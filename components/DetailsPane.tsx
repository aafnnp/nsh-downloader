import { Clipboard, Scroll, Text, View } from "nsh";
import { Button, Input, Progress } from "nsh/base";
import {
  formatBytes,
  formatEta,
  formatPercent,
  formatSpeed,
  hostOf,
  percentOf,
  timeAgo,
} from "../lib/format";
import { engineLabel } from "../lib/engines";
import { openDownloaded, prettyPath, revealInFolder } from "../lib/paths";
import { confirmRemove } from "../lib/removeTasks";
import {
  notify,
  pause,
  resume,
  retry,
  selectedItem,
  setItemLimit,
  setPriority,
} from "../store";
import {
  CATEGORY_META,
  PRIORITY_ORDER,
  priorityLabel,
  statusLabel,
  statusTone,
  type Item,
} from "../model";

function InfoRow(props: { label: string; value: string; tone?: string }) {
  return (
    <View class="flex-row items-start gap-2 py-0.5">
      <Text class="w-14 text-[10px] text-muted-foreground">{props.label}</Text>
      <Text class={`flex-1 text-[11px] ${props.tone ?? "text-foreground"}`} style={{ numberOfLines: 3, textOverflow: "ellipsis" }}>
        {props.value}
      </Text>
    </View>
  );
}

function engineText(item: Item): string {
  const base = item.engine ? engineLabel(item.engine) : "等待调度";
  return item.playlist ? `${base} · ${item.playlist.toUpperCase()} 分片` : base;
}

function SpeedLimit(props: { item: Item }) {
  return (
    <View class="flex-row items-center gap-1">
      <Input
        value={props.item.limitKb === null ? "" : String(props.item.limitKb)}
        onChange={(event) => {
          const digits = event.value.replace(/[^0-9]/g, "");
          setItemLimit(props.item.id, digits ? Number(digits) : null);
        }}
        keyboardType="number-pad"
        placeholder="跟随全局"
        class="w-20 rounded-(--radius) border border-input bg-background px-1.5 py-0.5 text-[10px] text-foreground"
      />
      <Text class="text-[10px] text-muted-foreground">
        {props.item.limitKb === null ? "KB/s · 全局" : props.item.limitKb === 0 ? "不限速" : "KB/s"}
      </Text>
    </View>
  );
}

function DetailsBody(props: { item: () => Item }) {
  const item = () => props.item();
  const meta = () => CATEGORY_META[item().category];
  const target = () => (item().torrent ? item().dir : `${item().dir}/${item().filename}`);

  return (
    <Scroll class="flex-1">
      <View class="gap-2 p-3">
        <View class="flex-row items-start gap-2">
          <View class={`size-9 items-center justify-center rounded-(--radius-card) ${meta().tone}`}>
            <Text class="text-[9px] font-bold tracking-wide">{meta().badge}</Text>
          </View>
          <View class="flex-1 gap-1" style={{ minWidth: 0 }}>
            <Text class="text-[12px] font-semibold text-foreground" style={{ numberOfLines: 2, textOverflow: "ellipsis" }}>
              {item().filename}
            </Text>
            <View class="flex-row items-center gap-1">
              <View class={`rounded-(--radius-pill) px-1.5 py-0.5 ${statusTone(item().status)}`}>
                <Text class="text-[9px] font-medium">{statusLabel(item().status)}</Text>
              </View>
              <Text class="text-[9px] text-muted-foreground">{meta().label}</Text>
            </View>
          </View>
        </View>

        <View class="gap-1">
          <Progress
            value={percentOf(item().received, item().total)}
            indeterminate={item().total === 0 && item().status === "running"}
            accessibilityLabel={`${item().filename} 的进度`}
            trackClass="h-1.5 rounded-(--radius-pill) bg-track overflow-hidden"
            indicatorClass="h-1.5 rounded-(--radius-pill) bg-primary"
          />
          <View class="flex-row items-center">
            <Text class="flex-1 text-[10px] text-muted-foreground">{formatPercent(item().received, item().total)}</Text>
            <Text class="text-[10px] text-muted-foreground">
              {formatBytes(item().received)} / {item().total > 0 ? formatBytes(item().total) : "未知"}
            </Text>
          </View>
        </View>

        <View class="rounded-(--radius) bg-raised px-2 py-1.5">
          <InfoRow label="来源" value={item().torrent ? "BitTorrent" : hostOf(item().url)} />
          <InfoRow label="速度" value={item().status === "running" ? formatSpeed(item().speed) : "—"} />
          <InfoRow
            label="剩余"
            value={
              item().status === "running" && item().total > 0 && item().speed > 1
                ? formatEta((item().total - item().received) / item().speed)
                : "—"
            }
          />
          <InfoRow label="保存到" value={prettyPath(item().dir)} />
          <InfoRow label="引擎" value={engineText(item())} />
          <InfoRow label="优先级" value={priorityLabel(item().priority)} />
          <InfoRow label="添加" value={timeAgo(item().createdAt)} />
          <If when={item().finishedAt !== null}>
            <InfoRow label="完成" value={timeAgo(item().finishedAt ?? item().createdAt)} />
          </If>
          <If when={!!item().description}>
            <InfoRow label="备注" value={item().description} />
          </If>
        </View>

        <View class="gap-1">
          <Text class="text-[10px] font-medium text-foreground">速度限制</Text>
          <SpeedLimit item={item()} />
        </View>

        <View class="gap-1">
          <Text class="text-[10px] font-medium text-foreground">优先级</Text>
          <View class="flex-row gap-1">
            <Each of={PRIORITY_ORDER} key={(priority) => priority}>
              {(priority) => (
                <Button
                  onPress={() => setPriority(item().id, priority())}
                  class={
                    item().priority === priority()
                      ? "rounded-(--radius) bg-accent px-2 py-0.5"
                      : "rounded-(--radius) px-2 py-0.5 hover:bg-muted active:opacity-60"
                  }
                >
                  <Text
                    class={
                      item().priority === priority()
                        ? "text-[10px] font-medium text-accent-foreground"
                        : "text-[10px] text-muted-foreground"
                    }
                  >
                    {priorityLabel(priority())}
                  </Text>
                </Button>
              )}
            </Each>
          </View>
        </View>

        <View class="gap-1">
          <Text class="text-[10px] font-medium text-foreground">链接</Text>
          <Text class="text-[10px] text-muted-foreground" style={{ numberOfLines: 3, textOverflow: "ellipsis" }}>
            {item().url}
          </Text>
          <Button
            onPress={() => {
              void Clipboard.writeText(item().url);
              notify("链接已复制");
            }}
            class="self-start rounded-(--radius) border border-border px-2 py-0.5 hover:bg-muted active:opacity-60"
          >
            <Text class="text-[10px] text-foreground">复制链接</Text>
          </Button>
        </View>

        <View class="flex-row flex-wrap gap-1 pt-1">
          <If when={item().status === "running"}>
            <Button onPress={() => pause(item().id)} class="rounded-(--radius) border border-border px-2 py-1 hover:bg-muted active:opacity-60">
              <Text class="text-[10px] text-foreground">暂停</Text>
            </Button>
          </If>
          <If when={item().status === "paused" || item().status === "queued" || item().status === "preparing"}>
            <Button onPress={() => resume(item().id)} class="rounded-(--radius) border border-border px-2 py-1 hover:bg-muted active:opacity-60">
              <Text class="text-[10px] text-foreground">继续</Text>
            </Button>
          </If>
          <If when={item().status === "failed"}>
            <Button onPress={() => retry(item().id)} class="rounded-(--radius) border border-border px-2 py-1 hover:bg-muted active:opacity-60">
              <Text class="text-[10px] text-foreground">重试</Text>
            </Button>
          </If>
          <If when={item().status === "done"}>
            <Button onPress={() => void openDownloaded(target())} class="rounded-(--radius) border border-border px-2 py-1 hover:bg-muted active:opacity-60">
              <Text class="text-[10px] text-foreground">打开</Text>
            </Button>
            <Button onPress={() => void revealInFolder(target())} class="rounded-(--radius) border border-border px-2 py-1 hover:bg-muted active:opacity-60">
              <Text class="text-[10px] text-foreground">目录</Text>
            </Button>
          </If>
          <Button
            onPress={() => void confirmRemove([item().id])}
            class="rounded-(--radius) border border-destructive px-2 py-1 hover:bg-muted active:opacity-60"
          >
            <Text class="text-[10px] text-destructive">移除</Text>
          </Button>
        </View>
      </View>
    </Scroll>
  );
}

export function DetailsPane(props: { open: boolean; onClose: () => void }) {
  const item = () => selectedItem();
  return (
    <View
      class={
        props.open
          ? "flex w-64 flex-col border-l border-border bg-card"
          : "hidden w-64 flex-col border-l border-border bg-card 2xl:flex"
      }
    >
      <View class="flex-row items-center gap-2 border-b border-border px-3 py-2">
        <Text class="flex-1 text-[11px] font-semibold text-foreground">详细信息</Text>
        <Button
          onPress={props.onClose}
          accessibilityLabel="关闭详细信息"
          class="rounded-(--radius) px-1.5 py-0.5 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[11px] text-muted-foreground">✕</Text>
        </Button>
      </View>

      <If when={!item()}>
        <View class="flex-1 items-center justify-center px-4">
          <Text class="text-center text-[10px] text-muted-foreground">
            选择一个下载，查看它的链接、分类、引擎和传输详情。
          </Text>
        </View>
      </If>
      <If when={!!item()}>
        <DetailsBody item={() => item() as Item} />
      </If>
    </View>
  );
}
