// Sniffs the resources a page loads and hands them to the Downloader app.
//
// The app has no server to push to, so the handover is the clipboard: this
// worker copies a JSON payload, and the app's clipboard watcher takes it.
// (A newer Native Shell routes `nshdl://` links straight into the app; the
// payload is the same, so only this side would change.)

const MAX_PER_TAB = 80;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|flv|ts|avi|wmv)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus)(\?|#|$)/i;
const FILE_EXT = /\.(pdf|zip|rar|7z|tar|gz|dmg|pkg|exe|msi|iso|apk|ipa|deb|rpm|epub|docx?|xlsx?|pptx?)(\?|#|$)/i;
const PLAYLIST_EXT = /\.(m3u8|mpd)(\?|#|$)/i;

const INTERESTING_TYPES = /^(video|audio)\//i;
const INTERESTING_FILE_TYPES = /(mpegurl|dash\+xml|application\/(zip|x-7z-compressed|x-rar|pdf|octet-stream|vnd\.apple\.mpegurl|gzip|x-tar|x-msdownload|x-msi))/i;

function kindOf(url, contentType) {
  if (PLAYLIST_EXT.test(url) || /mpegurl|dash\+xml/i.test(contentType)) return "stream";
  if (VIDEO_EXT.test(url) || /^video\//i.test(contentType)) return "video";
  if (AUDIO_EXT.test(url) || /^audio\//i.test(contentType)) return "audio";
  if (/^image\//i.test(contentType)) return "image";
  if (FILE_EXT.test(url) || INTERESTING_FILE_TYPES.test(contentType)) return "file";
  return null;
}

function headerValue(headers, name) {
  if (!headers) return "";
  const found = headers.find((header) => header.name.toLowerCase() === name);
  return found ? found.value || "" : "";
}

function fileNameOf(url) {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last);
  } catch {
    return url;
  }
}

const tabKey = (tabId) => `tab:${tabId}`;

async function addToTab(tabId, entry) {
  if (tabId < 0) return;
  const key = tabKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key] || [];
  if (stored.some((item) => item.url === entry.url)) return;
  stored.unshift(entry);
  await chrome.storage.session.set({ [key]: stored.slice(0, MAX_PER_TAB) });
  await updateBadge(tabId);
}

async function updateBadge(tabId) {
  const key = tabKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key] || [];
  const text = stored.length > 0 ? String(Math.min(stored.length, 99)) : "";
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#4f46e5" }).catch(() => {});
}

chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    const contentType = headerValue(details.responseHeaders, "content-type");
    const kind = kindOf(details.url, contentType);
    if (!kind) return;
    if (/^image\//i.test(contentType) && !FILE_EXT.test(details.url) && kind === "image") {
      // Page furniture is mostly images; only media and playlists are noise-free.
      return;
    }
    const length = Number(headerValue(details.responseHeaders, "content-length"));
    void addToTab(details.tabId, {
      url: details.url,
      kind,
      type: contentType.split(";")[0].trim().toLowerCase(),
      size: Number.isFinite(length) ? length : 0,
      name: fileNameOf(details.url),
      referer: details.documentUrl || details.initiator || "",
      at: Date.now(),
    });
  },
  { urls: ["<all_urls>"], types: ["media", "xmlhttprequest", "other", "main_frame", "sub_frame", "object"] },
  ["responseHeaders"],
);

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(tabKey(tabId));
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" && change.url) {
    void chrome.storage.session.remove(tabKey(tabId));
    void chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "send-link",
      title: "用 Downloader 下载此链接",
      contexts: ["link"],
    });
    chrome.contextMenus.create({
      id: "send-media",
      title: "用 Downloader 下载此媒体",
      contexts: ["video", "audio", "image"],
    });
  });
});

async function copyText(text) {
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "把嗅探到的地址复制到剪贴板，Downloader 会读取它。",
    });
  } catch (error) {
    // The document is already open.
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "copy", text });
    return !!(response && response.ok);
  } catch {
    return false;
  }
}

function payload(items) {
  return JSON.stringify({ source: "downloader-extension", items });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  const url = info.linkUrl || info.srcUrl;
  if (!url) return;
  const kind = kindOf(url, "") || "file";
  const copied = await copyText(
    payload([{ url, kind, name: fileNameOf(url), referer: info.pageUrl || "" }]),
  );
  await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/128.png",
    title: copied ? "已复制到剪贴板" : "复制失败",
    message: copied
      ? "Downloader 会在大约 2 秒内把它加入队列。"
      : "请在扩展弹窗里选择这个地址再复制。",
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "badge") {
    void updateBadge(message.tabId).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
