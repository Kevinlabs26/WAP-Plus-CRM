import { bridgeInvoke } from "@/lib/bridge";

type OpenAndroidMediaShareDeps = {
  file: File;
  dataUrl: string;
  caption: string;
  phoneE164: string;
  selectedPhoneId: string | null;
};

export async function openAndroidMediaShare({
  file,
  dataUrl,
  caption,
  phoneE164,
  selectedPhoneId,
}: OpenAndroidMediaShareDeps) {
  const result = await bridgeInvoke<{ opened?: boolean; note?: string }>(
    "send_whatsapp_media",
    {
      deviceId: selectedPhoneId,
      phoneE164,
      dataUrl,
      fileName: file.name,
      mime: file.type || "application/octet-stream",
      caption: caption || null,
    }
  );
  if (!result.opened) throw new Error(result.note || "手机未打开分享页");
  // 分享页还需用户在手机上确认，桌面端无法证明已送达。
  return { ...result, delivered: false };
}
