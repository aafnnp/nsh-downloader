import { Clipboard, Text, View, type ContextMenuEvent, type PressEvent } from "nsh";
import { Button, Checkbox, Progress } from "nsh/base";
import { Menu, isAvailable as desktopMenu, type MenuItem } from "nsh/desktop";
import { formatBytes, formatEta, formatPercent, formatSpeed, hostOf, percentOf } from "../lib/format";
import { openDownloaded, revealInFolder } from "../lib/paths";
import {
  pause,
  remove,
  resume,
  retry,
  selectOnly,
  setItemLimit,
  setPriority,
  startNow,
  toggleSelect,
} from "../store";
import {
  CATEGORY_META,
  PRIORITY_ORDER,
  priorityLabel,
  statusLabel,
  statusTone,
  type Item,
  type Priority,
} from "../model";

export interface DownloadRowProps {
  item: () => Item;
  selected: boolean;
  onToggleSelect: () => void;
  onSelect: (additive: boolean) => void;
  onRemove: () => void;
}

const SPEED_CHOICES: { label: string; value: number | null }[] = [
  { label: "跟随全局", value: null },
  { label: "不限速", value: 0 },
  { label: "64 KB/s", value: 64 },
  { label: "256 KB/s", value: 256 },
  { label: "1 MB/s", value: 1024 },
  { label: "4 MB/s", value: 4096 },
];

function priorityGlyph(priority: Priority): string {
  switch (priority) {
    case "high":
      return "↑";
    case "low":
      return "↓";
    default:
      return "";
  }
}

function rowActions(item: Item, props: DownloadRowProps) {
  return (
    <View class="flex-row items-center gap-0.5">
      <If when={item.status === "running"}>
        <Button
          accessibilityLabel={`暂停 ${item.filename}`}
          onPress={() => pause(item.id)}
          class="rounded-(--radius) px-1.5 py-1 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[11px] text-muted-foreground">⏸</Text>
        </Button>
      </If>
      <If when={item.status === "paused" || item.status === "queued" || item.status === "preparing"}>
        <Button
          accessibilityLabel={`继续 ${item.filename}`}
          onPress={() => resume(item.id)}
          class="rounded-(--radius) px-1.5 py-1 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[11px] text-primary">▶</Text>
        </Button>
      </If>
      <If when={item.status === "failed"}>
        <Button
          accessibilityLabel={`重试 ${item.filename}`}
          onPress={() => retry(item.id)}
          class="rounded-(--radius) px-1.5 py-1 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[11px] text-primary">⟳</Text>
        </Button>
      </If>
      <If when={item.status === "done"}>
        <Button
          accessibilityLabel={`打开 ${item.filename}`}
          onPress={() => void openDownloaded(item.torrent ? item.dir : `${item.dir}/${item.filename}`)}
          class="rounded-(--radius) px-1.5 py-1 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[11px] text-foreground">↗</Text>
        </Button>
        <Button
          accessibilityLabel={`在文件夹中显示 ${item.filename}`}
          onPress={() => void revealInFolder(item.torrent ? item.dir : `${item.dir}/${item.filename}`)}
          class="rounded-(--radius) px-1.5 py-1 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[11px] text-muted-foreground">⌕</Text>
        </Button>
      </If>
      <Button
        accessibilityLabel={`移除 ${item.filename}`}
        onPress={props.onRemove}
        class="rounded-(--radius) px-1.5 py-1 hover:bg-muted active:opacity-60"
      >
        <Text class="text-[11px] text-muted-foreground">✕</Text>
      </Button>
    </View>
  );
}

function contextMenu(item: Item): MenuItem[] {
  const priorityItems: MenuItem[] = PRIORITY_ORDER.map((priority) => ({
    label: priorityLabel(priority),
    checked: item.priority === priority,
    onSelect: () => setPriority(item.id, priority),
  }));
  const speedItems: MenuItem[] = SPEED_CHOICES.map((choice) => ({
    label: choice.label,
    checked: item.limitKb === choice.value,
    onSelect: () => setItemLimit(item.id, choice.value),
  }));
  return [
    {
      label: "立即开始",
      disabled: item.status === "running" || item.status === "done",
      onSelect: () => startNow(item.id),
    },
    {
      label: "暂停",
      disabled: item.status !== "running" && item.status !== "queued" && item.status !== "preparing",
      onSelect: () => pause(item.id),
    },
    {
      label: "继续",
      disabled: item.status !== "paused" && item.status !== "failed",
      onSelect: () => resume(item.id),
    },
    { type: "separator" },
    { label: "优先级", submenu: priorityItems },
    { label: "速度限制", submenu: speedItems },
    { type: "separator" },
    { label: "复制链接", onSelect: () => void Clipboard.writeText(item.url) },
    {
      label: "打开文件",
      disabled: item.status !== "done",
      onSelect: () => void openDownloaded(item.torrent ? item.dir : `${item.dir}/${item.filename}`),
    },
    {
      label: "在文件夹中显示",
      onSelect: () => void revealInFolder(item.torrent ? item.dir : `${item.dir}/${item.filename}`),
    },
    { type: "separator" },
    { label: "移除", onSelect: () => remove(item.id) },
  ];
}

export function DownloadRow(props: DownloadRowProps) {
  const item = () => props.item();
  const percent = () => percentOf(item().received, item().total);
  const meta = () => CATEGORY_META[item().category];

  const onContextMenu = (event: ContextMenuEvent) => {
    if (!desktopMenu) return;
    if (!props.selected) selectOnly(item().id);
    void Menu.popup(contextMenu(item()), event.pagePosition);
  };

  const onPress = (event: PressEvent) => {
    props.onSelect(event.modifiers.platform || event.modifiers.control || event.modifiers.shift);
    if (event.clickCount === 2 && item().status === "done") {
      void openDownloaded(item().torrent ? item().dir : `${item().dir}/${item().filename}`);
    }
  };

  return (
    <View
      class={
        props.selected
          ? "flex-row items-center gap-2 border-b border-border bg-accent/70 px-3 py-1.5"
          : "flex-row items-center gap-2 border-b border-border px-3 py-1.5 hover:bg-raised"
      }
      onPress={onPress}
      onContextMenu={onContextMenu}
    >
      <Checkbox
        checked={props.selected}
        onChange={props.onToggleSelect}
        accessibilityLabel={`选择 ${item().filename}`}
        class="w-5 items-center"
        indicatorClass="size-3.5 items-center justify-center rounded-[3px] border border-input bg-card checked:border-primary checked:bg-primary"
        indicator={
          <If when={props.selected}>
            <Text class="text-[8px] font-bold text-primary-foreground">✓</Text>
          </If>
        }
      />

      <View class={`size-7 items-center justify-center rounded-(--radius) ${meta().tone}`}>
        <Text class="text-[8px] font-bold tracking-wide">{meta().badge}</Text>
      </View>

      <View class="flex-1 gap-0.5" style={{ minWidth: 0 }}>
        <View class="flex-row items-center gap-1">
          <If when={item().priority !== "normal"}>
            <Text class={item().priority === "high" ? "text-[10px] text-warning" : "text-[10px] text-muted-foreground"}>
              {priorityGlyph(item().priority)}
            </Text>
          </If>
          <Text
            class="text-[12px] font-medium text-foreground"
            style={{ flex: 1, numberOfLines: 1, textOverflow: "ellipsis" }}
          >
            {item().filename}
          </Text>
        </View>
        <Text class="text-[10px] text-muted-foreground" style={{ numberOfLines: 1, textOverflow: "ellipsis" }}>
          {item().description || (item().torrent ? `磁力 · ${meta().label}` : `${hostOf(item().url)} · ${meta().label}`)}
          {item().phase ? ` · ${item().phase}` : ""}
        </Text>
      </View>

      <Text class="w-20 text-[11px] text-muted-foreground" style={{ textAlign: "right" }}>
        {item().total > 0 ? formatBytes(item().total) : item().received > 0 ? formatBytes(item().received) : "—"}
      </Text>

      <View class="w-16 flex-row items-center gap-1">
        <View class={`size-1.5 rounded-full ${item().status === "running" ? "bg-primary" : item().status === "done" ? "bg-success" : item().status === "failed" ? "bg-destructive" : "bg-muted-foreground"}`} />
        <Text class="text-[11px] text-muted-foreground" style={{ numberOfLines: 1 }}>
          {statusLabel(item().status)}
        </Text>
      </View>

      <View class="hidden w-36 flex-row items-center gap-1.5 lg:flex">
        <Progress
          value={percent()}
          indeterminate={item().total === 0 && item().status === "running"}
          accessibilityLabel={`${item().filename} 的进度`}
          class="flex-1"
          trackClass="h-1.5 rounded-(--radius-pill) bg-track overflow-hidden"
          indicatorClass="h-1.5 rounded-(--radius-pill) bg-primary"
        />
        <Text class="w-9 text-[10px] text-muted-foreground" style={{ textAlign: "right" }}>
          {formatPercent(item().received, item().total)}
        </Text>
      </View>

      <View class="hidden w-20 justify-end xl:flex">
        <Text class="text-[11px] text-muted-foreground">
          {item().status === "running" ? formatSpeed(item().speed) : "—"}
        </Text>
      </View>

      <View class="hidden w-16 justify-end xl:flex">
        <Text class="text-[11px] text-muted-foreground">
          {item().status === "running" && item().total > 0 && item().speed > 1
            ? formatEta((item().total - item().received) / item().speed)
            : item().status === "done"
              ? "完成"
              : "—"}
        </Text>
      </View>

      <View class="w-20 items-end">
        {rowActions(item(), props)}
      </View>
    </View>
  );
}
