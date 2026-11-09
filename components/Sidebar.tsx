import { Text, View } from "nsh";
import { Button } from "nsh/base";
import { activeCount, engineHint, engineInfo, failedCount, finishedCount, items, queuedCount, settings } from "../store";
import { normalizeProxy } from "../lib/urls";

export type Page = "downloads" | "settings";
export type Filter = "all" | "active" | "done" | "failed";

export interface SidebarProps {
  filter: Filter;
  page: Page;
  onFilter: (filter: Filter) => void;
  onPage: (page: Page) => void;
}

interface Entry {
  filter: Filter;
  label: string;
  count: () => number;
}

const ENTRIES: Entry[] = [
  { filter: "all", label: "全部下载", count: () => items().length },
  { filter: "active", label: "进行中", count: () => activeCount() + queuedCount() },
  { filter: "done", label: "已完成", count: () => finishedCount() },
  { filter: "failed", label: "失败", count: () => failedCount() },
];

function Row(props: { active: boolean; label: string; count: number; onPress: () => void }) {
  return (
    <Button
      onPress={props.onPress}
      class={props.active ? "rounded-(--radius) bg-sidebar-accent px-3 py-2" : "rounded-(--radius) px-3 py-2 hover:bg-sidebar-accent/60"}
    >
      <View class="flex-row items-center gap-2">
        <Text class={props.active ? "flex-1 text-[13px] font-medium text-sidebar-accent-foreground" : "flex-1 text-[13px] text-sidebar-foreground"}>
          {props.label}
        </Text>
        <Text class="text-[11px] text-muted-foreground">{props.count}</Text>
      </View>
    </Button>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <View class="w-44 gap-1 border-r border-sidebar-border bg-sidebar p-2 lg:w-52">
      <View class="px-3 pt-2 pb-1">
        <Text class="text-[10px] font-semibold tracking-wide text-muted-foreground">队列</Text>
      </View>
      <Each of={ENTRIES} key={(entry) => entry.filter}>
        {(entry) => (
          <Row
            active={props.filter === entry().filter}
            label={entry().label}
            count={entry().count()}
            onPress={() => props.onFilter(entry().filter)}
          />
        )}
      </Each>

      <View class="flex-1" />

      <Button
        testID="nav-settings"
        onPress={() => props.onPage("settings")}
        class={props.page === "settings" ? "rounded-(--radius) bg-sidebar-accent px-3 py-2" : "rounded-(--radius) px-3 py-2 hover:bg-sidebar-accent/60"}
      >
        <View class="flex-row items-center gap-2">
          <Text class={props.page === "settings" ? "flex-1 text-[13px] font-medium text-sidebar-accent-foreground" : "flex-1 text-[13px] text-sidebar-foreground"}>
            设置
          </Text>
          <Text class="text-[11px] text-muted-foreground">⚙</Text>
        </View>
      </Button>

      <View class="mx-1 mb-1 rounded-(--radius-card) border border-sidebar-border bg-card p-3">
        <Text class="text-[11px] font-medium text-foreground">下载引擎</Text>
        <Text class="mt-0.5 text-[10px] text-muted-foreground">{engineHint()}</Text>
        <View class="mt-1.5 gap-1">
          <View class="flex-row items-center gap-1">
            <Text class="text-[10px] text-muted-foreground">代理</Text>
            <Text class="flex-1 text-[10px] text-muted-foreground" style={{ numberOfLines: 1, textOverflow: "ellipsis" }}>
              {normalizeProxy(settings().proxy) || "直连"}
            </Text>
          </View>
          <View class="flex-row items-center gap-1">
            <Text class="text-[10px] text-muted-foreground">磁力</Text>
            <Text class="text-[10px] text-muted-foreground">{engineInfo().aria2 ? "aria2c" : "需装 aria2c"}</Text>
          </View>
        </View>
        <View class="mt-1.5 flex-row items-center gap-1">
          <Text class="text-[10px] text-muted-foreground">并发 {settings().maxConcurrent}</Text>
          <Text class="text-[10px] text-muted-foreground">·</Text>
          <Text class="text-[10px] text-muted-foreground">
            {engineInfo().aria2 ? `${settings().connections} 线程` : "单连接"}
          </Text>
        </View>
      </View>
    </View>
  );
}
