import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./bridge";

export async function copyLink(url: string): Promise<void> {
  if (isTauri()) await invoke("clipboard_write_text", { text: url });
  else await navigator.clipboard.writeText(url);
}
