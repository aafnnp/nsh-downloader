import { Application, isAvailable } from "nsh/desktop";
import processModule from "process";

/** Desktops restart themselves; a browser preview has no lifecycle of its own. */
export const canRestart = isAvailable;

/**
 * `nsh run` exports the project it serves; its development host quits on
 * `restart()` and never starts again, because the dev server ends with it.
 */
export function developmentDir(): string {
  try {
    return processModule.env.NSH_DEV_APP_DIR ?? "";
  } catch {
    return "";
  }
}

/** Whether `Application.restart()` brings the app back on this run. */
export function canRelaunch(): boolean {
  return canRestart && !developmentDir();
}

/** Quits and starts the app again; the saved queue comes back with unfinished rows paused. */
export function restartApp(): boolean {
  if (!canRelaunch()) return false;
  try {
    Application.restart();
    return true;
  } catch {
    return false;
  }
}
