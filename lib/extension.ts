import { writeFile } from "fs/promises";
import { extensionArchive } from "./extension-asset";
import { defaultDownloadDir, uniquePath, writableDir } from "./paths";

/** The file `tools/build-extension.sh` makes, in the app and in a release. */
export const EXTENSION_ARCHIVE_NAME = "Downloader-extension.zip";

/** The folder inside the archive: what Chrome's "Load unpacked" points at. */
export const EXTENSION_FOLDER_NAME = "Downloader-extension";

/**
 * Where the release publishes the archive, next to the app packages (`nsh.json`
 * names the repository in `updater.github`). `latest` needs no version, so a
 * build without the bundled archive can still hand out a working address.
 */
export const EXTENSION_RELEASE_URL = `https://github.com/aafnnp/nsh-downloader/releases/latest/download/${EXTENSION_ARCHIVE_NAME}`;

/** Whether this build carries the archive: `tools/package.sh` adds it, a dev run does not. */
export function hasExtensionArchive(): boolean {
  return extensionArchive !== null;
}

/**
 * Writes the bundled archive into `dir` (default: the user's Downloads) and
 * returns its path. `null` when this build ships none; rejects when the file
 * cannot be read or written.
 */
export async function saveExtensionArchive(dir = defaultDownloadDir()): Promise<string | null> {
  if (!extensionArchive) return null;
  // `asset:/` resolves beside the bundle when packaged and in the repository in a dev run.
  const response = await fetch(extensionArchive);
  if (!response.ok) throw new Error(`读取扩展包失败（HTTP ${response.status}）`);
  const target = await uniquePath(await writableDir(dir), EXTENSION_ARCHIVE_NAME);
  await writeFile(target, await response.bytes());
  return target;
}
