import type { ApiError as ApiErrorBody } from "@leadanchor/contracts";

/** An error response from the LeadAnchor API, with per-field messages for forms. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Json = Record<string, unknown> | unknown[];

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: Json | FormData;
}

/**
 * Calls the API through the same-origin /api proxy. Cookies travel automatically;
 * no API address, key or token is ever embedded in client code.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...rest,
    headers: {
      Accept: "application/json",
      ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });

  if (!response.ok) {
    let payload: Partial<ApiErrorBody> = {};
    try {
      payload = await response.json();
    } catch {
      // Non-JSON error (e.g. API offline) — fall through to a generic message.
    }
    throw new ApiError(
      response.status,
      payload.error?.code ?? (response.status === 502 || response.status === 504 ? "api_offline" : "request_failed"),
      payload.error?.message ?? (response.status >= 500 ? "The server is unavailable. Is the API running?" : "Request failed."),
      payload.error?.fields,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;
