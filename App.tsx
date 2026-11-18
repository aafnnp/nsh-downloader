import { colorScheme, effect, keymap, mount, setColorScheme, signal, View } from "nsh";
import { Menu, currentWindow, isAvailable as desktopWindow, type MenuItem } from "nsh/desktop";
import { TopBar } from "./components/TopBar";
import { Sidebar, type NavKey } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { DetailsPane } from "./components/DetailsPane";
import { AddDialog } from "./components/AddDialog";
import { SettingsDialog, type SettingsSection } from "./components/SettingsDialog";
import { DownloadsPage } from "./pages/DownloadsPage";
import {
  bootstrap,
  clearFinished,
  importClipboard,
  importFiles,
  notify,
  pause,
  pauseAll,
  removeMany,
  resume,
  resumeAll,
  selectedItem,
  selection,
  updateSettings,
} from "./store";
import { CATEGORY_ORDER, type Category } from "./model";
import { checkUpdates, updaterSupported } from "./lib/update";

function App() {
  const nav = signal<NavKey>("all");
  const search = signal("");
  const adding = signal(false);
  const settingsOpen = signal(false);
  const settingsSection = signal<SettingsSection>("general");
  const detailsOpen = signal(false);

  const win = desktopWindow ? currentWindow() : null;
  effect(() => {
    if (!win) return;
    try {
      win.set({ titleBar: { style: "hidden", height: 48 } });
    } catch {
      // A host that keeps its own title bar still shows the toolbar below it.
    }
  });

  void bootstrap();

  // A packaged app looks once after startup; a development run and the web skip it.
  if (updaterSupported()) {
    setTimeout(() => {
      void checkUpdates().then((found) => {
        if (found) notify(`发现新版本 ${found.version}，可在 设置 → 关于 中更新`);
      });
    }, 3000);
  }

  const openAdd = () => adding.set(true);
  const openSettings = (section: SettingsSection = "general") => {
    settingsSection.set(section);
    settingsOpen.set(true);
  };

  const toggleTheme = () => {
    const next = colorScheme() === "dark" ? "light" : "dark";
    setColorScheme(next);
    updateSettings({ appearance: next });
  };

  const menu = async () => {
    if (!desktopWindow) return;
    const entries: MenuItem[] = [
      { label: "新建下载…", shortcut: "mod+n", onSelect: openAdd },
      {
        label: "从剪贴板导入",
        shortcut: "mod+v",
        onSelect: () => {
          void importClipboard().then((result) => notify(result.message, result.ok ? "success" : "error"));
        },
      },
      { type: "separator" },
      { label: "全部开始", onSelect: () => resumeAll() },
      { label: "全部暂停", onSelect: () => pauseAll() },
      {
        label: "清除已完成",
        onSelect: () => {
          const removed = clearFinished();
          notify(removed > 0 ? `已清除 ${removed} 条记录` : "没有可清除的记录");
        },
      },
      { type: "separator" },
      { label: detailsOpen() ? "隐藏详细信息" : "显示详细信息", onSelect: () => detailsOpen.update((open) => !open) },
      { label: "切换深浅色", onSelect: toggleTheme },
      { type: "separator" },
      { label: "设置…", shortcut: "mod+,", onSelect: () => openSettings("general") },
      { label: "调度器…", onSelect: () => openSettings("scheduler") },
      {
        label: "检查更新…",
        onSelect: () => {
          openSettings("about");
          void checkUpdates();
        },
      },
      { type: "separator" },
      { label: "退出", role: "quit" },
    ];
    await Menu.popup(entries);
  };

  keymap.bind("mod+n", openAdd);
  keymap.bind("mod+,", () => openSettings("general"));
  keymap.bind("mod+v", () => {
    void importClipboard().then((result) => notify(result.message, result.ok ? "success" : "error"));
  });
  keymap.bind("mod+1", () => nav.set("all"));
  keymap.bind("mod+2", () => nav.set("unfinished"));
  keymap.bind("mod+3", () => nav.set("finished"));
  keymap.bind("mod+4", () => nav.set("failed"));
  keymap.bind("mod+5", () => nav.set(CATEGORY_ORDER[0]));
  keymap.bind("delete", () => {
    if (selection().length > 0) removeMany(selection());
  });
  keymap.bind("space", () => {
    const item = selectedItem();
    if (!item) return;
    if (item.status === "running" || item.status === "queued") pause(item.id);
    else resume(item.id);
  });

  const drop = (event: { uris: string[] }) => {
    if (event.uris.length === 0) return;
    void importFiles(event.uris).then((result) => notify(result.message, result.ok ? "success" : "error"));
  };

  return (
    <View testID="app-root" class="flex-1 bg-background" onFileDrop={drop}>
      <TopBar
        search={search()}
        onSearch={(value) => search.set(value)}
        onAdd={openAdd}
        onSettings={() => openSettings()}
        onEngine={() => openSettings("network")}
        onMenu={() => void menu()}
      />

      <View class="flex-1 flex-row" style={{ minHeight: 0 }}>
        <Sidebar
          nav={nav()}
          onNav={(next) => {
            nav.set(next);
            if (next === "all") search.set("");
          }}
          onSettings={() => openSettings("general")}
          onSettingsSection={(section) => openSettings(section)}
        />
        <DownloadsPage
          nav={nav()}
          search={search()}
          onOpenAdd={openAdd}
          onToggleDetails={() => detailsOpen.update((open) => !open)}
          detailsOpen={detailsOpen()}
        />
        <DetailsPane open={detailsOpen()} onClose={() => detailsOpen.set(false)} />
      </View>

      <StatusBar />

      <If when={adding()}>
        <AddDialog
          open={adding()}
          onOpenChange={(open) => adding.set(open)}
          initialCategory={nav() !== "all" && nav() !== "unfinished" && nav() !== "finished" && nav() !== "failed" ? (nav() as Category) : "auto"}
        />
      </If>

      <If when={settingsOpen()}>
        <SettingsDialog initialSection={settingsSection()} onOpenChange={(open) => settingsOpen.set(open)} />
      </If>
    </View>
  );
}

mount(App);
