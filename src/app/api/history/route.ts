import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { requireDidiAccess } from "@/lib/api/guard";

const HISTORY_FILE_PATH = path.join(process.env.STATE_DIR || path.join(process.cwd(), "data"), "history.json");

async function ensureHistoryFile() {
    try {
        await fs.access(HISTORY_FILE_PATH);
    } catch (e) {
        await fs.mkdir(path.dirname(HISTORY_FILE_PATH), { recursive: true });
        await fs.writeFile(HISTORY_FILE_PATH, JSON.stringify([], null, 2), "utf-8");
    }
}

async function atomicWriteHistory(data: any[]) {
    const tempPath = `${HISTORY_FILE_PATH}.${Date.now()}.tmp`;
    try {
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
        await fs.rename(tempPath, HISTORY_FILE_PATH);
    } catch (e) {
        try { await fs.unlink(tempPath); } catch (_) {}
        throw e;
    }
}

export async function GET(req: NextRequest) {
    const gate = requireDidiAccess(req, "viewer", { action: "history_read" });
    if (!gate.ok) return gate.response;

    try {
        await ensureHistoryFile();
        const data = await fs.readFile(HISTORY_FILE_PATH, "utf-8");
        let history = JSON.parse(data);
        if (!Array.isArray(history)) history = [];

        if (process.env.AUTH_MODE === "required" && gate.auth.userId && gate.auth.role !== "superadmin") {
            history = history.filter((h: any) => h.createdByUserId === gate.auth.userId);
        }

        history.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return NextResponse.json(history);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const gate = requireDidiAccess(req, "operator", { csrf: true, action: "history_write" });
    if (!gate.ok) return gate.response;

    try {
        const entry = await req.json();
        await ensureHistoryFile();

        const data = await fs.readFile(HISTORY_FILE_PATH, "utf-8");
        let history = JSON.parse(data);
        if (!Array.isArray(history)) history = [];

        if (!entry.id) entry.id = Date.now().toString();
        if (!entry.date) entry.date = new Date().toISOString();

        if (process.env.AUTH_MODE === "required" && gate.auth.userId) {
            entry.createdByUserId = gate.auth.userId;
        }

        history.push(entry);
        const truncated = history
            .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 10000);

        await atomicWriteHistory(truncated);
        return NextResponse.json({ success: true, entry });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const gate = requireDidiAccess(req, "operator", { csrf: true, action: "history_delete" });
    if (!gate.ok) return gate.response;

    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");

        const data = await fs.readFile(HISTORY_FILE_PATH, "utf-8");
        let history = JSON.parse(data);
        if (!Array.isArray(history)) history = [];

        const isRequired = process.env.AUTH_MODE === "required";
        const userId = gate.auth.userId;

        if (!id) {
            let remainingHistory = [];
            if (isRequired && userId && gate.auth.role !== "superadmin") {
                remainingHistory = history.filter((h: any) => h.createdByUserId !== userId);
            }
            await atomicWriteHistory(remainingHistory);
            return NextResponse.json({ success: true, message: "Cleared all history" });
        }

        const entryToDelete = history.find((h: any) => h.id === id);
        if (entryToDelete && isRequired && userId && gate.auth.role !== "superadmin" && entryToDelete.createdByUserId !== userId) {
            return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }

        const newHistory = history.filter((h: any) => h.id !== id);

        await atomicWriteHistory(newHistory);
        return NextResponse.json({ success: true, message: `Deleted entry ${id}` });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
