import { Text, View } from "nsh";
import { Button } from "nsh/base";
import {
  activeCount,
  categoryCount,
  engineHint,
  engineInfo,
  finishedCount,
  failedCount,
  items,
  pausedCount,
  settings,
  unfinishedCount,
} from "../store";
import { CATEGORY_META, CATEGORY_ORDER, speedModeLabel, type Category } from "../model";
import { normalizeProxy } from "../lib/urls";

export type NavKey = "all" | "unfinished" | "finished" | "failed" | Category;

export interface SidebarProps {
  nav: NavKey;
  onNav: (nav: NavKey) => void;
  onSettings: () => void;
  onSettingsSection: (section: "general" | "downloads" | "categories" | "network" | "scheduler" | "browser" | "about") => void;
}

interface Entry {
  key: NavKey;
  label: string;
  glyph: string;
  count: () => number;
  tone?: string;
}

const DOWNLOADS: Entry[] = [
  { key: "all", label: "全部下载", glyph: "⇩", count: () => items().length },
  { key: "unfinished", label: "未完成", glyph: "◔", count: () => unfinishedCount() },
  { key: "finished", label: "已完成", glyph: "✓", count: () => finishedCount() },
  { key: "failed", label: "失败", glyph: "!", count: () => failedCount() },
];

function rowClass(active: boolean): string {
  return active
    ? "flex-row items-center gap-2 rounded-(--radius) border-l-2 border-primary bg-sidebar-accent px-2 py-1.5"
    : "flex-row items-center gap-2 rounded-(--radius) border-l-2 border-transparent px-2 py-1.5 hover:bg-sidebar-accent/60";
}

function Row(props: { active: boolean; entry: Entry; onPress: () => void }) {
  return (
    <Button
      testID={`nav-${props.entry.key}`}
      onPress={props.onPress}
      class={rowClass(props.active)}
      accessibilityLabel={props.entry.label}
    >
      <View class="w-5 items-center">
        <Text class={props.active ? "text-[12px] text-primary" : "text-[12px] text-muted-foreground"}>{props.entry.glyph}</Text>
      </View>
      <Text
        class={
          props.active
            ? "flex-1 text-[12px] font-medium text-sidebar-accent-foreground"
            : "flex-1 text-[12px] text-sidebar-foreground"
        }
        style={{ numberOfLines: 1, textOverflow: "ellipsis" }}
      >
        {props.entry.label}
      </Text>
      <Text class="text-[10px] text-muted-foreground">{props.entry.count()}</Text>
    </Button>
  );
}

function Section(props: { label: string }) {
  return (
    <View class="px-2 pt-3 pb-1">
      <Text class="text-[9px] font-semibold tracking-wide text-muted-foreground">{props.label}</Text>
    </View>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <View class="w-48 gap-0.5 border-r border-sidebar-border bg-sidebar px-2 pb-2 lg:w-52">
      <Section label="下载" />
      <Each of={DOWNLOADS} key={(entry) => entry.key}>
        {(entry) => (
          <Row active={props.nav === entry().key} entry={entry()} onPress={() => props.onNav(entry().key)} />
        )}
      </Each>

      <Section label="分类" />
      <Each of={CATEGORY_ORDER} key={(category) => category}>
        {(category) => {
          const meta = () => CATEGORY_META[category()];
          return (
            <Button
              testID={`nav-category-${category()}`}
              onPress={() => props.onNav(category())}
              accessibilityLabel={meta().label}
              class={rowClass(props.nav === category())}
            >
              <View class={`size-5 items-center justify-center rounded-[4px] ${meta().tone}`}>
                <Text class="text-[7px] font-bold tracking-wide">{meta().badge}</Text>
              </View>
              <Text
                class={
                  props.nav === category()
                    ? "flex-1 text-[12px] font-medium text-sidebar-accent-foreground"
                    : "flex-1 text-[12px] text-sidebar-foreground"
                }
              >
                {meta().label}
              </Text>
              <Text class="text-[10px] text-muted-foreground">{categoryCount(category())}</Text>
            </Button>
          );
        }}
      </Each>

      <Section label="工具" />
      <Button
        testID="tool-scheduler"
        onPress={() => props.onSettingsSection("scheduler")}
        accessibilityLabel="调度器"
        class={rowClass(false)}
      >
        <View class="w-5 items-center">
          <Text class="text-[12px] text-muted-foreground">◷</Text>
        </View>
        <Text class="flex-1 text-[12px] text-sidebar-foreground">调度器</Text>
        <View
          class={
            settings().scheduler.enabled
              ? "size-1.5 rounded-full bg-success"
              : "size-1.5 rounded-full bg-muted-foreground/40"
          }
        />
      </Button>
      <Button onPress={() => props.onSettingsSection("browser")} accessibilityLabel="浏览器集成" class={rowClass(false)}>
        <View class="w-5 items-center">
          <Text class="text-[12px] text-muted-foreground">◎</Text>
        </View>
        <Text class="flex-1 text-[12px] text-sidebar-foreground">浏览器集成</Text>
      </Button>
      <Button onPress={props.onSettings} accessibilityLabel="设置" class={rowClass(false)}>
        <View class="w-5 items-center">
          <Text class="text-[12px] text-muted-foreground">⚙</Text>
        </View>
        <Text class="flex-1 text-[12px] text-sidebar-foreground">设置</Text>
      </Button>

      <View class="flex-1" />

      <View class="mx-0.5 rounded-(--radius-card) border border-sidebar-border bg-card p-2.5">
        <View class="flex-row items-center gap-1.5">
          <View
            class={
              engineInfo().aria2
                ? "size-1.5 rounded-full bg-success"
                : engineInfo().curl
                  ? "size-1.5 rounded-full bg-warning"
                  : "size-1.5 rounded-full bg-muted-foreground"
            }
          />
          <Text class="text-[10px] font-medium text-foreground">下载引擎</Text>
        </View>
        <Text class="mt-0.5 text-[9px] text-muted-foreground" style={{ numberOfLines: 2 }}>
          {engineHint()}
        </Text>
        <View class="mt-1.5 gap-0.5">
          <View class="flex-row items-center gap-1">
            <Text class="text-[9px] text-muted-foreground">代理</Text>
            <Text class="flex-1 text-[9px] text-muted-foreground" style={{ numberOfLines: 1, textOverflow: "ellipsis" }}>
              {normalizeProxy(settings().proxy) || "直连"}
            </Text>
          </View>
          <View class="flex-row items-center gap-1">
            <Text class="text-[9px] text-muted-foreground">流量</Text>
            <Text class="flex-1 text-[9px] text-muted-foreground">{speedModeLabel(settings().speedMode)}</Text>
          </View>
          <View class="flex-row items-center gap-1">
            <Text class="text-[9px] text-muted-foreground">并发</Text>
            <Text class="flex-1 text-[9px] text-muted-foreground">
              {settings().maxConcurrent} 任务 · {activeCount()} 运行 · {pausedCount()} 暂停
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
