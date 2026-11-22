import { AlertDialog } from "nsh/base";
import type { Item } from "../model";
import { deleteItems, itemById, notify } from "../store";

/**
 * Asks what happens to the download's file before its row goes: deleting a
 * file cannot be undone, so the destructive choice is never the default.
 */
export async function confirmRemove(ids: string[]): Promise<void> {
  const going = [...new Set(ids)]
    .map((id) => itemById(id))
    .filter((item): item is Item => item !== undefined);
  if (going.length === 0) return;

  const one = going.length === 1 ? going[0] : null;
  const { action } = await AlertDialog.show({
    title: one ? `删除「${one.filename}」？` : `删除 ${going.length} 个下载？`,
    description: one?.torrent
      ? "「仅删除任务」保留已下载的内容；「同时删除文件」会删掉这个任务自己的整个文件夹。"
      : "「仅删除任务」保留磁盘上已下载的内容；「同时删除文件」会连同文件一起删掉。",
    actions: [
      { id: "cancel", label: "取消", role: "cancel" },
      { id: "task", label: "仅删除任务" },
      { id: "files", label: "同时删除文件", role: "destructive" },
    ],
  });
  if (action !== "task" && action !== "files") return;

  const withFiles = action === "files";
  await deleteItems(
    going.map((item) => item.id),
    withFiles,
  );
  if (one) notify(withFiles ? `已删除「${one.filename}」及文件` : `已移除「${one.filename}」`);
  else notify(withFiles ? `已删除 ${going.length} 个下载及文件` : `已移除 ${going.length} 个下载`);
}
