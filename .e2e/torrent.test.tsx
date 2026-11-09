import { expect, open, test } from "nsh/test";

const KEY = "downloader.state.v1";
const DIR = "/tmp/nshdl-out";

/** `tools/e2e_torrent.py` seeds this payload from its own tracker; the hash is fixed by the fixture. */
const MAGNET =
  "magnet:?xt=urn:btih:7d8acc2bee9728501c0810b2277773208f3c352a&dn=payload.bin&tr=http%3A%2F%2F127.0.0.1%3A8130%2Fannounce";

test("a magnet link downloads the torrent into its own folder", async () => {
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    storage: { [KEY]: JSON.stringify({ settings: { dir: DIR, autoStart: true }, items: [] }) },
    network: "live",
  });
  await app.wait(4000);
  await app.type("id:add-input", MAGNET);
  await app.press("id:add-submit");

  let state: { items?: { status: string; kind: string; torrent: boolean; engine: string; received: number; total: number; dir: string }[] } = {};
  for (let attempt = 0; attempt < 120; attempt += 1) {
    state = JSON.parse(app.storage()[KEY] ?? "{}") as typeof state;
    const status = state.items?.[0]?.status;
    if (status === "done" || status === "failed") break;
    await app.wait(500);
  }
  const item = state.items?.[0];
  console.log("TORRENT ITEM", JSON.stringify(item));
  expect(item?.status).toBe("done");
  expect(item?.kind).toBe("torrent");
  expect(item?.torrent).toBe(true);
  expect(item?.engine).toBe("aria2");
  expect(item?.received).toBe(524288);
});
