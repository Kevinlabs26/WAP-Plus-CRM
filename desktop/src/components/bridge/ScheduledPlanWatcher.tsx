import { useEffect } from "react";
import { flushPersist, useAppStore } from "@/store/appStore";
import { withSendGate, sendRuntimeFromSettings } from "@/channels";
import { baileysSend, baileysSendImage, baileysSendDocument, baileysSendVoice, baileysSendVideo } from "@/lib/baileysSend";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { activePlanStep, nextBatchTask, scheduledPlanTargets } from "@/lib/scheduledPlans";
import { updateScheduledPlan } from "@/lib/scheduledPlanActions";
import { createScheduledPlanRunner } from "@/lib/scheduledPlanRunner";
import { translateCurrent, type TranslationKey } from "@/i18n";
import { isDataRestoreActive } from "@/store/restoreGuard";

export function ScheduledPlanWatcher() {
  useEffect(() => {
    const runner = createScheduledPlanRunner({
      plans: () => useAppStore.getState().settings.scheduledPlans || [],
      ready: () => { const state = useAppStore.getState(); return state.hydrated && state.uiReady && !isDataRestoreActive(); },
      update: updateScheduledPlan,
      hasTurn: id => {const s=useAppStore.getState();return nextBatchTask(s.settings.scheduledPlans || [],s.broadcastCampaigns || [])===id;},
      availability: item => {
        if (item.retired) return "missing";
        const state = useAppStore.getState();
        const target = scheduledPlanTargets(state, [item.chatId])[0];
        if (!target || target.accountId !== item.accountId || target.recipient !== item.recipient) return "missing";
        return isWaAccountConnected(state.settings.waAccounts, item.accountId, state.settings.liveBaileysAccountId, state.baileysUi.connection) ? "ready" : "offline";
      },
      enqueue: (plan, item) => {
        const state = useAppStore.getState();
        const step = activePlanStep(plan,item);
        if (!step) return null;
        if (item.messageId && state.messages.some(message => message.id === item.messageId && message.systemKind === "scheduled_plan")) {
          state.updateMessageDelivery(item.messageId, { deliveryStatus: "pending", lastError: undefined, deliveryUncertain: false });
          return item.messageId;
        }
        const id = state.enqueueOutgoingMessage({ chatId: item.chatId, contactId: item.contactId, phoneE164: item.recipient, accountId: item.accountId,
          channelId: "baileys", systemKind: "scheduled_plan", deliveryStatus: "pending", body: step.text || step.media?.fileName || "[文件]" });
        if (id && step.media) state.patchMessage(id, { mediaType: step.media.kind === "image" && step.media.size <= 6 * 1024 * 1024 ? "image" : plan.nativeMedia && step.media.kind === "audio" && !step.text ? "audio" : plan.nativeMedia && step.media.kind === "video" && step.media.mimeType === "video/mp4" ? "video" : "document",
          mediaUrl: step.media.dataUrl, mediaMime: step.media.mimeType, mediaCaption: step.text, mediaFileName: step.media.fileName, mediaPtt:false });
        return id;
      },
      send: async (plan, item, canSend) => {
        const state = useAppStore.getState();
        const step = activePlanStep(plan,item);
        if (!step) return {ok:false,error:"planQueue.invalidContent"};
        try {
          const outcome = await withSendGate({ accountId: item.accountId, phoneE164: item.recipient }, sendRuntimeFromSettings(state.settings, state.messages), async () => {
            if (!canSend()) return { ok: false, error: "automation_cancelled", message: translateCurrent("planQueue.stopped") };
            if (!step.media) return baileysSend(item.recipient, step.text, { accountId: item.accountId });
            if (step.media.kind === "image" && step.media.size <= 6 * 1024 * 1024) return baileysSendImage(item.recipient, step.media.dataUrl, step.text, { accountId: item.accountId });
            if (plan.nativeMedia && step.media.kind === "audio" && !step.text) return baileysSendVoice(item.recipient,step.media.dataUrl,{accountId:item.accountId,mimetype:step.media.mimeType,ptt:false});
            if (plan.nativeMedia && step.media.kind === "video" && step.media.mimeType === "video/mp4") return baileysSendVideo(item.recipient,step.media.dataUrl,step.text,item.accountId,canSend);
            return baileysSendDocument(item.recipient, step.media.dataUrl, step.media.fileName, { accountId: item.accountId, caption: step.text, mimetype: step.media.mimeType });
          }, step.gapSec || plan.gapSec);
          if (!outcome.ok) return { ok: false, error: outcome.gate.error, message: outcome.gate.reason, retryAfterMs: outcome.gate.retryAfterMs };
          const result = outcome.result;
          return { ok: result.ok !== false, error: "error" in result && result.error ? String(result.error) : undefined,
            message: "message" in result && result.message ? String(result.message) : undefined,
            uncertain: "error" in result && result.error === "baileys_delivery_unknown", remoteId: "id" in result ? String(result.id) : undefined };
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
          const uncertain = !(error && typeof error === "object" && "deliveryUncertain" in error && error.deliveryUncertain === false);
          return { ok: false, uncertain, error: code,
            message: code === "native_video_unsupported" ? translateCurrent("planQueue.videoUnsupported") : error instanceof Error ? error.message : translateCurrent("planQueue.failed") };
        }
      },
      finish: (id, result) => {
        const error = result.message || result.error;
        useAppStore.getState().updateMessageDelivery(id, { deliveryStatus: result.ok ? "sent" : "failed", deliveryUncertain: result.uncertain === true,
          waMessageId: result.remoteId, lastError: error?.startsWith("planQueue.") ? translateCurrent(error as TranslationKey) : error, nextAttemptAt: undefined });
      },
    });
    const timer = window.setInterval(() => void runner.tick(), 1000);
    void runner.tick();
    return () => { runner.stop(); window.clearInterval(timer); void flushPersist(() => useAppStore.getState()).catch(() => undefined); };
  }, []);
  return null;
}
