import { colorScheme, Text, View } from "nsh";
import { formatSpeed } from "../lib/format";
import {
  activeCount,
  engineHint,
  engineInfo,
  notice,
  queuedCount,
  ready,
  schedulerState,
  settings,
  totalSpeed,
  traffic,
} from "../store";
import { speedModeLabel } from "../model";

function toneClass(): string {
  const current = notice();
  if (!current) return "text-muted-foreground";
  return current.tone === "error" ? "text-destructive" : current.tone === "success" ? "text-success" : "text-foreground";
}

function TrafficGraph() {
  const bars = () => traffic().slice(-32);
  const peak = () => Math.max(1, ...bars());
  return (
    <View class="flex-row items-end gap-0.5" style={{ height: 16 }} accessibilityLabel="下载速度曲线">
      <Each of={bars()} key="index">
        {(sample) => (
          <View
            class="w-0.5 rounded-[1px] bg-primary/60"
            style={{ height: Math.max(1, Math.round((sample() / peak()) * 16)) }}
          />
        )}
      </Each>
    </View>
  );
}

export function StatusBar() {
  const schedulerLabel = () => {
    const state = schedulerState();
    if (state === "active") return "调度器运行中";
    if (state === "waiting") return "调度器等待中";
    return "调度器关闭";
  };

  return (
    <View class="flex-row items-center gap-3 border-t border-border bg-card px-3" style={{ height: 30 }}>
      <View class="flex-row items-center gap-1.5">
        <View class={ready() ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-warning"} />
        <Text class="text-[10px] text-muted-foreground" style={{ numberOfLines: 1 }}>
          {ready() ? engineHint() : "启动中…"}
        </Text>
      </View>

      <View class="h-3.5 w-px bg-border" />
      <View class="flex-row items-center gap-1">
        <View
          class={
            schedulerState() === "active"
              ? "size-1.5 rounded-full bg-success"
              : schedulerState() === "waiting"
                ? "size-1.5 rounded-full bg-warning"
                : "size-1.5 rounded-full bg-muted-foreground/40"
          }
        />
        <Text class="text-[10px] text-muted-foreground">{schedulerLabel()}</Text>
      </View>

      <View class="flex-1" />
      <If when={!!notice()}>
        <Text class={`text-[10px] ${toneClass()}`}>{notice()?.text}</Text>
      </If>
      <View class="flex-1" />

      <Text class="text-[10px] text-muted-foreground">
        {engineInfo().aria2 ? `${settings().connections} 线程` : engineInfo().curl ? "单连接" : "内置引擎"}
      </Text>
      <TrafficGraph />
      <Text class="text-[10px] font-medium text-foreground">
        {totalSpeed() > 1 ? formatSpeed(totalSpeed()) : "0 B/s"}
      </Text>
      <Text class="text-[10px] text-muted-foreground">
        活跃 {activeCount()} · 排队 {queuedCount()}
      </Text>
      <Text class="text-[10px] text-muted-foreground">
        {speedModeLabel(settings().speedMode)} · {colorScheme() === "dark" ? "深色" : "浅色"}
      </Text>
    </View>
  );
}
