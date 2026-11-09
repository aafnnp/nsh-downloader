import type { Kind } from "../model";
import { kindOfType } from "../model";
import {
  filenameFromUrl,
  normalizeUrl,
  playlistKind,
  sanitizeFilename,
  withExtension,
} from "./urls";

export interface Probe {
  /** The URL that answered, after redirects. */
  url: string;
  filename: string;
  contentType: string;
  /** Total bytes, 0 when the server does not say. */
  total: number;
  acceptRanges: boolean;
  playlist: "hls" | "dash" | null;
  kind: Kind;
}

function parseContentDisposition(value: string | null): string {
  if (!value) return "";
  const encoded = /filename\*\s*=\s*([^']*)''([^;]+)/i.exec(value);
  if (encoded) {
    try {
      return sanitizeFilename(decodeURIComponent(encoded[2].trim()));
    } catch {
      // Fall through to the plain form.
    }
  }
  const plain = /filename\s*=\s*"([^"]+)"/i.exec(value) ?? /filename\s*=\s*([^;]+)/i.exec(value);
  return plain ? sanitizeFilename(plain[1].trim()) : "";
}

function parseTotal(contentLength: string | null, contentRange: string | null): number {
  if (contentRange) {
    const match = /\/(\d+)\s*$/.exec(contentRange);
    if (match) return Number(match[1]);
  }
  if (contentLength) {
    const value = Number(contentLength);
    if (isFinite(value) && value > 0) return value;
  }
  return 0;
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label}超时（${Math.round(ms / 1000)} 秒）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Asks the server what it holds before the transfer starts: size, type, name and whether ranges work. */
export async function probe(rawUrl: string): Promise<Probe> {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error("不是有效的 http(s) 链接");

  let response: Response | null = null;
  let failure: string = "";

  try {
    response = await withTimeout(
      (signal) => fetch(url, { method: "HEAD", redirect: "follow", signal }),
      15000,
      "连接服务器",
    );
    if (!response.ok) {
      failure = `HTTP ${response.status}`;
      response = null;
    }
  } catch (error) {
    failure = messageOf(error);
    response = null;
  }

  let ranged = false;
  if (!response) {
    // Some servers refuse HEAD, or hide the size from it: a one-byte range answers both.
    response = await withTimeout(
      (signal) => fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow", signal }),
      20000,
      "连接服务器",
    );
    if (!response.ok && response.status !== 206) {
      throw new Error(`${failure || "无法读取链接"}（HTTP ${response.status}）`);
    }
    ranged = response.status === 206;
    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
  }

  const finalUrl = response.url || url;
  const contentType = response.headers.get("content-type") ?? "";
  const total = parseTotal(response.headers.get("content-length"), response.headers.get("content-range"));
  const acceptRanges = ranged || (response.headers.get("accept-ranges") ?? "").toLowerCase().includes("bytes");

  let filename = parseContentDisposition(response.headers.get("content-disposition"));
  if (!filename) filename = filenameFromUrl(finalUrl);
  if (!filename) filename = "download";

  const playlist = playlistKind(finalUrl, contentType);
  const kind = playlist === "hls" ? "stream" : kindOfType(contentType, filename);
  filename = withExtension(filename, contentType, kind);

  return { url: finalUrl, filename, contentType, total, acceptRanges, playlist, kind };
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const coded = error as Error & { code?: string; resource?: string; permission?: string };
    if (coded.code === "ERR_ACCESS_DENIED") {
      if (coded.permission === "network") return "这个链接不被允许访问";
      if (coded.permission === "fs") return `没有写入权限：${coded.resource ?? "目标目录"}`;
      if (coded.permission === "process") return "无法启动下载引擎";
      return "没有权限执行这个操作";
    }
    return error.message || String(error);
  }
  return String(error);
}

