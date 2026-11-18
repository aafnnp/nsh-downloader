import { Scroll, signal, Text, type JSX, View, windowSize } from "nsh";
import { AlertDialog, Button, Dialog, Input, Switch } from "nsh/base";
import { bundledAria2LicensePath, bundledAria2SslLicensePath } from "../lib/aria2";
import { defaultDownloadDir, openDownloaded, prettyPath } from "../lib/paths";
import { normalizeProxy } from "../lib/urls";
import {
  checkUpdates,
  currentBuild,
  currentVersion,
  installUpdate,
  openUpdatePage,
  updateApp,
  updateHint,
  updateMessage,
  updatePhase,
  updateProgress,
  updaterSupported,
} from "../lib/update";
import {
  clearAll,
  clearFinished,
  effectiveLimitKb,
  engineInfo,
  engineScan,
  importClipboard,
  items,
  notify,
  rescanEngines,
  schedulerState,
  settings,
  updateCategoryDir,
  updateSettings,
} from "../store";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  validClock,
  type SpeedMode,
} from "../model";

export type SettingsSection =
  | "general"
  | "downloads"
  | "categories"
  | "network"
  | "scheduler"
  | "browser"
  | "about";

export interface SettingsDialogProps {
  initialSection?: SettingsSection;
  onOpenChange: (open: boolean) => void;
}

const SECTIONS: { id: SettingsSection; label: string; glyph: string }[] = [
  { id: "general", label: "常规", glyph: "⚙" },
  { id: "downloads", label: "下载", glyph: "⇩" },
  { id: "categories", label: "分类目录", glyph: "▤" },
  { id: "network", label: "网络与引擎", glyph: "⇄" },
  { id: "scheduler", label: "调度器", glyph: "◷" },
  { id: "browser", label: "浏览器集成", glyph: "◎" },
  { id: "about", label: "关于", glyph: "ⓘ" },
];

const CONCURRENCY = [1, 2, 3, 4, 6, 8].map((value) => ({ id: String(value), label: String(value) }));
const CONNECTIONS = [1, 4, 8, 16].map((value) => ({ id: String(value), label: String(value) }));
const ENGINES = [
  { id: "auto", label: "自动" },
  { id: "aria2", label: "aria2c" },
  { id: "curl", label: "curl" },
  { id: "js", label: "内置" },
];
const APPEARANCE = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
];
const SPEED_MODES: { id: SpeedMode; label: string }[] = [
  { id: "unlimited", label: "不限" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "custom", label: "自定义" },
];
const PROXIES = [
  { id: "", label: "直连" },
  { id: "http://127.0.0.1:7890", label: "Clash" },
  { id: "socks5://127.0.0.1:1080", label: "socks5" },
];
const DAYS = ["日", "一", "二", "三", "四", "五", "六"];

function Segmented(props: { options: { id: string; label: string }[]; value: string; onSelect: (id: string) => void }) {
  return (
    <View class="flex-row gap-0.5 rounded-(--radius) border border-border bg-background p-0.5">
      <Each of={props.options} key={(option) => option.id}>
        {(option) => (
          <Button
            onPress={() => props.onSelect(option().id)}
            accessibilityLabel={option().label}
            class={
              props.value === option().id
                ? "rounded-[4px] bg-primary px-2 py-0.5"
                : "rounded-[4px] px-2 py-0.5 hover:bg-muted active:opacity-60"
            }
          >
            <Text class={props.value === option().id ? "text-[10px] font-medium text-primary-foreground" : "text-[10px] text-muted-foreground"}>
              {option().label}
            </Text>
          </Button>
        )}
      </Each>
    </View>
  );
}

function Field(props: { title: string; detail: string; children?: JSX.Element }) {
  return (
    <View class="flex-row items-center gap-4 border-b border-border px-4 py-2.5">
      <View class="flex-1 gap-0.5">
        <Text class="text-[12px] font-medium text-foreground">{props.title}</Text>
        <Text class="text-[10px] text-muted-foreground">{props.detail}</Text>
      </View>
      <View class="flex-row items-center gap-2">{props.children}</View>
    </View>
  );
}

function Group(props: { title: string; children?: JSX.Element }) {
  return (
    <View class="gap-0">
      <View class="bg-raised px-4 py-1">
        <Text class="text-[9px] font-semibold tracking-wide text-muted-foreground">{props.title}</Text>
      </View>
      <View class="border-y border-border bg-card">{props.children}</View>
    </View>
  );
}

function Toggle(props: { testID?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Switch
      testID={props.testID}
      checked={props.checked}
      onChange={(event) => props.onChange(event.checked)}
      trackClass="w-8 rounded-(--radius-pill) bg-track p-0.5 transition-colors checked:bg-primary"
      thumbClass="size-3 rounded-full bg-card transition-transform checked:translate-x-3.5"
    />
  );
}

async function openBundledLicense(which: "aria2" | "openssl") {
  const path = which === "openssl" ? await bundledAria2SslLicensePath() : await bundledAria2LicensePath();
  if (!path) {
    notify(`这个构建没有附带 ${which === "openssl" ? "OpenSSL" : "aria2c"} 许可证`, "error");
    return;
  }
  await openDownloaded(path);
}

/** The popup fills the layer, and its one card child is centered by the layer's flexbox. */
function dialogLayer() {
  return {
    position: "absolute" as const,
    left: 0,
    top: 0,
    width: "100%" as const,
    height: "100%" as const,
    pointerEvents: "box-none" as const,
  };
}

export function SettingsDialog(props: SettingsDialogProps) {
  const section = signal<SettingsSection>(props.initialSection ?? "general");
  const startDraft = signal(settings().scheduler.start);
  const stopDraft = signal(settings().scheduler.stop);
  const dirDraft = signal(settings().dir);

  const applyTime = (which: "start" | "stop") => {
    const value = (which === "start" ? startDraft() : stopDraft()).trim();
    if (!validClock(value)) {
      notify("时间要写成 HH:MM，例如 09:30", "error");
      startDraft.set(settings().scheduler.start);
      stopDraft.set(settings().scheduler.stop);
      return;
    }
    updateSettings(
      which === "start" ? { scheduler: { start: value } } : { scheduler: { stop: value } },
    );
  };

  const applyDir = () => {
    const value = dirDraft().trim();
    if (!value) {
      dirDraft.set(settings().dir);
      return;
    }
    updateSettings({ dir: value });
  };

  const confirmClear = async () => {
    const { action } = await AlertDialog.show({
      title: "清空下载列表？",
      description: "列表会清空，已下载的文件留在磁盘上。",
      actions: [
        { id: "cancel", label: "取消", role: "cancel" },
        { id: "clear", label: "清空", role: "destructive" },
      ],
    });
    if (action !== "clear") return;
    clearAll();
    notify("列表已清空");
  };

  const toggleDay = (day: number) => {
    const current = settings().scheduler.days;
    const days = current.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : current;
    const next = days.includes(day) ? days.filter((entry) => entry !== day) : [...days, day].sort();
    updateSettings({ scheduler: { days: next.length === 7 ? [] : next } });
  };

  const limitText = () => String(settings().limitKb);

  return (
    <Dialog
      open
      onOpenChange={(event) => props.onOpenChange(event.open)}
      animation="fade"
      backdropClass="bg-black/40"
      class="items-center justify-center p-4"
      style={dialogLayer()}
    >
      <View class="w-[760px] gap-0 rounded-(--radius-card) border border-border bg-popover p-0">
        <View class="flex-row items-center gap-2 border-b border-border px-4 py-2.5">
          <Text class="flex-1 text-[14px] font-semibold text-popover-foreground">设置</Text>
          <Button
            testID="settings-close"
            onPress={() => props.onOpenChange(false)}
            accessibilityLabel="关闭设置"
            class="rounded-(--radius) px-2 py-1 hover:bg-muted active:opacity-60"
          >
            <Text class="text-[12px] text-muted-foreground">✕</Text>
          </Button>
        </View>

        <View class="flex-row" style={{ height: Math.max(320, Math.min(520, windowSize().height - 140)) }}>
          <View class="w-40 gap-0.5 border-r border-border bg-raised p-2">
            <Each of={SECTIONS} key={(entry) => entry.id}>
              {(entry) => (
                <Button
                  testID={`settings-nav-${entry().id}`}
                  onPress={() => section.set(entry().id)}
                  class={
                    section() === entry().id
                      ? "flex-row items-center gap-2 rounded-(--radius) border-l-2 border-primary bg-accent px-2 py-1.5"
                      : "flex-row items-center gap-2 rounded-(--radius) border-l-2 border-transparent px-2 py-1.5 hover:bg-muted active:opacity-60"
                  }
                >
                  <Text class={section() === entry().id ? "w-4 text-[11px] text-primary" : "w-4 text-[11px] text-muted-foreground"}>
                    {entry().glyph}
                  </Text>
                  <Text
                    class={
                      section() === entry().id
                        ? "flex-1 text-[11px] font-medium text-accent-foreground"
                        : "flex-1 text-[11px] text-foreground"
                    }
                  >
                    {entry().label}
                  </Text>
                </Button>
              )}
            </Each>
          </View>

          <Scroll class="flex-1">
            <If when={section() === "general"}>
              <View class="gap-3 py-3">
                <Group title="外观">
                  <Field title="主题" detail="浅色、深色，或跟随系统">
                    <Segmented
                      options={APPEARANCE}
                      value={settings().appearance}
                      onSelect={(id) => updateSettings({ appearance: id as "system" | "light" | "dark" })}
                    />
                  </Field>
                </Group>

                <Group title="默认目录">
                  <View class="gap-1.5 px-4 py-2.5">
                    <View class="flex-row items-center gap-2">
                      <Input
                        testID="settings-dir"
                        value={dirDraft()}
                        onChange={(event) => dirDraft.set(event.value)}
                        onSubmit={applyDir}
                        onBlur={applyDir}
                        autoCapitalize="none"
                        placeholder={prettyPath(defaultDownloadDir())}
                        class="flex-1 rounded-(--radius) border border-input bg-background px-2.5 py-1.5 text-[11px] text-foreground"
                      />
                      <Button
                        onPress={() => {
                          updateSettings({ dir: defaultDownloadDir() });
                          dirDraft.set(defaultDownloadDir());
                        }}
                        class="rounded-(--radius) border border-border px-2.5 py-1.5 hover:bg-muted active:opacity-60"
                      >
                        <Text class="text-[10px] text-foreground">恢复默认</Text>
                      </Button>
                    </View>
                    <Text class="text-[9px] text-muted-foreground">当前：{prettyPath(settings().dir)}</Text>
                  </View>
                  <Field title="按分类自动归档" detail="把视频、音乐、文档等放进各自的子文件夹">
                    <Toggle
                      checked={settings().organizeByCategory}
                      onChange={(checked) => updateSettings({ organizeByCategory: checked })}
                    />
                  </Field>
                </Group>

                <Group title="通知">
                  <Field title="完成时提示" detail="下载完成时在状态栏显示一条提示">
                    <Toggle
                      checked={settings().notifyOnComplete}
                      onChange={(checked) => updateSettings({ notifyOnComplete: checked })}
                    />
                  </Field>
                </Group>
              </View>
            </If>

            <If when={section() === "downloads"}>
              <View class="gap-3 py-3">
                <Group title="队列">
                  <Field title="同时下载" detail="最多几个任务同时运行">
                    <Segmented
                      options={CONCURRENCY}
                      value={String(settings().maxConcurrent)}
                      onSelect={(id) => updateSettings({ maxConcurrent: Number(id) })}
                    />
                  </Field>
                  <Field title="单文件线程" detail="aria2c 的多连接数；curl 与内置引擎只用 1 个">
                    <Segmented
                      options={CONNECTIONS}
                      value={String(settings().connections)}
                      onSelect={(id) => updateSettings({ connections: Number(id) })}
                    />
                  </Field>
                </Group>

                <Group title="流量模式">
                  <Field title="模式" detail={`当前全局上限：${effectiveLimitKb() > 0 ? `${effectiveLimitKb()} KB/s` : "不限速"}`}>
                    <Segmented
                      options={SPEED_MODES}
                      value={settings().speedMode}
                      onSelect={(id) => updateSettings({ speedMode: id as SpeedMode })}
                    />
                  </Field>
                  <Field title="自定义上限" detail="仅在上面的模式选「自定义」时生效，0 表示不限">
                    <Input
                      value={limitText()}
                      onChange={(event) => {
                        const digits = event.value.replace(/[^0-9]/g, "");
                        updateSettings({ limitKb: Number(digits || 0) });
                      }}
                      keyboardType="number-pad"
                      placeholder="0"
                      class="w-20 rounded-(--radius) border border-input bg-background px-2 py-1 text-[10px] text-foreground"
                    />
                    <Text class="text-[10px] text-muted-foreground">KB/s</Text>
                  </Field>
                </Group>

                <Group title="行为">
                  <Field title="添加后自动开始" detail="关闭时新任务先进入暂停状态">
                    <Toggle checked={settings().autoStart} onChange={(checked) => updateSettings({ autoStart: checked })} />
                  </Field>
                  <Field title="监听剪贴板" detail="复制链接后自动加入队列（每 2 秒检查一次）">
                    <Toggle
                      checked={settings().watchClipboard}
                      onChange={(checked) => updateSettings({ watchClipboard: checked })}
                    />
                  </Field>
                </Group>

                <Group title="数据">
                  <Field title="清除已完成" detail="只移除列表里的完成与失败记录，文件保留">
                    <Button
                      onPress={() => {
                        const removed = clearFinished();
                        notify(removed > 0 ? `已清除 ${removed} 条记录` : "没有可清除的记录");
                      }}
                      class="rounded-(--radius) border border-border px-2.5 py-1 hover:bg-muted active:opacity-60"
                    >
                      <Text class="text-[10px] text-foreground">清除</Text>
                    </Button>
                  </Field>
                  <Field title="清空列表" detail={`${items().length} 条记录`}>
                    <Button onPress={() => void confirmClear()} class="rounded-(--radius) border border-destructive px-2.5 py-1 hover:bg-muted active:opacity-60">
                      <Text class="text-[10px] text-destructive">清空</Text>
                    </Button>
                  </Field>
                </Group>
              </View>
            </If>

            <If when={section() === "categories"}>
              <View class="gap-3 py-3">
                <Group title="分类文件夹">
                  <View class="px-4 py-2">
                    <Text class="text-[10px] text-muted-foreground">
                      留空表示放在主目录；填了路径就固定放那里。打开「按分类自动归档」后，会使用主目录下的分类子文件夹。
                    </Text>
                  </View>
                  <Each of={CATEGORY_ORDER} key={(category) => category}>
                    {(category) => (
                      <View class="flex-row items-center gap-2 border-t border-border px-4 py-2">
                        <View class={`size-6 items-center justify-center rounded-[4px] ${CATEGORY_META[category()].tone}`}>
                          <Text class="text-[7px] font-bold tracking-wide">{CATEGORY_META[category()].badge}</Text>
                        </View>
                        <Text class="w-12 text-[11px] text-foreground">{CATEGORY_META[category()].label}</Text>
                        <Input
                          value={settings().categoryDirs[category()] ?? ""}
                          onChange={(event) => updateCategoryDir(category(), event.value)}
                          autoCapitalize="none"
                          placeholder={`跟随主目录${settings().organizeByCategory ? ` / ${CATEGORY_META[category()].folder}` : ""}`}
                          class="flex-1 rounded-(--radius) border border-input bg-background px-2.5 py-1.5 text-[10px] text-foreground"
                        />
                      </View>
                    )}
                  </Each>
                </Group>
              </View>
            </If>

            <If when={section() === "network"}>
              <View class="gap-3 py-3">
                <Group title="代理">
                  <View class="gap-1.5 px-4 py-2.5">
                    <View class="flex-row items-center gap-2">
                      <Input
                        testID="proxy-input"
                        value={settings().proxy}
                        onChange={(event) => updateSettings({ proxy: event.value })}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="http://127.0.0.1:7890"
                        class="flex-1 rounded-(--radius) border border-input bg-background px-2.5 py-1.5 font-mono text-[10px] text-foreground"
                      />
                      <Segmented
                        options={PROXIES}
                        value={settings().proxy}
                        onSelect={(id) => updateSettings({ proxy: id })}
                      />
                    </View>
                    <Text class="text-[9px] text-muted-foreground">
                      {settings().proxy.trim() && !normalizeProxy(settings().proxy)
                        ? "地址看不出端口，下载时会退回直连。"
                        : "aria2c 与 curl 都走它；留空直连。HLS/DASH 分片用系统网络。"}
                    </Text>
                  </View>
                  <Field title="下载引擎" detail="自动会用 aria2c → curl → 内置依次回退">
                    <Segmented
                      options={ENGINES}
                      value={settings().engine}
                      onSelect={(id) => updateSettings({ engine: id as "auto" | "aria2" | "curl" | "js" })}
                    />
                  </Field>
                </Group>

                <Group title="引擎状态">
                  <Field
                    title="aria2c"
                    detail={
                      engineInfo().aria2
                        ? `${engineInfo().aria2Version} · ${engineInfo().aria2Source === "bundled" ? "随应用打包" : "系统安装"}`
                        : "未安装 · brew install aria2，或运行 tools/prepare-aria2.sh"
                    }
                  >
                    <Text class={engineInfo().aria2 ? "text-[10px] text-success" : "text-[10px] text-muted-foreground"}>
                      {engineInfo().aria2 ? "可用" : "缺失"}
                    </Text>
                  </Field>
                  <Field title="磁力与种子" detail={engineInfo().aria2 ? "aria2c 读取种子并下载，完成后做种时间 0" : "需要 aria2c：brew install aria2"}>
                    <Text class={engineInfo().aria2 ? "text-[10px] text-success" : "text-[10px] text-warning"}>
                      {engineInfo().aria2 ? "可用" : "不可用"}
                    </Text>
                  </Field>
                  <Field title="curl" detail={engineInfo().curl ? engineInfo().curlVersion : "系统里没有 curl"}>
                    <Text class={engineInfo().curl ? "text-[10px] text-success" : "text-[10px] text-muted-foreground"}>
                      {engineInfo().curl ? "可用" : "缺失"}
                    </Text>
                  </Field>
                  <Field title="重新检测" detail="安装新引擎后点一次">
                    <Button
                      disabled={engineScan()}
                      onPress={() =>
                        void rescanEngines().then(() =>
                          notify(engineInfo().aria2 ? "aria2c 已就绪" : "只有 curl / 内置引擎"),
                        )
                      }
                      class="rounded-(--radius) border border-border px-2.5 py-1 hover:bg-muted active:opacity-60 disabled:opacity-40"
                    >
                      <Text class="text-[10px] text-foreground">{engineScan() ? "检测中…" : "检测"}</Text>
                    </Button>
                  </Field>
                </Group>
              </View>
            </If>

            <If when={section() === "scheduler"}>
              <View class="gap-3 py-3">
                <Group title="定时下载">
                  <Field title="启用调度器" detail="在设定的时间自动开始或暂停全部下载">
                    <Toggle
                      testID="scheduler-enabled"
                      checked={settings().scheduler.enabled}
                      onChange={(checked) => updateSettings({ scheduler: { enabled: checked } })}
                    />
                  </Field>
                  <View class="flex-row items-center gap-2 border-b border-border px-4 py-2.5">
                    <View class="flex-1 gap-0.5">
                      <Text class="text-[12px] font-medium text-foreground">开始 / 停止时间</Text>
                      <Text class="text-[10px] text-muted-foreground">
                        当前状态：
                        {schedulerState() === "active" ? "运行中" : schedulerState() === "waiting" ? "等待中" : "已关闭"}
                      </Text>
                    </View>
                    <Input
                      testID="scheduler-start"
                      value={startDraft()}
                      onChange={(event) => startDraft.set(event.value)}
                      onSubmit={() => applyTime("start")}
                      onBlur={() => applyTime("start")}
                      placeholder="09:00"
                      class="w-16 rounded-(--radius) border border-input bg-background px-2 py-1 text-center text-[10px] text-foreground"
                    />
                    <Text class="text-[10px] text-muted-foreground">到</Text>
                    <Input
                      testID="scheduler-stop"
                      value={stopDraft()}
                      onChange={(event) => stopDraft.set(event.value)}
                      onSubmit={() => applyTime("stop")}
                      onBlur={() => applyTime("stop")}
                      placeholder="23:00"
                      class="w-16 rounded-(--radius) border border-input bg-background px-2 py-1 text-center text-[10px] text-foreground"
                    />
                  </View>
                  <View class="gap-1.5 px-4 py-2.5">
                    <Text class="text-[10px] font-medium text-foreground">运行日</Text>
                    <View class="flex-row gap-1">
                      <Each of={DAYS} key="index">
                        {(label, index) => (
                          <Button
                            onPress={() => toggleDay(index())}
                            class={
                              settings().scheduler.days.includes(index()) || settings().scheduler.days.length === 0
                                ? "size-7 items-center justify-center rounded-full bg-accent"
                                : "size-7 items-center justify-center rounded-full border border-border hover:bg-muted active:opacity-60"
                            }
                          >
                            <Text class="text-[10px] text-accent-foreground">{label()}</Text>
                          </Button>
                        )}
                      </Each>
                    </View>
                    <Text class="text-[9px] text-muted-foreground">
                      {settings().scheduler.days.length === 0 ? "每天都运行（当前）" : "只在选中的日子运行"}
                    </Text>
                  </View>
                </Group>
              </View>
            </If>

            <If when={section() === "browser"}>
              <View class="gap-3 py-3">
                <Group title="浏览器扩展">
                  <View class="gap-2 px-4 py-3">
                    <Text class="text-[11px] text-foreground">把网页里的视频、音频、压缩包地址送到下载器：</Text>
                    <Text class="text-[10px] text-muted-foreground">1. 打开浏览器扩展管理页，开启开发者模式；</Text>
                    <Text class="text-[10px] text-muted-foreground">2. 选择「加载已解压的扩展程序」，指向仓库里的 extension/ 目录；</Text>
                    <Text class="text-[10px] text-muted-foreground">3. 在网页上正常播放媒体，扩展会记录 m3u8 / mp4 / mp3 等响应；</Text>
                    <Text class="text-[10px] text-muted-foreground">4. 点扩展图标勾选地址并复制，下载器会在约 2 秒后自动收下。</Text>
                    <View class="flex-row items-center gap-2 pt-1">
                      <Button
                        onPress={() =>
                          void importClipboard().then((result) => notify(result.message, result.ok ? "success" : "error"))
                        }
                        class="rounded-(--radius) bg-primary px-3 py-1.5 active:opacity-80"
                      >
                        <Text class="text-[10px] font-medium text-primary-foreground">从剪贴板导入</Text>
                      </Button>
                      <Text class="text-[9px] text-muted-foreground">
                        当前剪贴板监听：{settings().watchClipboard ? "开启" : "关闭"}
                      </Text>
                    </View>
                  </View>
                </Group>
              </View>
            </If>

            <If when={section() === "about"}>
              <View class="gap-3 py-3">
                <Group title="Downloader">
                  <View class="gap-1.5 px-4 py-3">
                    <Text class="text-[12px] font-medium text-foreground">Downloader {currentVersion()}</Text>
                    <Text class="text-[10px] text-muted-foreground">
                      用 Native Shell 的 TSX 写成，界面是各平台的原生控件；布局与功能参照 Free Download Manager。
                    </Text>
                    <Text class="text-[10px] text-muted-foreground">
                      多线程、断点续传、磁力与种子、HLS/DASH、分类归档、优先级队列、限速模式与定时任务。
                    </Text>
                    <Text class="text-[10px] text-muted-foreground">MIT License。</Text>
                  </View>
                </Group>

                <Group title="更新">
                  <Field
                    title="当前版本"
                    detail={`${currentVersion()}${currentBuild() === null ? "" : `（build ${currentBuild()}）`} · ${updateHint()}`}
                  >
                    <Button
                      testID="about-check-update"
                      disabled={
                        !updaterSupported() ||
                        updatePhase() === "checking" ||
                        updatePhase() === "downloading" ||
                        updatePhase() === "installing"
                      }
                      onPress={() => void checkUpdates()}
                      class="rounded-(--radius) border border-border px-2.5 py-1 hover:bg-muted active:opacity-60 disabled:opacity-40"
                    >
                      <Text class="text-[10px] text-foreground">
                        {updatePhase() === "checking" ? "检查中…" : "检查更新"}
                      </Text>
                    </Button>
                  </Field>

                  <View class="gap-2 px-4 py-3">
                    <Text testID="about-update-status" class="text-[10px] text-muted-foreground">
                      {updateMessage() || updateHint()}
                    </Text>

                    <If when={updateApp() !== null}>
                      <View class="gap-2 rounded-(--radius) border border-border bg-raised p-2.5">
                        <Text class="text-[11px] font-medium text-foreground">
                          新版本 {updateApp()?.version}
                        </Text>
                        <If when={!!updateApp()?.notes}>
                          <Scroll class="flex-none" contentClass="gap-1" style={{ maxHeight: 120 }}>
                            <Text class="text-[10px] text-muted-foreground">{updateApp()?.notes ?? ""}</Text>
                          </Scroll>
                        </If>
                        <If when={updatePhase() === "downloading" || updatePhase() === "installing"}>
                          <View class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <View
                              class="h-1.5 rounded-full bg-primary"
                              style={{ width: `${Math.round(updateProgress() * 100)}%` as `${number}%` }}
                            />
                          </View>
                        </If>
                        <View class="flex-row gap-2">
                          <Button
                            testID="about-install-update"
                            disabled={updatePhase() === "downloading" || updatePhase() === "installing"}
                            onPress={() => void installUpdate()}
                            class="rounded-(--radius) bg-primary px-3 py-1.5 active:opacity-80 disabled:opacity-40"
                          >
                            <Text class="text-[10px] font-medium text-primary-foreground">
                              {updatePhase() === "downloading"
                                ? "下载中…"
                                : updatePhase() === "installing"
                                  ? "安装中…"
                                  : updateApp()?.canInstall
                                    ? "下载并安装"
                                    : "前往下载"}
                            </Text>
                          </Button>
                          <Button
                            testID="about-open-release"
                            onPress={() => void openUpdatePage()}
                            class="rounded-(--radius) border border-border px-3 py-1.5 hover:bg-muted active:opacity-60"
                          >
                            <Text class="text-[10px] text-foreground">打开发布页</Text>
                          </Button>
                        </View>
                      </View>
                    </If>
                  </View>
                </Group>

                <Group title="随包组件">
                  <Field
                    title="aria2c"
                    detail={
                      engineInfo().aria2Source === "bundled"
                        ? `内置 ${engineInfo().aria2Version} · GPLv2`
                        : engineInfo().aria2
                          ? `系统安装 ${engineInfo().aria2Version} · GPLv2`
                          : "这个构建没有附带 aria2c"
                    }
                  >
                    <Button
                      onPress={() => void openBundledLicense("aria2")}
                      accessibilityLabel="查看 aria2c 许可证"
                      testID="about-aria2-license"
                      class="rounded-(--radius) border border-border px-2.5 py-1 hover:bg-muted active:opacity-60"
                    >
                      <Text class="text-[10px] text-foreground">查看许可证</Text>
                    </Button>
                  </Field>
                  <Field title="OpenSSL" detail="aria2c 的 TLS 依赖 · OpenSSL License">
                    <Button
                      onPress={() => void openBundledLicense("openssl")}
                      accessibilityLabel="查看 OpenSSL 许可证"
                      testID="about-openssl-license"
                      class="rounded-(--radius) border border-border px-2.5 py-1 hover:bg-muted active:opacity-60"
                    >
                      <Text class="text-[10px] text-foreground">查看许可证</Text>
                    </Button>
                  </Field>
                </Group>
              </View>
            </If>
          </Scroll>
        </View>
      </View>
    </Dialog>
  );
}
