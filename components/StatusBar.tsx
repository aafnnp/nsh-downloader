import { colorScheme, Text, View } from "nsh";
import { formatSpeed } from "../lib/format";
import { activeCount, engineHint, notice, queuedCount, ready, totalSpeed } from "../store";

export function StatusBar() {
  const tone = () => {
    const current = notice();
    if (!current) return "text-muted-foreground";
    return current.tone === "error" ? "text-destructive" : current.tone === "success" ? "text-success" : "text-foreground";
  };

  return (
    <View class="flex-row items-center gap-3 border-t border-border bg-card px-4" style={{ height: 28 }}>
      <View class="flex-row items-center gap-1.5">
        <View class={ready() ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-warning"} />
        <Text class="text-[10px] text-muted-foreground">{ready() ? engineHint() : "启动中…"}</Text>
      </View>
      <View class="flex-1" />
      <If when={!!notice()}>
        <Text class={`text-[10px] ${tone()}`}>{notice()?.text}</Text>
      </If>
      <View class="flex-1" />
      <Text class="text-[10px] text-muted-foreground">
        {activeCount() > 0 ? formatSpeed(totalSpeed()) : "0 B/s"}
      </Text>
      <Text class="text-[10px] text-muted-foreground">排队 {queuedCount()}</Text>
      <Text class="text-[10px] text-muted-foreground">{colorScheme() === "dark" ? "深色" : "浅色"}</Text>
    </View>
  );
}
