import { signal, Text, View } from "nsh";
import { Button, Dialog, Input } from "nsh/base";
import { prettyPath } from "../lib/paths";
import { extractUrls, normalizeUrl } from "../lib/urls";
import { addMany, notify, settings, updateSettings } from "../store";

export interface AddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Advanced add: several links at once, a referer for a protected server, and where they land. */
export function AddDialog(props: AddDialogProps) {
  const links = signal("");
  const referer = signal("");
  const headers = signal("");
  // Empty until the user types: the field follows the setting meanwhile.
  const dir = signal("");
  const busy = signal(false);
  const failure = signal("");

  const count = () => extractUrls(links()).length;

  const submit = async () => {
    if (busy()) return;
    const found = extractUrls(links());
    if (found.length === 0) {
      failure.set("没有识别到 http(s) 链接");
      return;
    }
    busy.set(true);
    failure.set("");
    const target = dir().trim() || settings().dir;
    if (target !== settings().dir) updateSettings({ dir: target });
    const result = await addMany(found, normalizeReferer(referer()), headerLines(headers()));
    busy.set(false);
    if (result.ok) {
      links.set("");
      referer.set("");
      headers.set("");
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
      class="w-[560px] gap-4 rounded-(--radius-card) border border-border bg-popover p-5"
    >
      <View class="gap-1">
        <Text class="text-[15px] font-semibold text-popover-foreground">新建下载</Text>
        <Text class="text-[11px] text-muted-foreground">一行一个链接；支持直链、HLS(.m3u8) 与 DASH(.mpd) 播放列表。</Text>
      </View>

      <Input
        testID="dialog-links"
        value={links()}
        onChange={(event) => links.set(event.value)}
        multiline
        placeholder={"https://example.com/video.mp4\nhttps://cdn.example.com/stream/index.m3u8"}
        class="h-28 rounded-(--radius) border border-input bg-background px-3 py-2 text-[12px] text-foreground"
      />

      <View class="gap-1.5">
        <Text class="text-[11px] font-medium text-foreground">保存目录</Text>
        <Input
          testID="dialog-dir"
          value={dir() || settings().dir}
          onChange={(event) => dir.set(event.value)}
          autoCapitalize="none"
          placeholder={prettyPath(settings().dir)}
          class="rounded-(--radius) border border-input bg-background px-3 py-2 text-[12px] text-foreground"
        />
      </View>

      <View class="gap-1.5">
        <Text class="text-[11px] font-medium text-foreground">Referer（可选）</Text>
        <Input
          testID="dialog-referer"
          value={referer()}
          onChange={(event) => referer.set(event.value)}
          autoCapitalize="none"
          placeholder="https://example.com/watch/123"
          class="rounded-(--radius) border border-input bg-background px-3 py-2 text-[12px] text-foreground"
        />
      </View>

      <View class="gap-1.5">
        <Text class="text-[11px] font-medium text-foreground">额外请求头（可选）</Text>
        <Input
          testID="dialog-headers"
          value={headers()}
          onChange={(event) => headers.set(event.value)}
          multiline
          autoCapitalize="none"
          placeholder={"Cookie: SESSION=...\nUser-Agent: Mozilla/5.0"}
          class="h-16 rounded-(--radius) border border-input bg-background px-3 py-2 font-mono text-[11px] text-foreground"
        />
        <Text class="text-[10px] text-muted-foreground">每行一条 Name: value；网盘直链的 Cookie 常放在这里。</Text>
      </View>

      <If when={!!failure()}>
        <Text class="text-[11px] text-destructive">{failure()}</Text>
      </If>

      <View class="flex-row items-center gap-2">
        <Text class="flex-1 text-[10px] text-muted-foreground">识别到 {count()} 个链接</Text>
        <Button onPress={close} class="rounded-(--radius) border border-border px-3 py-1.5 active:opacity-60">
          <Text class="text-[12px] text-foreground">取消</Text>
        </Button>
        <Button
          testID="dialog-submit"
          disabled={busy() || count() === 0}
          onPress={() => void submit()}
          class="rounded-(--radius) bg-primary px-4 py-1.5 active:opacity-80 disabled:opacity-40"
        >
          <Text class="text-[12px] font-medium text-primary-foreground">{busy() ? "解析中…" : "开始下载"}</Text>
        </Button>
      </View>
    </Dialog>
  );
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
