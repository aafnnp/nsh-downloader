// A document the service worker opens to reach the clipboard (it has none).

const buffer = document.getElementById("buffer");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "copy") return false;
  buffer.value = message.text;
  buffer.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  if (!ok && navigator.clipboard) {
    navigator.clipboard
      .writeText(message.text)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  sendResponse({ ok });
  return false;
});
