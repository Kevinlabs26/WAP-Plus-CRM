import { useAppStore } from "@/store/appStore";
import { SectionLabel } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { useEffect, useRef, useState } from "react";
import { ensureNotifyPermission, getNotifyPermission } from "@/lib/desktopNotify";

export function SettingsNotificationsPanel() {
 const { t } = useI18n();
 const settings = useAppStore(s => s.settings);
 const updateSettings = useAppStore(s => s.updateSettings);
 const [permission, setPermission] = useState<"granted" | "not-granted" | "unavailable" | "checking">("checking");
 const [requesting, setRequesting] = useState(false);
 const permissionRequest = useRef(false);
 const permissionCheck = useRef(0);
 useEffect(() => {
   let active = true;
   const check = () => {
     if (permissionRequest.current) return;
     const ticket = ++permissionCheck.current;
     void getNotifyPermission().then(value => { if (active && ticket === permissionCheck.current && !permissionRequest.current) setPermission(value); });
   };
   check(); window.addEventListener("focus", check);
   return () => { active = false; window.removeEventListener("focus", check); };
 }, []);
 return <div className="mx-auto max-w-3xl space-y-6">
 <header><h3 className="text-lg font-semibold text-zinc-100">{t("settings.notifications")}</h3><p className="mt-1 text-xs leading-5 text-zinc-500">{t("settings.notificationsDesc")}</p></header>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsMessaging.notifications")}</SectionLabel>
        <p className="mt-2 text-[11px] text-zinc-600">
          {t("settingsMessaging.notificationsHint")}
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12px] text-zinc-300">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-zinc-600"
            checked={settings.desktopNotifyEnabled !== false}
            disabled={requesting}
            onChange={async (e) => {
              if (permissionRequest.current) return;
              if (!e.target.checked) { updateSettings({ desktopNotifyEnabled: false }); return; }
              permissionRequest.current = true; permissionCheck.current++; setRequesting(true);
              try {
                const granted = await ensureNotifyPermission();
                setPermission(granted ? "granted" : "not-granted");
                updateSettings({ desktopNotifyEnabled: granted });
              } catch { setPermission("unavailable"); updateSettings({ desktopNotifyEnabled: false }); }
              finally { permissionRequest.current = false; setRequesting(false); }
            }}
          />
          <span>
            <span className="font-medium">{t("settingsMessaging.newMessageNotification")}</span>
            <span className="mt-0.5 block text-2xs leading-4 text-zinc-600">
              {t("settingsMessaging.newMessageNotificationHint")}
            </span>
          </span>
        </label>

        <p role="status" className="mt-2 text-xs text-zinc-500">{t(requesting || permission === "checking" ? "notifications.checking" : permission === "granted" ? "notifications.granted" : permission === "not-granted" ? "notifications.notGranted" : "notifications.unavailable")}</p>

        <label className="mt-3 block max-w-sm text-2xs text-zinc-500">
          {t("settingsMessaging.notificationPrivacy")}
          <select
            value={settings.notificationPrivacy}
            onChange={(event) => updateSettings({ notificationPrivacy: event.target.value as typeof settings.notificationPrivacy })}
            className="ui-control mt-1 w-full px-2.5 text-[13px]"
          >
            <option value="full">{t("settingsMessaging.privacyFull")}</option>
            <option value="name">{t("settingsMessaging.privacyName")}</option>
            <option value="hidden">{t("settingsMessaging.privacyHidden")}</option>
          </select>
        </label>
        <fieldset disabled={settings.desktopNotifyEnabled === false || permission !== "granted" || requesting}
          className={
            settings.desktopNotifyEnabled === false
              ? "mt-3 space-y-2 opacity-40"
              : "mt-3 space-y-2"
          }
        >
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
            <input
              type="checkbox"
              className="rounded border-zinc-600"
              checked={settings.notifyFollowUpEnabled !== false}
              onChange={(e) =>
                updateSettings({ notifyFollowUpEnabled: e.target.checked })
              }
            />
            <span className="font-medium">{t("settingsMessaging.followUpNotification")}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
            <input
              type="checkbox"
              className="rounded border-zinc-600"
              checked={settings.notifyGroupMessagesEnabled === true}
              onChange={(e) =>
                updateSettings({ notifyGroupMessagesEnabled: e.target.checked })
              }
            />
            <span className="font-medium">{t("settingsMessaging.groupNotification")}</span>
          </label>

        </fieldset>
      </section>
 </div>;
}
