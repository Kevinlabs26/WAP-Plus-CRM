import { bridgeInvoke, isTauri } from "@/lib/bridge";
import {
  BAILEYS_BRIDGE_PROTOCOL_VERSION,
  type BaileysBridgeStatus,
  type BaileysEventsResponse,
  type BaileysSyncResponse,
} from "@shared/baileysProtocol";
import { syncLog } from "@/lib/syncDebug";

type Runtime = { baseUrl: string; token: string; accountId?: string };
export type BaileysStatus = BaileysBridgeStatus;

/** 每账号一个 runtime（多 session） */
const runtimeByAccount = new Map<string, Promise<Runtime>>();

function assertProtocol(value: { protocolVersion?: number }) {
  if (value.protocolVersion !== BAILEYS_BRIDGE_PROTOCOL_VERSION) {
    throw new Error(
      `Baileys Bridge 协议不兼容：桌面端 v${BAILEYS_BRIDGE_PROTOCOL_VERSION}，后台 v${value.protocolVersion ?? "旧版"}`
    );
  }
}

function sleep(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** 由 App 启动时注入，避免 baileys ↔ appStore 循环依赖 */
let accountIdResolver: (() => string) | null = null;

export function setBaileysAccountIdResolver(fn: () => string) {
  accountIdResolver = fn;
}

/** 解析目标账号：显式 > 注入的直播槽 > wa-default */
export function resolveBaileysAccountId(explicit?: string | null): string {
  const e = (explicit || "").trim();
  if (e) return e;
  try {
    const id = accountIdResolver?.()?.trim();
    if (id) return id;
  } catch {
    /* ignore */
  }
  return "wa-default";
}

async function getRuntime(accountId?: string | null): Promise<Runtime> {
  if (!isTauri()) {
    throw new Error("请使用桌面壳（npm run tauri dev）。浏览器无法启动 Baileys 后台。");
  }
  const id = resolveBaileysAccountId(accountId);
  let p = runtimeByAccount.get(id);
  if (!p) {
    p = (async () => {
      const runtime = await bridgeInvoke<Runtime>("baileys_runtime", {
        accountId: id,
      });
      if (!runtime || typeof runtime !== "object") {
        throw new Error("baileys_runtime 返回无效");
      }
      const anyRt = runtime as Runtime & {
        mock?: boolean;
        base_url?: string;
        account_id?: string;
      };
      if (anyRt.mock) {
        throw new Error("当前为浏览器预览，未连接 Tauri Baileys");
      }
      const baseUrl = anyRt.baseUrl || anyRt.base_url;
      const token = anyRt.token;
      if (!baseUrl || !token) {
        throw new Error(
          `Baileys runtime 缺少 baseUrl/token：${JSON.stringify(runtime)}`
        );
      }
      return {
        baseUrl,
        token,
        accountId: anyRt.accountId || anyRt.account_id || id,
      };
    })().catch((e) => {
      runtimeByAccount.delete(id);
      throw e;
    });
    runtimeByAccount.set(id, p);
  }
  return p;
}

/** 清除某账号 runtime 缓存（进程挂了或切换强制重拉） */
export function invalidateBaileysRuntime(accountId?: string | null) {
  if (accountId) runtimeByAccount.delete(resolveBaileysAccountId(accountId));
  else runtimeByAccount.clear();
}

export async function baileysStopAccount(accountId: string) {
  if (!isTauri()) return;
  invalidateBaileysRuntime(accountId);
  await bridgeInvoke("baileys_stop_account", { accountId });
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  accountId?: string | null
): Promise<T> {
  let lastError: unknown;
  const id = resolveBaileysAccountId(accountId);
  const method = (init?.method || "GET").toUpperCase();
  const signal =
    init?.signal ||
    AbortSignal.timeout(method === "GET" || method === "HEAD" ? 15_000 : 30_000);
  // 写操作若已到达 WhatsApp、但响应途中丢失，自动重放会造成双发。
  // 读取可重试；POST/PUT/DELETE 只执行一次，由上层明确呈现“结果未知”。
  const maxAttempts = method === "GET" || method === "HEAD" ? 8 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const runtime = await getRuntime(id);
      const response = await fetch(`${runtime.baseUrl}${path}`, {
        ...init,
        signal,
        headers: {
          "Content-Type": "application/json",
          "X-Wap-Token": runtime.token,
          "X-Wap-Account-Id": id,
          ...init?.headers,
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          (data as { error?: string }).error ||
            `Baileys HTTP ${response.status}`
        );
        (error as Error & { status?: number }).status = response.status;
        throw error;
      }
      return data as T;
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      // 4xx 是接口/请求本身的问题，重试只会放大 UI 卡顿；网络和 5xx 才重试。
      if (status && status >= 400 && status < 500) break;
      const errorName = (error as { name?: string })?.name || "";
      // 同一个 AbortSignal 一旦超时就永久失效，继续重试只会立即失败。
      if (
        signal.aborted ||
        errorName === "AbortError" ||
        errorName === "TimeoutError"
      ) {
        break;
      }
      invalidateBaileysRuntime(id);
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes("桌面壳") ||
        msg.includes("尚未连接") ||
        msg.includes("unauthorized") ||
        msg.includes("找不到 Baileys")
      ) {
        break;
      }
      if (attempt + 1 < maxAttempts) await sleep(400 + attempt * 200);
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  if (msg === "Failed to fetch" || msg.includes("fetch")) {
    throw new Error(
      "无法连接 Baileys 后台（Failed to fetch）。请确认用 npm run tauri dev 启动，并查看本机是否拦截 127.0.0.1。"
    );
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export const baileysStatus = async (accountId?: string | null) => {
  const status = await request<BaileysStatus>(
    "/status",
    { signal: AbortSignal.timeout(10_000) },
    accountId
  );
  assertProtocol(status);
  return status;
};

export const baileysEvents = async (after = 0, accountId?: string | null) => {
  const result = await request<BaileysEventsResponse>(
    `/events?after=${after}`,
    undefined,
    accountId
  );
  assertProtocol(result);
  return result;
};

export const baileysSync = async (
  accountId?: string | null,
  opts?: { hydrateGroups?: boolean; requestHistory?: boolean }
) => {
  const id = resolveBaileysAccountId(accountId);
  const t0 = performance.now?.() ?? Date.now();
  syncLog("baileys.sync", "POST /sync start", { accountId: id });
  const query = new URLSearchParams();
  if (opts?.hydrateGroups) query.set("hydrateGroups", "1");
  if (opts?.requestHistory) query.set("requestHistory", "1");
  const result = await request<BaileysSyncResponse>(
    `/sync${query.size ? `?${query}` : ""}`,
    { method: "POST", signal: AbortSignal.timeout(120_000) },
    accountId
  );
  assertProtocol(result);
  const ms = Math.round((performance.now?.() ?? Date.now()) - t0);
  const any = result as BaileysSyncResponse & {
    contactCount?: number;
    messageCount?: number;
    note?: string;
    connection?: string;
    storeChatN?: number;
    storeContactN?: number;
    accountId?: string;
  };
  syncLog("baileys.sync", "POST /sync done", {
    accountId: id,
    ms,
    contacts: result.contacts?.length ?? any.contactCount ?? 0,
    messages: result.messages?.length ?? any.messageCount ?? 0,
    note: any.note,
    connection: any.connection,
    storeChatN: any.storeChatN,
    storeContactN: any.storeContactN,
    sample: (result.contacts || []).slice(0, 3).map((c) => ({
      name: (c as { displayName?: string; name?: string }).displayName ||
        (c as { name?: string }).name,
      phone: (c as { phoneE164?: string; phone?: string }).phoneE164 ||
        (c as { phone?: string }).phone,
      lm: String((c as { lastMessage?: string }).lastMessage || "").slice(
        0,
        40
      ),
    })),
  });
  return result;
};

export function resetBaileysRuntimeCache() {
  invalidateBaileysRuntime();
}
