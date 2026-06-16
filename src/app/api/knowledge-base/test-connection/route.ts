import { NextRequest, NextResponse } from "next/server";
import { requireDidiAccess } from "@/lib/api/guard";
import { resolveCredential } from "@/lib/credentials/vault";

export async function POST(req: NextRequest) {
    const gate = requireDidiAccess(req, 'viewer', { csrf: true, action: 'test_connection' });
    if (!gate.ok) return gate.response;

    try {
        const { source, url, username, apiKey, credentialRef } = await req.json();
        const serverMode = process.env.AUTH_MODE === 'required';
        let resolvedUsername = username;
        let resolvedApiKey = apiKey;

        if (serverMode) {
            if (apiKey && apiKey !== "[redacted]") {
                return NextResponse.json({ success: false, message: "apiKey is not accepted in server mode" }, { status: 400 });
            }
            const resolved = resolveCredential({
                ref: credentialRef,
                actorUserId: gate.auth.userId,
                mode: 'required',
            });
            resolvedUsername = resolved.username;
            resolvedApiKey = resolved.token;
        }

        if (!url || !resolvedApiKey) {
            return NextResponse.json({ success: false, message: "Missing URL or API Key" }, { status: 400 });
        }

        let success = false;
        let message = "";
        let targetUrl = url.trim();
        if (!targetUrl.startsWith('http')) {
            targetUrl = `https://${targetUrl}`;
        }
        targetUrl = targetUrl.replace(/\/$/, '');

        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'X-Atlassian-Token': 'no-check'
        };

        if (source === 'confluence') {
            try {
                const tryConfAuth = async (authMethod: 'Basic' | 'Bearer') => {
                    const localHeaders = { ...headers };
                    if (authMethod === 'Basic') {
                        localHeaders['Authorization'] = `Basic ${Buffer.from(`${resolvedUsername || ''}:${resolvedApiKey}`).toString('base64')}`;
                    } else {
                        localHeaders['Authorization'] = `Bearer ${resolvedApiKey}`;
                    }
                    
                    return await fetch(`${targetUrl}/rest/api/content?limit=1`, {
                        headers: localHeaders,
                        signal: AbortSignal.timeout(15000)
                    });
                };

                // Try Basic first
                let response = await tryConfAuth('Basic');

                // If Basic fails, try Bearer (common for PATs or Mobile API tokens)
                if (!response.ok && (response.status === 401 || response.status === 400)) {
                    const bearerResponse = await tryConfAuth('Bearer');
                    if (bearerResponse.ok) {
                        response = bearerResponse;
                    }
                }

                if (response.ok) {
                    success = true;
                    message = "Kết nối Confluence thành công!";
                } else {
                    const status = response.status;
                    if (status === 401) {
                        message = "Sai Username hoặc API Key/Token (401)";
                    } else if (status === 403) {
                        message = "Không có quyền truy cập API Confluence (403 Forbidden)";
                    } else if (status === 404) {
                        message = "Không tìm thấy API Confluence (404 Not Found)";
                    } else if (status === 400) {
                        message = "Lỗi yêu cầu không hợp lệ (400 Bad Request) - Hãy kiểm tra URL";
                    } else {
                        message = `Lỗi hệ thống Confluence: Mã lỗi ${status}`;
                    }
                }
            } catch (err: any) {
                message = `Lỗi kết nối: ${err.message}`;
            }
        } else if (source === 'gitlab') {
            try {
                // GitLab use Private-Token header
                const response = await fetch(`${targetUrl}/api/v4/user`, {
                    headers: { ...headers, 'Private-Token': resolvedApiKey },
                    signal: AbortSignal.timeout(15000)
                });
                if (response.ok) {
                    const user = await response.json();
                    success = true;
                    message = `Kết nối GitLab thành công! (User: ${user.username})`;
                } else {
                    message = `Lỗi GitLab: ${response.status === 401 ? 'Sai Token/API Key' : `Mã lỗi ${response.status}`}`;
                }
            } catch (err: any) {
                message = `Lỗi kết nối GitLab: ${err.message}`;
            }
        } else if (source === 'jira') {
            try {
                const tryJiraAuth = async (authMethod: 'Basic' | 'Bearer') => {
                    const localHeaders = { ...headers };
                    if (authMethod === 'Basic') {
                        localHeaders['Authorization'] = `Basic ${Buffer.from(`${resolvedUsername || ''}:${resolvedApiKey}`).toString('base64')}`;
                    } else {
                        localHeaders['Authorization'] = `Bearer ${resolvedApiKey}`;
                    }

                    // Try myself first
                    let res = await fetch(`${targetUrl}/rest/api/2/myself`, {
                        headers: localHeaders,
                        signal: AbortSignal.timeout(15000)
                    });

                    // If failed, try serverInfo
                    if (!res.ok) {
                        res = await fetch(`${targetUrl}/rest/api/2/serverInfo`, {
                            headers: localHeaders,
                            signal: AbortSignal.timeout(15000)
                        });
                    }
                    return res;
                };

                // Try Basic first
                let response = await tryJiraAuth('Basic');

                // If Basic fails, try Bearer
                if (!response.ok && (response.status === 401 || response.status === 403)) {
                    const bearerResponse = await tryJiraAuth('Bearer');
                    if (bearerResponse.ok) {
                        response = bearerResponse;
                    }
                }

                if (response.ok) {
                    const data = await response.json();
                    success = true;
                    message = `Kết nối Jira thành công!${data.displayName ? ` (User: ${data.displayName})` : (data.version ? ` (Server v${data.version})` : '')}`;
                } else {
                    const status = response.status;
                    if (status === 401) {
                        message = "Sai Username hoặc API Key/Token (401)";
                    } else if (status === 403) {
                        message = "Không có quyền truy cập API Jira (403 Forbidden) - Hãy kiểm tra quyền của User/Token";
                    } else if (status === 404) {
                        message = "Không tìm thấy API Jira (404 Not Found)";
                    } else {
                        message = `Lỗi hệ thống Jira: Mã lỗi ${status}`;
                    }
                }
            } catch (err: any) {
                message = `Lỗi kết nối Jira: ${err.message}`;
            }
        }

        return NextResponse.json({ success, message });

    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}
