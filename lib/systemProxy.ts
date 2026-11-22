import { readFile } from "fs/promises";
import { platform } from "nsh";
import { join } from "path";
import { run } from "process";
import { safeHomedir } from "./paths";
import { normalizeProxy } from "./urls";

export interface SystemProxy {
  /** A URL for the proxy setting, or "" when the system has none this app can use. */
  proxy: string;
  /** Why nothing was imported, for the notice. */
  reason?: string;
}

/** A `scutil --proxy` dictionary's value; empty when the key is absent. */
function scutilValue(text: string, key: string): string {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "m").exec(text);
  return match ? match[1].trim() : "";
}

function scutilProxy(text: string, label: string, scheme: string): string {
  if (scutilValue(text, `${label}Enable`) !== "1") return "";
  const host = scutilValue(text, `${label}Proxy`);
  if (!host) return "";
  const port = scutilValue(text, `${label}Port`);
  return normalizeProxy(`${scheme}://${host}${port ? `:${port}` : ""}`);
}

/** `scutil --proxy`'s dictionary: the HTTPS proxy, then HTTP, then SOCKS. */
export function parseScutilProxy(text: string): string {
  return (
    scutilProxy(text, "HTTPS", "http") ||
    scutilProxy(text, "HTTP", "http") ||
    scutilProxy(text, "SOCKS", "socks5")
  );
}

/** The Internet Settings `ProxyServer` value: `host:port`, or `http=…;https=…;ftp=…`. */
export function parseWindowsProxy(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (!value.includes("=")) return normalizeProxy(value);
  const proxies = new Map<string, string>();
  for (const part of value.split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const scheme = part.slice(0, at).trim().toLowerCase();
    const entry = part.slice(at + 1).trim();
    if (entry) proxies.set(scheme, entry);
  }
  const http = proxies.get("https") ?? proxies.get("http");
  if (http) return normalizeProxy(http);
  const socks = proxies.get("socks");
  return socks ? normalizeProxy(`socks5://${socks}`) : "";
}

/** `gsettings` prints strings with their quotes: `'manual'`, `'127.0.0.1'`. */
function unquote(value: string): string {
  return value.trim().replace(/^'(.*)'$/, "$1").trim();
}

/** GNOME's manual proxy: HTTP when a host is set, else SOCKS. */
export function parseGnomeProxy(
  mode: string,
  httpHost: string,
  httpPort: string,
  socksHost: string,
  socksPort: string,
): string {
  if (unquote(mode) !== "manual") return "";
  const http = unquote(httpHost);
  if (http) return normalizeProxy(`http://${http}${unquote(httpPort) ? `:${unquote(httpPort)}` : ""}`);
  const socks = unquote(socksHost);
  if (socks) return normalizeProxy(`socks5://${socks}${unquote(socksPort) ? `:${unquote(socksPort)}` : ""}`);
  return "";
}

/** KDE's `~/.config/kioslaverc`: `ProxyType=1` is a manual proxy. */
export function parseKdeProxy(text: string): string {
  const section = /\[Proxy Settings\]([\s\S]*)/i.exec(text);
  if (!section) return "";
  const body = section[1];
  const type = /^\s*ProxyType\s*=\s*(\d+)/m.exec(body);
  if (!type || type[1] !== "1") return "";
  for (const key of ["httpsProxy", "httpProxy", "socksProxy"]) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m").exec(body);
    const value = match ? match[1].trim() : "";
    // KDE writes a SOCKS proxy as `socks://`; aria2 and curl take `socks5://`.
    if (value) return normalizeProxy(value.replace(/^socks:\/\//i, "socks5://"));
  }
  return "";
}

function reasonOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

async function macProxy(): Promise<SystemProxy> {
  const result = await run("sh", ["-c", "scutil --proxy"], { timeoutMs: 5000 });
  const proxy = parseScutilProxy(result.stdout);
  if (proxy) return { proxy };
  if (/^\s*ProxyAutoConfigEnable\s*:\s*1/m.test(result.stdout)) {
    return { proxy: "", reason: "系统只启用了自动代理脚本（PAC），无法直接导入" };
  }
  return { proxy: "", reason: "系统没有启用 HTTP 或 SOCKS 代理" };
}

/** Reads the per-user Internet Settings, the same values Edge and Chrome use. */
const WINDOWS_PROXY_SCRIPT = [
  "$p = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'",
  "if ($p.ProxyEnable -eq 1) { $p.ProxyServer }",
  "if ($p.AutoConfigURL) { 'PAC=' + $p.AutoConfigURL }",
].join("\n");

async function windowsProxy(): Promise<SystemProxy> {
  const result = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROXY_SCRIPT],
    { timeoutMs: 8000 },
  );
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const proxy = parseWindowsProxy(lines.find((line) => !line.startsWith("PAC=")) ?? "");
  if (proxy) return { proxy };
  if (lines.some((line) => line.startsWith("PAC="))) {
    return { proxy: "", reason: "系统只启用了自动配置脚本（PAC），无法直接导入" };
  }
  return { proxy: "", reason: "系统没有启用代理" };
}

const GNOME_PROXY_SCRIPT = [
  "command -v gsettings >/dev/null 2>&1 || exit 1",
  "gsettings get org.gnome.system.proxy mode",
  "gsettings get org.gnome.system.proxy.http host",
  "gsettings get org.gnome.system.proxy.http port",
  "gsettings get org.gnome.system.proxy.socks host",
  "gsettings get org.gnome.system.proxy.socks port",
].join("\n");

async function linuxProxy(): Promise<SystemProxy> {
  const gnome = await run("sh", ["-c", GNOME_PROXY_SCRIPT], { timeoutMs: 5000 }).catch(() => null);
  if (gnome && gnome.code === 0) {
    const [mode = "", httpHost = "", httpPort = "", socksHost = "", socksPort = ""] = gnome.stdout.split("\n");
    const proxy = parseGnomeProxy(mode, httpHost, httpPort, socksHost, socksPort);
    if (proxy) return { proxy };
    if (unquote(mode) === "auto") {
      return { proxy: "", reason: "系统只启用了自动代理脚本（PAC），无法直接导入" };
    }
  }
  const kde = await readFile(join(safeHomedir(), ".config", "kioslaverc"), "utf8").catch(() => "");
  const proxy = parseKdeProxy(kde);
  if (proxy) return { proxy };
  return { proxy: "", reason: "没有找到 GNOME 或 KDE 的系统代理设置" };
}

/** The system's own proxy, as one URL for the proxy setting; `reason` says what was found when none is usable. */
export async function findSystemProxy(): Promise<SystemProxy> {
  try {
    if (platform.os === "macos") return await macProxy();
    if (platform.os === "windows") return await windowsProxy();
    if (platform.os === "linux") return await linuxProxy();
    return { proxy: "", reason: "这个平台读不到系统代理" };
  } catch (error) {
    return { proxy: "", reason: `读取系统代理失败：${reasonOf(error)}` };
  }
}
