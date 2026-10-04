import {
  buildExportBundle,
  contactsToCsv,
  downloadJson,
  downloadText,
} from "@/lib/exportData";
import type {
  Activity,
  ChatPreview,
  Contact,
  FollowUp,
  Message,
  PhoneDevice,
} from "@/types/crm";
import type { AppSettings } from "./appStore";
import type { BroadcastCampaign } from "@/types/broadcast";
import { readMediaCache, waitForMediaCacheWrites } from "@/lib/mediaCache";
import { loadFullHistory } from "@/lib/storage";

type ExportState = {
  phones: PhoneDevice[];
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  followUps: FollowUp[];
  activities: Activity[];
  broadcastCampaigns: BroadcastCampaign[];
  settings: AppSettings;
};

type PushToast = (message: string, tone?: "info" | "success" | "error") => void;

function mergeById<T extends { id: string }>(disk: T[], memory: T[]): T[] {
  const merged = new Map(disk.map((row) => [row.id, row]));
  for (const row of memory) merged.set(row.id, row);
  return [...merged.values()];
}

export async function createBackupBundle(state: ExportState, includeMedia = false) {
  const full = await loadFullHistory();
  const messages = full ? mergeById(full.messages as Message[], state.messages) : [...state.messages];
  let mediaChars = 0;
  let attached = 0;
  if (includeMedia) {
    await waitForMediaCacheWrites();
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index]!;
      const mediaUrl = message.mediaUrl?.startsWith("data:")
        ? message.mediaUrl : await readMediaCache(message.id, true);
      if (!mediaUrl?.startsWith("data:")) continue;
      if (mediaUrl.length > 24 * 1024 * 1024) throw new Error("单个附件超过 24 MB，无法导出");
      mediaChars += mediaUrl.length;
      if (mediaChars > 128 * 1024 * 1024) throw new Error("附件总量超过 128 MB，请分批备份");
      messages[index] = { ...message, mediaUrl, mediaPending: false };
      attached++;
    }
  }
  const bundle = buildExportBundle({
    ...state,
    includeMedia,
    messages: [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    activities: full
      ? mergeById(full.activities as Activity[], state.activities).sort((a, b) =>
          b.at.localeCompare(a.at)
        )
      : state.activities,
  });
  return { bundle, attached };
}

export async function exportBackup(state: ExportState, pushToast: PushToast, includeMedia = false) {
  const { bundle, attached } = await createBackupBundle(state, includeMedia);
  downloadJson(
    `wap-plus-backup-${new Date().toISOString().slice(0, 10)}.json`,
    bundle
  );
  pushToast(`已导出 JSON 备份：${bundle.messages.length} 条消息，${attached} 个本机附件（不含密钥）`, "success");
}

export function exportContactsCsv(
  contacts: Contact[],
  pushToast: PushToast
) {
  downloadText(
    `wap-plus-contacts-${new Date().toISOString().slice(0, 10)}.csv`,
    contactsToCsv(contacts),
    "text/csv;charset=utf-8"
  );
  pushToast("已导出联系人 CSV", "success");
}
