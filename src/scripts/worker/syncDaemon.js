const cron = require('node-cron');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const STATE_DIR = process.env.STATE_DIR || path.join(process.cwd(), 'data');
const TASKS_FILE_PATH = path.join(STATE_DIR, 'tasks.json');
const LOGS_FILE_PATH = path.join(STATE_DIR, 'logs', 'sync.log');
const HISTORY_FILE_PATH = path.join(STATE_DIR, 'history.json');

const WORKFLOWS_FILE_PATH = path.join(STATE_DIR, 'workflows.json');

let isRunning = new Set(); // Prevent duplicate runs for same task or workflow ID

function getProjectRoot() {
    if (process.env.DIDI_APP_DIR) return process.env.DIDI_APP_DIR;

    const cwd = process.cwd();
    if (path.basename(cwd) === 'standalone' && path.basename(path.dirname(cwd)) === '.next') {
        return path.resolve(cwd, '../..');
    }
    return cwd;
}

async function resolveExistingPath(candidates, description) {
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch (e) {}
    }
    throw new Error(`${description} not found. Tried: ${candidates.join(', ')}`);
}

// Mutex lock for file updates to prevent read-modify-write race conditions
let fileLock = Promise.resolve();
async function withLock(action) {
    const currentLock = fileLock;
    let release;
    fileLock = new Promise(resolve => { release = resolve });
    await currentLock;
    try {
        await action();
    } finally {
        release();
    }
}

// Semaphore for process spawn limit
let activeProcesses = 0;
const processQueue = [];
async function acquireProcessSlot() {
    if (activeProcesses < 3) {
        activeProcesses++;
        return;
    }
    return new Promise(resolve => {
        processQueue.push(resolve);
    });
}
function releaseProcessSlot() {
    if (processQueue.length > 0) {
        const resolve = processQueue.shift();
        resolve();
    } else {
        activeProcesses--;
    }
}

async function atomicWriteFile(filePath, data) {
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`;
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(tempPath, data, 'utf-8');
        await fs.rename(tempPath, filePath);
    } catch (e) {
        // Cleanup temp file if it exists
        try { await fs.unlink(tempPath); } catch (u) {}
        throw e;
    }
}

async function logMsg(msg) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${msg}\n`;
    console.log(formatted.trim());
    try {
        await fs.mkdir(path.dirname(LOGS_FILE_PATH), { recursive: true });
        await fs.appendFile(LOGS_FILE_PATH, formatted);
    } catch (e) {
        console.error("Failed to write log", e);
    }
}

function getVaultDb() {
    const dbPath = path.join(STATE_DIR, 'didi.sqlite3');
    const db = new Database(dbPath, { readonly: false });
    db.pragma('foreign_keys = ON');
    return db;
}

function deriveVaultKey(info) {
    const secret = process.env.DIDI_APP_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error('DIDI_APP_SECRET must be at least 32 characters in server mode.');
    }
    return Buffer.from(crypto.hkdfSync('sha256', secret, '', info, 32));
}

function decryptVaultToken(buffer) {
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveVaultKey('cred-vault'), iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

function resolveScheduledCredential(task) {
    if ((process.env.AUTH_MODE || 'off') !== 'required') {
        return { username: task.username, token: task.apiKey, secure: false };
    }
    if (!task.credentialRef) {
        throw new Error(`Task ${task.id} has no credentialRef in server mode.`);
    }
    const ownerUserId = task.scheduleOwnerUserId || task.createdByUserId;
    if (!ownerUserId) {
        throw new Error(`Task ${task.id} has no scheduleOwnerUserId/createdByUserId in server mode.`);
    }

    const db = getVaultDb();
    try {
        const row = db.prepare(`
            SELECT username, token_encrypted as tokenEncrypted
            FROM credentials
            WHERE user_id = ? AND source = ? AND label = ? AND revoked = 0
        `).get(ownerUserId, task.credentialRef.source, task.credentialRef.label || 'default');
        if (!row) throw new Error(`Credential not found for task ${task.id}.`);
        return {
            username: row.username,
            token: decryptVaultToken(row.tokenEncrypted),
            secure: true
        };
    } finally {
        db.close();
    }
}

async function addHistoryEntry(taskName, status, processedFiles = 0, type = 'auto', url = '', errorLog = null) {
    await withLock(async () => {
        try {
            let history = [];
            try {
                const data = await fs.readFile(HISTORY_FILE_PATH, 'utf-8');
                history = JSON.parse(data);
            } catch (e) {
                // File might not exist
            }

            const entry = {
                id: Date.now().toString(),
                taskName: taskName,
                date: new Date().toISOString(),
                url: url,
                status: status,
                processedFiles: processedFiles,
                type: type,
                ...(errorLog ? { errorLog } : {})
            };

            history.push(entry);
            // Keep last 100
            const truncated = history.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 100);
            await atomicWriteFile(HISTORY_FILE_PATH, JSON.stringify(truncated, null, 2));
        } catch (e) {
            console.error("Failed to add history entry:", e);
        }
    });
}

async function runTask(task) {
    if (isRunning.has(task.id)) {
        await logMsg(`[INFO] Task ${task.name} (${task.id}) is already running, skipping.`);
        return;
    }

    isRunning.add(task.id);
    await logMsg(`[START] Starting auto-sync for task: ${task.name} (${task.id})`);

    try {
        let scriptName = "crawl_confluence.py";
        if (task.source === 'gitlab') scriptName = "crawl_gitlab.py";
        if (task.source === 'jira') scriptName = "crawl_jira.py";

        const credential = resolveScheduledCredential(task);
        const serverMode = credential.secure;
        const projectRoot = getProjectRoot();
        const crawlerScriptName = serverMode ? "crawlers_wrapper.py" : scriptName;
        const scriptPath = await resolveExistingPath(
            [
                path.join(projectRoot, "src/scripts/confluence_docs_tools", crawlerScriptName),
                path.join(process.cwd(), "src/scripts/confluence_docs_tools", crawlerScriptName),
            ],
            `Crawler script ${crawlerScriptName}`,
        );
        
        let finalOutputDir = task.outputDir;
        let finalFormats = task.formats || ['md'];
        
        if (serverMode) {
            if (task.downloadFiles !== false && task.outputDir) {
                finalOutputDir = task.outputDir;
                finalFormats = Array.isArray(task.formats) && task.formats.length > 0 ? task.formats : ['md'];
            } else {
                finalOutputDir = path.join(STATE_DIR, 'staging', task.id);
                finalFormats = ['md'];
            }
            await fs.mkdir(finalOutputDir, { recursive: true });
        } else if (task.downloadFiles === false) {
            finalOutputDir = path.join(os.tmpdir(), `kb-crawl-sync-${Date.now()}`);
            await fs.mkdir(finalOutputDir, { recursive: true });
            finalFormats = ['md'];
        }

        const args = serverMode
            ? [
                scriptPath,
                task.source,
                "--base-url", task.url,
                "--output-dir", finalOutputDir
            ]
            : [
                scriptPath,
                "--base-url", task.url,
                "--username", credential.username,
                "--api-key", credential.token,
                "--output-dir", finalOutputDir
            ];

        if (task.source === 'confluence') {
            args.push("--format", finalFormats.join(","));
            if (task.rules && task.rules.length > 0) {
                args.push("--rules-json", JSON.stringify(task.rules));
            }
        } else if (task.source === 'gitlab') {
            if (task.projectId) args.push("--project-id", task.projectId);
            if (task.groupId) args.push("--group-id", task.groupId);
            if (task.branch) args.push("--branch", task.branch);
        } else if (task.source === 'jira') {
            if (task.projectKey) args.push("--project-key", task.projectKey);
            if (task.jql) args.push("--jql", task.jql);
        }

        if (task.lastSyncTime) {
            args.push("--modified-since", task.lastSyncTime);
        }

        let processedFilesCount = 0;

        const venvPython = await resolveExistingPath(
            [
                path.join(projectRoot, '.venv', 'bin', 'python'),
                path.join(process.cwd(), '.venv', 'bin', 'python'),
            ],
            'Python virtual environment',
        );
        
        await acquireProcessSlot();
        try {
            await new Promise((resolve, reject) => {
                const pyProcess = spawn(venvPython, args, {
                    env: {
                        ...process.env,
                        ...(serverMode ? {
                            CRAWLER_USERNAME: credential.username,
                            CRAWLER_API_KEY: credential.token
                        } : {}),
                        DYLD_FALLBACK_LIBRARY_PATH: "/opt/homebrew/lib:/usr/local/lib:/usr/lib"
                    }
                });

                let stderrLog = "";
                pyProcess.stdout.on("data", (data) => {
                    const output = data.toString();
                    if (output.includes("[PROGRESS]")) {
                        processedFilesCount++;
                    }
                    const lines = output.split("\n");
                    for (const line of lines) {
                        const lowerLine = line.toLowerCase();
                        if (line.includes("[!]") || line.includes("[!!!]") || line.includes("XÁC THỰC THẤT BẠI") || lowerLine.includes("error") || lowerLine.includes("lỗi")) {
                            stderrLog += line + "\n";
                        }
                    }
                });

                pyProcess.stderr.on("data", (data) => {
                    const err = data.toString();
                    stderrLog += err;
                    if (err.trim()) logMsg(`[WARN] Python stderr: ${err.trim()}`);
                });

                pyProcess.on("close", (code) => {
                    if (code === 0) {
                        logMsg(`[SUCCESS] Task ${task.name} completed successfully.`);
                        resolve();
                    } else {
                        reject(new Error(`Python process exited with code ${code}. Log:\n${stderrLog.trim()}`));
                    }
                });
                
                pyProcess.on("error", (err) => {
                    reject(err);
                });
            });
        } finally {
            releaseProcessSlot();
        }

        // Update lastSyncTime upon success
        const nowStr = new Date().toISOString();
        await updateTaskLastSyncTime(task.id, nowStr);
        await addHistoryEntry(task.name, 'success', processedFilesCount, 'auto', task.url);
        await logMsg(`[INFO] Updated history & lastSyncTime for ${task.name}.`);

    } catch (err) {
        await logMsg(`[ERROR] Task ${task.name} failed: ${err.message}`);
        await addHistoryEntry(task.name, 'error', 0, 'auto', task.url, err.message);
    } finally {
        isRunning.delete(task.id);
    }
}

async function runWorkflow(workflow) {
    if (isRunning.has(workflow.id)) {
        await logMsg(`[INFO] Workflow ${workflow.name} (${workflow.id}) is already running, skipping.`);
        return;
    }

    isRunning.add(workflow.id);
    await logMsg(`[START] Starting auto-sync for workflow: ${workflow.name} (${workflow.id})`);

    try {
        const tasksData = await fs.readFile(TASKS_FILE_PATH, 'utf-8');
        const allTasks = JSON.parse(tasksData);

        // Find roots and chain (simplification: assume single chain)
        const roots = workflow.nodes.filter(n => !workflow.edges.find(e => e.target === n.id));
        let current = roots[0];
        
        while (current) {
            await logMsg(`[WORKFLOW] Executing node: ${current.data.label} (${current.id})`);
            
            if (current.data.taskType === 'taskExecution') {
                const taskIds = current.data.taskIds || [];
                if (taskIds.length === 0 && current.data.taskId) {
                    taskIds.push(current.data.taskId); // Migration support
                }

                for (const tid of taskIds) {
                    const task = allTasks.find(t => t.id === tid);
                    if (task) {
                        await logMsg(`[WORKFLOW] Executing sub-task: ${task.name} (${task.id})`);
                        // Temporarily remove from isRunning if it's there to allow runTask to proceed
                        const wasRunning = isRunning.has(task.id);
                        if (wasRunning) isRunning.delete(task.id);
                        
                        await runTask(task);
                        
                        if (wasRunning) isRunning.add(task.id);
                    } else {
                        await logMsg(`[ERROR] Linked task ${tid} not found for node ${current.id} in workflow "${workflow.name}". Task may have been deleted. Remove it from the node to fix.`);
                        await addHistoryEntry(`Tác vụ ${tid}`, 'error', 0, 'auto', '', `Task ID ${tid} không tồn tại trong hệ thống. Đã bị xóa khỏi Knowledge Base nhưng vẫn còn reference trong workflow "${workflow.name}". Vào chỉnh sửa node và bỏ chọn task này để khắc phục.`);
                    }
                }
            }
            
            const nextEdge = workflow.edges.find(e => e.source === current.id);
            if (nextEdge) {
                current = workflow.nodes.find(n => n.id === nextEdge.target);
            } else {
                break;
            }
        }

        const nowStr = new Date().toISOString();
        await updateWorkflowLastSyncTime(workflow.id, nowStr);
        await logMsg(`[SUCCESS] Workflow ${workflow.name} completed successfully.`);
        await addHistoryEntry(workflow.name, 'success', 0, 'workflow');

    } catch (err) {
        await logMsg(`[ERROR] Workflow ${workflow.name} failed: ${err.message}`);
        await addHistoryEntry(workflow.name, 'error', 0, 'workflow');
    } finally {
        isRunning.delete(workflow.id);
    }
}

async function updateTaskLastSyncTime(taskId, newTime) {
    await withLock(async () => {
        try {
            const rawData = await fs.readFile(TASKS_FILE_PATH, 'utf-8');
            let tasks = JSON.parse(rawData);
            const tf = tasks.find(t => t.id === taskId);
            if (tf) {
                tf.lastSyncTime = newTime;
                await atomicWriteFile(TASKS_FILE_PATH, JSON.stringify(tasks, null, 2));
            }
        } catch (e) {
            console.error("Failed to update last sync time:", e);
        }
    });
}

async function updateWorkflowLastSyncTime(workflowId, newTime) {
    await withLock(async () => {
        try {
            const rawData = await fs.readFile(WORKFLOWS_FILE_PATH, 'utf-8');
            let workflows = JSON.parse(rawData);
            const wf = workflows.find(w => w.id === workflowId);
            if (wf) {
                wf.lastSyncTime = newTime;
                await atomicWriteFile(WORKFLOWS_FILE_PATH, JSON.stringify(workflows, null, 2));
            }
        } catch (e) {
            console.error("Failed to update workflow last sync time:", e);
        }
    });
}

// Check schedule logic
function shouldRunNow(item) {
    if (!item.isAutoSync) return false;
    
    let { syncFrequency, syncTime, lastSyncTime } = item;
    const now = new Date();

    const lastRun = lastSyncTime ? new Date(lastSyncTime) : new Date(0);
    const msSinceLastRun = now.getTime() - lastRun.getTime();
    
    if (syncFrequency === 'hourly') {
        return msSinceLastRun >= 60 * 60 * 1000 - 30000; // allow a little buffer
    }

    if (!syncTime) return false; // Needs a time to run daily/weekly
    const [hStr, mStr] = syncTime.split(":");
    const targetH = parseInt(hStr, 10);
    const targetM = parseInt(mStr, 10);

    // If it's time (same hour/minute) and it hasn't run today
    if (now.getHours() === targetH && now.getMinutes() === targetM) {
        // If it ran in the last 23 hours, don't run it again
        if (msSinceLastRun < 23 * 60 * 60 * 1000) return false;

        if (syncFrequency === 'weekly') {
            return now.getDay() === 1; // 1 = Monday
        }
        
        return true; // daily
    }

    return false;
}

// Master cron runs every minute
cron.schedule('* * * * *', async () => {
    // Check individual tasks
    try {
        const rawData = await fs.readFile(TASKS_FILE_PATH, 'utf-8');
        const tasks = JSON.parse(rawData);
        for (const task of tasks) {
            if (shouldRunNow(task)) {
                runTask(task);
            }
        }
    } catch (e) {}

    // Check workflows
    try {
        const rawData = await fs.readFile(WORKFLOWS_FILE_PATH, 'utf-8');
        const workflows = JSON.parse(rawData);
        for (const wf of workflows) {
            if (shouldRunNow(wf)) {
                runWorkflow(wf);
            }
        }
    } catch (e) {}
});

logMsg("=== SYNC DAEMON STARTED ===");
console.log("Sync daemon is monitoring tasks and workflows every minute...");
