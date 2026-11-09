import { mkdir, readdir, rmdir, stat, unlink } from "fs/promises";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import processModule, { run } from "process";
import { platform } from "os";

/** `~/Downloads`, the desktop convention for a download manager. */
export function defaultDownloadDir(): string {
  try {
    return join(homedir(), "Downloads");
  } catch {
    // A browser has no home: the app's own storage is rooted, so the path is absolute.
    return "/Downloads";
  }
}

export function safeHomedir(): string {
  try {
    return homedir();
  } catch {
    return ".";
  }
}

/** "~/Downloads/a.mp4" for a path under home, else the path as it is. */
export function prettyPath(path: string): string {
  const home = safeHomedir();
  if (!path.startsWith(home)) return path;
  const rest = path.slice(home.length);
  return rest ? `~${rest}` : "~";
}

/** The directory the app may write to: the one asked for, else the host's data directory. */
export async function writableDir(preferred: string): Promise<string> {
  try {
    await ensureDir(preferred);
    return preferred;
  } catch {
    const fallback = processModule.dataDir;
    if (fallback && fallback !== preferred) {
      await ensureDir(fallback);
      return fallback;
    }
    throw new Error(`没有写入权限：${preferred}`);
  }
}

export async function ensureDir(path: string): Promise<void> {
  if (!path) return;
  await mkdir(path, { recursive: true });
}

/** A torrent's own folder: `name`, `name (1)`, … — the first that is free. */
export async function uniqueDir(parent: string, name: string): Promise<string> {
  const base = sanitizeName(name);
  for (let index = 0; index < 500; index += 1) {
    const candidate = join(parent, index === 0 ? base : `${base} (${index})`);
    if (!(await exists(candidate))) return candidate;
  }
  return join(parent, `${base}-${Date.now()}`);
}

function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  return cleaned || "torrent";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Everything under a path: a file's size, or every file's bytes in a folder, three levels deep. */
export async function pathSize(path: string): Promise<number> {
  const info = await stat(path).catch(() => null);
  if (!info) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  return folderSize(path, 3);
}

async function folderSize(path: string, depth: number): Promise<number> {
  if (depth < 0) return 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries.slice(0, 10000)) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await folderSize(child, depth - 1);
    else total += await fileSize(child);
  }
  return total;
}

/** The entry's size in bytes, 0 when it does not exist or is not a regular file. */
export async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}


/** `name`, `name (1)`, `name (2)` … — the first that is not taken in `dir`. */
export async function uniquePath(dir: string, name: string): Promise<string> {
  let candidate = join(dir, name);
  if ((await fileSize(candidate)) === 0) return candidate;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let index = 1; index < 500; index += 1) {
    candidate = join(dir, `${stem} (${index})${ext}`);
    if ((await fileSize(candidate)) === 0) return candidate;
  }
  return join(dir, `${stem}-${Date.now()}${ext}`);
}

export function filenameOf(path: string): string {
  return basename(path);
}

export function dirOf(path: string): string {
  return dirname(path);
}

/** Shows the file's folder with the file selected, where the desktop's file manager can. */
export async function revealInFolder(path: string): Promise<void> {
  const os = platform();
  if (os === "macos") {
    await run("open", ["-R", path]).catch(() => undefined);
    return;
  }
  if (os === "windows") {
    await run("explorer.exe", [`/select,${path}`]).catch(() => undefined);
    return;
  }
  await run("xdg-open", [dirOf(path)]).catch(() => undefined);
}

/** Opens a downloaded file with the system's default app. */
export async function openDownloaded(path: string): Promise<void> {
  const os = platform();
  if (os === "macos") {
    await run("open", [path]).catch(() => undefined);
    return;
  }
  if (os === "windows") {
    await run("cmd", ["/c", "start", "", path]).catch(() => undefined);
    return;
  }
  await run("xdg-open", [path]).catch(() => undefined);
}

export async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Already gone.
  }
}

/** Removes a download's temporary segments directory and what it holds. */
export async function removePartsDir(path: string): Promise<void> {
  try {
    const names = await readdir(path);
    for (const name of names) await removeIfPresent(join(path, name));
    await rmdir(path);
  } catch {
    // Already gone.
  }
}
