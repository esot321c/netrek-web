import type { CurrentUser, Session } from "../auth";
import type { ApiRequestOptions, ApiErrorResponse } from "./types";
import { ApiError } from "./types";

/**
 * Typed API client for the Netrek backend.
 *
 * Framework-agnostic — works with any fetch implementation.
 * Instantiate with your base URL and an optional token provider.
 */
export class NetrekClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken?: () => string | null | Promise<string | null>,
  ) {}

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  me(opts?: ApiRequestOptions) {
    return this.get<CurrentUser>("/v1/auth/me", opts);
  }

  getSessions(opts?: ApiRequestOptions) {
    return this.get<Session[]>("/v1/auth/sessions", opts);
  }

  deleteSession(sessionId: string, opts?: ApiRequestOptions) {
    return this.del<void>(`/v1/auth/sessions/${sessionId}`, opts);
  }

  deleteAllSessions(opts?: ApiRequestOptions) {
    return this.del<{ count: number }>("/v1/auth/sessions", opts);
  }

  // -------------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: ApiRequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...opts?.headers,
    };

    if (this.getToken) {
      const token = await this.getToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts?.signal,
      credentials: "include",
    });

    if (!res.ok) {
      const errorBody: ApiErrorResponse = await res.json().catch(() => ({
        statusCode: res.status,
        message: res.statusText,
      }));
      throw new ApiError(res.status, errorBody);
    }

    // 204 No Content
    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  private get<T>(path: string, opts?: ApiRequestOptions) {
    return this.request<T>("GET", path, undefined, opts);
  }

  private post<T>(path: string, body?: unknown, opts?: ApiRequestOptions) {
    return this.request<T>("POST", path, body, opts);
  }

  private put<T>(path: string, body?: unknown, opts?: ApiRequestOptions) {
    return this.request<T>("PUT", path, body, opts);
  }

  private del<T>(path: string, opts?: ApiRequestOptions) {
    return this.request<T>("DELETE", path, undefined, opts);
  }
}
