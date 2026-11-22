import { expect, open, test, type App, type OpenOptions } from "nsh/test";
import { hasExtensionArchive } from "./lib/extension";

const KEY = "downloader.state.v1";

function seeded(items: unknown[] = [], dir = "/tmp/downloader-nsh-test") {
  return { [KEY]: JSON.stringify({ settings: { dir, autoStart: true }, items }) };
}

const OK_RESPONSE = {
  status: 200,
  headers: {
    "content-type": "video/mp4",
    "content-length": "2048",
    "accept-ranges": "bytes",
    "content-disposition": 'attachment; filename="clip.mp4"',
  },
};

const STUB = {
  "HEAD http://files.test/clip.mp4": OK_RESPONSE,
  "GET http://files.test/clip.mp4": { ...OK_RESPONSE, body: "x".repeat(2048) },
};

/** A headless engine grants no file system; this stand-in keeps just sizes, enough for the queue. */
function fakeFs(files: Map<string, number>) {
  return {
    "fs/promises": {
      mkdir: () => undefined,
      stat: (path: string) => {
        if (!files.has(path)) throw new Error("ENOENT");
        return { isFile: () => true, isDirectory: () => false, size: files.get(path) ?? 0 };
      },
      exists: (path: string) => files.has(path),
      readdir: () => [],
      rmdir: () => undefined,
      unlink: (path: string) => {
        files.delete(path);
      },
      writeFile: (path: string, data: string | Uint8Array) => {
        // The engine hands the bytes over as a native array, which exposes no length here.
        const size = typeof data === "string" ? data.length : Number((data as { byteLength?: number })?.byteLength ?? 0);
        files.set(path, size);
      },
      readFile: () => "",
    },
  };
}

function inApp(
  network: OpenOptions["network"],
  clipboard?: string,
  items: unknown[] = [],
  extraModules: NonNullable<OpenOptions["modules"]> = {},
  disk: Map<string, number> = new Map<string, number>(),
) {
  const files = disk;
  return open("./App.tsx", {
    platform: "macos",
    width: 1400,
    height: 900,
    storage: seeded(items),
    network,
    clipboard: clipboard ?? null,
    modules: { ...fakeFs(files), ...extraModules },
  });
}

async function addLink(app: App, url: string) {
  await app.press("id:tool-add");
  await app.waitFor("id:dialog-links", { timeout: 5000 });
  await app.type("id:dialog-links", url);
  await app.press("id:dialog-submit");
}

function storedSettings(app: App): Record<string, unknown> {
  const raw = app.storage()[KEY];
  if (!raw) return {};
  const parsed = JSON.parse(raw) as { settings?: Record<string, unknown> };
  return parsed.settings ?? {};
}

function storedItems(app: App): { priority?: string; limitKb?: number | null }[] {
  const raw = app.storage()[KEY];
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { items?: { priority?: string; limitKb?: number | null }[] };
  return parsed.items ?? [];
}

test("the empty queue explains where links come from", async () => {
  const app = await inApp(STUB);
  expect(app.texts()).toContain("没有下载任务");
  expect(app.texts()).toContain("全部下载");
});

test("a link the server refuses lands in the failed list, and 重试 is offered", async () => {
  const app = await inApp({
    "HEAD http://files.test/broken.zip": { status: 404, headers: {} },
    "GET http://files.test/broken.zip": { status: 404, headers: {} },
  });
  await addLink(app, "http://files.test/broken.zip");
  await app.waitUntil(() => app.count("text:失败") >= 2, { timeout: 10000 });
  expect(app.count("label:重试 broken.zip")).toBeGreaterThan(0);
});

test("a file name from content-disposition names the row", async () => {
  const app = await inApp(STUB);
  await addLink(app, "http://files.test/clip.mp4");
  await app.waitFor("text:clip.mp4", { timeout: 10000 });
  expect(app.texts()).toContain("VID");
  await app.waitUntil(() => app.count("text:已完成") >= 2, { timeout: 10000 });
});

/** The alert a test answers for, without the native dialog a headless engine draws. */
function alertAnswer(action: string | null) {
  return {
    "nsh/base": {
      "AlertDialog.show": async (options: { actions: { id: string; label: string }[] }) => {
        expect(options.actions.map((entry) => entry.id)).toEqual(["cancel", "task", "files"]);
        return { action };
      },
    },
  };
}

async function pressRemove(answer: string | null, disk: Map<string, number>) {
  const app = await inApp(STUB, undefined, [], alertAnswer(answer), disk);
  await addLink(app, "http://files.test/clip.mp4");
  await app.waitUntil(() => app.count("text:已完成") >= 2, { timeout: 10000 });
  expect(disk.has("/tmp/downloader-nsh-test/clip.mp4")).toBe(true);
  await app.press("label:移除 clip.mp4");
  return app;
}

test("removing a download asks about the file, and 仅删除任务 keeps it", async () => {
  const disk = new Map<string, number>();
  const app = await pressRemove("task", disk);
  await app.waitUntil(() => app.count("text:clip.mp4") === 0, { timeout: 5000 });
  expect(disk.has("/tmp/downloader-nsh-test/clip.mp4")).toBe(true);
});

test("the file goes too when the dialog says so", async () => {
  const disk = new Map<string, number>();
  const app = await pressRemove("files", disk);
  await app.waitUntil(() => app.count("text:clip.mp4") === 0, { timeout: 5000 });
  // The row leaves first; the unlink follows the cancel settling.
  await app.waitUntil(() => !disk.has("/tmp/downloader-nsh-test/clip.mp4"), { timeout: 5000 });
});

test("closing the dialog leaves the download in place", async () => {
  const disk = new Map<string, number>();
  const app = await pressRemove(null, disk);
  await app.wait(500);
  expect(app.texts()).toContain("clip.mp4");
});

test("text without a link is refused with a notice", async () => {
  const app = await inApp(STUB, "not a link at all");
  await app.press("id:tool-clipboard");
  await app.waitUntil(() => app.texts().some((text) => text.includes("剪贴板里没有链接")), { timeout: 8000 });
});

test("the advanced dialog takes several links and shows the target folder", async () => {
  const app = await inApp(STUB);
  await app.press("id:tool-add");
  await app.waitFor("id:dialog-links", { timeout: 5000 });
  await app.waitUntil(() => app.texts().some((text) => text.includes("/tmp/downloader-nsh-test")), {
    timeout: 5000,
  });
  await app.type("id:dialog-links", "http://files.test/clip.mp4\nhttp://files.test/clip.mp4");
  await app.waitUntil(() => app.texts().some((text) => text.includes("识别到 1 个链接")), { timeout: 5000 });
  await app.press("id:dialog-advanced");
  await app.waitFor("id:dialog-referer", { timeout: 5000 });
  await app.press("id:dialog-cancel");
  await app.waitUntil(() => !app.shows("id:dialog-links"), { timeout: 5000 });
});

test("the sidebar filters to what finished and back", async () => {
  const app = await inApp(STUB);
  await addLink(app, "http://files.test/clip.mp4");
  await app.waitFor("text:clip.mp4", { timeout: 10000 });
  await app.press("id:nav-finished");
  await app.waitFor("text:clip.mp4", { timeout: 5000 });
  await app.press("id:nav-failed");
  await app.waitFor("text:没有失败的下载", { timeout: 5000 });
  await app.press("id:nav-all");
  await app.waitFor("text:clip.mp4", { timeout: 5000 });
});

test("a magnet link says aria2c is what it needs", async () => {
  const app = await inApp(STUB);
  await addLink(app, "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Demo");
  await app.waitUntil(() => app.texts().some((text) => text.includes("磁力链接需要 aria2c")), { timeout: 8000 });
  expect(app.count("text:Demo")).toBe(0);
});

test("a proxy typed in settings is kept and shown when it parses", async () => {
  const app = await inApp(STUB);
  await app.press("id:nav-settings");
  await app.waitFor("id:settings-close", { timeout: 5000 });
  await app.press("id:settings-nav-network");
  await app.waitFor("id:proxy-input", { timeout: 5000 });
  await app.clear("id:proxy-input");
  await app.type("id:proxy-input", "socks5://127.0.0.1:1080");
  await app.waitUntil(() => storedSettings(app).proxy === "socks5://127.0.0.1:1080", { timeout: 8000 });
  await app.press("id:settings-close");
  await app.waitUntil(() => app.texts().includes("socks5://127.0.0.1:1080"), { timeout: 5000 });
});

test("the network settings import the system's proxy", async () => {
  const app = await inApp(STUB, undefined, [], {
    process: {
      run: async (command: string) => {
        if (command === "sh") {
          return { code: 0, stdout: "HTTPEnable : 1\nHTTPPort : 7890\nHTTPProxy : 127.0.0.1\n", stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "not here" };
      },
    },
  });
  await app.press("id:nav-settings");
  await app.waitFor("id:settings-close", { timeout: 5000 });
  await app.press("id:settings-nav-network");
  await app.waitFor("id:proxy-import", { timeout: 5000 });
  await app.press("id:proxy-import");
  await app.waitUntil(() => storedSettings(app).proxy === "http://127.0.0.1:7890", { timeout: 8000 });
});

test("settings show the resolved download folder and engines", async () => {
  const app = await inApp(STUB);
  await app.press("label:切换深浅色");
  await app.waitUntil(() => app.texts().some((text) => text.includes("深色")), { timeout: 5000 });
  await app.press("id:nav-settings");
  await app.waitFor("id:settings-close", { timeout: 5000 });
  await app.press("id:settings-nav-network");
  await app.waitFor("text:aria2c", { timeout: 5000 });
  expect(app.texts()).toContain("curl");
  await app.waitFor("id:proxy-import", { timeout: 5000 });
  await app.waitFor("id:settings-restart", { timeout: 5000 });
  await app.press("id:settings-nav-about");
  await app.waitFor("id:about-aria2-license", { timeout: 5000 });
  await app.waitFor("id:about-openssl-license", { timeout: 5000 });
  await app.waitFor("id:about-check-update", { timeout: 5000 });
  expect(app.texts()).toContain("随包组件");
  expect(app.texts().some((text) => text.includes("开发运行不检查更新"))).toBe(true);
});

test("search narrows the list and clearing it brings the queue back", async () => {
  const app = await inApp(STUB);
  await app.type("id:search-input", "nothing");
  await app.waitFor("text:没有匹配的下载", { timeout: 5000 });
  await app.clear("id:search-input");
  await app.waitFor("text:没有下载任务", { timeout: 5000 });
});

test("category rows filter the queue", async () => {
  const app = await inApp(STUB);
  await addLink(app, "http://files.test/clip.mp4");
  await app.waitFor("text:clip.mp4", { timeout: 10000 });
  await app.press("id:nav-category-video");
  await app.waitFor("text:clip.mp4", { timeout: 5000 });
  await app.press("id:nav-category-audio");
  await app.waitFor("text:还没有音乐下载", { timeout: 5000 });
});

test("the row context menu offers priority and speed limits", async () => {
  const app = await inApp(STUB);
  await addLink(app, "http://files.test/clip.mp4");
  await app.waitFor("text:clip.mp4", { timeout: 10000 });
  await app.rightClick("text:clip.mp4");
  await app.waitUntil(() => !!app.menu(), { timeout: 5000 });
  const labels = (app.menu() ?? []).map((entry) => entry.label);
  expect(labels.some((label) => label.startsWith("优先级 > "))).toBe(true);
  expect(labels.some((label) => label.startsWith("速度限制 > "))).toBe(true);
  expect(labels).toContain("复制链接");
  await app.chooseMenuItem("优先级 > 高");
  await app.waitUntil(() => storedItems(app)[0]?.priority === "high", { timeout: 8000 });
  await app.rightClick("text:clip.mp4");
  await app.waitUntil(() => !!app.menu(), { timeout: 5000 });
  await app.chooseMenuItem("速度限制 > 256 KB/s");
  await app.waitUntil(() => storedItems(app)[0]?.limitKb === 256, { timeout: 8000 });
});

test("a dropped .torrent says aria2c is what it needs", async () => {
  const app = await inApp(STUB);
  await app.dropFiles("id:app-root", ["file:///tmp/downloader-nsh-demo.torrent"]);
  await app.waitUntil(() => app.texts().some((text) => text.includes("种子文件需要 aria2c")), {
    timeout: 8000,
  });
});

test("the scheduler keeps its start time and switch", async () => {
  const app = await inApp(STUB);
  await app.press("id:nav-settings");
  await app.waitFor("id:settings-close", { timeout: 5000 });
  await app.press("id:settings-nav-scheduler");
  await app.waitFor("id:scheduler-start", { timeout: 5000 });
  await app.clear("id:scheduler-start");
  await app.type("id:scheduler-start", "10:30");
  await app.submit("id:scheduler-start");
  await app.press("id:scheduler-enabled");
  await app.waitUntil(
    () => {
      const settings = storedSettings(app) as {
        scheduler?: { enabled?: boolean; start?: string };
      };
      return settings.scheduler?.enabled === true && settings.scheduler?.start === "10:30";
    },
    { timeout: 8000 },
  );
});

test("the list keeps a speed column in a window narrower than 1280", async () => {
  const app = await inApp(STUB);
  await app.setViewport(1100, 900);
  await app.waitFor("text:没有下载任务", { timeout: 5000 });
  expect(app.shows("text:速度")).toBe(true);
});

test("browser integration offers the extension archive and its address", async () => {
  const app = await inApp(STUB);
  await app.press("label:浏览器集成");
  await app.waitFor("id:browser-extension-download", { timeout: 5000 });
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("releases/latest/download/Downloader-extension.zip")),
    { timeout: 5000 },
  );

  await app.press("id:browser-extension-copy");
  await app.waitUntil(() => (app.clipboard() ?? "").includes("Downloader-extension.zip"), { timeout: 5000 });

  await app.press("id:browser-extension-download");
  if (hasExtensionArchive()) {
    // `tools/build-extension.sh` ran first: the bundled archive is written out.
    await app.waitUntil(() => app.texts().some((text) => text.startsWith("已保存到")), { timeout: 5000 });
  } else {
    // A plain checkout ships no archive: the button opens the release download.
    await app.waitUntil(() => app.openedUrls().some((url) => url.includes("Downloader-extension.zip")), {
      timeout: 5000,
    });
  }
});
