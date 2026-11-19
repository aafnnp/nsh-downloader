# 浏览器扩展：资源嗅探

`extension/` 是一个 Manifest V3 扩展，源码不需要任何编译；发布时由 `tools/build-extension.sh` 打成 `Downloader-extension.zip`（顶层就是可加载的 `Downloader-extension/` 目录），随安装包一起分发，也可以在应用的「设置 → 浏览器集成」里直接下载。

## 它做什么

1. **监听响应**：`chrome.webRequest.onResponseStarted` 覆盖所有标签页，挑出
   - 播放列表：`.m3u8`、`.mpd`，或 `Content-Type` 是 `application/vnd.apple.mpegurl` / `application/dash+xml`；
   - 音视频：`video/*`、`audio/*`，或常见扩展名（mp4/mkv/webm/mp3/m4a…）；
   - 文件：zip/rar/7z/dmg/pkg/exe/msi/iso/apk/pdf/epub 等，或 `application/octet-stream` 下的这些扩展名。

   每个标签页单独记一份（`chrome.storage.session`，最多 80 条），图标上显示数量角标；刷新或关闭标签页就清空。
2. **交接给应用**：扩展没有服务端可以推送，所以用剪贴板：
   - 弹窗里勾选后「复制选中」，或右键菜单「用 Downloader 下载此链接 / 媒体」（由 offscreen 文档写剪贴板）；
   - 剪贴板里是下面这段 JSON，Downloader 每 2 秒读一次剪贴板，认出它就直接入队。

```json
{
  "source": "downloader-extension",
  "items": [
    {
      "url": "https://cdn.example.com/a/index.m3u8",
      "kind": "stream",
      "name": "index.m3u8",
      "referer": "https://example.com/watch/1"
    }
  ]
}
```

`referer` 会写进下载任务的 `Referer` 请求头，对付播放页的防盗链。

## 安装

1. 设置 → 浏览器集成 →「下载扩展包」，压缩包会保存到下载目录；也可以从
   [Releases](https://github.com/aafnnp/nsh-downloader/releases/latest/download/Downloader-extension.zip)
   下载 `Downloader-extension.zip`（应用内的「复制下载地址」给出同一个链接）。
2. 解压得到 `Downloader-extension/` 文件夹。
3. Chrome / Edge 打开 `chrome://extensions`（Edge 是 `edge://extensions`）。
4. 右上角打开「开发者模式」。
5. 「加载已解压的扩展程序」→ 选择解压出来的 `Downloader-extension/` 目录。
6. 固定到工具栏，随便打开一个视频页面播放几秒，图标上的数字就是嗅探到的数量。

应用这边：设置 → 下载 → 「监听剪贴板」保持开启（默认开启），或随时在设置 → 浏览器集成里点「从剪贴板导入」。

打包版把扩展包一并放在应用资源里，所以「下载扩展包」不需要联网；从源码运行（`nsh run`）时没有内置包，按钮会打开发布页下载。

## 文件

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | MV3 清单：`webRequest`、`storage`、`contextMenus`、`offscreen`、`notifications`、`clipboardWrite`、`<all_urls>` |
| `background.js` | 嗅探、按标签页存储、角标、右键菜单、复制载荷 |
| `popup.html/.css/.js` | 资源列表、多选、复制选中 / 全部、清空 |
| `offscreen.html/.js` | Service Worker 没有剪贴板，右键菜单经它写入 |
| `icons/` | 16 / 32 / 48 / 128 图标（`tools/make-icon.py` 生成） |

## 打包

```sh
tools/build-extension.sh          # vendor/extension/Downloader-extension.zip
tools/build-extension.sh dist     # 再复制一份到 dist/，随安装包发布
tools/build-extension.sh --reset  # 还原 lib/extension-asset.ts 的 stub
```

`tools/package.sh` 打包应用时会自动执行：zip 既作为应用资源打进安装包（供「下载扩展包」离线保存），也会复制到 `--out` 目录随发布上传。manifest 的版本取自 `nsh.json`，压缩包时间戳固定，同样的源码得到同样的文件。

## 为什么用剪贴板

NSH 0.4 的 TSX 运行时里没有「监听端口」的 API，也没有 URL Scheme 回调（`nsh.json` 的 `schemes` 出现在更新的版本里），所以扩展无法直接 HTTP POST 给应用。剪贴板是唯一零配置、跨平台的通道：

- 应用侧：`Clipboard.readText()` 轮询 + `parseSharedPayload()` 解析（也接受纯链接列表、裸 JSON 数组）。
- 扩展侧：只负责写出同一份 JSON。

将来 NSH 提供 `schemes` + `UrlScheme` 之后，把 `copyText()` 换成 `chrome.tabs.create({ url: "nshdl://add?payload=..." })` 即可，应用侧只需多解析一个入口。

## 限制

- 嗅探到的是**浏览器实际请求过的**地址：加密分片（AES-128）扩展只拿到 `.ts` 与 `.m3u8`，密钥由 Downloader 自己再取一次，因此需要 Referer 正确。
- 一些站点把媒体放在 `blob:` 或 MSE 里（YouTube、Netflix 这类），`webRequest` 只能看到分片请求；能下的是分片本体，不是带音轨合并的成品。
- 需要登录的下载（网盘分享、付费内容）扩展不会替你带 Cookie，只有 `Referer`；这类地址请配合新建下载里的「高级选项」→ 自定义请求头。
- 扩展只在 Chromium 系浏览器验证过（Chrome / Edge）；Firefox 的 MV3 在 `webRequest` 阻塞式监听上有差异，未适配。
