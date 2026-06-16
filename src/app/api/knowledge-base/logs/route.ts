import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { requireDidiAccess } from "@/lib/api/guard";

function stateDir() {
    return process.env.STATE_DIR || path.join(process.cwd(), "data");
}

export async function GET(req: NextRequest) {
    const gate = requireDidiAccess(req, "viewer", { action: "logs_read" });
    if (!gate.ok) return gate.response;

    try {
        const { searchParams } = new URL(req.url);
        const taskId = searchParams.get("taskId");

        if (!taskId) {
            return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
        }

        if (process.env.AUTH_MODE === "required" && gate.auth.userId && gate.auth.role !== "superadmin") {
            const TASKS_FILE_PATH = path.join(stateDir(), "tasks.json");
            const tasksData = await fs.readFile(TASKS_FILE_PATH, "utf-8").catch(() => "[]");
            const tasks = JSON.parse(tasksData);
            const task = tasks.find((t: any) => t.id === taskId);
            if (task && task.createdByUserId !== gate.auth.userId) {
                return NextResponse.json({ error: "forbidden" }, { status: 403 });
            }
        }

        const logFilePath = path.join(stateDir(), "logs/manual", `task_${taskId}.log`);

        try {
            const content = await fs.readFile(logFilePath, "utf8");
            const lines = content.split("\n").filter(Boolean);
            const logs = lines.map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return { type: 'log', message: line };
                }
            });
            return NextResponse.json({ logs });
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                return NextResponse.json({ logs: [] });
            }
            throw e;
        }

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
