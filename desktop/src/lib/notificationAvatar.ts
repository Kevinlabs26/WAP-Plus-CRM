import { avatarInitials } from "@/lib/utils";

/** Windows toast accepts PNG/JPEG; reuse only cached images, never fetch a remote URL. */
export async function notificationAvatar(src?: string, name?: string): Promise<string | undefined> {
  if (typeof document === "undefined") return undefined;
  const local = src && src.length <= 4_800_000 &&
    (/^data:image\/(png|jpe?g|webp|avif|gif);base64,/i.test(src) || src.startsWith("blob:"));
  if (!local && !name) return undefined;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    let image: HTMLImageElement | undefined;
    if (local) {
      image = await new Promise<HTMLImageElement | undefined>((resolve) => {
        const candidate = new Image();
        const finish = (loaded?: HTMLImageElement) => {
          clearTimeout(timer);
          candidate.onload = candidate.onerror = null;
          if (!loaded) candidate.src = "";
          resolve(loaded);
        };
        const timer = setTimeout(() => finish(), 1500);
        candidate.onload = () => finish(
          candidate.naturalWidth > 0 && candidate.naturalHeight > 0 &&
          candidate.naturalWidth * candidate.naturalHeight <= 16_000_000 ? candidate : undefined
        );
        candidate.onerror = () => finish();
        candidate.src = src!;
      });
    }
    if (image) {
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2, side, side, 0, 0, 96, 96);
    } else if (name) {
      context.fillStyle = "#166534";
      context.fillRect(0, 0, 96, 96);
      context.fillStyle = "#ffffff";
      context.font = "600 40px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(avatarInitials(name), 48, 50);
    } else {
      return undefined;
    }
    return canvas.toDataURL("image/png");
  } catch {
    // An unavailable avatar must never prevent delivery of the message notification.
    return undefined;
  }
}
