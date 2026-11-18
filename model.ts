// The shapes the app stores, and the small pure helpers that read them.

export type Kind =
  | "video"
  | "audio"
  | "image"
  | "document"
  | "archive"
  | "app"
  | "stream"
  | "torrent"
  | "other";

export type Status =
  | "preparing"
  | "queued"
  | "running"
  | "paused"
  | "done"
  | "failed"
  | "canceled";

export type EngineId = "aria2" | "curl" | "js" | "segments";

/** The smart file manager's buckets, as Free Download Manager groups downloads. */
export type Category = "video" | "audio" | "document" | "program" | "archive" | "other";

/** Queue order: high runs before normal, normal before low. */
export type Priority = "high" | "normal" | "low";

/** FDM's traffic modes, plus a custom per-file limit. */
export type SpeedMode = "unlimited" | "low" | "medium" | "high" | "custom";

export interface Item {
  id: string;
  /** The URL as the user gave it. A local torrent keeps its `file:` URL. */
  url: string;
  /** The file name written under `dir`. */
  filename: string;
  dir: string;
  kind: Kind;
  /** The smart-file-manager bucket; `kind` decides it unless the user picks one. */
  category: Category;
  status: Status;
  /** Total bytes, 0 while unknown. */
  total: number;
  received: number;
  /** Bytes already on disk when the transfer started, so a resume shows its own progress. */
  offset: number;
  /** Bytes per second, measured by the store. */
  speed: number;
  error: string | null;
  /** What the engine is doing right now ("合并分片"), when it can say. */
  phase: string | null;
  engine: EngineId | null;
  /** What the probe found: HLS or DASH playlists are fetched as segments. */
  playlist: "hls" | "dash" | null;
  /** A magnet or torrent: aria2c fetches it, and `dir` holds everything it names. */
  torrent: boolean;
  /** A `.torrent` file the user dropped or opened; aria2c reads it from disk. */
  torrentFile: string | null;
  referer: string | null;
  /** Extra request headers, one `Name: value` per entry (a hotlink guard's Referer, a cookie). */
  headers: string[];
  /** Free-form note shown in the details pane. */
  description: string;
  /** From the queue: high, normal (default) or low. */
  priority: Priority;
  /** This download's own KB/s cap; `null` follows the app-wide traffic mode. */
  limitKb: number | null;
  createdAt: number;
  /** When the first byte of the current attempt was requested. */
  startedAt: number | null;
  finishedAt: number | null;
}

export interface SchedulerSettings {
  enabled: boolean;
  /** `HH:MM`, 24-hour local time. */
  start: string;
  /** `HH:MM`, 24-hour local time. */
  stop: string;
  /** Days it runs on, `0` Sunday to `6` Saturday; empty means every day. */
  days: number[];
}

export interface Settings {
  /** Where files land. */
  dir: string;
  /** Put each type in its own subfolder under `dir`, as FDM's smart file manager does. */
  organizeByCategory: boolean;
  /** A folder per category; an empty value follows `dir` (and `organizeByCategory`). */
  categoryDirs: Partial<Record<Category, string>>;
  /** Transfers running at the same time (1 to 8). */
  maxConcurrent: number;
  /** aria2's connections per file (1 to 16). */
  connections: number;
  /** The custom per-file limit in KB/s, used while `speedMode` is `custom`. */
  limitKb: number;
  /** FDM-style traffic mode. */
  speedMode: SpeedMode;
  /** The proxy the engines use (`http://127.0.0.1:7890`, `socks5://…`); empty goes direct. */
  proxy: string;
  /** `auto` picks aria2c, then curl, then the built-in fetch engine. */
  engine: "auto" | EngineId;
  /** Watch the clipboard while the window is focused, and take links from it. */
  watchClipboard: boolean;
  /** Start a new download as soon as it is added. */
  autoStart: boolean;
  /** Show a notice when a download finishes. */
  notifyOnComplete: boolean;
  appearance: "system" | "light" | "dark";
  scheduler: SchedulerSettings;
}

export function defaultSettings(dir: string): Settings {
  return {
    dir,
    organizeByCategory: false,
    categoryDirs: {},
    maxConcurrent: 3,
    connections: 8,
    limitKb: 0,
    speedMode: "unlimited",
    proxy: "",
    engine: "auto",
    watchClipboard: true,
    autoStart: true,
    notifyOnComplete: true,
    appearance: "system",
    scheduler: { enabled: false, start: "09:00", stop: "23:00", days: [] },
  };
}

export interface CategoryMeta {
  id: Category;
  label: string;
  /** The subfolder used while `organizeByCategory` is on. */
  folder: string;
  badge: string;
  /** Background and text of the small category tile. */
  tone: string;
}

export const CATEGORY_ORDER: Category[] = ["video", "audio", "document", "program", "archive", "other"];

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  video: {
    id: "video",
    label: "视频",
    folder: "视频",
    badge: "VID",
    tone: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  },
  audio: {
    id: "audio",
    label: "音乐",
    folder: "音乐",
    badge: "AUD",
    tone: "bg-sky-500/15 text-sky-500 dark:text-sky-300",
  },
  document: {
    id: "document",
    label: "文档",
    folder: "文档",
    badge: "DOC",
    tone: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  },
  program: {
    id: "program",
    label: "程序",
    folder: "程序",
    badge: "APP",
    tone: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  },
  archive: {
    id: "archive",
    label: "压缩包",
    folder: "压缩包",
    badge: "ZIP",
    tone: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  },
  other: {
    id: "other",
    label: "其他",
    folder: "其他",
    badge: "FILE",
    tone: "bg-muted text-muted-foreground",
  },
};

const VIDEO = ["mp4", "mkv", "mov", "webm", "avi", "flv", "m4v", "ts", "mpg", "mpeg", "wmv"];
const AUDIO = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma"];
const IMAGE = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "heic", "tiff"];
const DOCUMENT = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "epub", "rtf"];
const ARCHIVE = ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "iso"];
const APP = ["exe", "msi", "pkg", "dmg", "apk", "ipa", "deb", "rpm", "appimage"];
const TORRENT = ["torrent"];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function kindOfName(name: string): Kind {
  const ext = extensionOf(name);
  if (TORRENT.includes(ext)) return "torrent";
  if (ext === "m3u8" || ext === "m3u") return "stream";
  if (ext === "mpd") return "stream";
  if (VIDEO.includes(ext)) return "video";
  if (AUDIO.includes(ext)) return "audio";
  if (IMAGE.includes(ext)) return "image";
  if (DOCUMENT.includes(ext)) return "document";
  if (ARCHIVE.includes(ext)) return "archive";
  if (APP.includes(ext)) return "app";
  return "other";
}

export function kindOfType(contentType: string, name: string): Kind {
  const type = contentType.toLowerCase();
  if (type.includes("mpegurl") || type.includes("dash+xml")) return "stream";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  if (type.includes("zip") || type.includes("compressed") || type.includes("tar")) return "archive";
  if (type.startsWith("text/") || type.includes("pdf") || type.includes("document")) return "document";
  if (type.includes("octet-stream")) {
    const byName = kindOfName(name);
    return byName === "other" ? "other" : byName;
  }
  return kindOfName(name);
}

/** Which smart folder a file kind belongs to. */
export function categoryOfKind(kind: Kind): Category {
  switch (kind) {
    case "video":
    case "stream":
      return "video";
    case "audio":
      return "audio";
    case "document":
    case "image":
      return "document";
    case "app":
      return "program";
    case "archive":
      return "archive";
    default:
      return "other";
  }
}

/** The chip's two-to-three letter mark, which reads before the name does. */
export function kindBadge(kind: Kind): string {
  switch (kind) {
    case "video":
      return "VID";
    case "audio":
      return "AUD";
    case "image":
      return "IMG";
    case "document":
      return "DOC";
    case "archive":
      return "ZIP";
    case "app":
      return "APP";
    case "stream":
      return "HLS";
    case "torrent":
      return "BT";
    default:
      return "FILE";
  }
}

export function kindColorClass(kind: Kind): string {
  switch (kind) {
    case "video":
      return "bg-violet-500/15 text-violet-600 dark:text-violet-300";
    case "audio":
      return "bg-sky-500/15 text-sky-600 dark:text-sky-300";
    case "image":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
    case "document":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-300";
    case "archive":
      return "bg-orange-500/15 text-orange-600 dark:text-orange-300";
    case "app":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-300";
    case "stream":
      return "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300";
    case "torrent":
      return "bg-teal-500/15 text-teal-600 dark:text-teal-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function statusLabel(status: Status): string {
  switch (status) {
    case "preparing":
      return "解析中";
    case "queued":
      return "排队中";
    case "running":
      return "下载中";
    case "paused":
      return "已暂停";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
  }
}

/** How a status reads in a list: an order for sorting, and a tone for the badge. */
export const STATUS_RANK: Record<Status, number> = {
  running: 0,
  queued: 1,
  preparing: 2,
  paused: 3,
  failed: 4,
  done: 5,
  canceled: 6,
};

export function statusTone(status: Status): string {
  switch (status) {
    case "running":
      return "bg-primary/12 text-primary";
    case "done":
      return "bg-success/12 text-success";
    case "failed":
      return "bg-destructive/12 text-destructive";
    case "paused":
      return "bg-warning/12 text-warning";
    case "queued":
    case "preparing":
      return "bg-accent text-accent-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export const PRIORITY_ORDER: Priority[] = ["high", "normal", "low"];

export const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export function priorityLabel(priority: Priority): string {
  switch (priority) {
    case "high":
      return "高";
    case "low":
      return "低";
    default:
      return "普通";
  }
}

/** FDM's traffic modes; `custom` uses `customKb` instead. */
export const SPEED_MODE_KB: Record<Exclude<SpeedMode, "custom">, number> = {
  unlimited: 0,
  low: 64,
  medium: 512,
  high: 2048,
};

export function speedModeLabel(mode: SpeedMode): string {
  switch (mode) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
    case "custom":
      return "自定义";
    default:
      return "不限";
  }
}

export function speedLimitKb(mode: SpeedMode, customKb: number): number {
  if (mode === "custom") return Math.max(0, Math.round(customKb));
  return SPEED_MODE_KB[mode];
}

/** A `.torrent` URL is a BitTorrent job, not a file to keep. */
export function isTorrentUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".torrent");
  } catch {
    return false;
  }
}

function clockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Whether `minutes` since midnight falls in the scheduler's daily window. `start === stop` is closed. */
export function inScheduleWindow(start: string, stop: string, minutes: number): boolean {
  const from = clockMinutes(start);
  const to = clockMinutes(stop);
  if (from === null || to === null || from === to) return false;
  if (from < to) return minutes >= from && minutes < to;
  return minutes >= from || minutes < to;
}

export function validClock(value: string): boolean {
  return clockMinutes(value) !== null;
}
