import { expect, open, test } from "nsh/test";

const KEY = "downloader.state.v1";
const DIR = "/tmp/nshdl-out";

function largestText(app: { texts(): string[] }, needle: string): string {
  return app.texts().find((text) => text.includes(needle)) ?? "";
}

for (const [label, path] of [
  ["small", "small.bin"],
  ["big", "big.bin"],
] as const) {
  test(`a real ${label} download reaches done`, async () => {
    const app = await open("../App.tsx", {
      platform: "macos",
      width: 1200,
      height: 800,
      storage: { [KEY]: JSON.stringify({ settings: { dir: DIR, autoStart: true }, items: [] }) },
      network: "live",
    });
    await app.wait(5000);
    await app.type("id:add-input", `http://127.0.0.1:8123/${path}`);
    await app.press("id:add-submit");
    await app.waitFor("text:已完成", { timeout: 90000 });
    const meta = largestText(app, "127.0.0.1:8123");
    console.log(label, "META", meta);
    await app.wait(1200);
    const state = JSON.parse(app.storage()[KEY] ?? "{}") as {
      items?: { status: string; filename: string; received: number; total: number; engine: string }[];
    };
    console.log(label, "ITEM", JSON.stringify(state.items?.[0]));
    expect(state.items?.[0]?.status).toBe("done");
  });
}
