import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";
import { resolveCredential } from "@/lib/credentials/vault";

function getProjectRoot() {
    if (process.env.DIDI_APP_DIR) return process.env.DIDI_APP_DIR;

    const cwd = process.cwd();
    if (path.basename(cwd) === "standalone" && path.basename(path.dirname(cwd)) === ".next") {
        return path.resolve(cwd, "../..");
    }
    return cwd;
}

async function resolveExistingPath(candidates: string[], description: string) {
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // Try the next known runtime location.
        }
    }
    throw new Error(`${description} not found. Tried: ${candidates.join(", ")}`);
}

function stateDir() {
    return process.env.STATE_DIR || path.join(process.cwd(), "data");
}

export async function POST(req: NextRequest) {
    const gate = requireDidiAccess(req, 'operator', { csrf: true, action: 'crawl_run' });
    if (!gate.ok) return gate.response;

    try {
        const body = await req.json();
        const { 
            source, url, username, apiKey, rules, formats, outputDir, 
            queryPrompt, modelSelection, downloadFiles, enableAiProcessing,
            lastSyncTime, projectKey, projectId, groupId, branch, jql,
            taskId, taskName, credentialRef, scheduleOwnerUserId
        } = body;

        const serverMode = process.env.AUTH_MODE === 'required';
        let resolvedUsername = username;
        let resolvedApiKey = apiKey;
        let useCredentialWrapper = false;

        if (serverMode) {
            if (apiKey && apiKey !== "[redacted]") {
                return NextResponse.json({ error: "apiKey is not accepted in server mode" }, { status: 400 });
            }
            const resolved = resolveCredential({
                ref: credentialRef,
                actorUserId: gate.auth.userId,
                scheduleOwnerUserId,
                mode: 'required',
            });
            resolvedUsername = resolved.username;
            resolvedApiKey = resolved.token;
            useCredentialWrapper = true;
        }

        if (!url || !resolvedUsername || !resolvedApiKey || (source === 'confluence' && !rules)) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        let finalOutputDir = outputDir;
        let finalFormats = formats;
        let isTempDir = false;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        if (serverMode) {
            if (downloadFiles !== false && outputDir) {
                finalOutputDir = outputDir;
                finalFormats = Array.isArray(formats) && formats.length > 0 ? formats : ['md'];
            } else {
                finalOutputDir = path.join(stateDir(), 'staging', taskId || `manual-${Date.now()}`);
                finalFormats = ['md'];
            }
            await fs.mkdir(finalOutputDir, { recursive: true });
        } else if (downloadFiles === false) {
            finalOutputDir = path.join(os.tmpdir(), `kb-crawl-${Date.now()}`);
            await fs.mkdir(finalOutputDir, { recursive: true });
            finalFormats = ['md'];
            isTempDir = true;
        } else if (!outputDir || (!formats && source === 'confluence') || (formats && formats.length === 0)) {
            return NextResponse.json({ error: "Missing Output Config fields" }, { status: 400 });
        }

        let scriptName = "crawl_confluence.py";
        if (source === 'gitlab') scriptName = "crawl_gitlab.py";
        if (source === 'jira') scriptName = "crawl_jira.py";

        const projectRoot = getProjectRoot();
        const crawlerScriptName = useCredentialWrapper ? "crawlers_wrapper.py" : scriptName;
        const scriptPath = await resolveExistingPath(
            [
                path.join(projectRoot, "src/scripts/confluence_docs_tools", crawlerScriptName),
                path.join(process.cwd(), "src/scripts/confluence_docs_tools", crawlerScriptName),
            ],
            `Crawler script ${crawlerScriptName}`,
        );

        const args = useCredentialWrapper
            ? [
                scriptPath,
                source,
                "--base-url", url,
                "--output-dir", finalOutputDir,
            ]
            : [
                scriptPath,
                "--base-url", url,
                "--username", resolvedUsername,
                "--api-key", resolvedApiKey,
                "--output-dir", finalOutputDir,
            ];

        if (source === 'confluence') {
            args.push("--format", (finalFormats || ['md']).join(","));
            if (rules && rules.length > 0) {
                args.push("--rules-json", JSON.stringify(rules));
            }
        } else if (source === 'gitlab') {
            if (projectId) args.push("--project-id", projectId);
            if (groupId) args.push("--group-id", groupId);
            if (branch) args.push("--branch", branch);
        } else if (source === 'jira') {
            if (projectKey) args.push("--project-key", projectKey);
            if (jql) args.push("--jql", jql);
        }

        if (lastSyncTime) {
            args.push("--modified-since", lastSyncTime);
        }

        const encoder = new TextEncoder();

        const logFilePath = taskId ? path.join(stateDir(), "logs/manual", `task_${taskId}.log`) : null;
        if (logFilePath) {
            await fs.mkdir(path.dirname(logFilePath), { recursive: true });
            await fs.writeFile(logFilePath, "", "utf8"); // Clear old log
        }

        const venvPython = await resolveExistingPath(
            [
                path.join(projectRoot, ".venv", "bin", "python"),
                path.join(process.cwd(), ".venv", "bin", "python"),
            ],
            "Python virtual environment",
        );

        const stream = new ReadableStream({
            async start(controller) {
                const pyProcess = spawn(venvPython, args, {
                    env: {
                        ...process.env,
                        ...(useCredentialWrapper ? {
                            CRAWLER_USERNAME: resolvedUsername,
                            CRAWLER_API_KEY: resolvedApiKey,
                        } : {}),
                        DYLD_FALLBACK_LIBRARY_PATH: "/opt/homebrew/lib:/usr/local/lib:/usr/lib"
                    }
                });
                let streamClosed = false;

                const writeToLog = async (data: any) => {
                    if (logFilePath) {
                        try {
                            await fs.appendFile(logFilePath, JSON.stringify(data) + "\n", "utf8");
                        } catch (e) {
                            console.error("Failed to write manual log:", e);
                        }
                    }
                };

                const enqueueAndLog = (data: any) => {
                    if (streamClosed) return;
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                        writeToLog(data);
                    } catch (e) {
                        streamClosed = true;
                        console.error("Stream controller error:", e);
                    }
                };

                const closeStream = () => {
                    if (streamClosed) return;
                    streamClosed = true;
                    try {
                        controller.close();
                    } catch (e) {
                        console.error("Stream controller close error:", e);
                    }
                };

                // --- Handle Abort Signal from the Client UI ---
                req.signal.addEventListener('abort', async () => {
                    if (streamClosed) return;
                    console.log("[API] Client aborted the request. Killing python process...");
                    try {
                        pyProcess.kill('SIGKILL');
                    } catch (e) {
                        console.error("Error killing pyProcess:", e);
                    }
                    if (isTempDir && finalOutputDir) {
                        try {
                            await fs.rm(finalOutputDir, { recursive: true, force: true });
                            console.log("[API] Cleaned up temporary directory due to abort.");
                        } catch (e) {
                            console.error("Cleanup error on abort:", e);
                        }
                    }
                    closeStream();
                });

                let processedFilesCount = 0;
                let fullErrorLog = "";

                pyProcess.stdout.on("data", (data) => {
                    const output = data.toString();
                    if (output.includes("[PROGRESS]")) {
                        processedFilesCount++;
                    }
                    const lines = output.split("\n");
                    for (const line of lines) {
                        if (line.trim()) {
                            enqueueAndLog({ type: 'log', message: line });
                            const lowerLine = line.toLowerCase();
                            if (line.includes("[!]") || line.includes("[!!!]") || line.includes("XÁC THỰC THẤT BẠI") || lowerLine.includes("error") || lowerLine.includes("lỗi")) {
                                fullErrorLog += line + "\n";
                            }
                        }
                    }
                });

                pyProcess.stderr.on("data", (data) => {
                    const output = data.toString();
                    fullErrorLog += output;
                    const lines = output.split("\n");
                    for (const line of lines) {
                        if (line.trim()) {
                            enqueueAndLog({ type: 'error', message: line });
                        }
                    }
                });

                pyProcess.on("close", async (code) => {
                    if (streamClosed) return;
                    if (code === 0) {
                        audit(auditActor(gate.auth.username), 'crawl_success', taskId || taskName || source, {
                            source,
                            serverMode,
                            outputDir: serverMode ? finalOutputDir : undefined,
                        });
                    }

                    // Proceed to AI processing if python succeeded, AI is enabled, and queryPrompt exists
                    if (code === 0 && enableAiProcessing && queryPrompt && queryPrompt.trim() !== "") {
                        try {
                            enqueueAndLog({ type: 'log', message: 'Đang chuẩn bị dữ liệu gộp từ thư mục...' });

                            const files = await fs.readdir(finalOutputDir, { recursive: true });
                            
                            // Define supported text extensions for AI context
                            const textExtensions = ['.md', '.txt', '.py', '.js', '.ts', '.tsx', '.java', '.go', '.c', '.cpp', '.h', '.hpp', '.sh', '.yaml', '.yml', '.json', '.xml'];
                            
                            const targetFiles = files.filter(f => {
                                const ext = path.extname(f.toString()).toLowerCase();
                                if (source === 'gitlab') {
                                    return textExtensions.includes(ext);
                                }
                                return ext === '.md';
                            });

                            let extractedText = "";
                            for (const file of targetFiles) {
                                const filePath = path.join(finalOutputDir, file.toString());
                                const stat = await fs.stat(filePath);
                                if (stat.isDirectory()) continue;

                                const content = await fs.readFile(filePath, 'utf8');
                                extractedText += `\n--- File: ${file} ---\n${content}\n`;
                            }

                            if (extractedText.trim().length === 0) {
                                throw new Error("Không thu thập được nội dung text (Markdown) nào để AI xử lý.");
                            }

                            const geminiApiKey = process.env.GEMINI_API_KEY || "";
                            if (!geminiApiKey) {
                                throw new Error("GEMINI_API_KEY chưa được cấu hình trong file .env. Vào Settings để thêm Gemini API Key.");
                            }

                            const genAI = new GoogleGenerativeAI(geminiApiKey);
                            const model = genAI.getGenerativeModel({ model: modelSelection || 'gemini-2.5-flash' });

                            // Safeguard for Gemini 2.5 Free Tier (250,000 input tokens max / min)
                            // 1 token ~ 4 characters. 400,000 chars ~ 100k tokens per chunk.
                            const MAX_CHARS = 400000;
                            let totalInputTokens = 0;
                            let totalOutputTokens = 0;

                            if (extractedText.length <= MAX_CHARS) {
                                enqueueAndLog({ type: 'log', message: 'Đang xử lý dữ liệu với AI...' });

                                const finalPrompt = `Ngữ cảnh:\n${extractedText}\n\nYêu cầu phân tích:\n${queryPrompt}\n\nQuy tắc định dạng: Trình bày kết quả cực kỳ dễ đọc, spacing rộng thoáng. Tách biệt rõ ràng các Section bằng Heading (H2, H3). Bắt buộc dùng Bullet point (danh sách thụt lề phân cấp rõ ràng) đối với các nội dung mang tính liệt kê. Làm theo cấu trúc tài liệu tiêu chuẩn chuyên nghiệp. TRẢ LỜI NGẮN GỌN NHƯNG ĐỦ Ý.`;

                                const countResult = await model.countTokens(finalPrompt);
                                totalInputTokens += countResult.totalTokens;

                                const resultStream = await model.generateContentStream(finalPrompt);

                                let fullResponse = "";
                                for await (const chunk of resultStream.stream) {
                                    if (streamClosed) break;
                                    if (chunk.text()) {
                                        fullResponse += chunk.text();
                                        enqueueAndLog({ type: 'llm_chunk', message: chunk.text() });
                                    }
                                }

                                const outputCountResult = await model.countTokens(fullResponse);
                                totalOutputTokens += outputCountResult.totalTokens;

                                enqueueAndLog({ type: 'cost_estimation', inputTokens: totalInputTokens, outputTokens: totalOutputTokens });

                            } else {
                                enqueueAndLog({ type: 'error', message: "Dữ liệu gốc quá lớn (" + Math.round(extractedText.length / 1000) + "k ký tự). Bật cơ chế chia nhỏ và tổng hợp (Map-Reduce)..." });

                                const chunks: string[] = [];
                                for (let i = 0; i < extractedText.length; i += MAX_CHARS) {
                                    chunks.push(extractedText.substring(i, i + MAX_CHARS));
                                }

                                const chunkResponses: string[] = [];
                                for (let i = 0; i < chunks.length; i++) {
                                    if (streamClosed) break;
                                    enqueueAndLog({ type: 'log', message: "Đang xử lý phần " + (i + 1) + "/" + chunks.length + " với AI..." });

                                    const chunkPrompt = "Ngữ cảnh cục bộ phần " + (i + 1) + "/" + chunks.length + " của một tài liệu lớn:\n" + chunks[i] + "\n\nYêu cầu phân tích:\n" + queryPrompt + "\n\n👉 QUY CHUẨN TRÍCH XUẤT (QUAN TRỌNG):\n- TRÌNH BÀY DƯỚI DẠNG MARKDOWN CHUẨN.\n- BẮT BUỘC BẮT BUỘC dùng dấu `- ` (gạch ngang và dấu cách) ở đầu dòng để tạo Bullet List cho MỌI nội dung liệt kê (như tham số, mô tả, bước thực hiện). KHÔNG VIẾT text gạch đầu dòng ảo.\n- Các phần nội dung phải cách nhau bằng 1 DÒNG TRỐNG (Double Enter).";

                                    let attempts = 0;
                                    let success = false;
                                    while (attempts < 5 && !success) {
                                        try {
                                            const countResult = await model.countTokens(chunkPrompt);
                                            totalInputTokens += countResult.totalTokens;

                                            const result = await model.generateContent(chunkPrompt);
                                            const responseText = result.response.text();
                                            chunkResponses.push(responseText);

                                            const outputCountResult = await model.countTokens(responseText);
                                            totalOutputTokens += outputCountResult.totalTokens;

                                            enqueueAndLog({ type: 'log', message: "Đã hoàn thành phân tích phần " + (i + 1) + "/" + chunks.length + "." });
                                            success = true;
                                        } catch (e: any) {
                                            if (e.message && e.message.includes('429')) {
                                                attempts++;
                                                enqueueAndLog({ type: 'log', message: "Hệ thống AI đang quá tải (Rate limit 429). Đang đợi 30s để thử lại lần " + attempts + " cho phần " + (i + 1) + "..." });
                                                await new Promise(resolve => setTimeout(resolve, 30000));
                                            } else {
                                                enqueueAndLog({ type: 'error', message: "Lỗi khi xử lý AI phần " + (i + 1) + ": " + e.message });
                                                chunkResponses.push("(Phần " + (i + 1) + " gặp lỗi xử lý AI: " + e.message + ")");
                                                break;
                                            }
                                        }
                                    }

                                    if (!success && attempts >= 5) {
                                        chunkResponses.push("(Phần " + (i + 1) + " bị bỏ qua do quá tải AI liên tục)");
                                    }

                                    // Delay to respect API Free Tier limit (~15 RPM)
                                    if (i < chunks.length - 1) {
                                        await new Promise(resolve => setTimeout(resolve, 3000));
                                    }
                                }

                                enqueueAndLog({ type: 'log', message: 'Đang tổng hợp các phân tích thành kết quả cuối cùng...' });

                                const finalCombinePrompt = "Dưới đây là các bản phân tích chi tiết được chắt lọc từ nhiều phần của tài liệu:\n\n" + chunkResponses.map((r, idx) => "=== Phân tích phần " + (idx + 1) + " ===\n" + r).join('\n\n') + "\n\nDựa vào toàn bộ các phần trên, hãy tổng hợp lại một cách đầy đủ nhất theo lệnh của người dùng:\n" + queryPrompt + "\n\n🚨 QUY HIỆU ĐỊNH DẠNG MARKDOWN BẮT BUỘC (KHÔNG LÀM THEO SẼ BỊ LỖI HIỂN THỊ):\n1. DANH SÁCH LIỆT KÊ TỰ ĐỘNG: ĐỐI VỚI BẤT KỲ thông tin nào mang tính liệt kê (tham số `client_id`, mã lỗi, thuộc tính...), BẮT BUỘC phải dùng cú pháp Markdown List (Bắt đầu bằng dấu `- ` hoặc `* `). KHÔNG ĐƯỢC viết liền hoặc chỉ xuống dòng mà không có dấu `- `.\n2. LÙI ĐẦU DÒNG (NESTED LIST): Sử dụng 2 khoảng trắng (Space) trước dấu `- ` để tạo List phân cấp (Ví dụ: `  - Chi tiết nhỏ`).\n3. KHOẢNG TRẮNG GIỮA CÁC ĐOẠN (SPACING): Bắt buộc để lại MỘT DÒNG TRỐNG (Enter 2 lần) giữa các đoạn văn (Paragraph), giữa đoạn văn và danh sách, giữa các Heading.\n4. TIÊU ĐỀ: Chỉ dùng `## ` và `### ` cho Tiêu đề. TUYỆT ĐỐI KHÔNG DÙNG Bôi Đậm (`**Text**`) để làm giả Tiêu đề ảo.";

                                let finalAttempts = 0;
                                let finalSuccess = false;
                                while (finalAttempts < 5 && !finalSuccess) {
                                    try {
                                        const countResult = await model.countTokens(finalCombinePrompt);
                                        totalInputTokens += countResult.totalTokens;

                                        const finalResultStream = await model.generateContentStream(finalCombinePrompt);

                                        let fullFinalResponse = "";
                                        for await (const chunk of finalResultStream.stream) {
                                            if (streamClosed) break;
                                            if (chunk.text()) {
                                                fullFinalResponse += chunk.text();
                                                enqueueAndLog({ type: 'llm_chunk', message: chunk.text() });
                                            }
                                        }

                                        const outputCountResult = await model.countTokens(fullFinalResponse);
                                        totalOutputTokens += outputCountResult.totalTokens;

                                        enqueueAndLog({ type: 'cost_estimation', inputTokens: totalInputTokens, outputTokens: totalOutputTokens });

                                        finalSuccess = true;
                                    } catch (e: any) {
                                        if (e.message && e.message.includes('429')) {
                                            finalAttempts++;
                                            enqueueAndLog({ type: 'log', message: "Hệ thống AI đang quá tải khi tổng hợp chung. Đang đợi 30s để thử lại lần " + finalAttempts + "..." });
                                            await new Promise(resolve => setTimeout(resolve, 30000));
                                        } else {
                                            enqueueAndLog({ type: 'error', message: "Lỗi khi tổng hợp kết quả AI: " + e.message });
                                            break;
                                        }
                                    }
                                }
                            }

                        } catch (err: any) {
                                let friendlyErrMsg = err.message || "Unknown AI error";
                                // Phân loại lỗi Gemini phổ biến
                                if (err.message?.includes('API_KEY_INVALID') || err.message?.includes('401')) {
                                    friendlyErrMsg = "GEMINI_API_KEY không hợp lệ hoặc đã hết hạn. Vào Settings để cập nhật key mới.";
                                } else if (err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('429') || err.message?.includes('quota')) {
                                    friendlyErrMsg = "Đã vượt quá giới hạn quota của Gemini API (free tier). Chờ reset quota hoặc upgrade plan.";
                                } else if (err.message?.includes('PERMISSION_DENIED') || err.message?.includes('403')) {
                                    friendlyErrMsg = "API key không có quyền truy cập model này. Kiểm tra lại Gemini API Key.";
                                } else if (err.message?.includes('fetch') || err.message?.includes('ECONNREFUSED') || err.message?.includes('ENOTFOUND')) {
                                    friendlyErrMsg = "Không thể kết nối tới Gemini API. Kiểm tra kết nối mạng/VPN.";
                                }
                                enqueueAndLog({ type: 'error', message: "Lỗi AI: " + friendlyErrMsg });
                                fullErrorLog += "\nLỗi AI: " + friendlyErrMsg;
                                code = 1; // Mark as error for history
                        }
                    }

                    // Temp cleanup
                    if (isTempDir) {
                        try {
                            await fs.rm(finalOutputDir, { recursive: true, force: true });
                            enqueueAndLog({ type: 'log', message: 'Đã dọn dẹp thư mục tạm thành công.' });
                        } catch (e) {
                            // Suppress cleanup error logging to client because it isn't critical
                        }
                    }

                    // Record history — dùng atomic write để tránh race condition với sync daemon
                    try {
                        const HISTORY_FILE_PATH = path.join(stateDir(), "history.json");
                        let history = [];
                        try {
                            const data = await fs.readFile(HISTORY_FILE_PATH, "utf-8");
                            history = JSON.parse(data);
                            if (!Array.isArray(history)) history = [];
                        } catch (e) { history = []; }

                        history.push({
                            id: Date.now().toString(),
                            taskName: taskName || "Tác vụ không tên",
                            date: new Date().toISOString(),
                            url: url,
                            keywords: (rules && rules[0]?.keywords) || jql || "",
                            status: code === 0 ? "success" : "error",
                            inputTokens: totalInputTokens,
                            outputTokens: totalOutputTokens,
                            processedFiles: processedFilesCount,
                            modelName: modelSelection,
                            type: "manual",
                            errorLog: code === 0 ? undefined : (fullErrorLog || "Unknown execution error").trim()
                        });

                        const truncated = history
                            .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
                            .slice(0, 10000);

                        // Atomic write: ghi vào file tạm trước, sau đó rename để tránh corrupt
                        const tempPath = `${HISTORY_FILE_PATH}.${Date.now()}.tmp`;
                        try {
                            await fs.writeFile(tempPath, JSON.stringify(truncated, null, 2), "utf-8");
                            await fs.rename(tempPath, HISTORY_FILE_PATH);
                        } catch (writeErr) {
                            try { await fs.unlink(tempPath); } catch (_) {}
                            throw writeErr;
                        }
                    } catch (historyErr) {
                        console.error("Failed to save history:", historyErr);
                    }


                    enqueueAndLog({ type: 'done', code });
                    closeStream();
                });

                pyProcess.on("error", (err) => {
                    enqueueAndLog({ type: 'error', message: err.message });
                    closeStream();
                });
            }
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
