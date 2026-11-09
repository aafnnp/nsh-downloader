import { colorScheme, setColorScheme, Text, View } from "nsh";
import { Button } from "nsh/base";
import { titleBar } from "nsh/desktop";
import { engineHint, engineInfo, engineScan, items, updateSettings } from "../store";
import type { Page } from "./Sidebar";

const TITLES: Record<Page, string> = {
  downloads: "下载",
  settings: "设置",
};

export interface TitleBarProps {
  page: Page;
  onAdd: () => void;
}

/** The app's own title bar; `bootstrap` hides the system's and this one drags the window. */
export function TitleBar(props: TitleBarProps) {
  const toggleTheme = () => {
    const next = colorScheme() === "dark" ? "light" : "dark";
    setColorScheme(next);
    updateSettings({ appearance: next });
  };

  return (
    <View
      desktop={{ windowDrag: true }}
      class="border-b border-border bg-card"
      style={{
        height: titleBar().height || 52,
        paddingLeft: titleBar().left + 14,
        paddingRight: titleBar().right + 10,
      }}
    >
      <View class="flex-1 flex-row items-center gap-3">
        <View class="size-7 items-center justify-center rounded-[8px] bg-primary">
          <Text class="text-[15px] font-bold text-primary-foreground">↓</Text>
        </View>
        <View class="gap-0.5">
          <Text class="text-[13px] font-semibold text-foreground">Downloader</Text>
          <Text class="text-[10px] text-muted-foreground">
            {TITLES[props.page]} · {items().length} 项
          </Text>
        </View>

        <View class="flex-1" />

        <View
          class="flex-row items-center gap-1.5 rounded-(--radius-pill) border border-border px-2.5 py-1"
          accessibilityLabel={engineHint()}
        >
          <View class={engineInfo().aria2 ? "size-1.5 rounded-full bg-success" : engineInfo().curl ? "size-1.5 rounded-full bg-warning" : "size-1.5 rounded-full bg-muted-foreground"} />
          <Text class="text-[11px] text-muted-foreground">
            {engineScan() ? "检测引擎…" : engineInfo().aria2 ? "aria2c" : engineInfo().curl ? "curl" : "内置"}
          </Text>
        </View>

        <Button onPress={toggleTheme} accessibilityLabel="切换深浅色" class="rounded-(--radius-pill) px-2.5 py-1 active:opacity-60">
          <Text class="text-[13px] text-muted-foreground">{colorScheme() === "dark" ? "☀" : "☾"}</Text>
        </Button>

        <Button
          testID="nav-add"
          onPress={props.onAdd}
          accessibilityLabel="新建下载"
          class="rounded-(--radius) bg-primary px-3 py-1.5 active:opacity-80"
        >
          <Text class="text-[12px] font-medium text-primary-foreground">＋ 新建下载</Text>
        </Button>
      </View>
    </View>
  );
}
