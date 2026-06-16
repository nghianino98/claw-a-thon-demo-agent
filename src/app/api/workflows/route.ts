import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { requireDidiAccess } from "@/lib/api/guard";

const WORKFLOWS_FILE_PATH = path.join(process.env.STATE_DIR || path.join(process.cwd(), "data"), "workflows.json");

async function ensureFile() {
    try {
        await fs.access(WORKFLOWS_FILE_PATH);
    } catch {
        await fs.mkdir(path.dirname(WORKFLOWS_FILE_PATH), { recursive: true });
        await fs.writeFile(WORKFLOWS_FILE_PATH, "[]", "utf-8");
    }
}

export async function GET(req: NextRequest) {
    const gate = requireDidiAccess(req, "viewer", { action: "workflows_read" });
    if (!gate.ok) return gate.response;

    try {
        await ensureFile();
        const data = await fs.readFile(WORKFLOWS_FILE_PATH, "utf-8");
        return NextResponse.json(JSON.parse(data));
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const gate = requireDidiAccess(req, "operator", { csrf: true, action: "workflows_write" });
    if (!gate.ok) return gate.response;

    try {
        await ensureFile();
        const body = await req.json();
        
        const data = await fs.readFile(WORKFLOWS_FILE_PATH, "utf-8");
        let workflows = JSON.parse(data);
        
        if (Array.isArray(body)) {
            workflows = body;
        } else if (body && body.workflows && Array.isArray(body.workflows)) {
            workflows = body.workflows;
        } else {
            const workflow = body;
            const index = workflows.findIndex((w: { id: string }) => w.id === workflow.id);
            if (index !== -1) {
                workflows[index] = { ...workflows[index], ...workflow, updatedAt: Date.now() };
            } else {
                workflows.push({ ...workflow, updatedAt: Date.now() });
            }
        }
        
        await fs.writeFile(WORKFLOWS_FILE_PATH, JSON.stringify(workflows, null, 2), "utf-8");
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const gate = requireDidiAccess(req, "operator", { csrf: true, action: "workflows_delete" });
    if (!gate.ok) return gate.response;

    try {
        const { id } = await req.json();
        await ensureFile();
        
        const data = await fs.readFile(WORKFLOWS_FILE_PATH, "utf-8");
        let workflows = JSON.parse(data);
        
        workflows = workflows.filter((w: { id: string }) => w.id !== id);
        
        await fs.writeFile(WORKFLOWS_FILE_PATH, JSON.stringify(workflows, null, 2), "utf-8");
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
