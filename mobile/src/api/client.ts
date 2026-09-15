import { API_BASE_URL, SKIP_AUTH, DEV_USER_ID } from "../config";
import { auth } from "../config/firebase";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

// No request may hang forever — a stalled/blocked connection must surface as
// a retriable error, never an infinite spinner (App Review flagged Profile
// and Venues "loading indefinitely" on a network that couldn't reach the API
// promptly).
const REQUEST_TIMEOUT_MS = 15000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw Object.assign(new Error("Request timed out — check your connection and try again."), { status: 0 });
    }
    throw Object.assign(new Error(e?.message ?? "Network request failed — check your connection."), { status: 0 });
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (SKIP_AUTH) {
    headers["X-User-ID"] = DEV_USER_ID;
  } else {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const res = await timedFetch(`${API_BASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error ?? "Request failed"), {
      status: res.status,
    });
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Unauthenticated request for auth endpoints
export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await timedFetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}
