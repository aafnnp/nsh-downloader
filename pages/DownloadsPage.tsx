import { computed, List, signal, Text, View } from "nsh";
import { Button, Input } from "nsh/base";
import { formatSpeed } from "../lib/format";
import type { Item } from "../model";
import {
  activeCount,
  addFromText,
  clearFinished,
  engineHint,
  importClipboard,
  items,
  notify,
  pauseAll,
  queuedCount,
  ready,
  resumeAll,
  totalSpeed,
} from "../store";
import { ActionButton } from "../components/ActionButton";
import { DownloadRow } from "../components/DownloadRow";
import type { Filter } from "../components/Sidebar";

function matches(item: Item, filter: Filter): boolean {
  switch (filter) {
    case "active":
      return item.status === "running" || item.status === "queued" || item.status === "preparing" || item.status === "paused";
    case "done":
      return item.status === "done";
    case "failed":
      return item.status === "failed";
    default:
      return true;
  }
}

export interface DownloadsPageProps {
  filter: Filter;
  onOpenAdd: () => void;
}

export function DownloadsPage(props: DownloadsPageProps) {
  const draft = signal("");
  const busy = signal(false);
  const expanded = signal<Record<string, boolean>>({});

  const shown = computed(() => items().filter((item) => matches(item, props.filter)));
  const summary = computed(() => {
    const running = activeCount();
    const speed = totalSpeed();
    const queued = queuedCount();
    const parts: string[] = [];
    if (ready()) {
      parts.push(running > 0 ? `${running} 个进行中` : "空闲");
      if (speed > 1) parts.push(formatSpeed(speed));
      if (queued > 0) parts.push(`${queued} 个排队`);
    } else {
      parts.push("正在恢复会话…");
    }
    return parts.join(" · ");
  });

  const submit = async () => {
    const text = draft();
    if (!text.trim() || busy()) return;
    busy.set(true);
    const result = await addFromText(text);
    busy.set(false);
    if (result.ok) {
      draft.set("");
      notify(result.message, "success");
    } else {
      notify(result.message, "error");
    }
  };

  const paste = async () => {
    busy.set(true);
    const result = await importClipboard();
    busy.set(false);
    notify(result.message, result.ok ? "success" : "error");
  };

  return (
    <View class="flex-1">
      <View class="gap-2 border-b border-border px-4 pt-3 pb-2.5">
        <View class="flex-row items-center gap-2">
          <Input
            testID="add-input"
            value={draft()}
            onChange={(event) => draft.set(event.value)}
            onSubmit={() => void submit()}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="粘贴视频、音频、文件或 HLS/DASH 链接…"
            class="flex-1 rounded-(--radius) border border-input bg-card px-3 py-2 text-[13px] text-foreground"
          />
          <Button
            testID="add-submit"
            disabled={busy() || !draft().trim()}
            onPress={() => void submit()}
            class="rounded-(--radius) bg-primary px-4 py-2 active:opacity-80 disabled:opacity-40"
          >
            <Text class="text-[12px] font-medium text-primary-foreground">下载</Text>
          </Button>
          <Button testID="add-paste" onPress={() => void paste()} class="rounded-(--radius) border border-border bg-card px-3 py-2 active:opacity-60">
            <Text class="text-[12px] text-foreground">粘贴</Text>
          </Button>
          <Button testID="add-advanced" onPress={props.onOpenAdd} class="rounded-(--radius) border border-border bg-card px-3 py-2 active:opacity-60">
            <Text class="text-[12px] text-foreground">高级</Text>
          </Button>
        </View>
        <Text class="text-[10px] text-muted-foreground">{engineHint()}</Text>
      </View>

      <View class="flex-row items-center gap-2 border-b border-border px-4 py-2">
        <Text class="text-[11px] text-muted-foreground">{summary()}</Text>
        <View class="flex-1" />
        <ActionButton label="全部开始" hint="开始所有暂停的下载" onPress={() => resumeAll()} />
        <ActionButton label="全部暂停" hint="暂停所有进行中的下载" onPress={() => pauseAll()} />
        <ActionButton
          testID="clear-finished"
          label="清除记录"
          hint="移除已完成与失败的条目"
          tone="danger"
          onPress={() => {
            const removed = clearFinished();
            notify(removed > 0 ? `已清除 ${removed} 条记录` : "没有可清除的记录");
          }}
        />
      </View>

      <List
        each={shown()}
        keyExtractor={(item) => item.id}
        estimatedItemSize={92}
        class="flex-1"
        contentClass="pb-4"
        empty={<EmptyState />}
      >
        {(item) => (
          <DownloadRow
            item={item}
            expanded={!!expanded()[item().id]}
            onToggle={() =>
              expanded.update((current) => ({ ...current, [item().id]: !current[item().id] }))
            }
          />
        )}
      </List>
    </View>
  );
}

function EmptyState() {
  return (
    <View class="items-center justify-center gap-2 px-6 py-16">
      <View class="size-14 items-center justify-center rounded-(--radius-card) border border-border bg-card">
        <Text class="text-[22px] text-muted-foreground">↓</Text>
      </View>
      <Text class="text-[13px] font-medium text-foreground">队列是空的</Text>
      <Text class="text-center text-[11px] text-muted-foreground" style={{ maxWidth: 360 }}>
        把链接粘到上面的输入框，或在浏览器扩展里点“发送到 Downloader”，复制后会自动出现在这里。
      </Text>
    </View>
  );
}
