import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { audit, auditActor } from '@/lib/audit';
import { requireDidiAccess } from '@/lib/api/guard';
import { maskTaskSecrets } from '@/lib/credentials/vault';

function stateDir() {
    return process.env.STATE_DIR || path.join(process.cwd(), 'data');
}

// Local runtime path to store tasks.
const TASKS_FILE_PATH = path.join(stateDir(), 'tasks.json');

// Helper to ensure 'data' directory exists
async function ensureDataDir() {
    const dataDir = path.dirname(TASKS_FILE_PATH);
    try {
        await fs.access(dataDir);
    } catch (e) {
        await fs.mkdir(dataDir, { recursive: true });
    }
}

export async function GET(req: NextRequest) {
    const gate = requireDidiAccess(req, 'viewer', { action: 'tasks_read' });
    if (!gate.ok) return gate.response;

    try {
        await ensureDataDir();
        try {
            const data = await fs.readFile(TASKS_FILE_PATH, 'utf-8');
            const tasks = JSON.parse(data);
            const safeTasks = process.env.AUTH_MODE === 'required' ? tasks.map(maskTaskSecrets) : tasks;
            return NextResponse.json({ tasks: safeTasks });
        } catch (err: any) {
            // If file doesn't exist or is empty, return empty array
            if (err.code === 'ENOENT' || err instanceof SyntaxError) {
                return NextResponse.json({ tasks: [] });
            }
            throw err;
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const gate = requireDidiAccess(req, 'operator', { csrf: true, action: 'tasks_write' });
    if (!gate.ok) return gate.response;

    try {
        const body = await req.json();
        const { tasks } = body;

        if (!Array.isArray(tasks)) {
            return NextResponse.json({ error: 'Tasks must be an array' }, { status: 400 });
        }

        const tasksToWrite = process.env.AUTH_MODE === 'required'
            ? tasks.map((task) => ({
                ...task,
                apiKey: '',
                createdByUserId: task.createdByUserId || gate.auth.userId,
                scheduleOwnerUserId: task.isAutoSync ? (task.scheduleOwnerUserId || gate.auth.userId) : task.scheduleOwnerUserId,
            }))
            : tasks;

        await ensureDataDir();
        await fs.writeFile(TASKS_FILE_PATH, JSON.stringify(tasksToWrite, null, 2), 'utf-8');
        audit(auditActor(gate.auth.username), 'tasks_write', 'data/tasks.json', { count: tasksToWrite.length });

        return NextResponse.json({ success: true, count: tasksToWrite.length });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
