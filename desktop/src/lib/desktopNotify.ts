/**
 * 桌面系统通知。
 * - Tauri 环境：走 tauri-plugin-notification，弹出真正的 Windows/macOS 系统 toast
 *   （带应用图标、进系统通知中心）。点击「打开会话」动作按钮跳对应聊天。
 * - 浏览器开发：回退 Web Notification API。
 * 与业务解耦：调用方只传标题正文。
 */

type PluginNotification = typeof import("@tauri-apps/plugin-notification");
type PluginOptions = import("@tauri-apps/plugin-notification").Options;

const OPEN_ACTION_TYPE = "wap-open-chat";

let pluginApi: PluginNotification | null = null;
let pluginChecked = false;

async function loadPlugin(): Promise<PluginNotification | null> {
  if (pluginChecked) return pluginApi;
  pluginChecked = true;
  try {
    if (
      typeof window === "undefined" ||
      !("__TAURI_INTERNALS__" in window)
    ) {
      return null;
    }
    const mod = await import("@tauri-apps/plugin-notification");
    if (!mod?.sendNotification) return null;
    pluginApi = mod;
    return mod;
  } catch {
    return null;
  }
}

/** Tauri 原生通知是否就绪（仅用于外部判断） */
export async function isNativeNotificationReady(): Promise<boolean> {
  return (await loadPlugin()) !== null;
}

/** 注册「打开会话」动作类型（一次即可；macOS 必用，Windows 尽力支持） */
let actionTypeReady: Promise<boolean> | null = null;
function ensureActionType(plugin: PluginNotification): Promise<boolean> {
  if (!actionTypeReady) {
    actionTypeReady = plugin
      .registerActionTypes([
        {
          id: OPEN_ACTION_TYPE,
          actions: [{ id: "open", title: "打开会话" }],
        },
      ])
      .then(() => true)
      .catch(() => false);
  }
  return actionTypeReady;
}

/** 点击动作 → 打开对应聊天：按通知 group（= 调用方 tag）路由 */
const pendingOpenByKey = new Map<string, () => void>();
let actionListenerReady = false;
let debugActionListenerReady = false;

async function notificationImageBytes(src?: string): Promise<number[] | undefined> {
  if (!src || (!src.startsWith("data:") && !src.startsWith("blob:"))) {
    return undefined;
  }
  try {
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
    return bytes.byteLength <= 512_000 ? Array.from(bytes) : undefined;
  } catch {
    return undefined;
  }
}

async function sendWindowsBranded(opts: DesktopNotifyOpts): Promise<boolean> {
  try {
    const [{ invoke }, { listen }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
    ]);
    if (!debugActionListenerReady) {
      await listen<string>("wapplus://notification-click", (event) => {
        const cb = pendingOpenByKey.get(event.payload);
        if (!cb) return;
        pendingOpenByKey.delete(event.payload);
        try {
          cb();
        } catch {
          /* ignore */
        }
      });
      debugActionListenerReady = true;
    }
    if (opts.onClick && opts.tag) pendingOpenByKey.set(opts.tag, opts.onClick);
    const avatarBytes = await notificationImageBytes(opts.avatarUrl);
    return await invoke<boolean>("show_windows_branded_notification", {
      title: opts.title || "WAP Plus CRM",
      body: opts.body || "",
      tag: opts.tag,
      avatarBytes,
      unreadCount: opts.unreadCount,
    });
  } catch {
    return false;
  }
}

function ensureActionListener() {
  if (actionListenerReady) return;
  actionListenerReady = true;
  void loadPlugin().then((plugin) => {
    if (!plugin) return;
    plugin
      .onAction((notification) => {
        const group = (notification as { group?: string }).group;
        if (!group) return;
        const cb = pendingOpenByKey.get(group);
        if (!cb) return;
        pendingOpenByKey.delete(group);
        try {
          cb();
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  });
}

export async function ensureNotifyPermission(): Promise<boolean> {
  const plugin = await loadPlugin();
  if (plugin) {
    try {
      let granted = await plugin.isPermissionGranted();
      if (!granted) {
        granted = (await plugin.requestPermission()) === "granted";
      }
      return granted;
    } catch {
      return false;
    }
  }

  // 浏览器回退
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return false;
  }
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  if (permissionAsked) return false;
  permissionAsked = true;
  try {
    const r = await Notification.requestPermission();
    return r === "granted";
  } catch {
    return false;
  }
}

let permissionAsked = false;

export type DesktopNotifyOpts = {
  title: string;
  body?: string;
  tag?: string;
  /** 点击通知（或「打开会话」动作按钮）时的回调 */
  onClick?: () => void;
  silent?: boolean;
  avatarUrl?: string;
  unreadCount?: number;
};

async function sendNative(opts: DesktopNotifyOpts): Promise<boolean> {
  const plugin = await loadPlugin();
  if (!plugin) return false;
  try {
    let granted = await plugin.isPermissionGranted();
    if (!granted) {
      granted = (await plugin.requestPermission()) === "granted";
    }
    if (!granted) return false;

    // Windows 使用自适应模板；其它桌面系统继续走 Tauri 插件。
    if (await sendWindowsBranded(opts)) return true;

    if (opts.onClick) {
      await ensureActionType(plugin);
      ensureActionListener();
      if (opts.tag) pendingOpenByKey.set(opts.tag, opts.onClick);
    }

    const payload: PluginOptions = {
      title: opts.title || "WAP Plus CRM",
      body: opts.body || "",
    };
    // group 用作 Windows/macOS 的线程分组；同时是我们路由点击回会话的键
    if (opts.tag) payload.group = opts.tag;
    if (opts.onClick) payload.actionTypeId = OPEN_ACTION_TYPE;

    plugin.sendNotification(payload);
    return true;
  } catch {
    return false;
  }
}

function sendWeb(opts: DesktopNotifyOpts): boolean {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return false;
  }
  if (Notification.permission !== "granted") return false;
  try {
    const n = new Notification(opts.title || "WAP Plus CRM", {
      body: opts.body || "",
      tag: opts.tag || undefined,
      silent: Boolean(opts.silent),
    });
    if (opts.onClick) {
      n.onclick = () => {
        try {
          window.focus();
          opts.onClick?.();
        } catch {
          /* ignore */
        }
        try {
          n.close();
        } catch {
          /* ignore */
        }
      };
    }
    return true;
  } catch {
    return false;
  }
}

export async function showDesktopNotify(
  opts: DesktopNotifyOpts
): Promise<boolean> {
  const ok = await ensureNotifyPermission();
  if (!ok) return false;
  // 原生优先；浏览器开发环境回退 Web Notification
  const native = await sendNative(opts);
  if (native) return true;
  return sendWeb(opts);
}