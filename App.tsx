import { keymap, mount, signal, View } from "nsh";
import { AddDialog } from "./components/AddDialog";
import { Sidebar, type Filter, type Page } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { DownloadsPage } from "./pages/DownloadsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { bootstrap, importClipboard, notify } from "./store";

function App() {
  const page = signal<Page>("downloads");
  const filter = signal<Filter>("all");
  const adding = signal(false);

  void bootstrap();

  const openAdd = () => adding.set(true);

  keymap.bind("mod+n", openAdd);
  keymap.bind("mod+v", () => {
    void importClipboard().then((result) => notify(result.message, result.ok ? "success" : "error"));
  });
  keymap.bind("mod+1", () => page.set("downloads"));
  keymap.bind("mod+2", () => page.set("settings"));

  return (
    <View class="flex-1 bg-background">
      <TitleBar page={page()} onAdd={openAdd} />
      <View class="flex-1 flex-row" style={{ minHeight: 0 }}>
        <Sidebar
          filter={filter()}
          page={page()}
          onFilter={(next) => {
            filter.set(next);
            page.set("downloads");
          }}
          onPage={(next) => page.set(next)}
        />
        <View class="flex-1" style={{ minWidth: 0 }}>
          <If when={page() === "downloads"}>
            <DownloadsPage filter={filter()} onOpenAdd={openAdd} />
          </If>
          <If when={page() === "settings"}>
            <SettingsPage />
          </If>
        </View>
      </View>
      <StatusBar />
      <AddDialog open={adding()} onOpenChange={(open) => adding.set(open)} />
    </View>
  );
}

mount(App);
