import type { ChatMessage, Settings } from "../shared";
export class Feed {
  messages: ChatMessage[] = [];
  private seen = new Set<string>();
  add(message: ChatMessage) {
    const key = `${message.platform}:${message.id}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 10000)
      this.seen.delete(this.seen.values().next().value!);
    this.messages.push(message);
    this.messages.sort(
      (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
    );
    this.messages = this.messages.slice(-500);
    return true;
  }
  clear() {
    this.messages = [];
    this.seen.clear();
  }
}
export function videoId(input: string): string {
  if (/^[\w-]{11}$/.test(input)) return input;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Paste a YouTube livestream URL or 11-character video ID.");
  }
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Use a YouTube URL.");
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host))
    id =
      url.searchParams.get("v") ||
      (/^\/(live|shorts|embed)\//.test(url.pathname)
        ? url.pathname.split("/")[2]
        : null);
  if (!id || !/^[\w-]{11}$/.test(id))
    throw new Error("Use a direct YouTube video URL, not a channel URL.");
  return id;
}
export function settingsPatch(input: unknown): Partial<Settings> {
  if (!input || typeof input !== "object") throw new Error("Invalid settings.");
  const p = input as Record<string, unknown>,
    out: Partial<Settings> = {};
  for (const key of ["opacity", "fontSize"] as const)
    if (key in p) {
      if (typeof p[key] !== "number" || !Number.isFinite(p[key]))
        throw new Error("Invalid setting.");
      out[key] = Math.min(
        key === "opacity" ? 1 : 32,
        Math.max(key === "opacity" ? 0.2 : 12, p[key]),
      );
    }
  for (const key of ["alwaysOnTop", "clickThrough", "soundEnabled"] as const)
    if (key in p) {
      if (typeof p[key] !== "boolean") throw new Error("Invalid setting.");
      out[key] = p[key];
    }
  return out;
}
export const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
export class ApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
  ) {
    super(`API request failed (${status}: ${reason}).`);
  }
}
export async function jsonRequest(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  const data = (await response.json()) as any;
  if (!response.ok) {
    const raw = data.error?.errors?.[0]?.reason || data.error || data.message;
    const reason =
      typeof raw === "string" && /^[\w .:-]{1,90}$/.test(raw)
        ? raw
        : "request_failed";
    throw new ApiError(response.status, reason);
  }
  return data;
}
