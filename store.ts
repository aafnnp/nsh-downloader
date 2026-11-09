import { Clipboard, computed, platform, setColorScheme, signal, Storage } from "nsh";
import { Window, isAvailable as desktopWindow } from "nsh/desktop";
import { join } from "path";
import { defaultSettings, type EngineId, type Item, type Settings, type Status } from "./model";
import { detectEngines, engines, type EngineInfo } from "./lib/engines";
import {
  defaultDownloadDir,
  dirOf,
  ensureDir,
  fileSize,
  filenameOf,
  pathSize,
  removePartsDir,
  uniqueDir,
  uniquePath,
  writableDir,
} from "./lib/paths";
import { messageOf, probe, type Probe } from "./lib/probe";
import { chooseEngine, startTransfer, type Outcome, type Transfer } from "./lib/transfer";
import { startPlaylist } from "./lib/playlist";
import {
  extractUrls,
  filenameFromUrl,
  magnetInfo,
  magnetWithTrackers,
  normalizeMagnet,
  normalizeProxy,
  normalizeUrl,
  parseSharedPayload,
} from "./lib/urls";
import { kindOfName } from "./model";
import { describeLink } from "./lib/netdisk";

const STORE_KEY = "downloader.state.v1";

export interface Notice {
  text: string;
  tone: "info" | "error" | "success";
  at: number;
}

export const items = signal<Item[]>([]);
export const settings = signal<Settings>(defaultSettings(defaultDownloadDir()));
export const notice = signal<Notice | null>(null);
export const ready = signal(false);
export const engineScan = signal(false);
/** What the last scan found: a signal, because the title bar and sidebar read it in bindings. */
export const engineInfo = signal<EngineInfo>({ ...engines });

const transfers = new Map<string, Transfer>();
const speeds = new Map<string, { bytes: number; at: number; value: number }>();
let persistTimer: number | undefined;
let watchTimer: number | undefined;
let lastClipboard = "";

export const activeCount = computed(() => items().filter((item) => item.status === "running").length);
export const queuedCount = computed(() => items().filter((item) => item.status === "queued").length);
export const finishedCount = computed(() => items().filter((item) => item.status === "done").length);
export const failedCount = computed(() => items().filter((item) => item.status === "failed").length);
export const totalSpeed = computed(() =>
  items().reduce((sum, item) => (item.status === "running" ? sum + item.speed : sum), 0),
);

export function notify(text: string, tone: Notice["tone"] = "info"): void {
  notice.set({ text, tone, at: Date.now() });
  setTimeout(() => {
    const current = notice();
    if (current && current.text === text) notice.set(null);
  }, 4200);
}

function schedulePersist(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    const payload = JSON.stringify({ settings: settings(), items: items() });
    void writeState(payload);
  }, 600) as unknown as number;
}

async function writeState(payload: string): Promise<void> {
  try {
    await Storage.setItem(STORE_KEY, payload);
  } catch {
    // Storage is best effort: the app keeps working without it.
  }
}

/** Changes one item; `persist` writes the list out (progress ticks leave it off). */
function patch(id: string, changes: Partial<Item>, persist = false): void {
  items.update((list) => list.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  if (persist) schedulePersist();
}

function setStatus(id: string, status: Status, error: string | null = null): void {
  const speed = status === "running" ? undefined : 0;
  patch(id, { status, error, ...(speed === undefined ? {} : { speed }) }, true);
}

export function updateSettings(changes: Partial<Settings>): void {
  const next = { ...settings(), ...changes };
  if (changes.dir !== undefined) {
    const trimmed = next.dir.trim();
    next.dir = trimmed || settings().dir;
  }
  next.maxConcurrent = Math.max(1, Math.min(6, Math.round(next.maxConcurrent)));
  next.connections = Math.max(1, Math.min(16, Math.round(next.connections)));
  next.limitKb = Math.max(0, Math.min(1024 * 1024, Math.round(next.limitKb)));
  settings.set(next);
  if (changes.appearance) setColorScheme(next.appearance);
  if (changes.watchClipboard !== undefined) startClipboardWatch();
  schedulePersist();
  pump();
}

export function itemById(id: string): Item | undefined {
  return items().find((item) => item.id === id);
}

export interface AddResult {
  ok: boolean;
  message: string;
  count?: number;
}

export async function addUrl(
  rawUrl: string,
  referer: string | null = null,
  headers: string[] = [],
): Promise<AddResult> {
  const magnet = normalizeMagnet(rawUrl);
  if (magnet) return addMagnet(magnet);

  const url = normalizeUrl(rawUrl);
  if (!url) return { ok: false, message: "不是有效的 http(s) 或 magnet 链接" };

  const existing = items().find((item) => item.url === url && item.status !== "canceled");
  if (existing) return { ok: false, message: "这个链接已经在列表里了" };

  const current = settings();
  const provisional = filenameFromUrl(url) || "download";
  const item: Item = {
    id: crypto.randomUUID(),
    url,
    filename: provisional,
    dir: current.dir,
    kind: "other",
    status: "preparing",
    total: 0,
    received: 0,
    offset: 0,
    speed: 0,
    error: null,
    phase: null,
    engine: null,
    playlist: null,
    torrent: false,
    referer: referer ?? describeLink(url)?.referer ?? null,
    headers,
    createdAt: Date.now(),
    finishedAt: null,
  };
  items.update((list) => [item, ...list]);

  // A proxy this app cannot use (the built-in fetch has none) or a host that hides from HEAD
  // still downloads: aria2c and curl ask for themselves, so a failed probe only loses the size.
  let found: Probe | null = null;
  let probeError = "";
  try {
    found = await probe(url);
  } catch (error) {
    probeError = messageOf(error);
    if (!engines.aria2 && !engines.curl) {
      patch(item.id, { status: "failed", error: probeError }, true);
      return { ok: false, message: probeError };
    }
    patch(item.id, { kind: kindOfName(provisional), phase: "跳过探测，直接下载" }, true);
  }

  try {
    if (found) {
      patch(
        item.id,
        {
          kind: found.kind,
          total: found.total,
          playlist: found.playlist,
          url: found.url,
        },
        true,
      );
    }
    const dir = await writableDir(current.dir);
    if (dir !== current.dir) {
      notify(`保存目录不可写，改用 ${dir}`, "error");
      patch(item.id, { dir }, true);
    }
    const filename = await uniquePath(dir, found?.filename || provisional);
    patch(item.id, { filename: filenameOf(filename), dir: dirOf(filename) }, true);
    setStatus(item.id, current.autoStart ? "queued" : "paused");
    pump();
    if (!found) return { ok: true, message: "已加入队列（探测失败，交给下载引擎）" };
    return { ok: true, message: found.total > 0 ? "已加入队列" : "已加入队列（大小未知）" };
  } catch (error) {
    const message = messageOf(error);
    patch(item.id, { status: "failed", error: message }, true);
    return { ok: false, message };
  }
}

/** A magnet link: only aria2c speaks BitTorrent, and the torrent gets a folder of its own. */
async function addMagnet(magnet: string): Promise<AddResult> {
  if (!engines.checked) await detectEngines();
  if (!engines.aria2) {
    return { ok: false, message: "磁力链接需要 aria2c：brew install aria2 / sudo apt install aria2" };
  }

  const info = magnetInfo(magnet);
  const existing = items().find(
    (item) => item.torrent && (info.hash ? item.url.includes(info.hash) : item.url === magnet) && item.status !== "canceled",
  );
  if (existing) return { ok: false, message: "这个磁力链接已经在列表里了" };

  const current = settings();
  let dir = "";
  try {
    const parent = await writableDir(current.dir);
    dir = await uniqueDir(parent, info.name);
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }

  const item: Item = {
    id: crypto.randomUUID(),
    url: magnetWithTrackers(magnet),
    filename: info.name,
    dir,
    kind: "torrent",
    status: "preparing",
    total: 0,
    received: 0,
    offset: 0,
    speed: 0,
    error: null,
    phase: "读取种子",
    engine: "aria2",
    playlist: null,
    torrent: true,
    referer: null,
    headers: [],
    createdAt: Date.now(),
    finishedAt: null,
  };
  items.update((list) => [item, ...list]);
  setStatus(item.id, current.autoStart ? "queued" : "paused");
  pump();
  return { ok: true, message: `已加入磁力下载：${info.name}` };
}

export async function addMany(
  urls: string[],
  referer: string | null = null,
  headers: string[] = [],
): Promise<AddResult> {
  let added = 0;
  let lastMessage = "";
  for (const url of urls) {
    const result = await addUrl(url, referer, headers);
    if (result.ok) added += 1;
    lastMessage = result.message;
  }
  if (added === 0) return { ok: false, message: lastMessage || "没有可下载的链接" };
  return { ok: true, message: added === 1 ? "已加入 1 个下载" : `已加入 ${added} 个下载`, count: added };
}

function specOf(item: Item) {
  const current = settings();
  return {
    url: item.url,
    path: join(item.dir, item.filename),
    dir: item.dir,
    filename: item.filename,
    total: item.total,
    connections: current.connections,
    limitKb: current.limitKb,
    proxy: normalizeProxy(current.proxy),
    referer: item.referer,
    torrent: item.torrent,
    headers: item.headers ?? [],
  };
}

/** A transfer whose engine still has to start (a torrent's folder is made first). */
function deferredTransfer(begin: () => Promise<Transfer>): Transfer {
  let real: Transfer | null = null;
  let canceled = false;
  let settle: (outcome: Outcome) => void = () => undefined;
  const done = new Promise<Outcome>((resolve) => {
    settle = resolve;
  });
  void begin()
    .then(async (transfer) => {
      real = transfer;
      if (canceled) transfer.cancel();
      settle(await transfer.done);
    })
    .catch((error: unknown) => {
      settle({ ok: false, error: messageOf(error), canceled });
    });
  return {
    cancel() {
      canceled = true;
      real?.cancel();
    },
    done,
  };
}

function launch(item: Item): void {
  if (transfers.has(item.id)) return;
  const current = settings();
  const spec = specOf(item);
  if (item.torrent && !engines.aria2) {
    patch(item.id, { status: "failed", error: "磁力链接需要 aria2c，装好后点重试" }, true);
    return;
  }
  const engine: EngineId = item.playlist ? "segments" : chooseEngine(item.total, current.engine, item.torrent);

  setStatus(item.id, "running");
  patch(item.id, { engine });

  const hooks = {
    progress(received: number, total: number) {
      const now = Date.now();
      const previous = speeds.get(item.id) ?? { bytes: item.received, at: now, value: 0 };
      const elapsed = (now - previous.at) / 1000;
      let speed = previous.value;
      if (elapsed >= 0.4) {
        const instant = Math.max(0, (received - previous.bytes) / elapsed);
        speed = previous.value > 0 ? previous.value * 0.6 + instant * 0.4 : instant;
        speeds.set(item.id, { bytes: received, at: now, value: speed });
      }
      patch(item.id, { received, ...(total > 0 ? { total } : {}), speed });
    },
    phase(text: string) {
      patch(item.id, { phase: text });
    },
  };

  // A torrent's folder may not exist yet (its name is reserved, not created), and aria2 runs in it.
  const begin = async (): Promise<Transfer> => {
    if (item.torrent) await ensureDir(item.dir);
    return item.playlist
      ? startPlaylist(
          {
            ...spec,
            playlist: item.playlist,
            partsDir: join(item.dir, `.${item.filename}.parts`),
          },
          hooks,
        )
      : startTransfer(spec, engine, hooks);
  };

  const transfer = deferredTransfer(begin);
  transfers.set(item.id, transfer);

  void transfer.done.then(async (outcome) => {
    transfers.delete(item.id);
    speeds.delete(item.id);
    if (outcome.ok) {
      const size = item.torrent ? await pathSize(item.dir) : await fileSize(spec.path);
      patch(
        item.id,
        {
          status: "done",
          received: size || item.total,
          total: size || item.total,
          speed: 0,
          error: null,
          phase: null,
          finishedAt: Date.now(),
        },
        true,
      );
      if (item.playlist) await removePartsDir(join(item.dir, `.${item.filename}.parts`));
      notify(`完成：${item.filename}`, "success");
    } else if (outcome.canceled) {
      patch(item.id, { status: "paused", speed: 0 }, true);
    } else {
      patch(item.id, { status: "failed", error: outcome.error, speed: 0 }, true);
      notify(`失败：${item.filename}`, "error");
    }
    pump();
  });
}

/** Starts queued downloads while the settings leave room for them. */
export function pump(): void {
  const current = settings();
  const list = items();
  let running = list.filter((item) => item.status === "running").length;
  for (const item of list) {
    if (running >= current.maxConcurrent) break;
    if (item.status !== "queued" || transfers.has(item.id)) continue;
    launch(item);
    running += 1;
  }
}

export function pause(id: string): void {
  const transfer = transfers.get(id);
  if (transfer) {
    transfer.cancel();
    return;
  }
  const item = itemById(id);
  if (item && (item.status === "queued" || item.status === "preparing")) setStatus(id, "paused");
}

export function resume(id: string): void {
  const item = itemById(id);
  if (!item) return;
  if (item.status === "done") return;
  setStatus(id, "queued");
  pump();
}

export function retry(id: string): void {
  const item = itemById(id);
  if (!item) return;
  patch(id, { received: 0, error: null }, true);
  setStatus(id, "queued");
  pump();
}

export function pauseAll(): void {
  for (const item of items()) {
    if (item.status === "running" || item.status === "queued") pause(item.id);
  }
}

export function resumeAll(): void {
  for (const item of items()) {
    if (item.status === "paused" || item.status === "failed") setStatus(item.id, "queued");
  }
  pump();
}

export function remove(id: string): void {
  const transfer = transfers.get(id);
  if (transfer) transfer.cancel();
  transfers.delete(id);
  speeds.delete(id);
  items.update((list) => list.filter((item) => item.id !== id));
  schedulePersist();
  setTimeout(() => pump(), 50);
}

export function clearFinished(): number {
  const keep = items().filter((item) => item.status !== "done" && item.status !== "failed" && item.status !== "canceled");
  const removed = items().length - keep.length;
  items.set(keep);
  schedulePersist();
  return removed;
}

export function clearAll(): void {
  pauseAll();
  setTimeout(() => {
    items.set([]);
    schedulePersist();
  }, 100);
}

export async function importClipboard(): Promise<AddResult> {
  let text = "";
  try {
    text = await Clipboard.readText();
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  const resources = parseSharedPayload(text);
  if (resources.length === 0) return { ok: false, message: "剪贴板里没有链接" };
  let added = 0;
  for (const resource of resources) {
    const result = await addUrl(resource.url, resource.referer ?? null);
    if (result.ok) added += 1;
  }
  if (added === 0) return { ok: false, message: "剪贴板里的链接都已在列表中" };
  return { ok: true, message: `从剪贴板加入 ${added} 个下载`, count: added };
}

export async function addFromText(text: string): Promise<AddResult> {
  const resources = parseSharedPayload(text);
  const urls = resources.length > 0 ? resources.map((entry) => entry.url) : extractUrls(text);
  if (urls.length === 0) return { ok: false, message: "没有识别到链接" };
  return addMany(urls);
}

function startClipboardWatch(): void {
  if (watchTimer !== undefined) {
    clearInterval(watchTimer);
    watchTimer = undefined;
  }
  // A phone shows its paste notice on every read, so only a desktop watches.
  if (!settings().watchClipboard || !platform.desktop) return;
  watchTimer = setInterval(async () => {
    let text = "";
    try {
      text = await Clipboard.readText();
    } catch {
      return;
    }
    if (!text || text === lastClipboard) return;
    lastClipboard = text;
    const resources = parseSharedPayload(text);
    if (resources.length === 0) return;
    const fresh = resources.filter(
      (resource) => !items().some((item) => item.url === resource.url && item.status !== "canceled"),
    );
    if (fresh.length === 0) return;
    for (const resource of fresh) await addUrl(resource.url, resource.referer ?? null);
    notify(`剪贴板：加入 ${fresh.length} 个下载`, "success");
  }, 2000) as unknown as number;
}

export async function rescanEngines(): Promise<void> {
  engineScan.set(true);
  await detectEngines();
  engineInfo.set({ ...engines });
  engineScan.set(false);
}

export async function bootstrap(): Promise<void> {
  if (desktopWindow) Window.setTitleBar({ style: "hidden", height: 48 });
  let stored: { settings?: Partial<Settings>; items?: Item[] } | null = null;
  try {
    const raw = await Storage.getItem(STORE_KEY);
    if (raw) stored = JSON.parse(raw) as { settings?: Partial<Settings>; items?: Item[] };
  } catch {
    stored = null;
  }

  if (stored?.settings) {
    const merged = { ...defaultSettings(defaultDownloadDir()), ...stored.settings };
    settings.set(merged);
  }
  if (stored?.items && Array.isArray(stored.items)) {
    const restored = stored.items.map((item) => ({
      ...item,
      headers: item.headers ?? [],
      torrent: item.torrent ?? /^magnet:/i.test(item.url),
      phase: null,
      speed: 0,
      status: item.status === "running" || item.status === "preparing" ? ("paused" as Status) : item.status,
    }));
    items.set(restored);
  }

  setColorScheme(settings().appearance);
  startClipboardWatch();
  ready.set(true);

  await detectEngines();
  engineInfo.set({ ...engines });
  engineScan.set(false);
  pump();
}

/** The engines the UI shows, read once detection has run. */
export { engines };

export function engineHint(): string {
  const scanned = engineInfo();
  if (platform.os === "web") return "网页预览版：请用桌面应用下载";
  if (!scanned.checked) return "正在检测下载引擎…";
  if (scanned.aria2) return "aria2c 已就绪：多线程与磁力链接";
  if (scanned.curl) return "curl 已就绪，支持断点续传";
  return "只有内置引擎：文件上限 8 MB，磁力链接需安装 aria2c";
}

