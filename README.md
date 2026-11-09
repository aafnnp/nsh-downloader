# Downloader

用 [Native Shell](https://nsh.dev)（`nsh`）的 TSX 写法写的桌面下载管理器：视频、音频、压缩包、镜像、文档都能下，界面是各平台的原生控件（macOS 上是 AppKit，Windows 是 Win32/Direct2D，Linux 是 GTK 4），不是套壳网页。

> 一个 nsh 工程、一份 TSX，`nsh run` 直接看效果，`nsh package` 出 macOS / Windows / Linux 安装包，顺带还能出一个网页预览版。

## 功能

**下载**
- 直链下载：`http(s)` 任意文件，先探测大小、类型、文件名（`Content-Disposition` 优先），再开始传输；探测失败（需要代理、服务器拒绝 HEAD）时交给下载引擎直接下。
- 磁力链接：`magnet:` 交给 aria2c 的 BitTorrent 引擎，种子里的每个文件落在自己独立的文件夹；进度取自 aria2 的摘要行，所以拿到元数据后就有了总大小与速度。
- 断点续传：暂停、退出后重新开始都从已下载的字节接着走（aria2c / curl）。
- 多引擎：`aria2c`（多线程 + 分片）→ `curl`（单连接，系统自带）→ 内置 fetch 引擎（≤ 8 MB，找不到外部工具时兜底），自动回退。
- 队列与并发：同时任务数 1–6，单文件连接数 1–16，全局限速（KB/s）。
- 进度、速度、剩余时间实时刷新；暂停 / 继续 / 重试 / 打开 / 在文件夹中显示 / 移除。

**流媒体**
- HLS（`.m3u8`）：自动挑主播放列表里码率最高的一路，下载全部分段后合并成一个文件。
- HLS 的 `#EXT-X-KEY` AES-128 加密分片：用 WebCrypto 解密再合并。
- DASH（`.mpd`）：`SegmentTemplate`（含 `SegmentTimeline`）与 `SegmentList` 两种描述。

**与浏览器配合**
- 自带 MV3 扩展（`extension/`）：用 `webRequest` 嗅探页面里的视频 / 音频 / 播放列表 / 文件地址，一键复制。
- 应用监听剪贴板（可关）：复制后约 2 秒自动进队列，也支持手动「粘贴」和 `⌘V`。

**代理**
- 设置里填 `http://127.0.0.1:7890`、`socks5://127.0.0.1:1080` 或直接 `host:port`，aria2c 与 curl 都会走它（`--all-proxy` / `--proxy`）。
- 留空即直连；HLS/DASH 的分片走运行时自己的网络栈，用系统代理。

**网盘直链**
- 识别常见网盘 / CDN 主机，自动补上服务端要求的 `Referer`（阿里云盘、123 云盘、夸克、百度、蓝奏、115、移动云盘、OneDrive、Dropbox、Google Drive 等）。
- 「高级」里可加任意请求头（`Cookie`、`User-Agent`…），对付防盗链和需要登录态的直接链接。
- 分享页链接会明确提示「这是分享页而不是直链」，不会假装能解析。

**其它**
- 记录与设置持久化，重启后恢复队列（未完成的标为已暂停）。
- 浅色 / 深色 / 跟随系统，主题 token 集中在 [theme.json](./theme.json)。
- 快捷键：`⌘N` 新建、`⌘V` 从剪贴板导入、`⌘1` 下载页、`⌘2` 设置页。
- 拖放 `.txt` / 链接清单到窗口也能识别（`onFileDrop` 读到文件后解析链接）。

## 界面

```
┌──────────────────────────────────────────────────────────────┐
│ ↓ Downloader      引擎徽标 · 深浅色 · ＋新建下载              │  ← 自绘标题栏（可拖动窗口）
├──────────┬───────────────────────────────────────────────────┤
│ 队列     │ [ 粘贴链接…                     ] [下载][粘贴][高级] │
│ 全部下载 │ 只有内置引擎：文件上限 8 MB                        │
│ 进行中   │ ───────────────────────────────────────────────── │
│ 已完成   │ 3 个进行中 · 6.2 MB/s · 2 个排队  [全部开始][暂停][清除]│
│ 失败     │ ┌───┐ video.mp4                      下载中   暂停 │
│          │ │VID│ b23.tv · 128 MB · 6.2 MB/s · 剩余 20s      │
│ 设置     │ └───┘ ████████████░░░░░░░░░░░░░░░░░░ 38%        │
│ 下载引擎 │ …                                                │
├──────────┴───────────────────────────────────────────────────┤
│ ● aria2c 已就绪                    6.2 MB/s   排队 2   深色  │
└──────────────────────────────────────────────────────────────┘
```

## 快速开始

```sh
# 1. 安装 NSH CLI（装一次就够，自带各平台运行时）
curl -fsSL https://nsh.dev/install.sh | sh          # Windows: irm https://nsh.dev/install.ps1 | iex

# 2. 跑起来
nsh run                                             # 本机原生窗口（macOS / Windows / Linux）
nsh run --target web                                # 浏览器里看（预览用）

# 3. 校验
nsh check                                           # 唯一的类型检查
nsh build                                           # 打包与类名检查，警告要看
nsh test                                            # headless 测试（App.test.tsx）

# 4. 出安装包
nsh package App.tsx --target macos                  # .app
nsh package App.tsx --target windows                # 目录 + .zip + Inno Setup 脚本
nsh package App.tsx --target linux                  # 目录 + .tar.gz
nsh package App.tsx --target web                    # 静态站点
```

想用多线程下载，装一下 aria2 即可，应用会在启动时自动发现：

```sh
brew install aria2        # macOS
sudo apt install aria2    # Debian / Ubuntu
```

> 纯内置引擎一次 `writeFile` 最多 8 MB（运行时限制），所以大文件必须有 `curl` 或 `aria2c`。macOS、Windows 10+ 和多数 Linux 都自带 curl。

## 引擎是怎么选的

| 引擎 | 何时使用 | 能力 |
| --- | --- | --- |
| `aria2c` | 装了就用（可在设置里关闭） | 多连接分片、断点续传、限速、磁力链接 |
| `curl` | 没有 aria2c 时 | 断点续传（`--continue-at -`，服务器不支持 Range 时自动重下一次）、限速 |
| 内置 fetch | 前两者都不可用，或文件 ≤ 8 MB | 流式读取、写入磁盘；超限会明确报错 |
| 分段引擎 | HLS / DASH | 并发 4 路拉分片、AES-128 解密、本地合并 |

进度不靠解析引擎输出：传输期间轮询目标文件大小算进度和速度，所以三种引擎表现一致。磁力链接是例外——文件由种子命名，尺寸只有 aria2 自己知道，于是读它每秒一行 `[#gid 44MiB/190MiB(23%) CN:15 DL:9.9MiB]` 的摘要。

## 代理

设置 → 传输 → 代理：

| 写法 | 例子 |
| --- | --- |
| 只要 `host:port` | `127.0.0.1:7890`（按 http 处理） |
| 带协议 | `http://127.0.0.1:7890`、`socks5://127.0.0.1:1080` |

- 下载与磁力都生效：参数传给 `aria2c --all-proxy` 与 `curl --proxy`。
- 内置 fetch 引擎不认代理，HLS/DASH 分片也走运行时的网络栈（跟随系统代理）。
- 代理开着时 HTTP HEAD 探测往往失败，应用不会因此放弃，而是直接交给引擎开始传输。

## 磁力链接

- 粘贴 `magnet:?xt=...`（可在「高级」里一次贴多条），需要系统里有 `aria2c`：`brew install aria2` / `sudo apt install aria2`。
- 每条种子下载到 `<下载目录>/<种子名>/`，多文件种子自然保留内部结构，不与其他下载混在一起。
- 磁力里没写 tracker 时会补几个公共 tracker，省掉 DHT 冷启动。
- 完成后做种时间为 0（`--seed-time=0`），不会占着上行。

## 浏览器扩展

见 [docs/browser-extension.md](./docs/browser-extension.md)。简述：

1. `chrome://extensions` → 打开开发者模式 → 「加载已解压的扩展程序」→ 选 `extension/` 目录。
2. 在网页上正常播放视频，扩展会记录 m3u8 / mp4 / mp3 / 压缩包等响应。
3. 点扩展图标 → 勾选要下载的地址 → 「复制选中」。
4. Downloader 开着的话，约 2 秒后自动进队列。

NSH 目前的版本还没有 URL Scheme 回调（`nsh.json` 的 `schemes` 是更新版本的能力），所以扩展走剪贴板交接；收到的是同一个 JSON 结构，将来换成深链只需改扩展这边。

## 网盘直链

- 直接把文件直链粘进来即可；命中的服务商会自动带上 `Referer`，行内展开能看到「直链 · 已按服务商要求附加 Referer」。
- 需要登录态的（例如百度网盘），在「高级」里把 `Cookie: ...` 作为请求头写上，引擎会原样传给 curl / aria2c。
- 分享页（`/s/xxxx` 这类）不会被假装解析：应用会提示先拿到直链，或让浏览器扩展去嗅探下载按钮真正请求的地址。

## 目录

```
nsh.json            应用元数据、主题入口
theme.json          设计 token（浅色 / 深色 / 自定义角色）
App.tsx             外壳：标题栏、侧栏、页面切换、快捷键
model.ts            Item / Settings 类型与纯函数
store.ts            队列、调度、持久化、剪贴板监听（状态都在这）
lib/
  transfer.ts       进程引擎与内置 fetch 引擎
  playlist.ts       HLS / DASH 解析、分片下载、合并
  probe.ts          HEAD / Range 探测
  engines.ts        aria2c / curl 探测
  paths.ts          目录、唯一文件名、打开与定位
  urls.ts           链接归一化、文件名推导、剪贴板载荷解析
  netdisk.ts        网盘直链识别与 Referer 规则
  format.ts         大小、速度、ETA 格式化
components/         标题栏、侧栏、状态栏、下载行、对话框、分段控件
pages/              下载页、设置页
extension/          浏览器扩展（MV3，无需构建）
e2e/                真机引擎测试（不进默认测试集）
tools/              图标生成、e2e 的 HTTP 服务 / 代理 / BitTorrent swarm、e2e 运行脚本
.github/workflows/  类型检查 + 测试 + 三平台打包 + tag 发布
```

## 测试

```sh
nsh test                       # App.test.tsx + lib.test.ts：界面、解析、失败路径（16 个用例）
tools/run-e2e.sh               # 真下载：1 MB / 12 MB、HLS、AES-128、代理、磁力（需本机 curl，磁力需 aria2c）
```

`tools/run-e2e.sh` 会起三个本地服务——HTTP 文件服务器、只服务 `blocked.test` 的代理、带 tracker 与做种者的 BitTorrent swarm——临时在 `nsh.json` 里给 `/tmp` 读写权限（headless 引擎默认不给文件系统），跑完自动还原，并打印 sha256 对照。代理用例的正负两半（走代理能下、不走代理失败）保证「真走了代理」而不是碰巧成功。

## 持续集成

[.github/workflows/build.yml](./.github/workflows/build.yml)：

- `check`：`nsh check` → `nsh build`（警告即问题）→ `nsh test`，输出 JUnit。
- `package`：macOS（arm64）、Windows（x86_64）、Linux（x86_64）、Web 四个产物，`nsh package` 直接产出，再按平台归档成 `.zip` / `.tar.gz`。
- `release`：打 `v*` tag 时汇总产物、生成 `SHA256SUMS.txt` 与变更说明，用 `gh release` 发布。
- `e2e`：手动触发的 macOS 真机引擎测试。

macOS 包是临时签名（ad hoc），首次打开需要右键 → 打开。

## 已知限制

- 网页预览版不能把文件写到你磁盘上（只有页面存储），下载请用桌面应用。
- 内置引擎单文件上限 8 MB，见上文；装 curl / aria2c 就没有这个限制。
- 磁力链接必须有 aria2c；没有时会直接说明要装什么，而不是排队后失败。
- 内置 fetch 引擎与 HLS/DASH 分片不支持应用内代理，只跟随系统代理。
- 需要登录态的网盘必须自己提供直链和 Cookie，本应用不替你做鉴权或绕过分享限制。
- HLS 目前取主列表里码率最高的一路；多音轨、字幕轨没有单独合并。
- 只有桌面能跑外部引擎；iOS / Android 构建会因为无法调用进程而退回内置引擎。

## 许可

MIT
