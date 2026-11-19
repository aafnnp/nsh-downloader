import { computed, List, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { formatSpeed, percentOf } from "../lib/format";
import {
  activeCount,
  clearFinished,
  clearSelection,
  failedCount,
  finishedCount,
  items,
  notify,
  pauseAll,
  pausedCount,
  queuedCount,
  ready,
  remove,
  resumeAll,
  selectMany,
  selectOnly,
  selection,
  totalSpeed,
  toggleSelect,
} from "../store";
import {
  CATEGORY_META,
  PRIORITY_RANK,
  STATUS_RANK,
  type Category,
  type Item,
} from "../model";
import { DownloadRow } from "../components/DownloadRow";
import type { NavKey } from "../components/Sidebar";

type SortKey = "name" | "size" | "status" | "progress" | "speed" | "eta" | "added";

const SORT_LABEL: Record<SortKey, string> = {
  name: "文件名",
  size: "大小",
  status: "状态",
  progress: "进度",
  speed: "速度",
  eta: "剩余时间",
  added: "添加时间",
};

function matches(item: Item, nav: NavKey): boolean {
  if (nav === "all") return true;
  if (nav === "unfinished") return item.status !== "done" && item.status !== "failed" && item.status !== "canceled";
  if (nav === "finished") return item.status === "done";
  if (nav === "failed") return item.status === "failed";
  return item.category === nav;
}

function etaOf(item: Item): number {
  if (item.status !== "running" || item.total <= 0 || item.speed <= 0) return Number.POSITIVE_INFINITY;
  return (item.total - item.received) / item.speed;
}

function compare(a: Item, b: Item, key: SortKey): number {
  switch (key) {
    case "name":
      return a.filename.localeCompare(b.filename, "zh-Hans");
    case "size":
      return a.total - b.total;
    case "status":
      return STATUS_RANK[a.status] - STATUS_RANK[b.status] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    case "progress":
      return percentOf(a.received, a.total) - percentOf(b.received, b.total);
    case "speed":
      return a.speed - b.speed;
    case "eta":
      return etaOf(a) - etaOf(b);
    case "added":
      return a.createdAt - b.createdAt;
  }
}

function navTitle(nav: NavKey): string {
  switch (nav) {
    case "all":
      return "全部下载";
    case "unfinished":
      return "未完成";
    case "finished":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return CATEGORY_META[nav as Category].label;
  }
}

function summary(nav: NavKey): string {
  if (!ready()) return "正在恢复会话…";
  const running = activeCount();
  const speed = totalSpeed();
  const queued = queuedCount();
  const paused = pausedCount();
  const parts: string[] = [];
  parts.push(running > 0 ? `${running} 个进行中` : "空闲");
  if (speed > 1) parts.push(formatSpeed(speed));
  if (queued > 0) parts.push(`${queued} 个排队`);
  if (paused > 0) parts.push(`${paused} 个暂停`);
  if (nav === "failed" && failedCount() > 0) parts.push(`${failedCount()} 个失败`);
  if (nav === "finished" && finishedCount() > 0) parts.push(`${finishedCount()} 个完成`);
  return parts.join(" · ");
}

function HeaderCell(props: {
  label: string;
  width: string;
  key?: SortKey;
  sort: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = () => props.key !== undefined && props.sort === props.key;
  const content = () => (
    <View class={`flex-row items-center gap-0.5 ${props.align === "right" ? "justify-end" : ""}`}>
      <Text class={active() ? "text-[10px] font-semibold text-foreground" : "text-[10px] text-muted-foreground"}>
        {props.label}
      </Text>
      <If when={active()}>
        <Text class="text-[8px] text-primary">{props.dir === "asc" ? "▲" : "▼"}</Text>
      </If>
    </View>
  );
  if (!props.key) {
    return <View class={`${props.width} flex-row items-center justify-end`}>{content()}</View>;
  }
  return (
    <Button
      accessibilityLabel={`按${SORT_LABEL[props.key]}排序`}
      onPress={() => props.onSort(props.key as SortKey)}
      class={`${props.width} flex-row items-center rounded-[3px] px-0.5 py-0.5 hover:bg-muted active:opacity-60 ${props.align === "right" ? "justify-end" : ""}`}
    >
      {content()}
    </Button>
  );
}

export interface DownloadsPageProps {
  nav: NavKey;
  search: string;
  onOpenAdd: () => void;
  onToggleDetails: () => void;
  detailsOpen: boolean;
}

export function DownloadsPage(props: DownloadsPageProps) {
  const sortKey = signal<SortKey>("added");
  const sortDir = signal<"asc" | "desc">("desc");

  const filtered = computed(() => {
    const query = props.search.trim().toLowerCase();
    const list = items().filter((item) => {
      if (!matches(item, props.nav)) return false;
      if (!query) return true;
      return (
        item.filename.toLowerCase().includes(query) ||
        item.url.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query)
      );
    });
    const key = sortKey();
    const direction = sortDir() === "asc" ? 1 : -1;
    return list.sort((a, b) => compare(a, b, key) * direction);
  });

  const onSort = (key: SortKey) => {
    if (sortKey() === key) {
      sortDir.update((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    sortKey.set(key);
    sortDir.set(key === "name" ? "asc" : "desc");
  };

  const allSelected = () => filtered().length > 0 && filtered().every((item) => selection().includes(item.id));

  return (
    <View class="flex-1" style={{ minWidth: 0 }}>
      <View class="flex-row items-center gap-2 border-b border-border bg-card px-3 py-1.5">
        <Text class="text-[12px] font-semibold text-foreground">{navTitle(props.nav)}</Text>
        <Text class="text-[10px] text-muted-foreground">{filtered().length} 项</Text>
        <View class="h-4 w-px bg-border" />
        <Text class="text-[10px] text-muted-foreground">{summary(props.nav)}</Text>
        <View class="flex-1" />
        <Button
          onPress={() => (allSelected() ? clearSelection() : selectMany(filtered().map((item) => item.id)))}
          accessibilityLabel={allSelected() ? "取消全选" : "全选"}
          class="rounded-(--radius) px-2 py-1 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[10px] text-muted-foreground">{allSelected() ? "取消全选" : "全选"}</Text>
        </Button>
        <Button
          onPress={props.onToggleDetails}
          accessibilityLabel="显示或隐藏详细信息"
          class={
            props.detailsOpen
              ? "rounded-(--radius) bg-accent px-2 py-1"
              : "rounded-(--radius) px-2 py-1 hover:bg-muted active:opacity-60"
          }
        >
          <Text class={props.detailsOpen ? "text-[10px] font-medium text-accent-foreground" : "text-[10px] text-muted-foreground"}>
            详情
          </Text>
        </Button>
        <Button
          onPress={() => resumeAll()}
          accessibilityLabel="全部开始"
          class="rounded-(--radius) px-2 py-1 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[10px] text-foreground">全部开始</Text>
        </Button>
        <Button
          onPress={() => pauseAll()}
          accessibilityLabel="全部暂停"
          class="rounded-(--radius) px-2 py-1 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[10px] text-foreground">全部暂停</Text>
        </Button>
        <Button
          testID="clear-finished"
          onPress={() => {
            const removed = clearFinished();
            notify(removed > 0 ? `已清除 ${removed} 条记录` : "没有可清除的记录");
          }}
          accessibilityLabel="清除已完成"
          class="rounded-(--radius) px-2 py-1 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[10px] text-destructive">清除记录</Text>
        </Button>
      </View>

      <View class="flex-row items-center gap-2 border-b border-border bg-raised px-3 py-1">
        <View class="w-5" />
        <View class="w-7" />
        <HeaderCell label="文件名" width="flex-1" key="name" sort={sortKey()} dir={sortDir()} onSort={onSort} />
        <HeaderCell label="大小" width="w-20" key="size" sort={sortKey()} dir={sortDir()} onSort={onSort} align="right" />
        <HeaderCell label="状态" width="w-16" key="status" sort={sortKey()} dir={sortDir()} onSort={onSort} />
        <View class="hidden w-36 items-center lg:flex">
          <HeaderCell label="进度" width="flex-1" key="progress" sort={sortKey()} dir={sortDir()} onSort={onSort} />
        </View>
        <View class="w-20 items-center justify-end">
          <HeaderCell label="速度" width="flex-1" key="speed" sort={sortKey()} dir={sortDir()} onSort={onSort} align="right" />
        </View>
        <View class="hidden w-16 items-center xl:flex">
          <HeaderCell label="剩余" width="flex-1" key="eta" sort={sortKey()} dir={sortDir()} onSort={onSort} align="right" />
        </View>
        <View class="w-20" />
      </View>

      <List
        each={filtered()}
        keyExtractor={(item) => item.id}
        estimatedItemSize={44}
        class="flex-1"
        contentClass="pb-4"
        empty={<EmptyState nav={props.nav} search={props.search} onOpenAdd={props.onOpenAdd} />}
      >
        {(item) => (
          <DownloadRow
            item={item}
            selected={selection().includes(item().id)}
            onToggleSelect={() => toggleSelect(item().id)}
            onSelect={(additive) => (additive ? toggleSelect(item().id) : selectOnly(item().id))}
            onRemove={() => {
              const removed = item();
              remove(removed.id);
              notify(`已移除 ${removed.filename}`);
            }}
          />
        )}
      </List>
    </View>
  );
}

function EmptyState(props: { nav: NavKey; search: string; onOpenAdd: () => void }) {
  const searching = () => props.search.trim().length > 0;
  const title = () => {
    if (searching()) return "没有匹配的下载";
    if (props.nav === "failed") return "没有失败的下载";
    if (props.nav === "finished") return "还没有完成的下载";
    if (props.nav === "unfinished") return "没有进行中的下载";
    if (props.nav === "all") return "没有下载任务";
    return `还没有${CATEGORY_META[props.nav as Category].label}下载`;
  };
  return (
    <View class="items-center justify-center gap-2 px-6 py-16">
      <View class="size-14 items-center justify-center rounded-(--radius-card) border border-border bg-card">
        <Text class="text-[24px] text-muted-foreground">⇩</Text>
      </View>
      <Text class="text-[13px] font-medium text-foreground">{title()}</Text>
      <Text class="text-center text-[11px] text-muted-foreground" style={{ maxWidth: 380 }}>
        {searching()
          ? "换个关键词，或清空搜索框看看全部下载。"
          : "把链接粘到输入框，或从浏览器扩展发送过来；磁力链接和 .torrent 文件也可以直接拖进来。"}
      </Text>
      <If when={!searching() && (props.nav === "all" || props.nav === "unfinished")}>
        <Button
          onPress={props.onOpenAdd}
          class="mt-1 rounded-(--radius) bg-primary px-4 py-1.5 active:opacity-80"
        >
          <Text class="text-[12px] font-medium text-primary-foreground">＋ 新建下载</Text>
        </Button>
      </If>
    </View>
  );
}
