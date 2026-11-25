import { museWebAccounts, nextMuseAutoReplyAccount, type MuseWebAccountPool } from "./museWeb.ts";
import { resolveAiReplyProfile, type AiReplyProfile } from "./aiPromptScope.ts";
import type { AppSettings } from "@/store/appStore";

export type SelectTargetMuseAccountParams = {
  settings: AppSettings;
  profile: AiReplyProfile;
  auto?: boolean;
  proactive: boolean;
  usePrimaryPlaybook: boolean;
};

export type SelectedMuseAccount = {
  pool: MuseWebAccountPool;
  primaryMuseId: string;
  museAccountId: string;
  museAccountName?: string;
};

export type PrepareMuseAccountPlaybookParams = {
  settings: AppSettings;
  profile: AiReplyProfile;
  accountId?: string;
  chatId?: string;
  contactInstructions?: string;
  museAccountId: string;
  primaryMuseId: string;
  auto?: boolean;
  proactive: boolean;
  outreach?: string;
  usePrimaryPlaybook: boolean;
  signal?: AbortSignal;
  applyOutreachSettings: (latestSettings: AppSettings) => AppSettings;
};

export type PreparedMusePlaybook = {
  settings: AppSettings;
  profile: AiReplyProfile;
  useMuseWorkspacePlaybook: boolean;
  shouldTryPrimaryFallback: boolean;
  fallbackError?: unknown;
};

async function resolveProactiveMuseAccountId(settings: AppSettings, pool: MuseWebAccountPool): Promise<string> {
  if (settings.aiOutreachMuseAccountId) return settings.aiOutreachMuseAccountId;
  // Empty aiOutreachMuseAccountId rotates across confirmed available Muse accounts.
  const rotatedAccountId = await nextMuseAutoReplyAccount(settings.museAutoReplyAccountIds ?? undefined);
  return rotatedAccountId || pool.primaryId || pool.selectedId || pool.accounts[0]?.id || "";
}

/** Select the target Muse account for manual, auto-reply, or proactive outreach execution. */
export async function selectTargetMuseAccount(params: SelectTargetMuseAccountParams): Promise<SelectedMuseAccount> {
  const { settings, profile, auto, proactive, usePrimaryPlaybook } = params;
  const pool = await museWebAccounts();
  const primaryMuseId = pool.primaryId;
  if (auto && profile.workspacePlaybook && settings.aiPlaybookMuseAccountId !== primaryMuseId) {
    throw Error("Playbook 来源与当前主 Muse 不一致，请重新同步版本");
  }
  let museAccountId = "";
  if (usePrimaryPlaybook) {
    if (!primaryMuseId || primaryMuseId !== settings.aiPlaybookMuseAccountId || !profile.readMuseFiles) {
      throw Error("主 Muse 账号与 Playbook 来源不一致，请重新同步 Workspace");
    }
    if (auto && !proactive && settings.museAutoReplyAccountIds != null &&
        !settings.museAutoReplyAccountIds.includes(primaryMuseId)) {
      throw Error("主 Muse 未勾选为自动回复账号");
    }
    if (auto && !proactive && await nextMuseAutoReplyAccount([primaryMuseId]) !== primaryMuseId) {
      throw Error("主 Muse 未通过自动回复可用性或隐私检查");
    }
    museAccountId = primaryMuseId;
  } else if (proactive) {
    museAccountId = await resolveProactiveMuseAccountId(settings, pool);
    if (!museAccountId || !pool.accounts.some(account => account.id === museAccountId)) {
      throw Error("主动联系没有可用的 Muse 账号，请在 Muse 账号池中选择一个账号");
    }
  } else if (auto) {
    museAccountId = await nextMuseAutoReplyAccount(settings.museAutoReplyAccountIds ?? undefined);
    if (!museAccountId) {
      throw Error("没有已勾选且可用的 Muse 自动回复账号：请确认账号已登录可用，并已确认关闭模型训练");
    }
  } else {
    museAccountId = pool.selectedId;
  }
  const museAccountName = pool.accounts.find(account => account.id === museAccountId)?.name;
  return { pool, primaryMuseId, museAccountId, museAccountName };
}

async function ensureSecondaryWorkspaceCopy(
  params: PrepareMuseAccountPlaybookParams,
  activeSettings: AppSettings,
  activeProfile: AiReplyProfile
): Promise<{
  settings: AppSettings;
  useMuseWorkspacePlaybook: boolean;
  shouldTryPrimaryFallback: boolean;
  fallbackError?: unknown;
}> {
  const { accountId, chatId, contactInstructions, museAccountId, auto, outreach, usePrimaryPlaybook, signal, applyOutreachSettings } = params;
  const existingCopy = resolveAiReplyProfile(activeSettings, accountId, chatId, museAccountId, contactInstructions);
  if (!existingCopy.error && existingCopy.readMuseFiles) {
    return { settings: activeSettings, useMuseWorkspacePlaybook: true, shouldTryPrimaryFallback: false };
  }
  const { trainMuseAccountPlaybooks } = await import("./musePlaybookSync.ts");
  const { useAppStore } = await import("@/store/appStore");
  try {
    await trainMuseAccountPlaybooks(museAccountId, activeProfile.museMaterials || [], signal);
    const refreshedSettings = applyOutreachSettings(useAppStore.getState().settings);
    return { settings: refreshedSettings, useMuseWorkspacePlaybook: true, shouldTryPrimaryFallback: false };
  } catch (trainError) {
    if (signal?.aborted) throw trainError;
    if (auto && !outreach && !usePrimaryPlaybook) {
      return { settings: activeSettings, useMuseWorkspacePlaybook: false, shouldTryPrimaryFallback: true, fallbackError: trainError };
    }
    const refreshedSettings = applyOutreachSettings(useAppStore.getState().settings);
    const inlineProfile = resolveAiReplyProfile(refreshedSettings, accountId, chatId, undefined, contactInstructions);
    if (inlineProfile.error || inlineProfile.readMuseFiles) {
      throw Error(inlineProfile.error || "主 Muse Playbook 原文尚未读取，无法交给副号使用");
    }
    console.warn("[muse-playbook] Workspace 副本未通过校验，本次改用 CRM 中的原文", trainError);
    return { settings: refreshedSettings, useMuseWorkspacePlaybook: false, shouldTryPrimaryFallback: false };
  }
}

/**
 * Prepare Playbook delivery for the chosen Muse account:
 * - Primary source account in workspace mode reads its own source file directly in 1 turn.
 * - Secondary accounts extract once from primary if needed, then reuse or train their own copy.
 */
export async function prepareMuseAccountPlaybook(params: PrepareMuseAccountPlaybookParams): Promise<PreparedMusePlaybook> {
  const { settings, profile, accountId, chatId, contactInstructions, museAccountId, primaryMuseId, usePrimaryPlaybook, signal, applyOutreachSettings } = params;
  const workspaceMode = settings.aiPlaybookMuseMode !== "shared";
  const isPrimarySourceAccount = Boolean(
    museAccountId &&
    museAccountId === primaryMuseId &&
    (!settings.aiPlaybookMuseAccountId || settings.aiPlaybookMuseAccountId === primaryMuseId)
  );
  if (usePrimaryPlaybook || (workspaceMode && isPrimarySourceAccount && profile.workspacePlaybook)) {
    const directProfile = usePrimaryPlaybook
      ? profile
      : resolveAiReplyProfile(settings, accountId, chatId, undefined, contactInstructions, true);
    return { settings, profile: directProfile, useMuseWorkspacePlaybook: false, shouldTryPrimaryFallback: false };
  }

  let activeSettings = settings;
  let activeProfile = profile;
  let useMuseWorkspacePlaybook = false;
  if (activeProfile.readMuseFiles) {
    const { shareMusePlaybooks } = await import("./musePlaybookSync.ts");
    const { useAppStore } = await import("@/store/appStore");
    await shareMusePlaybooks(activeProfile.musePlaybookPaths || [], signal);
    activeSettings = applyOutreachSettings(useAppStore.getState().settings);
    activeProfile = resolveAiReplyProfile(activeSettings, accountId, chatId, undefined, contactInstructions);
  }
  if (workspaceMode && activeProfile.museMaterials?.length) {
    const copyOutcome = await ensureSecondaryWorkspaceCopy(params, activeSettings, activeProfile);
    activeSettings = copyOutcome.settings;
    useMuseWorkspacePlaybook = copyOutcome.useMuseWorkspacePlaybook;
    if (copyOutcome.shouldTryPrimaryFallback) {
      return {
        settings: activeSettings,
        profile: activeProfile,
        useMuseWorkspacePlaybook: false,
        shouldTryPrimaryFallback: true,
        fallbackError: copyOutcome.fallbackError,
      };
    }
  }
  const finalProfile = usePrimaryPlaybook
    ? activeProfile
    : resolveAiReplyProfile(
        activeSettings,
        accountId,
        chatId,
        workspaceMode && useMuseWorkspacePlaybook ? museAccountId : undefined,
        contactInstructions
      );
  return { settings: activeSettings, profile: finalProfile, useMuseWorkspacePlaybook, shouldTryPrimaryFallback: false };
}
