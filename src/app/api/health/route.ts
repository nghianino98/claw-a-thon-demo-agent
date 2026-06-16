import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    app: "didi-ai-tool",
    authMode: process.env.AUTH_MODE || "off",
    timestamp: Date.now(),
  });
}
