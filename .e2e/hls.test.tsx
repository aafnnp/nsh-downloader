import { expect, open, test } from "nsh/test";

const KEY = "downloader.state.v1";
const DIR = "/tmp/nshdl-out";

for (const [label, path] of [
  ["master", "hls/master.m3u8"],
  ["aes128", "hls/enc/index.m3u8"],
] as const) {
  test(`an HLS playlist (${label}) becomes one file`, async () => {
    const app = await open("../App.tsx", {
      platform: "macos",
      width: 1200,
      height: 800,
      storage: { [KEY]: JSON.stringify({ settings: { dir: DIR, autoStart: true }, items: [] }) },
      network: "live",
    });
    await app.wait(4000);
    await app.type("id:add-input", `http://127.0.0.1:8123/${path}`);
    await app.press("id:add-submit");
    await app.waitFor("text:已完成", { timeout: 90000 });
    await app.wait(1200);
    const state = JSON.parse(app.storage()[KEY] ?? "{}") as {
      items?: { status: string; filename: string; received: number; engine: string; error: string | null }[];
    };
    console.log(label, "ITEM", JSON.stringify(state.items?.[0]));
    expect(state.items?.[0]?.status).toBe("done");
  });
}
