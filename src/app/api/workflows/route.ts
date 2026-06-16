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
        let workflows = JSON.parse(data);
        if (!Array.isArray(workflows)) workflows = [];

        if (process.env.AUTH_MODE === "required" && gate.auth.userId && gate.auth.role !== "superadmin") {
            workflows = workflows.filter((w: any) => w.createdByUserId === gate.auth.userId);
        }

        return NextResponse.json(workflows);
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
        const workflows = JSON.parse(data);

        const isRequired = process.env.AUTH_MODE === "required";
        const userId = gate.auth.userId;

        const otherUsersWorkflows = isRequired && userId && gate.auth.role !== "superadmin"
            ? workflows.filter((w: any) => w.createdByUserId !== userId)
            : [];

        let userWorkflows = isRequired && userId && gate.auth.role !== "superadmin"
            ? workflows.filter((w: any) => w.createdByUserId === userId)
            : workflows;

        if (Array.isArray(body)) {
            userWorkflows = body.map(w => ({ ...w, createdByUserId: w.createdByUserId || userId }));
        } else if (body && body.workflows && Array.isArray(body.workflows)) {
            userWorkflows = body.workflows.map((w: any) => ({ ...w, createdByUserId: w.createdByUserId || userId }));
        } else {
            const workflow = body;
            const existingWf = workflows.find((w: any) => w.id === workflow.id);
            if (existingWf && isRequired && userId && gate.auth.role !== "superadmin" && existingWf.createdByUserId !== userId) {
                return NextResponse.json({ error: "forbidden" }, { status: 403 });
            }

            const index = userWorkflows.findIndex((w: { id: string }) => w.id === workflow.id);
            if (index !== -1) {
                userWorkflows[index] = { ...userWorkflows[index], ...workflow, updatedAt: Date.now(), createdByUserId: workflow.createdByUserId || userId };
            } else {
                userWorkflows.push({ ...workflow, updatedAt: Date.now(), createdByUserId: workflow.createdByUserId || userId });
            }
        }

        const finalWorkflows = [...otherUsersWorkflows, ...userWorkflows];

        await fs.writeFile(WORKFLOWS_FILE_PATH, JSON.stringify(finalWorkflows, null, 2), "utf-8");
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
        if (!Array.isArray(workflows)) workflows = [];

        const isRequired = process.env.AUTH_MODE === "required";
        const userId = gate.auth.userId;

        const workflowToDelete = workflows.find((w: any) => w.id === id);
        if (workflowToDelete && isRequired && userId && gate.auth.role !== "superadmin" && workflowToDelete.createdByUserId !== userId) {
            return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }

        workflows = workflows.filter((w: { id: string }) => w.id !== id);

        await fs.writeFile(WORKFLOWS_FILE_PATH, JSON.stringify(workflows, null, 2), "utf-8");
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
