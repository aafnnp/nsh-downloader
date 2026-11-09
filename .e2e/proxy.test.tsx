import { expect, open, test } from "nsh/test";

const KEY = "downloader.state.v1";
const DIR = "/tmp/nshdl-out";
const PROXY = "http://127.0.0.1:8127";

/** `blocked.test` does not resolve: only the proxy this suite runs knows it. */
test("a download with a proxy configured reaches a host that only the proxy knows", async () => {
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    storage: { [KEY]: JSON.stringify({ settings: { dir: DIR, autoStart: true, proxy: PROXY }, items: [] }) },
    network: "live",
  });
  await app.wait(4000);
  await app.type("id:add-input", "http://blocked.test/proxy-target.bin");
  await app.press("id:add-submit");
  await app.waitFor("text:已完成", { timeout: 90000 });
  await app.wait(1200);

  const state = JSON.parse(app.storage()[KEY] ?? "{}") as {
    items?: { status: string; engine: string; received: number; total: number }[];
  };
  console.log("PROXY ITEM", JSON.stringify(state.items?.[0]));
  expect(state.items?.[0]?.status).toBe("done");
  // aria2c or curl, whichever the machine has: both carry the proxy.
  expect(["aria2", "curl"]).toContain(state.items?.[0]?.engine);
  expect(state.items?.[0]?.received).toBe(262144);
});

test("without a proxy the same host fails, so the test above proves the route", async () => {
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    storage: { [KEY]: JSON.stringify({ settings: { dir: DIR, autoStart: true }, items: [] }) },
    network: "live",
  });
  await app.wait(4000);
  await app.type("id:add-input", "http://blocked.test/proxy-target.bin");
  await app.press("id:add-submit");
  // Polled by hand: the store persists on a debounce, and a failing curl ends in well under a second.
  let state: { items?: { status: string; error: string | null }[] } = {};
  for (let attempt = 0; attempt < 40; attempt += 1) {
    state = JSON.parse(app.storage()[KEY] ?? "{}") as typeof state;
    if (state.items?.[0]?.status === "failed") break;
    await app.wait(250);
  }
  console.log("DIRECT ITEM", JSON.stringify(state.items?.[0]));
  expect(state.items?.[0]?.status).toBe("failed");
  expect((state.items?.[0]?.error ?? "").length).toBeGreaterThan(0);
});
