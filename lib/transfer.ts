import { writeFile } from "fs/promises";
import { spawn, type ChildProcess } from "process";
import type { EngineId } from "../model";
import { engineAvailable } from "./engines";
import { fileSize, pathSize, removeIfPresent } from "./paths";
import { messageOf } from "./probe";

export interface TransferSpec {
  url: string;
  /** The file the transfer writes, absolute; a torrent writes whatever it names under `dir`. */
  path: string;
  dir: string;
  filename: string;
  total: number;
  connections: number;
  limitKb: number;
  /** The proxy both engines use; empty goes direct. */
  proxy: string;
  referer: string | null;
  headers: string[];
  /** A magnet link: aria2c takes it, and progress comes from its own summary lines. */
  torrent: boolean;
}

export interface TransferHooks {
  progress(received: number, total: number): void;
  phase(text: string): void;
}

export type Outcome = { ok: true } | { ok: false; error: string; canceled: boolean };

export interface Transfer {
  cancel(): void;
  readonly done: Promise<Outcome>;
}

/** The built-in engine writes a file in one call, so it keeps to what `writeFile` takes. */
const JS_LIMIT = 7 * 1024 * 1024;

/** aria2c when it is installed, else curl, else the built-in engine (small files only). */
export function chooseEngine(total: number, preference: "auto" | EngineId, torrent = false): EngineId {
  if (torrent) return "aria2";
  if (preference !== "auto" && engineAvailable(preference)) return preference;
  for (const id of ["aria2", "curl", "js"] as EngineId[]) {
    if (!engineAvailable(id)) continue;
    if (id === "js" && total > JS_LIMIT) continue;
    return id;
  }
  return "js";
}

function aria2Args(spec: TransferSpec): string[] {
  const connections = Math.max(1, Math.min(16, spec.connections));
  const args = [
    "--continue=true",
    "--allow-overwrite=true",
    "--file-allocation=none",
    "--connect-timeout=20",
    "--max-tries=5",
    "--retry-wait=2",
    "-d",
    spec.dir,
  ];
  if (spec.proxy) args.push(`--all-proxy=${spec.proxy}`);

  if (spec.torrent) {
    // The torrent names its own files under `-d`, and its summary is the only progress there is.
    args.push("--seed-time=0", "--follow-torrent=mem", "--bt-save-metadata=false", "--summary-interval=1", "--console-log-level=notice");
  } else {
    args.push(
      `--max-connection-per-server=${connections}`,
      `--split=${connections}`,
      "--min-split-size=1M",
      "--auto-file-renaming=false",
      "--console-log-level=warn",
      "--summary-interval=0",
      "-o",
      spec.filename,
    );
  }
  if (spec.limitKb > 0) args.push(`--max-download-limit=${spec.limitKb}K`);
  if (spec.referer) args.push(`--referer=${spec.referer}`);
  for (const header of spec.headers) args.push(`--header=${header}`);
  args.push(spec.url);
  return args;
}

function curlArgs(spec: TransferSpec): string[] {
  const args = [
    "--location",
    "--fail",
    "--silent",
    "--show-error",
    "--retry",
    "4",
    "--retry-delay",
    "2",
    "--connect-timeout",
    "20",
    "--continue-at",
    "-",
    "--output",
    spec.path,
  ];
  if (spec.limitKb > 0) args.push("--limit-rate", `${spec.limitKb}K`);
  if (spec.proxy) args.push("--proxy", spec.proxy);
  if (spec.referer) args.push("--referer", spec.referer);
  for (const header of spec.headers) args.push("--header", header);
  args.push("--", spec.url);
  return args;
}

/** aria2c and curl write the file themselves: no JS-side size limit, resume, and parallel connections. */
function startProcess(spec: TransferSpec, engine: "aria2" | "curl", hooks: TransferHooks): Transfer {
  let canceled = false;
  let finished = false;
  let stderrTail = "";
  let timer: number | undefined;
  let child: ChildProcess | null = null;
  let resolveDone: (outcome: Outcome) => void = () => undefined;
  const done = new Promise<Outcome>((resolve) => {
    resolveDone = resolve;
  });

  const stopPolling = () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  const finish = (outcome: Outcome) => {
    if (finished) return;
    finished = true;
    stopPolling();
    resolveDone(outcome);
  };
  const poll = async () => {
    if (finished) return;
    hooks.progress(spec.torrent ? await pathSize(spec.dir) : await fileSize(spec.path), spec.total);
  };

  const launch = (attempt: number) => {
    try {
      child = spawn(engine === "aria2" ? "aria2c" : "curl", engine === "aria2" ? aria2Args(spec) : curlArgs(spec), {
        cwd: spec.dir,
      });
    } catch (error) {
      finish({ ok: false, error: messageOf(error), canceled: false });
      return;
    }
    child.on("stderr", (text) => {
      stderrTail = (stderrTail + text).slice(-2000);
    });
    if (spec.torrent) {
      child.on("stdout", (text) => {
        const tick = parseAria2Summary(text);
        if (tick) hooks.progress(tick.received, tick.total);
      });
    }
    child.on("exit", (result) => {
      void (async () => {
        const size = spec.torrent ? await pathSize(spec.dir) : await fileSize(spec.path);
        if (size > 0) hooks.progress(size, spec.total);
        if (result.code === 0 || (spec.total > 0 && size >= spec.total)) {
          finish({ ok: true });
          return;
        }
        if (canceled) {
          finish({ ok: false, error: "已暂停", canceled: true });
          return;
        }
        const reason = describeExit(engine, result.code, stderrTail);
        // A server that ignores Range makes curl refuse to resume: start the file over once.
        if (attempt === 0 && /range|resume|416|33/.test(reason)) {
          void (async () => {
            await removeIfPresent(spec.path);
            stderrTail = "";
            hooks.progress(0, spec.total);
            launch(1);
          })();
          return;
        }
        finish({ ok: false, error: reason, canceled: false });
      })();
    });
    timer = setInterval(() => void poll(), 300) as unknown as number;
    void poll();
  };

  launch(0);

  return {
    cancel() {
      canceled = true;
      try {
        child?.kill();
      } catch {
        // Already gone.
      }
      finish({ ok: false, error: "已暂停", canceled: true });
    },
    done,
  };
}

/** What aria2's exit status means, for the failures it keeps out of stderr at warn level. */
const ARIA2_ERRORS: Record<number, string> = {
  1: "下载失败",
  3: "资源不存在（404）",
  5: "下载太慢，已放弃",
  6: "网络错误",
  8: "服务器不支持断点续传",
  9: "磁盘空间不足",
  13: "文件已存在",
  16: "无法创建文件",
  17: "文件系统错误",
  18: "无法创建目录",
  19: "域名解析失败",
  22: "HTTP 响应错误",
  23: "重定向过多",
  24: "需要认证（401）",
  28: "连接超时",
  29: "服务器返回错误",
  32: "文件校验失败",
};

const CURL_ERRORS: Record<number, string> = {
  3: "URL 格式错误",
  5: "代理地址无法解析",
  6: "域名解析失败",
  7: "无法连接服务器",
  22: "服务器返回错误状态",
  23: "写入磁盘失败",
  28: "连接超时",
  35: "TLS 握手失败",
  52: "服务器没有响应",
  56: "接收数据失败",
  60: "证书校验失败",
};

/** The line a failed transfer shows: the engine's own message when it wrote one, else what its status means. */
export function describeExit(engine: "aria2" | "curl", code: number | null | undefined, tail: string): string {
  const line = tail.trim().split("\n").filter(Boolean).pop() ?? "";
  if (line && !/^status legend|^exit status/i.test(line)) return line;
  const table = engine === "aria2" ? ARIA2_ERRORS : CURL_ERRORS;
  const known = typeof code === "number" ? table[code] : undefined;
  if (known) return known;
  return `退出码 ${code ?? "?"}`;
}

const UNITS: Record<string, number> = { B: 1, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3 };

function parseSize(value: string, unit: string): number {
  const size = Number(value.replace(/,/g, ""));
  const scale = UNITS[unit.toUpperCase()] ?? 1;
  return isFinite(size) ? Math.round(size * scale) : 0;
}

/** One of aria2's `[#gid 1.2MiB/5.0MiB(24%) CN:4 DL:1.0MiB ETA:3s]` lines, when the text holds one. */
export function parseAria2Summary(text: string): { received: number; total: number; speed: number } | null {
  const match = /\[#\w+\s+([\d.]+)\s*([KMGTP]?i?B)\/([\d.]+)\s*([KMGTP]?i?B)\(([\d.]+)%\)([^\]]*)\]/i.exec(text);
  if (!match) return null;
  const total = parseSize(match[3], match[4]);
  const received = parseSize(match[1], match[2]);
  const rate = /DL:([\d.]+)\s*([KMGTP]?i?B)/i.exec(match[6]);
  const speed = rate ? parseSize(rate[1], rate[2]) : 0;
  return { received, total, speed };
}

/** The `Referer` this app adds, plus the headers the user wrote (`Name: value` per line). */
export function requestHeaders(referer: string | null, headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of headers) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (name && value) out[name] = value;
  }
  if (referer && !Object.keys(out).some((name) => name.toLowerCase() === "referer")) out.Referer = referer;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The built-in engine: a streaming fetch that keeps the bytes in memory until they are written. */
function startFetch(spec: TransferSpec, hooks: TransferHooks): Transfer {
  const controller = new AbortController();
  let canceled = false;
  let resolveDone: (outcome: Outcome) => void = () => undefined;
  const done = new Promise<Outcome>((resolve) => {
    resolveDone = resolve;
  });

  void (async () => {
    try {
      hooks.phase("连接中");
      await removeIfPresent(spec.path);
      const response = await fetch(spec.url, {
        headers: requestHeaders(spec.referer, spec.headers),
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const total = Number(response.headers.get("content-length") ?? 0) || spec.total;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("服务器没有返回响应体");
      const parts: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!chunk.value) continue;
        received += chunk.value.length;
        if (received > JS_LIMIT) {
          await reader.cancel().catch(() => undefined);
          throw new Error("文件超过内置引擎的上限，请安装 curl 或 aria2c 后重试");
        }
        parts.push(chunk.value);
        hooks.progress(received, total);
      }
      hooks.phase("写入磁盘");
      await writeFile(spec.path, concat(parts));
      resolveDone({ ok: true });
    } catch (error) {
      resolveDone({ ok: false, error: canceled ? "已暂停" : messageOf(error), canceled });
    }
  })();

  return {
    cancel() {
      canceled = true;
      controller.abort();
      resolveDone({ ok: false, error: "已暂停", canceled: true });
    },
    done,
  };
}

export function startTransfer(spec: TransferSpec, engine: EngineId, hooks: TransferHooks): Transfer {
  if (engine === "js" || engine === "segments") return startFetch(spec, hooks);
  return startProcess(spec, engine, hooks);
}
