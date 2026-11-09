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

export interface Item {
  id: string;
  /** The URL as the user gave it. */
  url: string;
  /** The file name written under `dir`. */
  filename: string;
  dir: string;
  kind: Kind;
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
  /** A magnet link: aria2c fetches it, and `dir` holds everything the torrent names. */
  torrent: boolean;
  referer: string | null;
  /** Extra request headers, one `Name: value` per entry (a hotlink guard's Referer, a cookie). */
  headers: string[];
  createdAt: number;
  finishedAt: number | null;
}

export interface Settings {
  /** Where files land. */
  dir: string;
  /** Transfers running at the same time (1 to 6). */
  maxConcurrent: number;
  /** aria2's connections per file (1 to 16). */
  connections: number;
  /** Per-file speed limit in KB/s; 0 is unlimited. */
  limitKb: number;
  /** The proxy the engines use (`http://127.0.0.1:7890`, `socks5://…`); empty goes direct. */
  proxy: string;
  /** `auto` picks aria2c, then curl, then the built-in fetch engine. */
  engine: "auto" | EngineId;
  /** Watch the clipboard while the window is focused, and take links from it. */
  watchClipboard: boolean;
  /** Start a new download as soon as it is added. */
  autoStart: boolean;
  appearance: "system" | "light" | "dark";
}

export function defaultSettings(dir: string): Settings {
  return {
    dir,
    maxConcurrent: 3,
    connections: 8,
    limitKb: 0,
    proxy: "",
    engine: "auto",
    watchClipboard: true,
    autoStart: true,
    appearance: "system",
  };
}

const VIDEO = ["mp4", "mkv", "mov", "webm", "avi", "flv", "m4v", "ts", "mpg", "mpeg", "wmv"];
const AUDIO = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma"];
const IMAGE = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "heic", "tiff"];
const DOCUMENT = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "epub", "rtf"];
const ARCHIVE = ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "iso", "dmg"];
const APP = ["exe", "msi", "pkg", "apk", "ipa", "deb", "rpm", "appimage"];
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

