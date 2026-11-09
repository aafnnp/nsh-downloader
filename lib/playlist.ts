import { mkdir, stat, writeFile } from "fs/promises";
import { join } from "path";
import { platform } from "os";
import { run } from "process";
import { removeIfPresent } from "./paths";
import { messageOf } from "./probe";
import { requestHeaders, type Outcome, type Transfer, type TransferHooks, type TransferSpec } from "./transfer";

/** One write stays under the runtime's `writeFile` limit. */
const MAX_PART = 7 * 1024 * 1024;
const PARALLEL = 4;

export interface PlaylistSpec extends TransferSpec {
  playlist: "hls" | "dash";
  /** Where the segments are written before they are joined. */
  partsDir: string;
}

function absolute(base: string, path: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

function textAttribute(line: string, name: string): string | null {
  const match = new RegExp(`${name}=("[^"]*"|[^,]*)`).exec(line);
  return match ? match[1].replace(/^"|"$/g, "") : null;
}

interface HlsKey {
  method: string;
  uri: string;
  iv: Uint8Array | null;
}

function parseIv(value: string | null): Uint8Array | null {
  if (!value) return null;
  const hex = value.replace(/^0x/i, "").padStart(32, "0").slice(-32);
  const out = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) out[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
}

/** The media playlist a master playlist points at: its highest-bandwidth variant. */
function pickVariant(playlistUrl: string, text: string): string | null {
  const lines = text.split(/\r?\n/);
  let best: { bandwidth: number; url: string } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const bandwidth = Number(textAttribute(line, "BANDWIDTH") ?? 0);
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (!candidate || candidate.startsWith("#")) continue;
      if (!best || bandwidth > best.bandwidth) best = { bandwidth, url: absolute(playlistUrl, candidate) };
      break;
    }
  }
  return best ? best.url : null;
}

interface Segment {
  url: string;
  key: HlsKey | null;
  sequence: number;
}

interface Plan {
  initSegment: string | null;
  segments: Segment[];
}

function parseHls(playlistUrl: string, text: string): Plan {
  const plan: Plan = { initSegment: null, segments: [] };
  let key: HlsKey | null = null;
  let sequence = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      sequence = Number(line.slice("#EXT-X-MEDIA-SEQUENCE:".length)) || 0;
      continue;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      const method = textAttribute(line, "METHOD") ?? "NONE";
      const uri = textAttribute(line, "URI");
      key = method !== "NONE" && uri
        ? { method, uri: absolute(playlistUrl, uri), iv: parseIv(textAttribute(line, "IV")) }
        : null;
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const uri = textAttribute(line, "URI");
      if (uri) plan.initSegment = absolute(playlistUrl, uri);
      continue;
    }
    if (line.startsWith("#")) continue;
    plan.segments.push({ url: absolute(playlistUrl, line), key, sequence });
    sequence += 1;
  }
  return plan;
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\$(\w+)(?:%0(\d+)d)?\$/g, (whole, name: string, width: string | undefined) => {
    const value = values[name];
    if (value === undefined) return whole;
    if (width && name === "Number") return value.padStart(Number(width), "0");
    return value;
  });
}

/** A best-effort MPD reader: `SegmentList`, or `SegmentTemplate` with a duration or a timeline. */
function parseDash(mpdUrl: string, xml: string): Plan {
  const plan: Plan = { initSegment: null, segments: [] };
  const representation = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/i.exec(xml);
  const attributesOfRepresentation = representation ? representation[1] : "";
  const body = representation ? representation[2] : xml;

  const values = {
    RepresentationID: /id="([^"]*)"/.exec(attributesOfRepresentation)?.[1] ?? "",
    Bandwidth: /bandwidth="([^"]*)"/.exec(attributesOfRepresentation)?.[1] ?? "",
    Time: "0",
    Number: "1",
  };
  const base =
    /<BaseURL>([^<]+)<\/BaseURL>/i.exec(body)?.[1] ?? /<BaseURL>([^<]+)<\/BaseURL>/i.exec(xml)?.[1] ?? "";
  const mediaBase = base ? absolute(mpdUrl, base.trim()) : mpdUrl;

  const segmentList = /<SegmentList\b[^>]*>([\s\S]*?)<\/SegmentList>/i.exec(body);
  if (segmentList) {
    const init = /<Initialization\b[^>]*sourceURL="([^"]+)"/i.exec(segmentList[1])?.[1];
    if (init) plan.initSegment = absolute(mediaBase, init);
    const media = /<SegmentURL\b[^>]*media="([^"]+)"/gi;
    for (let match = media.exec(segmentList[1]); match; match = media.exec(segmentList[1])) {
      plan.segments.push({ url: absolute(mediaBase, match[1]), key: null, sequence: plan.segments.length });
    }
    return plan;
  }

  const template = /<SegmentTemplate\b([^>]*)\/?>/i.exec(body);
  if (!template) return plan;
  const attributes = template[1];
  const init = /initialization="([^"]+)"/i.exec(attributes)?.[1];
  if (init) plan.initSegment = absolute(mediaBase, fillTemplate(init, values));
  const media = /media="([^"]+)"/i.exec(attributes)?.[1];
  if (!media) return plan;

  const startNumber = Number(/startNumber="(\d+)"/i.exec(attributes)?.[1] ?? 1);
  const timescale = Number(/timescale="(\d+)"/i.exec(attributes)?.[1] ?? 1);
  const push = (number: number, time: number) => {
    const url = fillTemplate(media, { ...values, Number: String(number), Time: String(time) });
    plan.segments.push({ url: absolute(mediaBase, url), key: null, sequence: plan.segments.length });
  };

  const timeline = /<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>/i.exec(body);
  if (timeline) {
    let time = 0;
    let number = startNumber;
    const steps = /<S\b([^>]*)\/?>/gi;
    for (let match = steps.exec(timeline[1]); match; match = steps.exec(timeline[1])) {
      const duration = Number(/d="(\d+)"/.exec(match[1])?.[1] ?? 0);
      const repeat = Number(/r="(-?\d+)"/.exec(match[1])?.[1] ?? 0);
      const startTime = /t="(\d+)"/.exec(match[1])?.[1];
      if (startTime) time = Number(startTime);
      const count = repeat >= 0 ? repeat + 1 : 1;
      for (let index = 0; index < count && index < 5000; index += 1) {
        push(number, time);
        time += duration;
        number += 1;
      }
    }
    return plan;
  }

  const periodDuration = /<Period\b[^>]*duration="([^"]+)"/.exec(xml)?.[1];
  const segmentDuration = Number(/duration="(\d+)"/.exec(attributes)?.[1] ?? 0);
  if (periodDuration && segmentDuration > 0) {
    const seconds = Number(periodDuration.replace(/[^0-9.]/g, ""));
    const total = Math.max(1, Math.round((seconds * timescale) / segmentDuration));
    for (let index = 0; index < Math.min(total, 5000); index += 1) push(startNumber + index, 0);
  }
  return plan;
}

async function fetchBytes(
  url: string,
  referer: string | null,
  extra: string[],
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(url, { headers: requestHeaders(referer, extra), redirect: "follow", signal });
  if (!response.ok) throw new Error(`分片下载失败 HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_PART) throw new Error("单个分片超过内置写入上限");
  return bytes;
}

async function decrypt(
  bytes: Uint8Array,
  key: HlsKey,
  iv: Uint8Array,
  extra: string[],
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (key.method !== "AES-128") throw new Error(`不支持的分片加密：${key.method}`);
  const keyBytes = await fetchBytes(key.uri, null, extra, signal);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, bytes);
  return new Uint8Array(plain);
}

function sequenceIv(sequence: number): Uint8Array {
  const iv = new Uint8Array(16);
  let value = sequence;
  for (let index = 15; index >= 12; index -= 1) {
    iv[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return iv;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Joins the numbered parts in name order with the platform's own tool. */
async function joinParts(partsDir: string, outPath: string): Promise<void> {
  await removeIfPresent(outPath);
  if (platform() === "windows") {
    const result = await run("cmd", ["/c", `cd /d "${partsDir}" && copy /b part-*.bin "${outPath}"`], {
      timeoutMs: 300000,
    });
    if (result.code !== 0) throw new Error(result.stderr.trim() || "合并分片失败");
    return;
  }
  const result = await run("sh", ["-c", `cd ${shellQuote(partsDir)} && cat part-*.bin > ${shellQuote(outPath)}`], {
    timeoutMs: 300000,
  });
  if (result.code !== 0) throw new Error(result.stderr.trim() || "合并分片失败");
}

interface Task {
  url: string;
  name: string;
  key: HlsKey | null;
  iv: Uint8Array | null;
}

/** HLS and DASH: the segments are fetched, numbered in playback order, then joined into one file. */
export function startPlaylist(spec: PlaylistSpec, hooks: TransferHooks): Transfer {
  const controller = new AbortController();
  let canceled = false;
  let resolveDone: (outcome: Outcome) => void = () => undefined;
  const done = new Promise<Outcome>((resolve) => {
    resolveDone = resolve;
  });

  void (async () => {
    try {
      hooks.phase("读取播放列表");
      await mkdir(spec.partsDir, { recursive: true });
      const headers = requestHeaders(spec.referer, spec.headers);

      const response = await fetch(spec.url, { headers, redirect: "follow", signal: controller.signal });
      if (!response.ok) throw new Error(`读取播放列表失败 HTTP ${response.status}`);
      const text = await response.text();

      let plan: Plan;
      if (spec.playlist === "dash") {
        plan = parseDash(spec.url, text);
      } else if (/#EXT-X-STREAM-INF/.test(text)) {
        hooks.phase("选择清晰度");
        const variant = pickVariant(spec.url, text);
        if (!variant) throw new Error("主播放列表里没有可用清晰度");
        const nested = await fetch(variant, { headers, redirect: "follow", signal: controller.signal });
        if (!nested.ok) throw new Error(`读取媒体播放列表失败 HTTP ${nested.status}`);
        plan = parseHls(variant, await nested.text());
      } else {
        plan = parseHls(spec.url, text);
      }

      if (plan.segments.length === 0) throw new Error("播放列表里没有分片");

      const tasks: Task[] = [];
      if (plan.initSegment) tasks.push({ url: plan.initSegment, name: "part-00000.bin", key: null, iv: null });
      plan.segments.forEach((segment, index) => {
        tasks.push({
          url: segment.url,
          name: `part-${String(index + 1).padStart(5, "0")}.bin`,
          key: segment.key,
          iv: segment.key ? segment.key.iv ?? sequenceIv(segment.sequence) : null,
        });
      });

      let next = 0;
      let completed = 0;
      let written = 0;
      const worker = async () => {
        for (;;) {
          const position = next;
          if (position >= tasks.length || canceled) return;
          next += 1;
          const task = tasks[position];
          let bytes = await fetchBytes(task.url, spec.referer, spec.headers, controller.signal);
          if (task.key && task.iv) bytes = await decrypt(bytes, task.key, task.iv, spec.headers, controller.signal);
          await writeFile(join(spec.partsDir, task.name), bytes);
          completed += 1;
          written += bytes.length;
          hooks.phase(`分片 ${completed}/${tasks.length}`);
          hooks.progress(written, 0);
        }
      };

      await Promise.all(Array.from({ length: Math.min(PARALLEL, tasks.length) }, () => worker()));
      if (canceled) {
        resolveDone({ ok: false, error: "已暂停", canceled: true });
        return;
      }

      hooks.phase("合并分片");
      await joinParts(spec.partsDir, spec.path);
      const size = await stat(spec.path).then((info) => info.size).catch(() => written);
      hooks.progress(size, size);
      resolveDone({ ok: true });
    } catch (error) {
      if (canceled) resolveDone({ ok: false, error: "已暂停", canceled: true });
      else resolveDone({ ok: false, error: messageOf(error), canceled: false });
    }
  })();

  return {
    cancel() {
      canceled = true;
      controller.abort();
      resolveDone({ ok: false, error: "已暂停", canceled: true });
    },
    done,
  };
}
