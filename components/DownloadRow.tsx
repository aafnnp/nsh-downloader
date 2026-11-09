import { Text, View } from "nsh";
import { Progress } from "nsh/base";
import { engineLabel } from "../lib/engines";
import { formatBytes, formatEta, formatPercent, formatSpeed, hostOf, percentOf, timeAgo } from "../lib/format";
import { kindBadge, kindColorClass, type Item, type Status } from "../model";
import { describeLink } from "../lib/netdisk";
import { openDownloaded, prettyPath, revealInFolder } from "../lib/paths";
import { notify, pause, remove, resume, retry } from "../store";
import { ActionButton, Pill } from "./ActionButton";

export interface DownloadRowProps {
  item: () => Item;
  expanded: boolean;
  onToggle: () => void;
}

function statusText(status: Status): string {
  switch (status) {
    case "preparing":
      return "解析中";
    case "queued":
      return "排队中";
    case "running":
      return "下载中";
    case "paused":
      return "已暂停";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
  }
}

function statusClass(status: Status): string {
  switch (status) {
    case "running":
      return "bg-primary/12 text-primary";
    case "done":
      return "bg-success/12 text-success";
    case "failed":
      return "bg-destructive/12 text-destructive";
    case "queued":
    case "preparing":
      return "bg-accent text-accent-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function metaLine(item: Item): string {
  const parts: string[] = [item.torrent ? "磁力" : hostOf(item.url)];
  if (item.total > 0) parts.push(formatBytes(item.total));
  else if (item.received > 0) parts.push(formatBytes(item.received));
  if (item.status === "running") {
    parts.push(formatSpeed(item.speed));
    if (item.total > 0 && item.speed > 1) {
      parts.push(`剩余 ${formatEta((item.total - item.received) / item.speed)}`);
    }
    if (item.phase) parts.push(item.phase);
  } else if (item.status === "paused" && item.received > 0) {
    parts.push(`已下载 ${formatPercent(item.received, item.total)}`);
  } else if (item.status === "done") {
    parts.push(timeAgo(item.finishedAt ?? item.createdAt));
  }
  return parts.join(" · ");
}

function engineText(item: Item): string {
  const base = item.engine ? engineLabel(item.engine) : "等待调度";
  return item.playlist ? `${base} · ${item.playlist.toUpperCase()} 分片` : base;
}

export function DownloadRow(props: DownloadRowProps) {
  const item = () => props.item();
  const percent = () => percentOf(item().received, item().total);
  const done = () => item().status === "done";

  const target = () => (item().torrent ? item().dir : `${item().dir}/${item().filename}`);

  const open = async () => {
    await openDownloaded(target());
    notify(`正在打开 ${item().torrent ? "下载目录" : item().filename}`);
  };

  const reveal = async () => {
    await revealInFolder(target());
  };

  return (
    <View class="border-b border-border">
      <View class="flex-row items-center gap-3 px-4 py-3" onPress={props.onToggle}>
        <View class={`size-10 items-center justify-center rounded-(--radius-card) ${kindColorClass(item().kind)}`}>
          <Text class="text-[10px] font-bold tracking-wide">{kindBadge(item().kind)}</Text>
        </View>

        <View class="flex-1 gap-1.5" style={{ minWidth: 0 }}>
          <View class="flex-row items-center gap-2">
            <Text
              class="text-[13px] font-medium text-foreground"
              style={{ flex: 1, numberOfLines: 1, textOverflow: "ellipsis" }}
            >
              {item().filename}
            </Text>
            <Pill text={statusText(item().status)} class={statusClass(item().status)} />
          </View>

          <Text
            class={item().status === "failed" ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}
            style={{ numberOfLines: 1, textOverflow: "ellipsis" }}
          >
            {metaLine(item())}
          </Text>

          <If when={item().status === "running" || item().status === "paused" || item().status === "queued"}>
            <View class="flex-row items-center gap-2">
              <Progress
                value={percent()}
                indeterminate={item().total === 0 && item().status === "running"}
                accessibilityLabel={`${item().filename} 的进度`}
                class="flex-1"
                trackClass="h-1 rounded-(--radius-pill) bg-track overflow-hidden"
                indicatorClass="h-1 rounded-(--radius-pill) bg-primary"
              />
              <Text class="text-[10px] text-muted-foreground" style={{ width: 34, textAlign: "right" }}>
                {formatPercent(item().received, item().total)}
              </Text>
            </View>
          </If>

          <If when={item().status === "failed" && !!item().error}>
            <Text class="text-[11px] text-destructive" style={{ numberOfLines: 2, textOverflow: "ellipsis" }}>
              {item().error}
            </Text>
          </If>
        </View>

        <View class="flex-row items-center gap-0.5">
          <If when={item().status === "running"}>
            <ActionButton label="暂停" hint="暂停下载" onPress={() => pause(item().id)} />
          </If>
          <If when={item().status === "paused" || item().status === "queued"}>
            <ActionButton label="继续" hint="继续下载" tone="primary" onPress={() => resume(item().id)} />
          </If>
          <If when={item().status === "failed"}>
            <ActionButton label="重试" hint="重新下载" tone="primary" onPress={() => retry(item().id)} />
          </If>
          <If when={done()}>
            <ActionButton label="打开" hint={item().torrent ? "打开下载目录" : "打开文件"} onPress={() => void open()} />
            <ActionButton label="目录" hint="在文件夹中显示" onPress={() => void reveal()} />
          </If>
          <ActionButton label="移除" hint="从列表移除" tone="danger" onPress={() => remove(item().id)} />
        </View>
      </View>

      <If when={props.expanded}>
        <View class="gap-1.5 px-4 pt-0 pb-3" style={{ paddingLeft: 68 }}>
          <View class="flex-row gap-2">
            <Text class="w-16 text-[10px] text-muted-foreground">链接</Text>
            <Text class="flex-1 text-[11px] text-foreground" style={{ numberOfLines: 2, textOverflow: "ellipsis" }}>
              {item().url}
            </Text>
          </View>
          <View class="flex-row gap-2">
            <Text class="w-16 text-[10px] text-muted-foreground">保存到</Text>
            <Text class="flex-1 text-[11px] text-foreground">{prettyPath(item().dir)}</Text>
          </View>
          <View class="flex-row gap-2">
            <Text class="w-16 text-[10px] text-muted-foreground">引擎</Text>
            <Text class="flex-1 text-[11px] text-foreground">{engineText(item())}</Text>
          </View>
          <If when={!!describeLink(item().url)}>
            <View class="flex-row gap-2">
              <Text class="w-16 text-[10px] text-muted-foreground">直链</Text>
              <Text class="flex-1 text-[11px] text-muted-foreground" style={{ numberOfLines: 2 }}>
                {describeLink(item().url)?.provider} · {describeLink(item().url)?.note}
              </Text>
            </View>
          </If>
          <View class="flex-row gap-2">
            <Text class="w-16 text-[10px] text-muted-foreground">大小</Text>
            <Text class="flex-1 text-[11px] text-foreground">
              {formatBytes(item().received)} / {item().total > 0 ? formatBytes(item().total) : "未知"}
            </Text>
          </View>
        </View>
      </If>
    </View>
  );
}
