import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import os from "os";
import { requireDidiAccess } from "@/lib/api/guard";

export async function POST(req: NextRequest) {
    const gate = requireDidiAccess(req, "superadmin", { csrf: true, action: "open_folder" });
    if (!gate.ok) return gate.response;

    try {
        const { path } = await req.json();
        if (!path) return NextResponse.json({ error: "No path" }, { status: 400 });

        let command = "";
        if (os.platform() === 'darwin') {
            command = `open "${path}"`;
        } else if (os.platform() === 'win32') {
            command = `start "" "${path}"`;
        } else {
            command = `xdg-open "${path}"`;
        }

        exec(command);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
