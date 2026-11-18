import { appInfo, openUrl, platform, signal } from "nsh";
import { checkForUpdate, downloadUpdate, installAndRestart, type AppUpdate } from "nsh/updater";

export type UpdatePhase = "idle" | "checking" | "current" | "available" | "downloading" | "installing" | "error";

export const updatePhase = signal<UpdatePhase>("idle");
export const updateApp = signal<AppUpdate | null>(null);
export const updateProgress = signal(0);
export const updateMessage = signal("");

/** The version this code was built as, from `nsh.json` (or the packaging flag). */
export function currentVersion(): string {
  return appInfo().version ?? "未知";
}

export function currentBuild(): number | null {
  return appInfo().build;
}

/** Updates are unavailable in development runs and on the web, where a deploy ships the code. */
export function updaterSupported(): boolean {
  return !appInfo().development && platform.os !== "web";
}

export function updateHint(): string {
  if (platform.os === "web") return "网页版随部署自动更新";
  if (appInfo().development) return "开发运行不检查更新";
  return "更新来自 GitHub Releases";
}

/** Asks the source configured in `nsh.json`; resolves with what it found, if anything. */
export async function checkUpdates(): Promise<AppUpdate | null> {
  if (!updaterSupported()) {
    updatePhase.set("idle");
    updateMessage.set(updateHint());
    return null;
  }
  if (updatePhase() === "checking" || updatePhase() === "downloading" || updatePhase() === "installing") {
    return updateApp();
  }

  updatePhase.set("checking");
  updateMessage.set("正在检查更新…");
  try {
    const found = await checkForUpdate();
    updateApp.set(found);
    if (found) {
      updatePhase.set("available");
      updateMessage.set(`发现新版本 ${found.version}`);
    } else {
      updatePhase.set("current");
      updateMessage.set("已是最新版本");
    }
    return found;
  } catch (error) {
    updateApp.set(null);
    updatePhase.set("error");
    updateMessage.set(`检查更新失败：${reason(error)}`);
    return null;
  }
}

/** Downloads and installs the update found last, or opens its page where the app cannot replace itself. */
export async function installUpdate(): Promise<void> {
  const found = updateApp();
  if (!found) return;
  if (!found.canInstall) {
    updateMessage.set("这个平台需要手动下载新版本");
    await openUpdatePage();
    return;
  }

  updatePhase.set("downloading");
  updateProgress.set(0);
  updateMessage.set("正在下载更新…");
  try {
    await downloadUpdate(({ received, total }) => {
      if (total) {
        const fraction = Math.min(1, received / total);
        updateProgress.set(fraction);
        updateMessage.set(`正在下载更新 ${Math.round(fraction * 100)}%`);
      } else {
        updateMessage.set("正在下载更新…");
      }
    });
    updatePhase.set("installing");
    updateMessage.set("正在安装并重启…");
    await installAndRestart();
  } catch (error) {
    updatePhase.set("error");
    updateMessage.set(`更新失败：${reason(error)}`);
  }
}

/** Opens the archive or store page the update points to. */
export async function openUpdatePage(): Promise<void> {
  const url = updateApp()?.url;
  if (!url) return;
  try {
    const { opened } = await openUrl(url);
    if (!opened) updateMessage.set("没有能打开这个链接的应用");
  } catch (error) {
    updateMessage.set(`打开链接失败：${reason(error)}`);
  }
}

function reason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
