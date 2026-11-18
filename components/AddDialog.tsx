import { platform, Scroll, signal, Text, View, windowSize } from "nsh";
import { Button, Dialog, Input } from "nsh/base";
import { prettyPath } from "../lib/paths";
import { extractUrls, normalizeUrl } from "../lib/urls";
import { addMany, notify, settings } from "../store";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  PRIORITY_ORDER,
  priorityLabel,
  type Category,
  type Priority,
} from "../model";

export interface AddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The category the sidebar is showing, when it is one. */
  initialCategory?: Category | "auto";
}

type CategoryChoice = Category | "auto";

export function AddDialog(props: AddDialogProps) {
  const links = signal("");
  const referer = signal("");
  const headers = signal("");
  const description = signal("");
  const limit = signal("");
  const dir = signal("");
  const category = signal<CategoryChoice>(props.initialCategory ?? "auto");
  const priority = signal<Priority>("normal");
  const advanced = signal(false);
  const busy = signal(false);
  const failure = signal("");

  const count = () => extractUrls(links()).length;
  const resolvedDir = () => dir().trim() || settings().dir;

  const submit = async () => {
    if (busy()) return;
    const found = extractUrls(links());
    if (found.length === 0) {
      failure.set("没有识别到 http(s) 或 magnet 链接");
      return;
    }
    busy.set(true);
    failure.set("");
    const result = await addMany(found, {
      dir: dir().trim() || undefined,
      category: category(),
      priority: priority(),
      limitKb: limit().trim() === "" ? null : Number(limit().replace(/[^0-9]/g, "") || 0),
      description: description(),
      referer: normalizeReferer(referer()),
      headers: headerLines(headers()),
    });
    busy.set(false);
    if (result.ok) {
      links.set("");
      referer.set("");
      headers.set("");
      description.set("");
      limit.set("");
      failure.set("");
      notify(result.message, "success");
      props.onOpenChange(false);
    } else {
      failure.set(result.message);
    }
  };

  const close = () => props.onOpenChange(false);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(event) => props.onOpenChange(event.open)}
      animation="fade"
      backdropClass="bg-black/40"
      class="w-[620px] gap-3 rounded-(--radius-card) border border-border bg-popover p-4"
      style={platformCenter()}
    >
      <View class="flex-row items-center gap-2">
        <View class="size-8 items-center justify-center rounded-(--radius) bg-primary">
          <Text class="text-[15px] font-bold text-primary-foreground">＋</Text>
        </View>
        <View class="flex-1 gap-0.5">
          <Text class="text-[14px] font-semibold text-popover-foreground">新建下载</Text>
          <Text class="text-[10px] text-muted-foreground">
            一行一个链接；支持直链、磁力、.torrent、HLS(.m3u8) 与 DASH(.mpd)。
          </Text>
        </View>
      </View>

      <Scroll
          class="flex-none"
          contentClass="gap-3"
          style={{ maxHeight: Math.max(180, windowSize().height - 250) }}
        >
          <Input
            testID="dialog-links"
          value={links()}
          onChange={(event) => links.set(event.value)}
          multiline
          autoFocus
          placeholder={"https://example.com/video.mp4\nhttps://cdn.example.com/stream/index.m3u8\nmagnet:?xt=urn:btih:…"}
          class="h-24 rounded-(--radius) border border-input bg-background px-2.5 py-2 text-[12px] text-foreground"
        />

        <View class="gap-1">
          <Text class="text-[10px] font-medium text-foreground">保存目录</Text>
          <Input
            testID="dialog-dir"
            value={dir()}
            onChange={(event) => dir.set(event.value)}
            autoCapitalize="none"
            placeholder={prettyPath(settings().dir)}
            class="rounded-(--radius) border border-input bg-background px-2.5 py-1.5 text-[11px] text-foreground"
          />
          <Text class="text-[9px] text-muted-foreground">
            留空使用 {prettyPath(settings().dir)}
            {settings().organizeByCategory ? "；按分类自动归档已开启" : ""}
          </Text>
        </View>

        <View class="gap-1">
          <Text class="text-[10px] font-medium text-foreground">分类</Text>
          <View class="flex-row flex-wrap gap-1">
            <Button
              testID="dialog-category-auto"
              onPress={() => category.set("auto")}
              class={
                category() === "auto"
                  ? "rounded-(--radius) bg-accent px-2 py-1"
                  : "rounded-(--radius) border border-border px-2 py-1 hover:bg-muted active:opacity-60"
              }
            >
              <Text class={category() === "auto" ? "text-[10px] font-medium text-accent-foreground" : "text-[10px] text-muted-foreground"}>
                自动
              </Text>
            </Button>
            <Each of={CATEGORY_ORDER} key={(entry) => entry}>
              {(entry) => (
                <Button
                  testID={`dialog-category-${entry()}`}
                  onPress={() => category.set(entry())}
                  class={
                    category() === entry()
                      ? "flex-row items-center gap-1 rounded-(--radius) bg-accent px-2 py-1"
                      : "flex-row items-center gap-1 rounded-(--radius) border border-border px-2 py-1 hover:bg-muted active:opacity-60"
                  }
                >
                  <Text class={category() === entry() ? "text-[10px] font-medium text-accent-foreground" : "text-[10px] text-muted-foreground"}>
                    {CATEGORY_META[entry()].label}
                  </Text>
                </Button>
              )}
            </Each>
          </View>
        </View>

        <View class="flex-row gap-3">
          <View class="flex-1 gap-1">
            <Text class="text-[10px] font-medium text-foreground">优先级</Text>
            <View class="flex-row gap-1">
              <Each of={PRIORITY_ORDER} key={(entry) => entry}>
                {(entry) => (
                  <Button
                    onPress={() => priority.set(entry())}
                    class={
                      priority() === entry()
                        ? "rounded-(--radius) bg-accent px-2.5 py-1"
                        : "rounded-(--radius) border border-border px-2.5 py-1 hover:bg-muted active:opacity-60"
                    }
                  >
                    <Text class={priority() === entry() ? "text-[10px] font-medium text-accent-foreground" : "text-[10px] text-muted-foreground"}>
                      {priorityLabel(entry())}
                    </Text>
                  </Button>
                )}
              </Each>
            </View>
          </View>

          <View class="w-36 gap-1">
            <Text class="text-[10px] font-medium text-foreground">速度限制</Text>
            <View class="flex-row items-center gap-1">
              <Input
                value={limit()}
                onChange={(event) => limit.set(event.value.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder="全局"
                class="w-16 rounded-(--radius) border border-input bg-background px-2 py-1 text-[10px] text-foreground"
              />
              <Text class="text-[10px] text-muted-foreground">KB/s</Text>
            </View>
          </View>
        </View>

        <View class="gap-1">
          <Text class="text-[10px] font-medium text-foreground">备注（可选）</Text>
          <Input
            value={description()}
            onChange={(event) => description.set(event.value)}
            placeholder="给这个下载起个说明"
            class="rounded-(--radius) border border-input bg-background px-2.5 py-1.5 text-[11px] text-foreground"
          />
        </View>

        <Button
          testID="dialog-advanced"
          onPress={() => advanced.update((value) => !value)}
          class="self-start rounded-(--radius) px-1 py-0.5 hover:bg-muted active:opacity-60"
        >
          <Text class="text-[10px] text-muted-foreground">{advanced() ? "▾ 高级选项" : "▸ 高级选项"}</Text>
        </Button>

        <If when={advanced()}>
          <View class="gap-2 rounded-(--radius) border border-border bg-raised p-2">
            <View class="gap-1">
              <Text class="text-[10px] font-medium text-foreground">Referer（可选）</Text>
              <Input
                testID="dialog-referer"
                value={referer()}
                onChange={(event) => referer.set(event.value)}
                autoCapitalize="none"
                placeholder="https://example.com/watch/123"
                class="rounded-(--radius) border border-input bg-background px-2.5 py-1.5 text-[11px] text-foreground"
              />
            </View>
            <View class="gap-1">
              <Text class="text-[10px] font-medium text-foreground">额外请求头（可选）</Text>
              <Input
                testID="dialog-headers"
                value={headers()}
                onChange={(event) => headers.set(event.value)}
                multiline
                autoCapitalize="none"
                placeholder={"Cookie: SESSION=...\nUser-Agent: Mozilla/5.0"}
                class="h-14 rounded-(--radius) border border-input bg-background px-2.5 py-1.5 font-mono text-[10px] text-foreground"
              />
              <Text class="text-[9px] text-muted-foreground">每行一条 Name: value；网盘直链的 Cookie 常放在这里。</Text>
            </View>
          </View>
        </If>

        <If when={!!failure()}>
          <Text class="text-[11px] text-destructive">{failure()}</Text>
        </If>

      </Scroll>

      <View class="flex-row items-center gap-2">
        <Text class="flex-1 text-[10px] text-muted-foreground">
          识别到 {count()} 个链接 · 保存到 {prettyPath(resolvedDir())}
        </Text>
        <Button testID="dialog-cancel" onPress={close} class="rounded-(--radius) border border-border px-3 py-1.5 hover:bg-muted active:opacity-60">
          <Text class="text-[11px] text-foreground">取消</Text>
        </Button>
        <Button
          testID="dialog-submit"
          disabled={busy() || count() === 0}
          onPress={() => void submit()}
          class="rounded-(--radius) bg-primary px-4 py-1.5 active:opacity-80 disabled:opacity-40"
        >
          <Text class="text-[11px] font-medium text-primary-foreground">{busy() ? "解析中…" : "开始下载"}</Text>
        </Button>
      </View>
    </Dialog>
  );
}

/** The web's dialog layer starts at the top-left; the native hosts center it already. */
function platformCenter() {
  return platform.os === "web"
    ? { left: "50%" as const, top: "50%" as const, translate: "-50% -50%" }
    : undefined;
}

function headerLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(":"));
}

function normalizeReferer(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return normalizeUrl(trimmed) ?? trimmed;
}
