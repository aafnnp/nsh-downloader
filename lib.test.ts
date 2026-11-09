import { expect, test } from "nsh/test";
import {
  extractUrls,
  magnetInfo,
  magnetWithTrackers,
  normalizeMagnet,
  normalizeProxy,
  normalizeUrl,
} from "./lib/urls";
import { parseAria2Summary } from "./lib/transfer";
import { kindBadge, kindOfName } from "./model";

test("a proxy takes a bare host:port, a scheme, and refuses a value with no port", () => {
  expect(normalizeProxy("127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
  expect(normalizeProxy("  socks5://127.0.0.1:1080 ")).toBe("socks5://127.0.0.1:1080");
  expect(normalizeProxy("http://proxy.example.com:8080/")).toBe("http://proxy.example.com:8080");
  expect(normalizeProxy("")).toBe("");
  expect(normalizeProxy("nonsense")).toBe("");
  expect(normalizeProxy("ftp://127.0.0.1:21")).toBe("");
});

test("a magnet link keeps its parameters and yields a name and hash", () => {
  const magnet =
    "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Ubuntu%2024.04%20ISO&tr=udp%3A%2F%2Ftracker.example%3A1337";
  expect(normalizeMagnet(magnet)).toBe(magnet);
  expect(normalizeMagnet("https://example.com/a.mp4")).toBe(null);
  const info = magnetInfo(magnet);
  expect(info.name).toBe("Ubuntu 24.04 ISO");
  expect(info.hash).toBe("abcdef0123456789abcdef0123456789abcdef01");
  expect(magnetWithTrackers(magnet)).toBe(magnet);
});

test("a magnet without a name falls back to its hash, and gets trackers added", () => {
  const bare = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";
  expect(magnetInfo(bare).name).toBe("torrent-01234567");
  const withTrackers = magnetWithTrackers(bare);
  expect(withTrackers.startsWith(bare)).toBe(true);
  expect(withTrackers.includes("&tr=udp%3A%2F%2Ftracker.opentrackr.org")).toBe(true);
});

test("links in a text include magnets and http links, without duplicates", () => {
  const text = [
    "https://example.com/a.mp4",
    "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
    "https://example.com/a.mp4",
    "example.org/b.zip",
  ].join("\n");
  const found = extractUrls(text);
  expect(found.length).toBe(3);
  expect(found[0]).toBe("https://example.com/a.mp4");
  expect(found[1].startsWith("magnet:?")).toBe(true);
  expect(found[2]).toBe("https://example.org/b.zip");
});

test("a non-web scheme is not a download link", () => {
  expect(normalizeUrl("ftp://example.com/a.mp4")).toBe(null);
  expect(normalizeUrl("javascript:alert(1)")).toBe(null);
  expect(normalizeUrl("file:///etc/passwd")).toBe(null);
});

test("aria2's summary line gives progress for a torrent", () => {
  const tick = parseAria2Summary("[#2089b0 44MiB/190MiB(23%) CN:15 DL:9.9MiB ETA:14s]");
  expect(tick?.received).toBe(44 * 1024 * 1024);
  expect(tick?.total).toBe(190 * 1024 * 1024);
  expect(Math.abs((tick?.speed ?? 0) - 9.9 * 1024 * 1024)).toBeLessThan(1024);
  expect(parseAria2Summary("no progress here")).toBe(null);
  const small = parseAria2Summary("[#abc123 512KiB/1.5MiB(33%) CN:2 DL:128KiB]");
  expect(small?.received).toBe(512 * 1024);
  expect(small?.total).toBe(Math.round(1.5 * 1024 * 1024));
});

test("a .torrent file and a magnet are recognised as BitTorrent", () => {
  expect(kindOfName("debian-13.torrent")).toBe("torrent");
  expect(kindBadge("torrent")).toBe("BT");
});
