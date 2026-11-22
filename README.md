# Downloader

[![Build](https://github.com/aafnnp/nsh-downloader/actions/workflows/build.yml/badge.svg)](https://github.com/aafnnp/nsh-downloader/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/aafnnp/nsh-downloader)](https://github.com/aafnnp/nsh-downloader/releases)

参照 [Free Download Manager](https://www.freedownloadmanager.org/zh/) 的功能和界面重做的桌面下载管理器。用 [Native Shell](https://nsh.dev)（`nsh`）的 TSX 写法实现，界面是各平台的原生控件（macOS 上是 AppKit，Windows 是 Win32/Direct2D，Linux 是 GTK 4），不是套壳网页。

一个 nsh 工程、一份 TSX：`nsh run` 直接看效果，`nsh package` 出 macOS / Windows / Linux 安装包，也能打包出网页预览版。

## 功能

**FDM 风格的界面**
- 自绘标题栏 / 工具栏：新建下载、开始、暂停、重试、从剪贴板导入、流量模式、搜索、设置。
- 左侧导航：全部下载、未完成、已完成、失败，以及视频 / 音乐 / 文档 / 程序 / 压缩包 / 其他六个分类。
- 列表按 FDM 的列组织：文件名、大小、状态、进度、速度、剩余时间；点列头排序。
- 选中一行后在右侧看详细信息：来源、保存目录、分类、优先级、引擎、限速、链接、时间。
- 状态栏显示引擎、调度器、线程数、实时速度曲线、活跃 / 排队数量与当前流量模式。
- 深色 / 浅色 / 跟随系统；右键菜单；多选与批量操作。

**下载**
- 直链下载：`http(s)` 任意文件，先探测大小、类型、文件名（`Content-Disposition` 优先），再开始传输；探测失败（需要代理、服务器拒绝 HEAD）时交给下载引擎直接下。
- 断点续传：暂停、退出后重新开始都从已下载的字节接着走（aria2c / curl）。
- 多引擎：随包 `aria2c`（多线程 + 分片）→ 系统 `aria2c` → `curl`（单连接，系统自带）→ 内置 fetch 引擎（≤ 8 MB，找不到外部工具时兜底），自动回退。
- 队列与并发：同时任务数 1–8，单文件连接数 1–16。
- 优先级：高 / 普通 / 低，调度器按优先级出队；右键可「立即开始」。
- 进度、速度、剩余时间实时刷新；暂停 / 继续 / 重试 / 打开 / 在文件夹中显示 / 移除。
- 移除时会问一次：`仅删除任务` 保留磁盘上的文件，`同时删除文件` 连文件一起删（种子任务删掉它自己的文件夹，分片缓存也清掉）。

**带宽管理**
- FDM 式流量模式：不限、低（64 KB/s）、中（512 KB/s）、高（2 MB/s）、自定义。
- 每个下载可以单独设 KB/s 上限，或跟随全局。
- 代理：`http://127.0.0.1:7890`、`socks5://127.0.0.1:1080` 或直接 `host:port`，aria2c 与 curl 都会走它。
- 一键「导入系统代理」：macOS 读 `scutil --proxy`，Windows 读 Internet 设置，Linux 读 GNOME / KDE 的代理；导入后仍可手改。

**智能分类**
- 文件按类型进入视频 / 音乐 / 文档 / 程序 / 压缩包 / 其他。
- 可为每个分类指定固定目录；或打开「按分类自动归档」，在主目录下使用分类子文件夹。
- 新建下载时可以选择分类、优先级、备注和单任务限速。

**调度器**
- 按星期和起止时间自动开始 / 暂停全部下载，支持跨午夜窗口。
- 状态栏和侧栏会显示「运行中 / 等待中 / 关闭」。

**流媒体**
- HLS（`.m3u8`）：自动挑主播放列表里码率最高的一路，下载全部分段后合并成一个文件。
- HLS 的 `#EXT-X-KEY` AES-128 加密分片：用 WebCrypto 解密再合并。
- DASH（`.mpd`）：`SegmentTemplate`（含 `SegmentTimeline`）与 `SegmentList` 两种描述。

**BitTorrent**
- 磁力链接：交给 aria2c 的 BitTorrent 引擎，每个种子落在自己的文件夹。
- `.torrent` 直链：aria2c 下载元数据后继续下载种子内容。
- 本地 `.torrent` 文件：拖进窗口，或在系统里用「打开方式」交给 Downloader；`nsh.json` 已声明 `fileTypes`。
- 完成后做种时间为 0（`--seed-time=0`），不占上行。

**与浏览器配合**
- 自带 MV3 扩展（`extension/`）：用 `webRequest` 嗅探页面里的视频 / 音频 / 播放列表 / 文件地址，一键复制。
- 扩展包随安装包一起发布：设置 → 浏览器集成里点「下载扩展包」即可保存到下载目录（打包版离线可用），也可以复制固定的发布下载地址。
- 应用监听剪贴板（可关）：复制后约 2 秒自动进队列，也支持手动「从剪贴板导入」和 `⌘V`。

**网盘直链**
- 识别常见网盘 / CDN 主机，自动补上服务端要求的 `Referer`（阿里云盘、123 云盘、夸克、百度、蓝奏、115、移动云盘、OneDrive、Dropbox、Google Drive 等）。
- 「高级」里可加任意请求头（`Cookie`、`User-Agent`…），对付防盗链和需要登录态的直接链接。
- 分享页链接会明确提示「这是分享页而不是直链」，不会假装能解析。

**自动更新**
- 打包版启动后向 GitHub Releases 检查新版本；设置 → 关于 里有当前版本、检查更新、下载进度与「下载并安装」。
- 安装完自动重启进入新版本；iOS / Android 等不能自替换的平台会改为打开发布页。开发运行和网页版不检查更新。

**其它**
- 记录与设置持久化，重启后恢复队列（未完成的标为已暂停）。
- 设置 → 网络与引擎里的「重启」会先暂停并保存队列，再重启应用：代理、引擎、线程数这类只对之后任务生效的改动，重启后对全部任务生效。打包版真的退出再启动；`nsh run` 的开发宿主被 nsh 停掉后不会自己回来，那里改为原地重新载入设置与队列（按钮读作「重新载入」）。
- 进度与速度取的是引擎自己报的已完成字节（aria2c 的 summary、curl 的写入量），不是磁盘上稀疏文件的大小，所以多线程下载时两者对得上。
- 搜索文件名 / 链接 / 备注；支持多选、全选、批量开始 / 暂停 / 移除。
- 快捷键：`⌘N` 新建、`⌘V` 从剪贴板导入、`⌘,` 设置、`⌘1` 全部、`⌘2` 未完成、`⌘3` 已完成、`⌘4` 失败、`⌘5` 视频；`Delete` 移除选中，`Space` 暂停 / 继续选中。
- 拖放 `.txt` / 链接清单 / `.torrent` 到窗口也能识别。

## 界面

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ↓ Downloader   ＋新建下载  ▶开始  ⏸暂停  ⟳重试  ⧉剪贴板   搜索…  不限  ⚙  │
├───────────┬───────────────────────────────────────────────┬────────────────┤
│ 下载      │ 全部下载  12 项  3 个进行中 · 6.2 MB/s        │ 详细信息       │
│  全部下载 │ ───────────────────────────────────────────── │ ┌────┐         │
│  未完成   │ ☑ 文件名            大小   状态  进度   速度  │ │VID │ video…  │
│  已完成   │ ☐ video.mp4         128 MB 下载中 ███░  6.2MB │ └────┘         │
│  失败     │ ☐ archive.zip       2.1 GB 排队中 ░░░░   —    │ 来源  b23.tv   │
│ 分类      │ ☐ music.flac        42 MB  已完成 100%   —    │ 保存到 ~/…     │
│  视频     │ …                                             │ 分类  视频     │
│  音乐     │                                               │ 引擎  aria2c   │
│  文档     │                                               │ 优先级 普通     │
│  程序     │                                               │ 速度限制 全局   │
│  压缩包   │                                               │ 链接 …         │
│  其他     │                                               │                │
│ 工具      │                                               │                │
│  调度器   │                                               │                │
│  浏览器   │                                               │                │
│  设置     │                                               │                │
├───────────┴───────────────────────────────────────────────┴────────────────┤
│ ● aria2c 已就绪   ○ 调度器关闭   ⣀⣠⣤⣀ 6.2 MB/s  活跃 3 · 排队 5  不限 · 深色 │
└────────────────────────────────────────────────────────────────────────────┘
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
nsh test                                            # headless 测试（App.test.tsx + lib.test.ts）

# 4. 出安装包
nsh package App.tsx --target macos                  # .app
nsh package App.tsx --target windows                # 目录 + .zip + Inno Setup 脚本
nsh package App.tsx --target linux                  # 目录 + .tar.gz
nsh package App.tsx --target web                    # 静态站点
```

用 `tools/package.sh` 构建的发布包自带 `aria2c`；从源码运行、直接 `nsh package`、或没有准备 sidecar 时，应用会回退到系统安装的 aria2c / curl：

```sh
brew install aria2        # macOS
sudo apt install aria2    # Debian / Ubuntu
```

> 纯内置引擎一次 `writeFile` 最多 8 MB（运行时限制），所以大文件必须有 `curl` 或 `aria2c`。macOS、Windows 10+ 和多数 Linux 都自带 curl。

## 内置 aria2c（随包分发）

构建时先准备 sidecar，再打包：

```sh
tools/prepare-aria2.sh                  # 当前机器对应的平台
tools/prepare-aria2.sh macos-arm64      # 也可以指定目标
tools/prepare-aria2.sh windows-x86_64   # 官方自包含 aria2c.exe，可跨平台准备
tools/prepare-aria2.sh windows-arm64    # 同一份 x86_64 exe，Windows on Arm 走 x64 模拟
tools/prepare-aria2.sh linux-x86_64     # 需要 aria2 与 patchelf，建议在 Linux 上跑

# 或者用包装脚本：先准备目标平台的 sidecar，再调用 nsh package
tools/package.sh macos --out dist
tools/package.sh windows --out dist
tools/package.sh linux --out dist
SKIP_ARIA2=1 tools/package.sh web --out dist
```

- 产物在 `vendor/aria2/current/<triple>/`（已 gitignore），`lib/aria2-asset.ts` 由脚本生成；仓库里提交的是空列表 stub，所以 `nsh check`、`nsh test` 和普通 `nsh package` 都不需要二进制。`tools/package.sh` 跑完会把 stub 还原，避免提交指向构建产物的 import。
- 运行时把 sidecar 解压或复制到应用数据目录的 `engines/<triple>/`，按来源大小判断是否复用；通过 `sh`（Windows 上是 `powershell.exe -EncodedCommand`）启动。`nsh` 的 `process.execute` 只匹配精确的可执行文件路径，shell 是指向随包位置的跨安装路径方案。Windows 不能用 `cmd.exe`：`nsh` 起进程时按 MSVC 规则转义参数里的引号（变成 `\"`），`cmd.exe` 不会把它读回引号，而且它还会展开 URL 里的 `%NAME%`；`-EncodedCommand` 把整条命令行以 base64 的 UTF-16LE 传过去，没有第二层解析。`nsh` 只给子进程 `PATH`、`HOME`、`SystemRoot` 等少数环境变量，不传 `PATHEXT`，PowerShell 因此会把 `.exe` 当成“文档”而拒绝执行，所以脚本先设 `$env:PATHEXT` 再调用。资源导入的 `asset:/` URL 换成本地路径时也要留意：`fileURLToPath` 在 Windows 上会留下前导斜杠（`/C:/…`），这种形式不在任何 `fs` 授权根下，`lib/paths.ts` 的 `filePathFromUrl` 负责去掉它。
- 优先级：随包 `aria2c` → 系统 `aria2c` → `curl` → 内置 fetch。设置 → 网络与引擎 会显示“随应用打包”。
- Windows arm64 包也带 aria2c：官方只有 x86_64 构建，Windows on Arm 通过系统内置的 x64 模拟运行。
- macOS 约增加 4.5 MB，Windows 约增加 5.4 MB；Web 版不含二进制（浏览器不能起进程）。
- macOS 版会把非系统 dylib 改到 `@executable_path/lib` 并重新 ad-hoc 签名；Linux 用 `$ORIGIN/lib` rpath，glibc 仍用系统自带的（打包 glibc 会和宿主的 `ld.so` 混用）；Windows 用官方 zip 里自包含的 `aria2c.exe`，下载时按脚本里固定的 SHA-256 校验。
- 平台下限跟着准备 sidecar 的机器走：Homebrew 产物要求打包机的 macOS 版本（脚本会警告，app 本身只要求 macOS 11），Linux 产物要求打包机的 glibc。要在老系统上可用，就在更老的 runner 上构建，或用 `MACOSX_DEPLOYMENT_TARGET` 编译 aria2。
- `nsh.json` 已为这套流程声明 `process.execute`（`sh`、`cmd.exe`、`powershell.exe`、`tar`、`chmod`、`open` 等）和 `fs` 根目录（`${pluginDir}`、`${dataDir}`、`${homeDir}`）。

aria2 是 GPLv2。源码：<https://github.com/aria2/aria2>；`vendor/aria2/COPYING` 与 `vendor/aria2/LICENSE.OpenSSL` 随包分发，设置 → 关于 → “查看许可证” 可以打开。

## 浏览器扩展包（随包分发）

扩展本身不需要构建，但发布要一个能直接下载的压缩包：

```sh
tools/build-extension.sh                # vendor/extension/Downloader-extension.zip
tools/build-extension.sh dist           # 再复制一份到 dist/
tools/build-extension.sh --reset        # 还原 lib/extension-asset.ts 的 stub
```

- 压缩包里是顶层 `Downloader-extension/` 目录，解压后正好是 Chrome「加载已解压的扩展程序」要选的那一层；`manifest.json` 的版本跟随 `nsh.json`，打包时间戳固定，同样的源码得到同样的 zip。
- `tools/package.sh` 自动调用它：先让 `lib/extension-asset.ts` 指向 zip，`nsh package` 把它作为资源打进应用（设置 → 浏览器集成 →「下载扩展包」离线可保存），打包结束后还原 stub，并把同一份 zip 复制到 `--out` 目录（默认 `.nsh/out`），随安装包一起上传发布。
- 没有内置扩展包的构建（`nsh run`、直接 `nsh package`）在设置里显示 `https://github.com/aafnnp/nsh-downloader/releases/latest/download/Downloader-extension.zip`，「下载扩展包」会打开这个地址。

## 引擎是怎么选的

| 引擎 | 何时使用 | 能力 |
| --- | --- | --- |
| `aria2c` | 随包优先，其次系统安装（可在设置里关闭） | 多连接分片、断点续传、限速、磁力 / 种子 |
| `curl` | 没有 aria2c 时 | 断点续传（`--continue-at -`，服务器不支持 Range 时自动重下一次）、限速 |
| 内置 fetch | 前两者都不可用，或文件 ≤ 8 MB | 流式读取、写入磁盘；超限会明确报错 |
| 分段引擎 | HLS / DASH | 并发 4 路拉分片、AES-128 解密、本地合并 |

进度不靠解析引擎输出：传输期间轮询目标文件大小算进度和速度，所以三种引擎表现一致。磁力 / 种子是例外——文件由种子命名，尺寸只有 aria2 自己知道，于是读它每秒一行 `[#gid 44MiB/190MiB(23%) CN:15 DL:9.9MiB]` 的摘要。

## 流量模式与限速

设置 → 下载 → 流量模式：

| 模式 | 上限 |
| --- | --- |
| 不限 | 0（不限制） |
| 低 | 64 KB/s |
| 中 | 512 KB/s |
| 高 | 2 MB/s |
| 自定义 | 设置里的「自定义上限」 |

- 全局模式作用于每个文件；单个下载还可以在「详细信息 → 速度限制」里覆盖，或右键选择。
- 限速通过 `aria2c --max-download-limit` 与 `curl --limit-rate` 实现；内置 fetch 引擎与 HLS/DASH 分片不认应用限速。

## 调度器

设置 → 调度器：

- 打开「启用调度器」，填开始 / 停止时间（`HH:MM`），选择星期（不选表示每天）。
- 进入时间窗口时自动开始全部下载，离开窗口时暂停全部下载。
- 支持跨午夜，例如 `22:00` → `06:00`。
- 当前状态显示在状态栏与左侧「调度器」行。

## 代理

设置 → 网络与引擎 → 代理：

| 写法 | 例子 |
| --- | --- |
| 只要 `host:port` | `127.0.0.1:7890`（按 http 处理） |
| 带协议 | `http://127.0.0.1:7890`、`socks5://127.0.0.1:1080` |

- 下载与磁力都生效：参数传给 `aria2c --all-proxy` 与 `curl --proxy`。
- 内置 fetch 引擎不认代理，HLS/DASH 分片也走运行时的网络栈（跟随系统代理）。
- 代理开着时 HTTP HEAD 探测往往失败，应用不会因此放弃，而是直接交给引擎开始传输。

## 磁力与种子

- 粘贴 `magnet:?xt=...`（可在「新建下载」里一次贴多条），需要随包或系统里有 `aria2c`。
- 粘贴 `.torrent` 直链，或把本地 `.torrent` 拖进窗口。
- 每条种子下载到 `<下载目录>/<种子名>/`，多文件种子自然保留内部结构。
- 磁力里没写 tracker 时会补几个公共 tracker，省掉 DHT 冷启动。
- 完成后做种时间为 0（`--seed-time=0`），不会占着上行。
- `nsh.json` 的 `fileTypes` 让打包后的应用能在「打开方式」里接收 `.torrent`，`singleInstance` 让第二次打开把文件交给正在运行的实例。

## 浏览器扩展

见 [docs/browser-extension.md](./docs/browser-extension.md)。简述：

1. 设置 → 浏览器集成 →「下载扩展包」，解压出 `Downloader-extension/` 文件夹；也可以从 Release 里直接下载 `Downloader-extension.zip`。
2. `chrome://extensions` → 打开开发者模式 → 「加载已解压的扩展程序」→ 选这个文件夹。
3. 在网页上正常播放视频，扩展会记录 m3u8 / mp4 / mp3 / 压缩包等响应。
4. 点扩展图标 → 勾选要下载的地址 → 「复制选中」。
5. Downloader 开着的话，约 2 秒后自动进队列；也可以在设置 → 浏览器集成里点「从剪贴板导入」。

`tools/build-extension.sh` 用 `extension/` 生成 `vendor/extension/Downloader-extension.zip`（manifest 版本跟随 `nsh.json`，固定时间戳，内容可复现），并让 `lib/extension-asset.ts` 指向它；`tools/package.sh` 在打包时自动做这一步，应用内的「下载扩展包」就是这份文件，同一份 zip 也会放进 `--out` 目录随发布上传。下载地址固定为 `https://github.com/aafnnp/nsh-downloader/releases/latest/download/Downloader-extension.zip`。

NSH 目前的版本还没有 URL Scheme 回调，所以扩展走剪贴板交接；收到的是同一个 JSON 结构，将来换成深链只需改扩展这边。

## 网盘直链

- 直接把文件直链粘进来即可；命中的服务商会自动带上 `Referer`，行内展开能看到「直链 · 已按服务商要求附加 Referer」。
- 需要登录态的（例如百度网盘），在「高级」里把 `Cookie: ...` 作为请求头写上，引擎会原样传给 curl / aria2c。
- 分享页（`/s/xxxx` 这类）不会被假装解析：应用会提示先拿到直链，或让浏览器扩展去嗅探下载按钮真正请求的地址。

## 目录

```
nsh.json            应用元数据、主题入口、.torrent 文件类型、单实例
theme.json          设计 token（FDM 风格的浅色 / 深色角色）
App.tsx             外壳：标题栏、侧栏、页面、快捷键、菜单、拖放
model.ts            Item / Settings / 分类 / 优先级 / 流量模式 / 调度窗口
store.ts            队列、调度、持久化、选择、剪贴板监听、流量采样
lib/
  transfer.ts       进程引擎与内置 fetch 引擎
  playlist.ts       HLS / DASH 解析、分片下载、合并
  probe.ts          HEAD / Range 探测
  engines.ts        aria2c / curl 探测
  aria2.ts          随包 aria2c 的解压、路径与 shell 启动
  aria2-asset.ts    生成的 sidecar 列表（提交的 stub 为空）
  extension.ts      随包浏览器扩展包的保存与发布下载地址
  extension-asset.ts 生成的扩展包路径（提交的 stub 为 null）
  paths.ts          目录、唯一文件名、打开与定位
  urls.ts           链接归一化、文件名推导、剪贴板载荷解析
  netdisk.ts        网盘直链识别与 Referer 规则
  update.ts         nsh/updater 的检查、下载、安装与状态
  format.ts         大小、速度、ETA 格式化
components/
  TopBar.tsx        标题栏与工具栏
  Sidebar.tsx       导航、分类计数、引擎状态
  DownloadRow.tsx   表格行、右键菜单、行内操作
  DetailsPane.tsx   右侧详细信息
  AddDialog.tsx     新建下载（分类 / 优先级 / 限速 / 备注 / 高级头）
  SettingsDialog.tsx 设置（常规 / 下载 / 分类 / 网络 / 调度器 / 浏览器 / 关于）
  StatusBar.tsx     引擎、调度器、流量曲线、计数
pages/
  DownloadsPage.tsx 列表、搜索、排序、空状态、批量操作
extension/          浏览器扩展（MV3，无需构建）
e2e/                真机引擎测试（不进默认测试集）
tools/              图标生成、aria2 sidecar 与浏览器扩展包的构建脚本、打包与 macOS 稳定签名脚本、e2e 的 HTTP 服务 / 代理 / BitTorrent swarm
.github/workflows/  类型检查 + 测试 + 全平台打包 + tag 发布与更新清单
```

## 测试

```sh
nsh test                       # App.test.tsx + lib.test.ts：界面、删除确认、分类、调度、右键菜单、系统代理解析、aria2 与扩展打包（44 个用例）
tools/run-e2e.sh               # 真下载：1 MB / 12 MB、HLS、AES-128、代理、磁力（需本机 curl，磁力需 aria2c）
```

`tools/run-e2e.sh` 会起三个本地服务——HTTP 文件服务器、只服务 `blocked.test` 的代理、带 tracker 与做种者的 BitTorrent swarm——临时在 `nsh.json` 里给 `/tmp` 读写权限（headless 引擎默认不给文件系统），跑完自动还原，并打印 sha256 对照。代理用例的正负两半（走代理能下、不走代理失败）保证「真走了代理」而不是碰巧成功。

单元测试用一个只记录文件大小的 `fs/promises` 替身，让下载队列在 headless 引擎里也能跑完完成态，而不需要真的写盘。

## 发布

打一个 tag 就会出七个平台产物（macOS / Linux / Windows 各两种架构，加网页预览版）、一份 `Downloader-extension.zip`，并生成 Release：

```sh
git tag v1.0.1 && git push origin v1.0.1
```

最新一次：<https://github.com/aafnnp/nsh-downloader/releases>

`nsh.json` 的 `"updater": { "github": "aafnnp/nsh-downloader" }` 让 `nsh package` 额外写出自动更新包；发布任务用 `nsh update-manifest` 汇总成 `latest.json`，和安装包一起上传。因此 **tag 必须与 `nsh.json` 的 `version` 一致**（发布任务会检查）。应用内「设置 → 关于 → 检查更新」读取这份清单，下载后自替换并重启。

## 持续集成

[.github/workflows/build.yml](./.github/workflows/build.yml)：

- `check`：`nsh check` → `nsh build`（警告即问题）→ 构建并校验浏览器扩展包 → `nsh test`，输出 JUnit。
- `package`：macOS（arm64 / x86_64）、Linux（x86_64 / aarch64）、Windows（x86_64 / arm64）、Web 共七个产物；桌面目标都走 `tools/package.sh`（先准备该目标的 sidecar 和浏览器扩展包，再 `nsh package` 打进 `.app` / `.zip` / `.tar.gz`，最后还原 stub，并把 `Downloader-extension.zip` 放进产物目录），CI 与本地是同一条命令。Windows arm64 装的是官方 x86_64 的 aria2c，由 Windows 11 on Arm 的 x64 模拟运行。
- `release`：打 `v*` tag 时汇总产物、用 `nsh update-manifest` 生成 `latest.json`、生成 `SHA256SUMS.txt` 与变更说明，用 `gh release` 发布。
- `e2e`：手动触发的 macOS 真机引擎测试。

macOS 包默认是临时签名（ad hoc）：它的 designated requirement 就是这次构建的代码哈希，于是每次重新打包，macOS 都把它当成另一个应用，「想要访问“下载”文件夹」的授权也随之重问。`tools/package.sh macos` 打完包会调用 `tools/sign-macos.sh` 用固定身份重签——首次运行在 `~/.nsh-signing/downloader-signing.keychain-db` 里生成一次自签名证书（独立钥匙串，不动登录钥匙串），之后每次的 requirement 都是 `identifier "dev.nsh.downloader" and certificate leaf = H"…"`，重建多少次都不变，授权只问一次；随后还会用签名后的 `.app` 重建自动更新包。已有正式证书就设 `DOWNLOADER_SIGN_IDENTITY`，不想签就设 `SKIP_SIGN=1`（回到旧行为）。`nsh run` 不需要这一步：开发宿主是 nsh 自己的应用。

## 已知限制

- 网页预览版不能把文件写到你磁盘上（只有页面存储），下载请用桌面应用。
- 直接 `nsh package` 不会自动准备 sidecar；没有 sidecar 的包会回退到系统 aria2c / curl。
- 内置引擎单文件上限 8 MB，见上文；装 curl / aria2c 就没有这个限制。
- 磁力与本地 `.torrent` 必须有 aria2c；没有时会直接说明要装什么，而不是排队后失败。
- Windows arm64 包里的 aria2c 是官方 x86_64 构建，依赖 Windows 11 on Arm 的 x64 模拟；更老的 ARM Windows 可能需要自行安装原生引擎。
- Windows 安装包按架构区分：x64 用 `windows-x86_64`，Windows on Arm 用 `windows-arm64`；安装器会拒绝不匹配的机型。装错架构启动会报 `0xc000007b`。
- Windows 包自带对应的 `vcruntime140.dll`（x64 另带 `vcruntime140_1.dll`），不要求系统预装 Visual C++ 运行库。
- 应用内更新只认 GitHub Releases；macOS 自替换仍受 Gatekeeper 限制，第一次打开新版本可能需要右键 → 打开。
- 内置 fetch 引擎与 HLS/DASH 分片不支持应用内代理，只跟随系统代理。
- 需要登录态的网盘必须自己提供直链和 Cookie，本应用不替你做鉴权或绕过分享限制。
- HLS 目前取主列表里码率最高的一路；多音轨、字幕轨没有单独合并。
- 调度器是「每天的起止窗口」，不是 FDM 那样可编排多条独立任务。
- 未包含 FDM 的远程控制、站点探索器 / HTML 抓取、下载后转码（这些需要额外服务或 ffmpeg）。
- 只有桌面能跑外部引擎；iOS / Android 构建会因为无法调用进程而退回内置引擎。

## 许可

应用代码是 MIT。随包分发的 `aria2c` 是 GPLv2，TLS 依赖是 OpenSSL：源码见 <https://github.com/aria2/aria2>，`vendor/aria2/COPYING` 与 `vendor/aria2/LICENSE.OpenSSL` 随包分发，设置 → 关于 里也能打开。
