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

export async function exportBackup(state: ExportState, pushToast: PushToast) {
  const full = await loadFullHistory();
  const bundle = buildExportBundle({
    ...state,
    messages: full
      ? mergeById(full.messages as Message[], state.messages).sort((a, b) =>
          a.sentAt.localeCompare(b.sentAt)
        )
      : state.messages,
    activities: full
      ? mergeById(full.activities as Activity[], state.activities).sort((a, b) =>
          b.at.localeCompare(a.at)
        )
      : state.activities,
  });
  downloadJson(
    `wap-plus-backup-${new Date().toISOString().slice(0, 10)}.json`,
    bundle
  );
  pushToast("已导出 JSON 备份（不含 API Key）", "success");
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
