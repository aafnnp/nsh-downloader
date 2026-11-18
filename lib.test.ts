import { platform } from "nsh";
import { expect, test } from "nsh/test";
import { aria2Triple, powerShellScript, shellCommand, windowsShellCommand } from "./lib/aria2";
import { filePathFromUrl } from "./lib/paths";
import {
  extractUrls,
  magnetInfo,
  magnetWithTrackers,
  normalizeMagnet,
  normalizeProxy,
  normalizeUrl,
} from "./lib/urls";
import { parseAria2Summary } from "./lib/transfer";
import {
  categoryOfKind,
  inScheduleWindow,
  isTorrentUrl,
  kindBadge,
  kindOfName,
  speedLimitKb,
  speedModeLabel,
  validClock,
} from "./model";

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

test("file kinds map to the smart file manager's categories", () => {
  expect(kindOfName("movie.mp4")).toBe("video");
  expect(categoryOfKind(kindOfName("movie.mp4"))).toBe("video");
  expect(categoryOfKind(kindOfName("song.flac"))).toBe("audio");
  expect(categoryOfKind(kindOfName("manual.pdf"))).toBe("document");
  expect(categoryOfKind(kindOfName("setup.dmg"))).toBe("program");
  expect(categoryOfKind(kindOfName("bundle.tar.gz"))).toBe("archive");
  expect(categoryOfKind(kindOfName("anything.bin"))).toBe("other");
});

test("FDM traffic modes turn into KB/s caps, and custom uses the typed value", () => {
  expect(speedLimitKb("unlimited", 999)).toBe(0);
  expect(speedLimitKb("low", 0)).toBe(64);
  expect(speedLimitKb("medium", 0)).toBe(512);
  expect(speedLimitKb("high", 0)).toBe(2048);
  expect(speedLimitKb("custom", 1234)).toBe(1234);
  expect(speedModeLabel("custom")).toBe("自定义");
});

test("the scheduler window handles daytime, overnight and a closed range", () => {
  expect(inScheduleWindow("09:00", "18:00", 9 * 60)).toBe(true);
  expect(inScheduleWindow("09:00", "18:00", 18 * 60)).toBe(false);
  expect(inScheduleWindow("22:00", "06:00", 23 * 60)).toBe(true);
  expect(inScheduleWindow("22:00", "06:00", 5 * 60)).toBe(true);
  expect(inScheduleWindow("22:00", "06:00", 12 * 60)).toBe(false);
  expect(inScheduleWindow("09:00", "09:00", 9 * 60)).toBe(false);
  expect(validClock("7:05")).toBe(true);
  expect(validClock("24:00")).toBe(false);
});

test("a .torrent URL and a local torrent file are both BitTorrent", () => {
  expect(isTorrentUrl("https://example.com/debian.torrent")).toBe(true);
  expect(isTorrentUrl("https://example.com/debian.iso")).toBe(false);
  expect(kindOfName("debian.torrent")).toBe("torrent");
});

test("a bundled aria2c picks the sidecar for the running desktop", () => {
  expect(aria2Triple("macos", "aarch64")).toBe("macos-arm64");
  expect(aria2Triple("macos", "x86_64")).toBe("macos-x86_64");
  expect(aria2Triple("linux", "aarch64")).toBe("linux-arm64");
  expect(aria2Triple("linux", "x86_64")).toBe("linux-x86_64");
  expect(aria2Triple("windows", "aarch64")).toBe("windows-arm64");
  expect(aria2Triple("windows", "x86_64")).toBe("windows-x86_64");
  expect(aria2Triple("web", "aarch64")).toBe(null);
  expect(aria2Triple("ios", "aarch64")).toBe(null);
  expect(aria2Triple("macos", "mips")).toBe(null);
});

test("the bundled aria2c starts through a shell the manifest can grant", () => {
  const command = shellCommand("/Applications/Downloader.app/aria2c", ["--version"]);
  if (platform.os === "windows") {
    expect(command.command).toBe("powershell.exe");
    expect(command.args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  } else {
    expect(command.command).toBe("sh");
    expect(command.args).toEqual(["-c", '"$0" "$@"', "/Applications/Downloader.app/aria2c", "--version"]);
  }
});

test("Windows gets the whole command line as one encoded argument, so no shell parses it again", () => {
  const path = "C:\\Users\\Ann Lee\\AppData\\Roaming\\dev.nsh.downloader\\engines\\windows-x86_64\\aria2c.exe";
  const args = ["--dir=C:\\Users\\Ann Lee\\Downloads", "--header=Referer: https://a.test/?q=1&b=2", "https://a.test/a%20b%20c.iso"];
  const command = windowsShellCommand(path, args);
  expect(command.command).toBe("powershell.exe");
  // Base64 has no quotes, spaces or percent signs: every layer below passes it through unchanged.
  const encoded = command.args[command.args.length - 1] ?? "";
  expect(/^[A-Za-z0-9+/=]+$/.test(encoded)).toBe(true);

  const script = powerShellScript(path, args);
  expect(script.includes(`'${path}'`)).toBe(true);
  expect(script.includes(`'${args[0]}'`)).toBe(true);
  expect(script.includes(`'${args[2]}'`)).toBe(true);
  expect(script.includes("exit $code")).toBe(true);
  // nsh gives the child no PATHEXT, and PowerShell then calls the .exe a document.
  expect(script.includes("$env:PATHEXT = ")).toBe(true);
  // `%` and `&` reach aria2c as typed instead of being expanded (cmd) or split (a shell).
  const decoded = atob(encoded);
  let utf16 = "";
  for (let index = 0; index + 1 < decoded.length; index += 2) {
    utf16 += String.fromCharCode(decoded.charCodeAt(index) | (decoded.charCodeAt(index + 1) << 8));
  }
  expect(utf16).toBe(script);
});

test("a PowerShell argument keeps its text when it contains a quote", () => {
  expect(powerShellScript("C:\\it's\\aria2c.exe", [])).toBe(
    "$env:PATHEXT = '.COM;.EXE;.BAT;.CMD'\n& 'C:\\it''s\\aria2c.exe'\n$code = $LASTEXITCODE\nif ($null -eq $code) { exit 1 } else { exit $code }",
  );
});

test("an asset URL becomes a path a Windows fs grant matches", () => {
  if (platform.os !== "windows") return;
  const path = filePathFromUrl("file:///C:/Users/Ann%20Lee/aria2c.exe");
  expect(path.startsWith("C:/") || path.startsWith("C:\\")).toBe(true);
  expect(path.endsWith("aria2c.exe")).toBe(true);
});
