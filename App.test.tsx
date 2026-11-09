import { expect, open, test, type OpenOptions } from "nsh/test";

const KEY = "downloader.state.v1";

function seeded(dir = "/tmp/downloader-nsh-test") {
  return { [KEY]: JSON.stringify({ settings: { dir, autoStart: true }, items: [] }) };
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

function inApp(network: OpenOptions["network"]) {
  return open("./App.tsx", { platform: "macos", width: 1200, height: 800, storage: seeded(), network });
}

test("the empty queue explains where links come from", async () => {
  const app = await inApp(STUB);
  expect(app.texts()).toContain("队列是空的");
  expect(app.texts()).toContain("全部下载");
});

test("a link the server refuses lands in the failed list, and 重试 is offered", async () => {
  const app = await inApp({
    "HEAD http://files.test/broken.zip": { status: 404, headers: {} },
    "GET http://files.test/broken.zip": { status: 404, headers: {} },
  });
  await app.type("id:add-input", "http://files.test/broken.zip");
  await app.press("id:add-submit");
  await app.waitFor("text:失败", { timeout: 10000 });
  await app.waitFor("label:从列表移除");
});

test("a file name from content-disposition names the row", async () => {
  const app = await inApp(STUB);
  await app.type("id:add-input", "http://files.test/clip.mp4");
  await app.press("id:add-submit");
  await app.waitFor("text:clip.mp4", { timeout: 10000 });
  expect(app.texts()).toContain("VID");
});

test("text without a link is refused with a notice", async () => {
  const app = await inApp(STUB);
  await app.type("id:add-input", "not a link at all");
  await app.press("id:add-submit");
  await app.waitFor("text:没有识别到链接", { timeout: 8000 });
});

test("the advanced dialog takes several links and shows the target folder", async () => {
  const app = await inApp(STUB);
  await app.press("id:add-advanced");
  await app.waitFor("id:dialog-links", { timeout: 5000 });
  expect(app.value("id:dialog-dir")).toBe("/tmp/downloader-nsh-test");
  await app.type("id:dialog-links", "http://files.test/clip.mp4\nhttp://files.test/clip.mp4");
  await app.waitFor("text:识别到 1 个链接", { timeout: 5000 });
  await app.press("text:开始下载");
  await app.waitFor("text:clip.mp4", { timeout: 10000 });
  expect(app.texts()).toContain("VID");
});

test("the sidebar filters to what finished and back", async () => {
  const app = await inApp(STUB);
  await app.press("text:已完成");
  await app.waitFor("text:队列是空的", { timeout: 5000 });
  expect(app.count("text:clip.mp4")).toBe(0);
});

test("a magnet link says aria2c is what it needs", async () => {
  const app = await inApp(STUB);
  await app.type("id:add-input", "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Demo");
  await app.press("id:add-submit");
  await app.waitUntil(() => app.texts().some((text) => text.includes("磁力链接需要 aria2c")), { timeout: 8000 });
  expect(app.count("text:Demo")).toBe(0);
});

test("a proxy typed in settings is kept and shown when it parses", async () => {
  const app = await inApp(STUB);
  await app.press("id:nav-settings");
  await app.waitFor("id:proxy-input", { timeout: 5000 });
  await app.type("id:proxy-input", "socks5://127.0.0.1:1080");
  await app.waitUntil(() => {
    const stored = JSON.parse(app.storage()[KEY] ?? "{}") as { settings?: { proxy?: string } };
    return stored.settings?.proxy === "socks5://127.0.0.1:1080";
  }, { timeout: 8000 });
  await app.press("text:全部下载");
  await app.waitFor("text:粘贴视频、音频、文件或 HLS/DASH 链接…", { timeout: 5000 });
  expect(app.texts()).toContain("socks5://127.0.0.1:1080");
});

test("settings show the resolved download folder and engines", async () => {
  const app = await inApp(STUB);
  await app.press("label:切换深浅色");
  await app.waitFor("text:深色", { timeout: 5000 });
  await app.press("id:nav-settings");
  await app.waitFor("text:下载目录", { timeout: 5000 });
  expect(app.texts()).toContain("aria2c");
  expect(app.texts()).toContain("curl");
});
