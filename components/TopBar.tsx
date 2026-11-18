import { colorScheme, setColorScheme, Text, View } from "nsh";
import { Button, Input } from "nsh/base";
import { Menu, isAvailable as desktopMenu, titleBar, type MenuItem } from "nsh/desktop";
import { formatSpeed } from "../lib/format";
import {
  activeCount,
  engineHint,
  engineInfo,
  engineScan,
  importClipboard,
  items,
  notify,
  pauseMany,
  resumeMany,
  retryMany,
  selection,
  settings,
  totalSpeed,
  updateSettings,
} from "../store";
import { speedModeLabel, type SpeedMode } from "../model";

const MODES: SpeedMode[] = ["unlimited", "low", "medium", "high", "custom"];

export interface TopBarProps {
  search: string;
  onSearch: (value: string) => void;
  onAdd: () => void;
  onSettings: () => void;
  onEngine: () => void;
  onMenu: (at?: { x: number; y: number }) => void;
}

/** The downloads the toolbar acts on: the selection, or the whole list when nothing is selected. */
function targetIds(): string[] {
  const selected = selection();
  return selected.length > 0 ? selected : items().map((item) => item.id);
}

function ToolButton(props: {
  testID?: string;
  glyph: string;
  label: string;
  hint: string;
  onPress: () => void;
  primary?: boolean;
  compact?: boolean;
}) {
  return (
    <Button
      testID={props.testID}
      accessibilityLabel={props.hint}
      onPress={props.onPress}
      class={
        props.primary
          ? "shrink-0 flex-row items-center gap-1.5 rounded-(--radius) bg-primary px-3 py-1.5 active:opacity-80"
          : "shrink-0 flex-row items-center gap-1.5 rounded-(--radius) px-2.5 py-1.5 hover:bg-raised active:opacity-60"
      }
    >
      <Text class={props.primary ? "text-[13px] font-semibold text-primary-foreground" : "text-[13px] text-muted-foreground"}>
        {props.glyph}
      </Text>
      <Text
        class={`${props.primary ? "text-[12px] font-medium text-primary-foreground" : "text-[12px] text-foreground"} ${props.compact ? "hidden lg:flex" : ""}`}
      >
        {props.label}
      </Text>
    </Button>
  );
}

function Separator() {
  return <View class="mx-1 h-5 w-px bg-border" />;
}

export function TopBar(props: TopBarProps) {
  const area = () => titleBar();

  const toggleTheme = () => {
    const next = colorScheme() === "dark" ? "light" : "dark";
    setColorScheme(next);
    updateSettings({ appearance: next });
  };

  const chooseSpeedMode = async () => {
    const current = settings().speedMode;
    if (!desktopMenu) {
      const index = MODES.indexOf(current);
      updateSettings({ speedMode: MODES[(index + 1) % MODES.length] });
      return;
    }
    const entries: MenuItem[] = MODES.map((mode) => ({
      label: speedModeLabel(mode),
      checked: current === mode,
      onSelect: () => updateSettings({ speedMode: mode }),
    }));
    await Menu.popup(entries);
  };

  return (
    <View
      desktop={{ windowDrag: true }}
      class="border-b border-border bg-card"
      style={{
        height: Math.max(48, area().height),
        paddingLeft: area().left + 10,
        paddingRight: area().right + 12,
      }}
    >
      <View class="flex-1 flex-row items-center gap-2">
        <View class="shrink-0 flex-row items-center gap-2 pr-1">
          <View class="size-7 items-center justify-center rounded-(--radius) bg-primary">
            <Text class="text-[15px] font-bold text-primary-foreground">↓</Text>
          </View>
          <View class="hidden flex-col gap-0.5 md:flex" style={{ minWidth: 0 }}>
            <Text class="text-[13px] font-semibold text-foreground">Downloader</Text>
            <Text class="text-[10px] text-muted-foreground">
              {activeCount() > 0 ? `${formatSpeed(totalSpeed())} · ${activeCount()} 个进行中` : `${items().length} 个任务`}
            </Text>
          </View>
        </View>

        <Separator />
        <ToolButton testID="tool-add" glyph="＋" label="新建下载" hint="新建下载" primary onPress={props.onAdd} />
        <ToolButton
          testID="tool-start"
          glyph="▶"
          label="开始"
          hint="开始选中的下载；没有选中时开始全部"
          compact
          onPress={() => resumeMany(targetIds())}
        />
        <ToolButton
          testID="tool-pause"
          glyph="⏸"
          label="暂停"
          hint="暂停选中的下载；没有选中时暂停全部"
          compact
          onPress={() => pauseMany(targetIds())}
        />
        <ToolButton
          testID="tool-retry"
          glyph="⟳"
          label="重试"
          hint="重试失败的下载"
          compact
          onPress={() => retryMany(targetIds())}
        />
        <ToolButton
          testID="tool-clipboard"
          glyph="⧉"
          label="剪贴板"
          hint="从剪贴板导入链接"
          compact
          onPress={() => {
            void importClipboard().then((result) => notify(result.message, result.ok ? "success" : "error"));
          }}
        />

        <View class="flex-1" />

        <View class="hidden flex-row items-center gap-1.5 md:flex">
          <Input
            testID="search-input"
            value={props.search}
            onChange={(event) => props.onSearch(event.value)}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="搜索下载…"
            class="w-44 rounded-(--radius) border border-input bg-background px-2.5 py-1.5 text-[12px] text-foreground"
          />
        </View>

        <Button
          testID="speed-mode"
          accessibilityLabel="流量模式"
          onPress={() => void chooseSpeedMode()}
          class="shrink-0 flex-row items-center gap-1 rounded-(--radius) border border-border px-2.5 py-1.5 hover:bg-raised active:opacity-60"
        >
          <Text class="hidden text-[11px] text-muted-foreground lg:flex">限速</Text>
          <Text class="text-[11px] font-medium text-foreground">{speedModeLabel(settings().speedMode)}</Text>
        </Button>

        <Button
          accessibilityLabel={engineHint()}
          onPress={props.onEngine}
          class="shrink-0 flex-row items-center gap-1.5 rounded-(--radius-pill) border border-border px-2.5 py-1 hover:bg-raised active:opacity-60"
        >
          <View
            class={
              engineInfo().aria2
                ? "size-1.5 rounded-full bg-success"
                : engineInfo().curl
                  ? "size-1.5 rounded-full bg-warning"
                  : "size-1.5 rounded-full bg-muted-foreground"
            }
          />
          <Text class="hidden text-[11px] text-muted-foreground lg:flex">
            {engineScan() ? "检测中" : engineInfo().aria2 ? "aria2c" : engineInfo().curl ? "curl" : "内置"}
          </Text>
        </Button>

        <Button
          accessibilityLabel="切换深浅色"
          onPress={toggleTheme}
          class="shrink-0 rounded-(--radius) px-2 py-1.5 hover:bg-raised active:opacity-60"
        >
          <Text class="text-[13px] text-muted-foreground">{colorScheme() === "dark" ? "☀" : "☾"}</Text>
        </Button>

        <Button
          testID="nav-settings"
          accessibilityLabel="设置"
          onPress={props.onSettings}
          class="shrink-0 rounded-(--radius) px-2 py-1.5 hover:bg-raised active:opacity-60"
        >
          <Text class="text-[14px] text-muted-foreground">⚙</Text>
        </Button>

        <Button
          testID="app-menu"
          accessibilityLabel="应用菜单"
          onPress={() => props.onMenu()}
          class="shrink-0 rounded-(--radius) px-2 py-1.5 hover:bg-raised active:opacity-60"
        >
          <Text class="text-[14px] text-muted-foreground">☰</Text>
        </Button>
      </View>
    </View>
  );
}
