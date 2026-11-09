import { run } from "process";
import type { EngineId } from "../model";

export interface EngineInfo {
  aria2: boolean;
  curl: boolean;
  aria2Version: string;
  curlVersion: string;
  /** Where the process-based engines are available at all (the desktops). */
  processes: boolean;
  checked: boolean;
}

export const engines: EngineInfo = {
  aria2: false,
  curl: false,
  aria2Version: "",
  curlVersion: "",
  processes: false,
  checked: false,
};

/** A host without processes never answers: the scan gives up instead of waiting. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function firstLine(text: string): string {
  const line = text.split("\n").map((part) => part.trim()).find((part) => part.length > 0) ?? "";
  return line.slice(0, 120);
}

/** Looks for aria2c and curl once; both are optional, the fetch engine always works for small files. */
export async function detectEngines(): Promise<EngineInfo> {
  const curl = await withDeadline(run("curl", ["--version"], { timeoutMs: 3000 }), 3500);
  engines.curl = !!curl && curl.code === 0;
  engines.curlVersion = curl && curl.code === 0 ? firstLine(curl.stdout) : "";

  const aria2 = await withDeadline(run("aria2c", ["--version"], { timeoutMs: 3000 }), 3500);
  engines.aria2 = !!aria2 && aria2.code === 0;
  engines.aria2Version = aria2 && aria2.code === 0 ? firstLine(aria2.stdout) : "";
  engines.processes = engines.curl || engines.aria2;

  engines.checked = true;
  return engines;
}

export function engineAvailable(id: EngineId): boolean {
  switch (id) {
    case "aria2":
      return engines.aria2;
    case "curl":
      return engines.curl;
    case "segments":
    case "js":
      return true;
  }
}

export function engineLabel(id: EngineId): string {
  switch (id) {
    case "aria2":
      return "aria2c · 多线程";
    case "curl":
      return "curl · 断点续传";
    case "segments":
      return "分片下载";
    case "js":
      return "内置 fetch";
  }
}
