import { useAuthStore } from "@/lib/store/auth-store";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export class HttpError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.data = data;
  }
}

function isErrorPayload(value: unknown): value is { error?: string; message?: string } {
  return typeof value === "object" && value !== null;
}

export async function apiFetch<T = unknown>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const { authMode, csrfToken, clearAuth } = useAuthStore.getState();

  const headers = new Headers(init?.headers);

  // Auto-inject CSRF Token for mutating requests in required auth mode
  const method = init?.method?.toUpperCase() || "GET";
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  if (authMode === "required" && isMutating && csrfToken) {
    if (!headers.has("X-CSRF-Token")) {
      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  // Ensure JSON requests set Content-Type if not uploading files/FormData
  const hasBody = !!init?.body;
  const isFormData = init?.body instanceof FormData;
  if (hasBody && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (typeof window !== "undefined" && typeof input === "string" && input.startsWith("/api/agent-admin")) {
    try {
      const persisted = JSON.parse(localStorage.getItem("agent-connect-store") || "{}");
      const selectedId = persisted?.state?.selectedId;
      if (typeof selectedId === "string" && selectedId && !headers.has("X-Agent-Connection-Id")) {
        headers.set("X-Agent-Connection-Id", selectedId);
      }
    } catch {
      // Ignore local storage parsing issues and let the server use the default declared connect.
    }
  }

  let response = await fetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let errorData: unknown = null;
    try {
      errorData = await response.json();
    } catch {
      // Not a JSON error
    }

    if (
      response.status === 403 &&
      typeof errorData === "object" &&
      errorData !== null &&
      "error" in errorData &&
      errorData.error === "csrf"
    ) {
      try {
        const csrfRes = await fetch("/api/security/csrf");
        if (csrfRes.ok) {
          const csrfData = await csrfRes.json();
          if (csrfData.csrfToken) {
            useAuthStore.setState({ csrfToken: csrfData.csrfToken });
            const retryHeaders = new Headers(headers);
            retryHeaders.set("X-CSRF-Token", csrfData.csrfToken);
            const retryResponse = await fetch(input, {
              ...init,
              headers: retryHeaders,
            });
            if (retryResponse.ok) {
              const contentType = retryResponse.headers.get("content-type") || "";
              if (!contentType.includes("application/json")) {
                return (await retryResponse.text()) as unknown as T;
              }
              return retryResponse.json();
            }
            response = retryResponse;
            try {
              errorData = await response.json();
            } catch {
              errorData = null;
            }
          }
        }
      } catch (e) {
        console.error("Failed to auto-recover CSRF:", e);
      }
    }

    if (response.status === 401) {
      clearAuth();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new HttpError("Unauthorized", 401, errorData);
    }

    const errorMsg =
      (isErrorPayload(errorData) && (errorData.error || errorData.message)) ||
      response.statusText ||
      `HTTP error ${response.status}`;
    throw new HttpError(errorMsg, response.status, errorData);
  }

  // Handle empty or text responses
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return (await response.text()) as unknown as T;
  }

  return response.json();
}

export function getHttpErrorStatus(error: unknown) {
  return error instanceof HttpError ? error.status : 0;
}

export function getAgentErrorType(error: unknown) {
  const status = getHttpErrorStatus(error);
  if (status === 403) return "forbidden" as const;
  if (status === 502) return "unreachable" as const;
  if (status === 503) return "not_configured" as const;
  return "general" as const;
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
