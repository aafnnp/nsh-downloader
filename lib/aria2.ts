import { platform } from "nsh";
import processModule, { run } from "process";
import { exists, mkdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { filePathFromUrl } from "./paths";
import {
  bundledAria2Assets,
  bundledAria2License,
  bundledAria2SslLicense,
  type BundledAria2Asset,
} from "./aria2-asset";

export interface PreparedAria2 {
  /** The executable to start, in the app's data directory (or the shipped asset). */
  path: string;
}

/** `macos-arm64`, `linux-x86_64`, ...; `null` where no sidecar is built. */
export function aria2Triple(os: string, arch: string): string | null {
  if (os === "macos") return arch === "aarch64" ? "macos-arm64" : arch === "x86_64" ? "macos-x86_64" : null;
  if (os === "linux") return arch === "aarch64" ? "linux-arm64" : arch === "x86_64" ? "linux-x86_64" : null;
  if (os === "windows") return arch === "aarch64" ? "windows-arm64" : arch === "x86_64" ? "windows-x86_64" : null;
  return null;
}

function selectedAsset(): BundledAria2Asset | null {
  if (platform.os !== "macos" && platform.os !== "linux" && platform.os !== "windows") return null;
  return (
    bundledAria2Assets.find((asset) => asset.platform === platform.os && asset.arch === process.arch) ?? null
  );
}

/** The packaged path (`<nsh>/assets/<path>`) and the repository path, both on disk. */
function assetPaths(asset: BundledAria2Asset): { packaged: string; dev: string } | null {
  if (!asset.url.startsWith("asset:/")) return null;
  const relative = asset.url.slice("asset:/".length);
  try {
    return {
      packaged: filePathFromUrl(new URL(`../assets/${relative}`, import.meta.url)),
      dev: filePathFromUrl(new URL(`../${relative}`, import.meta.url)),
    };
  } catch {
    return null;
  }
}

/** `exists` rejects for a path outside the granted roots; that path holds no asset. */
async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      if (await exists(path)) return path;
    } catch {
      // Keep looking: `read` grants only the app's own folders.
    }
  }
  return null;
}

async function shippedAssetPath(url: string | null): Promise<string | null> {
  if (!url || !url.startsWith("asset:/")) return null;
  const relative = url.slice("asset:/".length);
  try {
    return await firstExisting([
      filePathFromUrl(new URL(`../assets/${relative}`, import.meta.url)),
      filePathFromUrl(new URL(`../${relative}`, import.meta.url)),
    ]);
  } catch {
    return null;
  }
}

/** The shipped aria2 COPYING, for the About section; `null` when this build has none. */
export function bundledAria2LicensePath(): Promise<string | null> {
  return shippedAssetPath(bundledAria2License);
}

/** The shipped OpenSSL license that covers aria2c's TLS libraries. */
export function bundledAria2SslLicensePath(): Promise<string | null> {
  return shippedAssetPath(bundledAria2SslLicense);
}

/**
 * The arguments that start `path` through a shell the manifest grants. The
 * shell is what lets a sidecar live wherever the app is installed: the
 * `process.execute` capability matches exact paths, not `${pluginDir}`.
 */
export function shellCommand(path: string, args: string[]): { command: string; args: string[] } {
  if (platform.os === "windows") return windowsShellCommand(path, args);
  return { command: "sh", args: ["-c", '"$0" "$@"', path, ...args] };
}

/**
 * Windows starts `path` through PowerShell's `-EncodedCommand`, which carries
 * the whole command line as base64 UTF-16LE. `cmd.exe` cannot be used: nsh
 * starts a child with `std::process::Command`, whose Windows quoting escapes an
 * argument's `"` as `\"` — `cmd.exe` does not read that back as a quote — and
 * `cmd.exe` would still expand `%NAME%` and `!NAME!` inside URLs.
 */
export function windowsShellCommand(path: string, args: string[]): { command: string; args: string[] } {
  const script = powerShellScript(path, args);
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)],
  };
}

/** `&` invokes the executable; single quotes are literal, and `''` is one of them. */
export function powerShellScript(path: string, args: string[]): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return [
    // nsh gives a child only PATH, HOME, SystemRoot and a few more, so
    // PowerShell has no PATHEXT and calls an .exe a document instead of
    // running it ("Cannot run this document in a pipeline").
    "$env:PATHEXT = '.COM;.EXE;.BAT;.CMD'",
    `& ${[path, ...args].map(quote).join(" ")}`,
    // A launch failure leaves $LASTEXITCODE unset; report it as one.
    "$code = $LASTEXITCODE",
    "if ($null -eq $code) { exit 1 } else { exit $code }",
  ].join("\n");
}

/** PowerShell reads `-EncodedCommand` as base64 of the script's UTF-16 code units. */
function encodePowerShell(script: string): string {
  let binary = "";
  for (let index = 0; index < script.length; index += 1) {
    const unit = script.charCodeAt(index);
    binary += String.fromCharCode(unit & 0xff, unit >> 8);
  }
  return btoa(binary);
}

export async function runBundled(prepared: PreparedAria2, args: string[], timeoutMs = 5000) {
  const { command, args: commandArgs } = shellCommand(prepared.path, args);
  return run(command, commandArgs, { cwd: processModule.dataDir ?? undefined, timeoutMs });
}

let cached: PreparedAria2 | null | undefined;

/**
 * Unpacks the shipped aria2c into the app's data directory, once per shipped
 * build, and returns how to start it. `null` when this build carries none.
 */
export async function prepareBundledAria2(): Promise<PreparedAria2 | null> {
  if (cached !== undefined) return cached;
  const asset = selectedAsset();
  const triple = aria2Triple(platform.os, process.arch);
  if (!asset || !triple) {
    cached = null;
    return null;
  }
  const paths = assetPaths(asset);
  if (!paths) {
    cached = null;
    return null;
  }
  const source = await firstExisting([paths.packaged, paths.dev]);
  if (!source) {
    cached = null;
    return null;
  }

  const dataDir = processModule.dataDir;
  if (!dataDir) {
    cached = { path: source };
    return cached;
  }

  const dir = join(dataDir, "engines", triple);
  const target = join(dir, asset.name);
  const marker = join(dir, ".source-stamp");
  try {
    await mkdir(dir, { recursive: true });
    const info = await stat(source);
    const sourceSize = info.size;
    // Size alone misses a rebuild of the same size; the modification time does not.
    const stamp = `${sourceSize}:${Math.round(info.mtimeMs)}`;
    const marked = (await readFile(marker, "utf8").catch(() => "")).trim();
    const present = await exists(target);
    if (!present || marked !== stamp) {
      if (asset.archive) {
        const result = await run("tar", ["-xzf", source, "-C", dir], { cwd: dataDir, timeoutMs: 20000 });
        if (result.code !== 0) throw new Error(result.stderr || "无法解压内置 aria2c");
      } else {
        if (sourceSize > 7 * 1024 * 1024) throw new Error("内置 aria2c 超过内置写入上限");
        await writeFile(target, await readFile(source));
      }
      await writeFile(marker, stamp);
    }
    if (platform.os !== "windows") {
      await run("chmod", ["+x", target]).catch(() => undefined);
    }
    cached = { path: target };
    return cached;
  } catch {
    // A read-only or full data directory still lets a plain executable run
    // where the package kept it; an archive cannot, and reporting it would
    // hand `aria2c` a .tar.gz to start.
    cached = asset.archive ? null : { path: source };
    return cached;
  }
}

export function resetBundledAria2(): void {
  cached = undefined;
}
