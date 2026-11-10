import { useAppStore } from "@/store/appStore";

export type ImageGenerationRequest = { source: string; title: string; chatId: string | null; mode: "style" | "portrait" };
let pending: ImageGenerationRequest | null = null;
export function requestImageGeneration(request: ImageGenerationRequest) {
  if (!request.source || !/^(data:image\/(?:png|jpe?g|webp|gif);base64,|blob:|https?:\/\/)/i.test(request.source)) throw Error("请先加载图片");
  pending = request;
  const store = useAppStore.getState();
  store.setCrmPanelCollapsed(false);
  store.setCrmPanelTab("images");
  window.dispatchEvent(new Event("wap:image-generation-request"));
}
export function takeImageGenerationRequest() { const request = pending; pending = null; return request; }
