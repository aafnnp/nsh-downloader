import { Clipboard, computed, platform, setColorScheme, signal, Storage } from "nsh";
import { Application, isAvailable as desktopWindow } from "nsh/desktop";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";
import {
  CATEGORY_META,
  categoryOfKind,
  defaultSettings,
  inScheduleWindow,
  isTorrentUrl,
  kindOfName,
  PRIORITY_RANK,
  speedLimitKb,
  validClock,
  type Category,
  type EngineId,
  type Item,
  type Priority,
  type SchedulerSettings,
  type Settings,
  type Status,
} from "./model";
import { detectEngines, engines, type EngineInfo } from "./lib/engines";
import { resetBundledAria2 } from "./lib/aria2";
import {
  defaultDownloadDir,
  dirOf,
  ensureDir,
  filePathFromUrl,
  fileSize,
  filenameOf,
  pathSize,
  removePartsDir,
  uniqueDir,
  uniquePath,
  writableDir,
} from "./lib/paths";
import { messageOf, probe, type Probe } from "./lib/probe";
import { SpeedMeter } from "./lib/speed";
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
import { describeLink } from "./lib/netdisk";

const STORE_KEY = "downloader.state.v1";
const TRAFFIC_SAMPLES = 48;

export interface Notice {
  text: string;
  tone: "info" | "error" | "success";
  at: number;
}

export interface AddOptions {
  /** The base folder; category subfolders and overrides still apply under it. */
  dir?: string;
  /** `auto` lets the probe's kind decide, as FDM's smart file manager does. */
  category?: Category | "auto";
  priority?: Priority;
  /** `null` follows the app-wide traffic mode. */
  limitKb?: number | null;
  description?: string;
  referer?: string | null;
  headers?: string[];
}

export interface AddResult {
  ok: boolean;
  message: string;
  count?: number;
}

export const items = signal<Item[]>([]);
export const settings = signal<Settings>(defaultSettings(defaultDownloadDir()));
export const notice = signal<Notice | null>(null);
export const ready = signal(false);
export const engineScan = signal(false);
/** What the last scan found: a signal, because the title bar and sidebar read it in bindings. */
export const engineInfo = signal<EngineInfo>({ ...engines });
/** The rows the toolbar and details pane act on. */
export const selection = signal<string[]>([]);
/** The last 48 one-second samples, for FDM's traffic graph. */
export const traffic = signal<number[]>(new Array(TRAFFIC_SAMPLES).fill(0));
/** `off` when disabled, `waiting` outside the window, `active` inside it. */
export const schedulerState = signal<"off" | "waiting" | "active">("off");

const transfers = new Map<string, Transfer>();
const speeds = new Map<string, SpeedMeter>();
let persistTimer: number | undefined;
let watchTimer: number | undefined;
let trafficTimer: number | undefined;
let schedulerTimer: number | undefined;
let schedulerArmed = false;
let lastClipboard = "";
let openFilesBound = false;

export const activeCount = computed(() => items().filter((item) => item.status === "running").length);
export const queuedCount = computed(() => items().filter((item) => item.status === "queued").length);
export const pausedCount = computed(() => items().filter((item) => item.status === "paused").length);
export const finishedCount = computed(() => items().filter((item) => item.status === "done").length);
export const failedCount = computed(() => items().filter((item) => item.status === "failed").length);
export const unfinishedCount = computed(
  () => items().filter((item) => item.status !== "done" && item.status !== "failed" && item.status !== "canceled").length,
);
export const totalSpeed = computed(() =>
  items().reduce((sum, item) => (item.status === "running" ? sum + item.speed : sum), 0),
);
export const categoryCounts = computed(() => {
  const counts: Record<Category, number> = { video: 0, audio: 0, document: 0, program: 0, archive: 0, other: 0 };
  for (const item of items()) counts[item.category] += 1;
  return counts;
});
export const selectedItem = computed<Item | null>(() => {
  const ids = selection();
  if (ids.length === 0) return null;
  const last = ids[ids.length - 1];
  return items().find((item) => item.id === last) ?? null;
});

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

export type SettingsPatch = Omit<Partial<Settings>, "scheduler"> & { scheduler?: Partial<SchedulerSettings> };

export function updateSettings(changes: SettingsPatch): void {
  const previous = settings();
  const next: Settings = {
    ...previous,
    ...changes,
    categoryDirs: { ...previous.categoryDirs, ...(changes.categoryDirs ?? {}) },
    scheduler: { ...previous.scheduler, ...(changes.scheduler ?? {}) },
  };
  if (changes.dir !== undefined) {
    const trimmed = next.dir.trim();
    next.dir = trimmed || previous.dir;
  }
  next.maxConcurrent = Math.max(1, Math.min(8, Math.round(next.maxConcurrent)));
  next.connections = Math.max(1, Math.min(16, Math.round(next.connections)));
  next.limitKb = Math.max(0, Math.min(1024 * 1024, Math.round(next.limitKb)));
  if (!validClock(next.scheduler.start)) next.scheduler.start = previous.scheduler.start;
  if (!validClock(next.scheduler.stop)) next.scheduler.stop = previous.scheduler.stop;
  next.scheduler.days = [...new Set(next.scheduler.days)].filter((day) => day >= 0 && day <= 6).sort();

  settings.set(next);
  if (changes.appearance) setColorScheme(next.appearance);
  if (changes.watchClipboard !== undefined) startClipboardWatch();
  syncScheduler();
  schedulePersist();
  pump();
}

export function updateCategoryDir(category: Category, value: string): void {
  updateSettings({ categoryDirs: { [category]: value } });
}

/** The KB/s the app-wide traffic mode asks for. */
export function effectiveLimitKb(): number {
  return speedLimitKb(settings().speedMode, settings().limitKb);
}

/** Where a category's files land under `base`, honoring a per-category folder. */
export function categoryDirFor(base: string, category: Category): string {
  const override = settings().categoryDirs[category]?.trim();
  if (override) return override;
  if (settings().organizeByCategory) return join(base, CATEGORY_META[category].folder);
  return base;
}

export function itemById(id: string): Item | undefined {
  return items().find((item) => item.id === id);
}

export function categoryCount(category: Category): number {
  return categoryCounts()[category];
}

export async function addUrl(rawUrl: string, options: AddOptions = {}): Promise<AddResult> {
  if (!engines.checked) await detectEngines();
  const magnet = normalizeMagnet(rawUrl);
  if (magnet) return addMagnet(magnet, options);

  const url = normalizeUrl(rawUrl);
  if (!url) return { ok: false, message: "不是有效的 http(s) 或 magnet 链接" };
  if (isTorrentUrl(url)) return addTorrentUrl(url, options);

  const existing = items().find((item) => item.url === url && item.status !== "canceled");
  if (existing) return { ok: false, message: "这个链接已经在列表里了" };

  const current = settings();
  const base = options.dir?.trim() || current.dir;
  const provisional = filenameFromUrl(url) || "download";
  const provisionalKind = kindOfName(provisional);
  const chosen = options.category && options.category !== "auto" ? options.category : null;
  const provisionalCategory = chosen ?? categoryOfKind(provisionalKind);
  const item: Item = {
    id: crypto.randomUUID(),
    url,
    filename: provisional,
    dir: categoryDirFor(base, provisionalCategory),
    kind: provisionalKind,
    category: provisionalCategory,
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
    torrentFile: null,
    referer: options.referer ?? describeLink(url)?.referer ?? null,
    headers: options.headers ?? [],
    description: options.description?.trim() ?? "",
    priority: options.priority ?? "normal",
    limitKb: options.limitKb ?? null,
    createdAt: Date.now(),
    startedAt: null,
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
    patch(item.id, { kind: provisionalKind, phase: "跳过探测，直接下载" }, true);
  }

  try {
    if (found) {
      const category = chosen ?? categoryOfKind(found.kind);
      patch(
        item.id,
        {
          kind: found.kind,
          category,
          total: found.total,
          playlist: found.playlist,
          url: found.url,
        },
        true,
      );
    }
    const after = itemById(item.id);
    const targetCategory = after?.category ?? provisionalCategory;
    const dir = await writableDir(categoryDirFor(base, targetCategory));
    if (dir !== itemById(item.id)?.dir) {
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
async function addMagnet(magnet: string, options: AddOptions): Promise<AddResult> {
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
  const base = options.dir?.trim() || current.dir;
  let dir = "";
  try {
    const parent = await writableDir(base);
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
    category: "other",
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
    torrentFile: null,
    referer: null,
    headers: options.headers ?? [],
    description: options.description?.trim() ?? "",
    priority: options.priority ?? "normal",
    limitKb: options.limitKb ?? null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  items.update((list) => [item, ...list]);
  setStatus(item.id, current.autoStart ? "queued" : "paused");
  pump();
  return { ok: true, message: `已加入磁力下载：${info.name}` };
}

/** A `.torrent` URL: aria2c downloads the metadata and then the files it names. */
async function addTorrentUrl(url: string, options: AddOptions): Promise<AddResult> {
  if (!engines.checked) await detectEngines();
  if (!engines.aria2) {
    return { ok: false, message: "种子链接需要 aria2c：brew install aria2 / sudo apt install aria2" };
  }
  const existing = items().find((item) => item.url === url && item.status !== "canceled");
  if (existing) return { ok: false, message: "这个种子链接已经在列表里了" };

  const current = settings();
  const base = options.dir?.trim() || current.dir;
  const display = filenameFromUrl(url).replace(/\.torrent$/i, "") || "torrent";
  let dir = "";
  try {
    const parent = await writableDir(base);
    dir = await uniqueDir(parent, display);
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }

  const item: Item = {
    id: crypto.randomUUID(),
    url,
    filename: display,
    dir,
    kind: "torrent",
    category: "other",
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
    torrentFile: null,
    referer: options.referer ?? null,
    headers: options.headers ?? [],
    description: options.description?.trim() ?? "",
    priority: options.priority ?? "normal",
    limitKb: options.limitKb ?? null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  items.update((list) => [item, ...list]);
  setStatus(item.id, current.autoStart ? "queued" : "paused");
  pump();
  return { ok: true, message: `已加入种子下载：${display}` };
}

/** A `.torrent` file dropped on the window or opened from the system. */
export async function addTorrentFile(path: string, options: AddOptions = {}): Promise<AddResult> {
  if (!engines.checked) await detectEngines();
  if (!engines.aria2) {
    return { ok: false, message: "种子文件需要 aria2c：brew install aria2 / sudo apt install aria2" };
  }
  const existing = items().find((item) => item.torrentFile === path && item.status !== "canceled");
  if (existing) return { ok: false, message: "这个种子文件已经在列表里了" };

  const current = settings();
  const base = options.dir?.trim() || current.dir;
  const display = filenameOf(path).replace(/\.torrent$/i, "") || "torrent";
  let dir = "";
  try {
    const parent = await writableDir(base);
    dir = await uniqueDir(parent, display);
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }

  const item: Item = {
    id: crypto.randomUUID(),
    url: pathToFileURL(path).toString(),
    filename: display,
    dir,
    kind: "torrent",
    category: "other",
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
    torrentFile: path,
    referer: null,
    headers: [],
    description: options.description?.trim() ?? "",
    priority: options.priority ?? "normal",
    limitKb: options.limitKb ?? null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  items.update((list) => [item, ...list]);
  setStatus(item.id, current.autoStart ? "queued" : "paused");
  pump();
  return { ok: true, message: `已加入种子文件：${display}` };
}

export async function addMany(urls: string[], options: AddOptions = {}): Promise<AddResult> {
  let added = 0;
  let lastMessage = "";
  for (const url of urls) {
    const result = await addUrl(url, options);
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
    limitKb: item.limitKb ?? effectiveLimitKb(),
    proxy: normalizeProxy(current.proxy),
    referer: item.referer,
    torrent: item.torrent,
    torrentFile: item.torrentFile,
    aria2Path: engines.aria2Source === "bundled" ? engines.aria2Path : null,
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
    patch(item.id, { status: "failed", error: "磁力/种子下载需要 aria2c，装好后点重试" }, true);
    return;
  }
  const engine: EngineId = item.playlist ? "segments" : chooseEngine(item.total, current.engine, item.torrent);

  setStatus(item.id, "running");
  patch(item.id, { engine, startedAt: item.startedAt ?? Date.now() });

  const hooks = {
    progress(received: number, total: number) {
      const now = Date.now();
      const meter = speeds.get(item.id) ?? new SpeedMeter(item.received, now);
      speeds.set(item.id, meter);
      const speed = meter.sample(received, now);
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
      if (settings().notifyOnComplete) notify(`完成：${item.filename}`, "success");
    } else if (outcome.canceled) {
      patch(item.id, { status: "paused", speed: 0 }, true);
    } else {
      patch(item.id, { status: "failed", error: outcome.error, speed: 0 }, true);
      notify(`失败：${item.filename}`, "error");
    }
    pump();
  });
}

/** Starts queued downloads while the settings leave room for them, highest priority first. */
export function pump(): void {
  if (!engines.checked) return;
  const current = settings();
  const list = items();
  let running = list.filter((item) => item.status === "running").length;
  const queued = list
    .filter((item) => item.status === "queued" && !transfers.has(item.id))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt);
  for (const item of queued) {
    if (running >= current.maxConcurrent) break;
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
  if (item.status === "done" || item.status === "running" || item.status === "queued") return;
  setStatus(id, "queued");
  pump();
}

export function retry(id: string): void {
  const item = itemById(id);
  if (!item) return;
  if (item.status === "running" || item.status === "queued" || item.status === "preparing") return;
  patch(id, { received: 0, speed: 0, error: null }, true);
  setStatus(id, "queued");
  pump();
}

export function pauseAll(): void {
  for (const item of items()) {
    if (item.status === "running" || item.status === "queued" || item.status === "preparing") pause(item.id);
  }
}

export function resumeAll(): void {
  for (const item of items()) {
    if (item.status === "paused" || item.status === "failed" || item.status === "queued") setStatus(item.id, "queued");
  }
  pump();
}

export function pauseMany(ids: string[]): void {
  for (const id of ids) pause(id);
}

export function resumeMany(ids: string[]): void {
  for (const id of ids) {
    const item = itemById(id);
    if (!item) continue;
    if (item.status === "paused" || item.status === "failed" || item.status === "preparing") setStatus(id, "queued");
  }
  pump();
}

export function retryMany(ids: string[]): void {
  for (const id of ids) retry(id);
  pump();
}

export function remove(id: string): void {
  removeMany([id]);
}

export function removeMany(ids: string[]): void {
  const wanted = new Set(ids);
  for (const id of wanted) {
    const transfer = transfers.get(id);
    if (transfer) transfer.cancel();
    transfers.delete(id);
    speeds.delete(id);
  }
  items.update((list) => list.filter((item) => !wanted.has(item.id)));
  selection.update((list) => list.filter((id) => !wanted.has(id)));
  schedulePersist();
  setTimeout(() => pump(), 50);
}

export function clearFinished(): number {
  const keep = items().filter((item) => item.status !== "done" && item.status !== "failed" && item.status !== "canceled");
  const removed = items().length - keep.length;
  items.set(keep);
  selection.set([]);
  schedulePersist();
  return removed;
}

export function clearAll(): void {
  pauseAll();
  setTimeout(() => {
    items.set([]);
    selection.set([]);
    schedulePersist();
  }, 100);
}

export function selectOnly(id: string): void {
  selection.set([id]);
}

export function toggleSelect(id: string): void {
  selection.update((list) => (list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]));
}

export function selectMany(ids: string[]): void {
  selection.set([...new Set(ids)]);
}

export function clearSelection(): void {
  selection.set([]);
}

export function setPriority(id: string, priority: Priority): void {
  patch(id, { priority }, true);
  pump();
}

export function setItemLimit(id: string, limitKb: number | null): void {
  patch(id, { limitKb: limitKb !== null ? Math.max(0, Math.round(limitKb)) : null }, true);
}

/** Moves a queued row ahead of the rest without waiting for its turn. */
export function startNow(id: string): void {
  const item = itemById(id);
  if (!item) return;
  patch(id, { priority: "high" }, true);
  if (item.status !== "running" && item.status !== "done") {
    setStatus(id, "queued");
    pump();
  }
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
    const result = await addUrl(resource.url, { referer: resource.referer ?? null });
    if (result.ok) added += 1;
  }
  if (added === 0) return { ok: false, message: "剪贴板里的链接都已在列表中" };
  return { ok: true, message: `从剪贴板加入 ${added} 个下载`, count: added };
}

export async function addFromText(text: string, options: AddOptions = {}): Promise<AddResult> {
  const resources = parseSharedPayload(text);
  const urls = resources.length > 0 ? resources.map((entry) => entry.url) : extractUrls(text);
  if (urls.length === 0) return { ok: false, message: "没有识别到链接" };
  return addMany(urls, options);
}

/** A dropped file is read for links only while it is plausibly text. */
const DROPPED_TEXT_LIMIT = 1024 * 1024;

/** Files dropped on the window: `.torrent` files become BitTorrent jobs, text files give up their links. */
export async function importFiles(uris: string[]): Promise<AddResult> {
  let added = 0;
  let lastMessage = "";
  for (const uri of uris) {
    let path = uri;
    if (uri.startsWith("file:")) {
      try {
        path = filePathFromUrl(uri);
      } catch {
        continue;
      }
    }
    if (path.toLowerCase().endsWith(".torrent")) {
      const result = await addTorrentFile(path);
      if (result.ok) added += 1;
      lastMessage = result.message;
      continue;
    }
    try {
      const info = await stat(path);
      if (info.size > DROPPED_TEXT_LIMIT) {
        lastMessage = `${filenameOf(path)} 太大，只读取 1 MB 以内的文本或 .torrent`;
        continue;
      }
      const text = await readFile(path, "utf8");
      const result = await addFromText(text);
      if (result.ok) added += result.count ?? 0;
      lastMessage = result.message;
    } catch {
      lastMessage = `读不了 ${filenameOf(path)}`;
    }
  }
  if (added === 0) return { ok: false, message: lastMessage || "没有可导入的文件" };
  return {
    ok: true,
    message: added === 1 ? "已从文件加入 1 个下载" : `已从文件加入 ${added} 个下载`,
    count: added,
  };
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
    for (const resource of fresh) await addUrl(resource.url, { referer: resource.referer ?? null });
    notify(`剪贴板：加入 ${fresh.length} 个下载`, "success");
  }, 2000) as unknown as number;
}

function startTrafficSampler(): void {
  if (trafficTimer !== undefined) return;
  trafficTimer = setInterval(() => {
    traffic.update((samples) => [...samples.slice(1), totalSpeed()]);
  }, 1000) as unknown as number;
}

function schedulerDay(day: number): boolean {
  const days = settings().scheduler.days;
  return days.length === 0 || days.includes(day);
}

function schedulerTick(): void {
  const scheduler = settings().scheduler;
  if (!scheduler.enabled) {
    schedulerArmed = false;
    schedulerState.set("off");
    return;
  }
  const now = new Date();
  const active =
    schedulerDay(now.getDay()) && inScheduleWindow(scheduler.start, scheduler.stop, now.getHours() * 60 + now.getMinutes());
  schedulerState.set(active ? "active" : "waiting");
  if (active && !schedulerArmed) {
    schedulerArmed = true;
    resumeAll();
    notify(`调度器：已开始下载（${scheduler.start}–${scheduler.stop}）`, "success");
  } else if (!active && schedulerArmed) {
    schedulerArmed = false;
    pauseAll();
    notify("调度器：已到达暂停时间", "info");
  }
}

function syncScheduler(): void {
  if (schedulerTimer !== undefined) {
    clearInterval(schedulerTimer);
    schedulerTimer = undefined;
  }
  if (!settings().scheduler.enabled) {
    schedulerArmed = false;
    schedulerState.set("off");
    return;
  }
  schedulerTick();
  schedulerTimer = setInterval(schedulerTick, 20000) as unknown as number;
}

export async function rescanEngines(): Promise<void> {
  engineScan.set(true);
  resetBundledAria2();
  await detectEngines();
  engineInfo.set({ ...engines });
  engineScan.set(false);
}

function normalizeSettings(stored: Partial<Settings> | undefined): Settings {
  const base = defaultSettings(defaultDownloadDir());
  if (!stored) return base;
  const merged: Settings = {
    ...base,
    ...stored,
    categoryDirs: { ...base.categoryDirs, ...(stored.categoryDirs ?? {}) },
    scheduler: { ...base.scheduler, ...(stored.scheduler ?? {}) },
  };
  merged.maxConcurrent = Math.max(1, Math.min(8, Math.round(merged.maxConcurrent)));
  merged.connections = Math.max(1, Math.min(16, Math.round(merged.connections)));
  merged.limitKb = Math.max(0, Math.min(1024 * 1024, Math.round(merged.limitKb)));
  if (!validClock(merged.scheduler.start)) merged.scheduler.start = base.scheduler.start;
  if (!validClock(merged.scheduler.stop)) merged.scheduler.stop = base.scheduler.stop;
  merged.scheduler.days = (merged.scheduler.days ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return merged;
}

function normalizeItem(raw: Item): Item {
  const kind = raw.kind ?? kindOfName(raw.filename);
  return {
    ...raw,
    kind,
    category: raw.category ?? categoryOfKind(kind),
    headers: raw.headers ?? [],
    torrent: raw.torrent ?? /^magnet:/i.test(raw.url),
    torrentFile: raw.torrentFile ?? null,
    description: raw.description ?? "",
    priority: raw.priority ?? "normal",
    limitKb: raw.limitKb ?? null,
    startedAt: raw.startedAt ?? null,
    phase: null,
    speed: 0,
    status: raw.status === "running" || raw.status === "preparing" ? "paused" : raw.status,
  };
}

export async function bootstrap(): Promise<void> {
  let stored: { settings?: Partial<Settings>; items?: Item[] } | null = null;
  try {
    const raw = await Storage.getItem(STORE_KEY);
    if (raw) stored = JSON.parse(raw) as { settings?: Partial<Settings>; items?: Item[] };
  } catch {
    stored = null;
  }

  settings.set(normalizeSettings(stored?.settings));
  if (stored?.items && Array.isArray(stored.items)) {
    items.set(stored.items.map(normalizeItem));
  }

  setColorScheme(settings().appearance);
  startClipboardWatch();
  startTrafficSampler();
  ready.set(true);

  if (desktopWindow && !openFilesBound) {
    openFilesBound = true;
    try {
      Application.on("openFiles", (files) => {
        void importFiles(files.paths).then((result) => notify(result.message, result.ok ? "success" : "error"));
      });
    } catch {
      // A host without the event still downloads from links and drops.
    }
  }

  await detectEngines();
  engineInfo.set({ ...engines });
  engineScan.set(false);
  syncScheduler();
  pump();
}

/** The engines the UI shows, read once detection has run. */
export { engines };

export function engineHint(): string {
  const scanned = engineInfo();
  if (platform.os === "web") return "网页预览版：请用桌面应用下载";
  if (!scanned.checked) return "正在检测下载引擎…";
  if (scanned.aria2) {
    return scanned.aria2Source === "bundled"
      ? "内置 aria2c 已就绪：多线程、磁力与种子"
      : "aria2c 已就绪：多线程、磁力与种子";
  }
  if (scanned.curl) return "curl 已就绪，支持断点续传";
  return "只有内置引擎：文件上限 8 MB，磁力与种子需安装 aria2c";
}
