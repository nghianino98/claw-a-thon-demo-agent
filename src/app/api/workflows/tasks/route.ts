import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { requireDidiAccess } from "@/lib/api/guard";
import { maskTaskSecrets } from "@/lib/credentials/vault";

const TASKS_FILE_PATH = path.join(process.env.STATE_DIR || path.join(process.cwd(), "data"), "tasks.json");

export async function GET(req: NextRequest) {
    const gate = requireDidiAccess(req, "viewer", { action: "workflow_tasks_read" });
    if (!gate.ok) return gate.response;

    try {
        const data = await fs.readFile(TASKS_FILE_PATH, "utf-8");
        let tasks = JSON.parse(data);
        if (!Array.isArray(tasks)) tasks = [];

        if (process.env.AUTH_MODE === "required" && gate.auth.userId && gate.auth.role !== "superadmin") {
            tasks = tasks.filter((t: any) => t.createdByUserId === gate.auth.userId);
        }

        return NextResponse.json(process.env.AUTH_MODE === "required" ? tasks.map(maskTaskSecrets) : tasks);
    } catch (error: any) {
        return NextResponse.json({ error: error.message || "Failed to read tasks" }, { status: 500 });
    }
}
