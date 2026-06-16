import { NextRequest, NextResponse } from "next/server";
import { issueCsrf } from "@/lib/auth/csrf";
import { getAuthContext } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!auth.csrfRequired || !auth.tokenHash) return NextResponse.json({ csrfToken: null });
  return NextResponse.json({ csrfToken: issueCsrf(auth.tokenHash) });
}
