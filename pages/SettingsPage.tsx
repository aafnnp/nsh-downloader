import { Scroll, signal, Text, View } from "nsh";
import { AlertDialog, Button, Input, Switch } from "nsh/base";
import type { Settings } from "../model";
import { defaultDownloadDir, ensureDir, openDownloaded, prettyPath } from "../lib/paths";
import { normalizeProxy } from "../lib/urls";
import {
  clearAll,
  clearFinished,
  engineInfo,
  engineScan,
  items,
  notify,
  rescanEngines,
  settings,
  updateSettings,
} from "../store";
import { Segmented, SettingRow, SectionTitle } from "../components/Segmented";

const CONCURRENCY = [1, 2, 3, 4, 6].map((value) => ({ id: String(value), label: String(value) }));
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

const PROXIES = [
  { id: "", label: "直连" },
  { id: "http://127.0.0.1:7890", label: "Clash" },
  { id: "socks5://127.0.0.1:1080", label: "socks5" },
];

export function SettingsPage() {
  const limit = signal(String(settings().limitKb));
  // Kept as typed: a half-typed address is not something to correct while the user types.
  const proxy = signal(settings().proxy);
  const proxyOk = () => !proxy().trim() || normalizeProxy(proxy()) !== "";

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

  const useDefaultDir = async () => {
    updateSettings({ dir: defaultDownloadDir() });
    notify(`保存目录：${prettyPath(defaultDownloadDir())}`);
  };

  return (
    <Scroll class="flex-1">
      <SectionTitle text="下载目录" />
      <View class="border-y border-border bg-card">
        <SettingRow title="保存位置" detail={prettyPath(settings().dir)}>
          <Button onPress={() => void useDefaultDir()} class="rounded-(--radius) border border-border px-3 py-1.5 active:opacity-60">
            <Text class="text-[11px] text-foreground">恢复默认</Text>
          </Button>
          <Button
            onPress={() => {
              void ensureDir(settings().dir).then(() => openDownloaded(settings().dir));
            }}
            class="rounded-(--radius) border border-border px-3 py-1.5 active:opacity-60"
          >
            <Text class="text-[11px] text-foreground">打开</Text>
          </Button>
        </SettingRow>
        <View class="px-5 py-3">
          <Input
            value={settings().dir}
            onChange={(event) => updateSettings({ dir: event.value })}
            autoCapitalize="none"
            class="rounded-(--radius) border border-input bg-background px-3 py-2 text-[12px] text-foreground"
          />
        </View>
      </View>

      <SectionTitle text="传输" />
      <View class="border-y border-border bg-card">
        <SettingRow title="同时下载" detail="最多几个任务同时运行">
          <Segmented
            options={CONCURRENCY}
            value={String(settings().maxConcurrent)}
            onSelect={(id) => updateSettings({ maxConcurrent: Number(id) })}
          />
        </SettingRow>
        <SettingRow title="单文件线程" detail="aria2c 的多连接数；curl 与内置引擎只用 1 个">
          <Segmented
            options={CONNECTIONS}
            value={String(settings().connections)}
            onSelect={(id) => updateSettings({ connections: Number(id) })}
          />
        </SettingRow>
        <SettingRow title="限速" detail="每个文件的上限，0 表示不限速">
          <Input
            value={limit()}
            onChange={(event) => {
              const text = event.value.replace(/[^0-9]/g, "");
              limit.set(text);
              updateSettings({ limitKb: Number(text || 0) });
            }}
            onSubmit={(event) => limit.set(event.text.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            placeholder="0"
            class="w-20 rounded-(--radius) border border-input bg-background px-2.5 py-1.5 text-[12px] text-foreground"
          />
          <Text class="text-[11px] text-muted-foreground">KB/s</Text>
        </SettingRow>
        <View class="flex-row items-center gap-4 border-b border-border px-5 py-3">
          <View class="flex-1 gap-0.5">
            <Text class="text-[13px] font-medium text-foreground">代理</Text>
            <Text class="text-[11px] text-muted-foreground">
              aria2c 与 curl 都走它；留空直连。HLS/DASH 分片用系统网络。
            </Text>
          </View>
          <Input
            testID="proxy-input"
            value={proxy()}
            onChange={(event) => {
              proxy.set(event.value);
              updateSettings({ proxy: event.value });
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://127.0.0.1:7890"
            class="w-56 rounded-(--radius) border border-input bg-background px-2.5 py-1.5 font-mono text-[11px] text-foreground"
          />
          <Segmented
            options={PROXIES}
            value={proxy()}
            onSelect={(id) => {
              proxy.set(id);
              updateSettings({ proxy: id });
            }}
          />
        </View>
        <If when={!proxyOk()}>
          <View class="px-5 pb-2">
            <Text class="text-[11px] text-destructive">地址看不出端口，下载时会退回直连。</Text>
          </View>
        </If>
        <SettingRow title="下载引擎" detail="自动会用 aria2c → curl → 内置依次回退">
          <Segmented
            options={ENGINES}
            value={settings().engine}
            onSelect={(id) => updateSettings({ engine: id as Settings["engine"] })}
          />
        </SettingRow>
      </View>

      <SectionTitle text="行为" />
      <View class="border-y border-border bg-card">
        <SettingRow title="监听剪贴板" detail="复制链接后自动加入队列（每 2 秒检查一次）">
          <Switch
            checked={settings().watchClipboard}
            onChange={(event) => updateSettings({ watchClipboard: event.checked })}
            trackClass="w-10 rounded-(--radius-pill) bg-track p-0.5 transition-colors checked:bg-primary"
            thumbClass="size-4 rounded-full bg-card transition-transform checked:translate-x-4"
          />
        </SettingRow>
        <SettingRow title="添加后自动开始" detail="关闭时新任务先进入暂停状态">
          <Switch
            checked={settings().autoStart}
            onChange={(event) => updateSettings({ autoStart: event.checked })}
            trackClass="w-10 rounded-(--radius-pill) bg-track p-0.5 transition-colors checked:bg-primary"
            thumbClass="size-4 rounded-full bg-card transition-transform checked:translate-x-4"
          />
        </SettingRow>
        <SettingRow title="外观" detail="浅色、深色，或跟随系统">
          <Segmented
            options={APPEARANCE}
            value={settings().appearance}
            onSelect={(id) => updateSettings({ appearance: id as Settings["appearance"] })}
          />
        </SettingRow>
      </View>

      <SectionTitle text="引擎状态" />
      <View class="border-y border-border bg-card">
        <SettingRow title="aria2c" detail={engineInfo().aria2 ? engineInfo().aria2Version : "未安装 · brew install aria2"}>
          <Text class={engineInfo().aria2 ? "text-[11px] text-success" : "text-[11px] text-muted-foreground"}>
            {engineInfo().aria2 ? "可用" : "缺失"}
          </Text>
        </SettingRow>
        <SettingRow title="磁力链接" detail={engineInfo().aria2 ? "aria2c 会读取种子并下载，完成后做种时间 0" : "需要 aria2c：brew install aria2"}>
          <Text class={engineInfo().aria2 ? "text-[11px] text-success" : "text-[11px] text-warning"}>
            {engineInfo().aria2 ? "可用" : "不可用"}
          </Text>
        </SettingRow>
        <SettingRow title="curl" detail={engineInfo().curl ? engineInfo().curlVersion : "系统里没有 curl"}>
          <Text class={engineInfo().curl ? "text-[11px] text-success" : "text-[11px] text-muted-foreground"}>
            {engineInfo().curl ? "可用" : "缺失"}
          </Text>
        </SettingRow>
        <SettingRow title="重新检测" detail="安装新引擎后点一次">
          <Button
            disabled={engineScan()}
            onPress={() => void rescanEngines().then(() => notify(engineInfo().aria2 ? "aria2c 已就绪" : "只有 curl / 内置引擎"))}
            class="rounded-(--radius) border border-border px-3 py-1.5 active:opacity-60 disabled:opacity-40"
          >
            <Text class="text-[11px] text-foreground">{engineScan() ? "检测中…" : "检测"}</Text>
          </Button>
        </SettingRow>
      </View>

      <SectionTitle text="数据" />
      <View class="border-y border-border bg-card">
        <SettingRow title="清除已完成" detail="只移除列表里的记录，文件保留">
          <Button
            onPress={() => {
              const removed = clearFinished();
              notify(removed > 0 ? `已清除 ${removed} 条记录` : "没有可清除的记录");
            }}
            class="rounded-(--radius) border border-border px-3 py-1.5 active:opacity-60"
          >
            <Text class="text-[11px] text-foreground">清除</Text>
          </Button>
        </SettingRow>
        <SettingRow title="清空列表" detail={`${items().length} 条记录`}>
          <Button onPress={() => void confirmClear()} class="rounded-(--radius) border border-destructive px-3 py-1.5 active:opacity-60">
            <Text class="text-[11px] text-destructive">清空</Text>
          </Button>
        </SettingRow>
      </View>

      <View class="gap-1 px-5 py-5">
        <Text class="text-[10px] font-semibold text-muted-foreground">关于</Text>
        <Text class="text-[11px] text-muted-foreground">
          Downloader 1.0.0 · 用 Native Shell 的 TSX 写成，界面是各平台的原生控件。
        </Text>
        <Text class="text-[11px] text-muted-foreground">
          浏览器扩展在仓库的 extension/ 目录，安装后可从网页把媒体地址发到剪贴板，本应用会自动收下。
        </Text>
      </View>
    </Scroll>
  );
}
