import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { hideOverlay, showOverlayCard } from "@/lib/bridge";
import { SALES_STAGE_LABEL } from "@/lib/contactWorkflow";
import type { Contact } from "@/types/crm";

type UseOverlayContactCardArgs = {
  isBaileys: boolean;
  bridgeConnected: boolean;
  selectedChatId: string | null;
  selectedPhoneId: string | null;
  activeContact: Contact | undefined;
};

/**
 * Android Bridge 悬浮客户卡：跟随当前会话在手机侧展示联系人摘要卡片；
 * 离开会话/切换设备时隐藏并重设签名避免重复推送。
 */
export function useOverlayContactCard({
  isBaileys,
  bridgeConnected,
  selectedChatId,
  selectedPhoneId,
  activeContact,
}: UseOverlayContactCardArgs) {
  const pushToast = useAppStore((s) => s.pushToast);
  const overlaySignatureRef = useRef<string | null>(null);
  const overlayDeviceRef = useRef<string | undefined>(undefined);
  const overlayErrorRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const deviceId = selectedPhoneId ?? undefined;
    overlayDeviceRef.current = deviceId;
    if (isBaileys || !bridgeConnected || !selectedChatId || !activeContact) {
      if (overlaySignatureRef.current) {
        overlaySignatureRef.current = null;
        void hideOverlay(deviceId).catch(() => undefined);
      }
      return;
    }

    const card = {
      contactName: activeContact.name,
      tags: activeContact.tags,
      stage: SALES_STAGE_LABEL[activeContact.stage] ?? activeContact.stage,
      nextFollowUp: activeContact.nextFollowUpAt,
      aiSummary: activeContact.aiSummary,
    };
    const signature = JSON.stringify([deviceId, card]);
    if (overlaySignatureRef.current === signature) return;
    overlaySignatureRef.current = signature;
    void showOverlayCard(deviceId, card)
      .then(() => {
        if (!cancelled) overlayErrorRef.current = null;
      })
      .catch((error) => {
        if (cancelled) return;
        overlaySignatureRef.current = null;
        const message = error instanceof Error ? error.message : String(error);
        if (overlayErrorRef.current === message) return;
        overlayErrorRef.current = message;
        pushToast(
          message.includes("permission") || message.includes("权限")
            ? "请先在手机设置中开启 WAP Plus Bridge 的悬浮窗权限"
            : `悬浮客户卡显示失败：${message}`,
          "error"
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeContact,
    bridgeConnected,
    isBaileys,
    pushToast,
    selectedChatId,
    selectedPhoneId,
  ]);

  useEffect(
    () => () => {
      if (overlaySignatureRef.current) {
        void hideOverlay(overlayDeviceRef.current).catch(() => undefined);
      }
    },
    []
  );
}