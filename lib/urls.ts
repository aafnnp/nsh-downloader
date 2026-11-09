import type { Kind } from "../model";

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const MAGNET = /^magnet:\?\S+$/i;

/** A magnet link as pasted, trimmed, with its parameters kept as they are. */
export function normalizeMagnet(raw: string): string | null {
  const text = raw.trim();
  return MAGNET.test(text) ? text : null;
}

function magnetParam(magnet: string, name: string): string {
  const query = magnet.slice(magnet.indexOf("?") + 1);
  for (const pair of query.split("&")) {
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    if (pair.slice(0, at).toLowerCase() !== name) continue;
    const value = pair.slice(at + 1).replace(/\+/g, " ");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

export interface MagnetInfo {
  /** The display name a `dn=` parameter gives, else the info hash's first 8 characters. */
  name: string;
  /** The BitTorrent info hash, lower-case hex when it can be read. */
  hash: string;
}

export function magnetInfo(magnet: string): MagnetInfo {
  const xt = magnetParam(magnet, "xt");
  const raw = xt.replace(/^urn:btih:/i, "");
  const hash = /^[0-9a-z]{32,40}$/i.test(raw) ? raw.toLowerCase() : "";
  const name = sanitizeFilename(magnetParam(magnet, "dn"));
  return { name: name || (hash ? `torrent-${hash.slice(0, 8)}` : "torrent"), hash };
}

/** Public trackers added to a magnet that names none: DHT bootstrap is slow for a one-off download. */
const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
];

/** The magnet with trackers when it lists none, so a link without peers still finds some. */
export function magnetWithTrackers(magnet: string): string {
  if (/[?&]tr=/.test(magnet) || !/^magnet:\?/i.test(magnet)) return magnet;
  const joined = TRACKERS.map((tracker) => `&tr=${encodeURIComponent(tracker)}`).join("");
  return magnet + joined;
}

/** Trims a pasted link and gives it a scheme when it has none. Null when it is not a web link. */
export function normalizeUrl(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  if (!SCHEME.test(text)) {
    if (/^[\w-]+(\.[\w-]+)+/.test(text)) text = `https://${text}`;
    else return null;
  }
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A proxy from what the user typed: `host:port` means http, and scheme-less values get one. */
export function normalizeProxy(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return "";
    if (!url.port && !url.hostname.includes(".") && url.hostname !== "localhost") return "";
    if (!["http:", "https:", "socks5:", "socks5h:", "socks4:"].includes(url.protocol)) return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

/** Whether a text is a magnet link rather than a web link. */
export function looksLikeMagnet(raw: string): boolean {
  return /^magnet:/i.test(raw.trim());
}

/** Every web link and magnet link in a text. Duplicates are dropped. */
export function extractUrls(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const piece of text.split(/[\s"'<>]+/)) {
    const url = normalizeMagnet(piece) ?? normalizeUrl(piece);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    found.push(url);
  }
  return found;
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/x-7z-compressed": "7z",
  "application/x-tar": "tar",
  "application/gzip": "gz",
  "application/vnd.apple.mpegurl": "m3u8",
  "application/x-mpegurl": "m3u8",
  "application/dash+xml": "mpd",
};

export function extensionForType(contentType: string): string {
  const bare = contentType.split(";")[0].trim().toLowerCase();
  return EXTENSION_BY_TYPE[bare] ?? "";
}

/** The last path segment of a URL, decoded and stripped of anything a file name may not hold. */
export function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").filter(Boolean).pop() ?? "";
    return sanitizeFilename(decodeURIComponent(last));
  } catch {
    return "";
  }
}

/** A name a file system takes: no separators or control characters, no trailing dots, bounded. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (!cleaned) return "";
  if (cleaned.length <= 180) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 180 - ext.length) + ext;
}

export function withExtension(name: string, contentType: string, kind: Kind): string {
  if (name.includes(".")) return name;
  const ext = extensionForType(contentType);
  if (ext) return `${name}.${ext}`;
  switch (kind) {
    case "video":
      return `${name}.mp4`;
    case "audio":
      return `${name}.mp3`;
    case "image":
      return `${name}.jpg`;
    case "document":
      return `${name}.pdf`;
    case "archive":
      return `${name}.zip`;
    case "stream":
      return `${name}.m3u8`;
    default:
      return name;
  }
}

/** "file.mp4?download=1" is not a playlist even when the path is; the path decides. */
export function playlistKind(url: string, contentType: string): "hls" | "dash" | null {
  let path = url;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  if (path.endsWith(".m3u8") || path.endsWith(".m3u")) return "hls";
  if (path.endsWith(".mpd")) return "dash";
  const type = contentType.toLowerCase();
  if (type.includes("mpegurl")) return "hls";
  if (type.includes("dash+xml")) return "dash";
  return null;
}


/** Keeps what the extension's popup sends: a JSON payload of resources, or a list of links. */
export interface SharedResource {
  url: string;
  title?: string;
  kind?: string;
  referer?: string;
}

export function parseSharedPayload(text: string): SharedResource[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const wrapped =
        parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
          ? ((parsed as { items: unknown[] }).items)
          : null;
      const list = wrapped ?? (Array.isArray(parsed) ? parsed : [parsed]);
      const out: SharedResource[] = [];
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        const url =
          typeof record.url === "string" ? normalizeMagnet(record.url) ?? normalizeUrl(record.url) : null;
        if (!url) continue;
        out.push({
          url,
          title: typeof record.title === "string" ? record.title : undefined,
          kind: typeof record.kind === "string" ? record.kind : undefined,
          referer: typeof record.referer === "string" ? record.referer : undefined,
        });
      }
      if (out.length > 0) return out;
    } catch {
      // Not JSON: fall through to plain links.
    }
  }
  return extractUrls(text).map((url) => ({ url }));
}
