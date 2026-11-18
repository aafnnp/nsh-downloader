import { run } from "process";
import type { EngineId } from "../model";
import { prepareBundledAria2, runBundled } from "./aria2";

export interface EngineInfo {
  aria2: boolean;
  curl: boolean;
  aria2Version: string;
  curlVersion: string;
  /** Where aria2c comes from: the app's sidecar, the system, or nowhere. */
  aria2Source: "bundled" | "system" | "";
  /** The bundled executable path, or `aria2c` for the system engine. */
  aria2Path: string;
  /** Where the process-based engines are available at all (the desktops). */
  processes: boolean;
  checked: boolean;
}

export const engines: EngineInfo = {
  aria2: false,
  curl: false,
  aria2Version: "",
  curlVersion: "",
  aria2Source: "",
  aria2Path: "",
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

let scanning: Promise<EngineInfo> | null = null;

/** Looks for the bundled aria2c, then curl and system aria2c; a scan in progress is shared. */
export function detectEngines(): Promise<EngineInfo> {
  if (!scanning) {
    scanning = scanEngines().finally(() => {
      scanning = null;
    });
  }
  return scanning;
}

async function scanEngines(): Promise<EngineInfo> {
  engines.aria2 = false;
  engines.aria2Version = "";
  engines.aria2Source = "";
  engines.aria2Path = "";

  // A sidecar the app cannot unpack still leaves curl and the system's aria2c to try.
  const bundled = await withDeadline(prepareBundledAria2(), 25000);
  if (bundled) {
    const found = await withDeadline(runBundled(bundled, ["--version"]), 5000);
    if (found && found.code === 0) {
      engines.aria2 = true;
      engines.aria2Version = firstLine(found.stdout);
      engines.aria2Source = "bundled";
      engines.aria2Path = bundled.path;
    }
  }

  const curl = await withDeadline(run("curl", ["--version"], { timeoutMs: 3000 }), 3500);
  engines.curl = !!curl && curl.code === 0;
  engines.curlVersion = curl && curl.code === 0 ? firstLine(curl.stdout) : "";

  if (!engines.aria2) {
    const aria2 = await withDeadline(run("aria2c", ["--version"], { timeoutMs: 3000 }), 3500);
    engines.aria2 = !!aria2 && aria2.code === 0;
    engines.aria2Version = aria2 && aria2.code === 0 ? firstLine(aria2.stdout) : "";
    engines.aria2Source = engines.aria2 ? "system" : "";
    engines.aria2Path = engines.aria2 ? "aria2c" : "";
  }
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
      return engines.aria2Source === "bundled" ? "aria2c · 内置" : "aria2c · 多线程";
    case "curl":
      return "curl · 断点续传";
    case "segments":
      return "分片下载";
    case "js":
      return "内置 fetch";
  }
}
