// Lists what the page loaded, and copies it in the shape the app reads.

const BADGE = { video: "VID", audio: "AUD", stream: "HLS", file: "FILE", image: "IMG" };

const list = document.getElementById("list");
const empty = document.getElementById("empty");
const subtitle = document.getElementById("subtitle");
const all = document.getElementById("all");
const copySelected = document.getElementById("copy-selected");
const copyAll = document.getElementById("copy-all");
const clear = document.getElementById("clear");

let tabId = -1;
let entries = [];

function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function payload(items) {
  return JSON.stringify({
    source: "downloader-extension",
    items: items.map((item) => ({
      url: item.url,
      kind: item.kind,
      name: item.name,
      referer: item.referer,
    })),
  });
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function selected() {
  return entries.filter((entry) => entry.checked);
}

function render() {
  list.textContent = "";
  empty.hidden = entries.length > 0;
  subtitle.textContent =
    entries.length > 0 ? `发现 ${entries.length} 个可下载资源` : "正在嗅探本页资源…";
  for (const entry of entries) {
    const row = document.createElement("li");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = entry.checked;
    check.addEventListener("change", () => {
      entry.checked = check.checked;
      updateButtons();
    });
    row.appendChild(check);

    const chip = document.createElement("span");
    chip.className = `chip ${entry.kind}`;
    chip.textContent = BADGE[entry.kind] || "FILE";
    row.appendChild(chip);

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = entry.name || entry.url;
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.textContent = [hostOf(entry.url), formatBytes(entry.size), entry.type]
      .filter(Boolean)
      .join(" · ");
    meta.append(name, detail);
    row.appendChild(meta);

    list.appendChild(row);
  }
  updateButtons();
}

function updateButtons() {
  const count = selected().length;
  copySelected.disabled = count === 0;
  copySelected.textContent = count > 0 ? `复制选中 (${count})` : "复制选中";
  copyAll.disabled = entries.length === 0;
  all.checked = entries.length > 0 && count === entries.length;
}

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab ? tab.id : -1;
  if (tabId < 0) return;
  const key = `tab:${tabId}`;
  const stored = (await chrome.storage.session.get(key))[key] || [];
  entries = stored.map((entry) => ({ ...entry, checked: true }));
  render();
}

async function copyAndClose(items) {
  if (items.length === 0) return;
  await copy(payload(items));
  subtitle.textContent = `已复制 ${items.length} 个地址，Downloader 会自动接收`;
  setTimeout(() => window.close(), 600);
}

all.addEventListener("change", () => {
  for (const entry of entries) entry.checked = all.checked;
  render();
});

copySelected.addEventListener("click", () => void copyAndClose(selected()));
copyAll.addEventListener("click", () => void copyAndClose(entries));

clear.addEventListener("click", async () => {
  entries = [];
  if (tabId >= 0) await chrome.storage.session.remove(`tab:${tabId}`);
  await chrome.runtime.sendMessage({ type: "badge", tabId });
  render();
});

void load();
