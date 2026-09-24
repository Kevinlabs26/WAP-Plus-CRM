import http from "node:http";
import { json, requestBody } from "./httpUtil.mjs";
import { describeMessage } from "./messageDescribe.mjs";
import {
  ensureGifMp4,
  ensureOggOpusPtt,
  MAX_WHATSAPP_AUDIO_SECONDS,
  parseDataUrl,
} from "./audioConvert.mjs";
import { tryHandleGroupRoutes } from "./groupRoutes.mjs";
import { tryHandleGroupWriteRoutes } from "./groupWriteRoutes.mjs";
import { tryHandleBlocklistRoutes } from "./blocklistRoutes.mjs";
import { tryHandleCatalogRoutes } from "./catalogRoutes.mjs";
import { buildContactVcard } from "./contactVcard.mjs";

const syncDebugOn =
  process.env.WAP_SYNC_DEBUG === "1" ||
  process.env.WAP_BAILEYS_LOG === "info" ||
  process.env.WAP_BAILEYS_LOG === "debug";

/**
 * getD: () => live deps object with getters/setters for mutable bridge state.
 */
export function createBaileysRequestHandler(getD) {
  return async (req, res) => {
    const d = typeof getD === "function" ? getD() : getD;

    if (req.method === "OPTIONS") return json(res, 204, {});
    if (!d.token || req.headers["x-wap-token"] !== d.token)
      return json(res, 401, { error: "unauthorized" });
    try {
      const url = new URL(req.url, `http://127.0.0.1:${d.port}`);
      if (req.method === "GET" && url.pathname === "/status")
        return json(res, 200, d.statusPayload());
      if (req.method === "GET" && url.pathname === "/events") {
        const after = Number(url.searchParams.get("after") || 0);
        const status = d.statusPayload();
        const droppedThrough = Number(d.eventsDroppedThrough || 0);
        const gap = after < droppedThrough
          ? {
              after,
              from: after + 1,
              to: droppedThrough,
              count: droppedThrough - after,
            }
          : undefined;
        return json(res, 200, {
          protocolVersion: status.protocolVersion,
          baileysVersion: status.baileysVersion,
          events: d.events.filter((event) => event.seq > after),
          cursor: d.sequence,
          ...(gap ? { gap } : {}),
        });
      }
      if (req.method === "POST" && url.pathname === "/sync") {
        const aid =
          d.accountId ||
          req.headers["x-wap-account-id"] ||
          "unknown";
        let storeChatN = 0;
        let storeContactN = 0;
        let groupHydrate = null;
        let historyRequest = null;
        // 尝试从 socket.store 补会话（部分 Baileys 版本会挂 store）
        try {
          const sock = d.socket;
          const storeChats =
            sock?.store?.chats && typeof sock.store.chats === "object"
              ? Object.values(sock.store.chats)
              : [];
          storeChatN = storeChats.length;
          if (storeChats.length && typeof d.ingestStoreChats === "function") {
            d.ingestStoreChats(storeChats);
          }
          const storeContacts =
            sock?.store?.contacts && typeof sock.store.contacts === "object"
              ? Object.values(sock.store.contacts)
              : [];
          storeContactN = storeContacts.length;
          if (
            storeContacts.length &&
            typeof d.ingestStoreContacts === "function"
          ) {
            d.ingestStoreContacts(storeContacts);
          }
        } catch (e) {
          console.log(
            `[wap-sync][${aid}] /sync store-read-error ${e?.message || e}`
          );
        }
        // 手动同步：强制拉参与群 subject，避免侧栏一直显示「群聊」
        if (
          url.searchParams.get("hydrateGroups") === "1" &&
          typeof d.hydrateGroupSubjects === "function"
        ) {
          try {
            groupHydrate = await d.hydrateGroupSubjects({
              force: true,
              limit: 200,
            });
          } catch (e) {
            console.log(
              `[wap-sync][${aid}] /sync group-hydrate-error ${e?.message || e}`
            );
            groupHydrate = { error: String(e?.message || e) };
          }
        }
        if (
          url.searchParams.get("requestHistory") === "1" &&
          typeof d.requestFullHistorySync === "function"
        ) {
          historyRequest = await d.requestFullHistorySync();
        }
        const snap = d.snapshot();
        const status = d.statusPayload();
        const body = {
          protocolVersion: status.protocolVersion,
          baileysVersion: status.baileysVersion,
          contacts: snap.contacts,
          messages: snap.messages,
          contactCount: snap.contacts?.length ?? 0,
          messageCount: snap.messages?.length ?? 0,
          accountId: aid,
          connection: status.connection,
          storeChatN,
          storeContactN,
          groupHydrate,
          historyRequest,
          memMapSize:
            typeof d.contacts?.size === "number" ? d.contacts.size : undefined,
          note:
            (snap.contacts?.length ?? 0) === 0
              ? "bridge_memory_empty_wait_history"
              : undefined,
        };
        if (syncDebugOn) {
          console.log(
            `[wap-sync][${aid}] POST /sync => contacts=${body.contactCount} messages=${body.messageCount} conn=${body.connection} storeChats=${storeChatN} storeContacts=${storeContactN} groupsUpdated=${groupHydrate?.updated ?? "-"} note=${body.note || ""}`
          );
        }
        return json(res, 200, body);
      }
      if (req.method === "POST" && url.pathname === "/pairing-code") {
        if (!d.socket || !["starting", "qr", "reconnecting"].includes(d.connection))
          return json(res, 409, { error: "请先启动未登录的 WhatsApp 会话" });
        const body = await requestBody(req);
        const result = await d.requestPairingCode(body.phoneNumber || body.phone);
        return json(res, 200, { ok: true, ...result });
      }
      if (req.method === "POST" && url.pathname === "/check-numbers") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        return json(res, 200, {
          ok: true,
          results: await d.checkWhatsAppNumbers(body.numbers || body.phoneNumbers),
        });
      }
      if (req.method === "GET" && url.pathname === "/privacy") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        return json(res, 200, {
          ok: true,
          privacy: await d.getPrivacySettings(true),
        });
      }
      if (req.method === "POST" && url.pathname === "/privacy") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        return json(res, 200, {
          ok: true,
          privacy: await d.updatePrivacySettings(body),
        });
      }
      if (req.method === "GET" && url.pathname === "/labels") {
        return json(res, 200, {
          ok: true,
          labels: [...d.labels.values()].sort((a, b) =>
            a.name.localeCompare(b.name)
          ),
          chatLabelIds: Object.fromEntries(
            [...d.chatLabelIds].map(([jid, ids]) => [jid, [...ids]])
          ),
        });
      }
      if (req.method === "POST" && url.pathname === "/labels") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const name = String(body.name || "").trim().slice(0, 100);
        if (!name) return json(res, 400, { error: "标签名称为空" });
        const label = {
          id: String(body.id || Date.now()),
          name,
          color: Math.max(0, Math.min(19, Number(body.color) || 0)),
        };
        await d.socket.addLabel("", label);
        d.labels.set(label.id, label);
        return json(res, 200, { ok: true, label });
      }
      if (req.method === "POST" && url.pathname === "/labels/chat") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const address = String(body.jid || body.phoneE164 || "").trim();
        const labelId = String(body.labelId || "").trim();
        if (!address || !labelId)
          return json(res, 400, { error: "缺少会话或标签" });
        const jid = await d.resolveSendJid(address);
        if (!jid) return json(res, 400, { error: "无法解析会话" });
        const enabled = body.enabled !== false;
        if (enabled) await d.socket.addChatLabel(jid, labelId);
        else await d.socket.removeChatLabel(jid, labelId);
        const ids = d.chatLabelIds.get(jid) || new Set();
        if (enabled) ids.add(labelId);
        else ids.delete(labelId);
        if (ids.size) d.chatLabelIds.set(jid, ids);
        else d.chatLabelIds.delete(jid);
        return json(res, 200, { ok: true, jid, labelId, enabled });
      }
      if (req.method === "POST" && url.pathname === "/quick-replies") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp is not connected" });
        const body = await requestBody(req);
        const items = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
        let synced = 0;
        for (const item of items) {
          const timestamp = String(item?.id || "").trim().slice(0, 80);
          const shortcut = String(item?.title || "").trim().slice(0, 40);
          const message = String(item?.body || "").trim().slice(0, 2000);
          if (!timestamp || !shortcut || !message) continue;
          await d.socket.addOrEditQuickReply({ timestamp, shortcut, message });
          synced++;
        }
        return json(res, 200, { ok: true, synced });
      }
      if (req.method === "POST" && url.pathname === "/quick-replies/remove") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp is not connected" });
        const body = await requestBody(req);
        const timestamp = String(body.id || "").trim().slice(0, 80);
        if (!timestamp) return json(res, 400, { error: "Missing quick reply id" });
        await d.socket.removeQuickReply(timestamp);
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/avatar") {
        const jid = url.searchParams.get("jid") || "";
        const phone = url.searchParams.get("phone") || "";
        const quality = (url.searchParams.get("quality") || "preview").toLowerCase();
        const force = url.searchParams.get("force") === "1";
        const self = url.searchParams.get("self") === "1";
        let target = jid;
        if (!target && phone) {
          const digits = phone.replace(/\D/g, "");
          target = digits ? `${digits}@s.whatsapp.net` : "";
        }
        // 本人头像：补上 socket.user 的多种 jid 形态
        const selfJids =
          self && typeof d.selfJidCandidates === "function"
            ? d.selfJidCandidates() || []
            : [];
        if (!target && selfJids.length) target = selfJids[0] || "";
        if ((!target && !selfJids.length) || !d.socket || d.connection !== "connected") {
          return json(res, 200, { ok: false, avatarUrl: "", avatarFullUrl: "" });
        }
        try {
          const wantFull =
            quality === "image" || quality === "full" || quality === "hd";
          // 优先直拉（不依赖 contacts Map，本人常被 isSelfJid 挡掉）
          if (typeof d.fetchAvatarForJids === "function") {
            const jids = self
              ? [
                  target,
                  ...selfJids,
                  d.socket?.user?.id,
                  d.socket?.user?.lid,
                  d.socket?.user?.phoneNumber,
                ].filter(Boolean)
              : [target].filter(Boolean);
            const direct = await d.fetchAvatarForJids(jids, { full: wantFull });
            if (direct?.ok && (direct.avatarUrl || direct.avatarFullUrl)) {
              return json(res, 200, {
                ok: true,
                jid: target || jids[0] || "",
                avatarUrl: direct.avatarUrl || direct.avatarFullUrl || "",
                avatarFullUrl:
                  direct.avatarFullUrl || direct.avatarUrl || "",
              });
            }
          }
          if (wantFull && typeof d.fetchAvatarHd === "function" && target) {
            const hd = await d.fetchAvatarHd(target, { force });
            if (hd?.ok) {
              return json(res, 200, {
                ok: true,
                jid: target,
                avatarUrl: hd?.avatarUrl || "",
                avatarFullUrl: hd?.avatarFullUrl || hd?.avatarUrl || "",
              });
            }
          }
          // 回退：通讯录队列
          let c =
            (target && d.findContactByAnyJid?.(target)) ||
            (target && d.upsertContact?.(target)) ||
            null;
          if (c) c.avatarCheckedAt = 0;
          if (target) d.enqueueAvatar?.(target);
          const deadline = Date.now() + 8_000;
          while (Date.now() < deadline) {
            c = target ? d.findContactByAnyJid?.(target) : null;
            if (c?.avatarFullUrl && String(c.avatarFullUrl).startsWith("data:"))
              break;
            if (c?.avatarUrl && String(c.avatarUrl).startsWith("data:")) break;
            await new Promise((r) => setTimeout(r, 400));
          }
          c = target ? d.findContactByAnyJid?.(target) : null;
          return json(res, 200, {
            ok: Boolean(c?.avatarUrl || c?.avatarFullUrl),
            jid: target,
            avatarUrl: c?.avatarUrl || "",
            avatarFullUrl: c?.avatarFullUrl || c?.avatarUrl || "",
          });
        } catch {
          return json(res, 200, {
            ok: false,
            jid: target,
            avatarUrl: "",
            avatarFullUrl: "",
          });
        }
      }
if (req.method === "POST" && url.pathname === "/restart") {
        const body = await requestBody(req).catch(() => ({}));
        const clearAuth = body?.clearAuth !== false; // 默认清会话出新码
        d.connection = "starting";
        d.qrDataUrl = "";
        d.lastError = "";
        // 异步重启，立即返回，前端轮询 QR
        void d.connect({ clearAuth }).catch((error) => {
          d.connection = "error";
          d.lastError = error instanceof Error ? error.message : String(error);
        });
        return json(res, 200, {
          ok: true,
          message: clearAuth ? "正在清空会话并生成新二维码…" : "正在重连…",
          ...d.statusPayload(),
        });
      }
      if (req.method === "POST" && url.pathname === "/send") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const {
          phoneE164,
          text,
          jid: jidIn,
          imageDataUrl,
          imageUrl,
          stickerDataUrl,
          stickerUrl,
          gifDataUrl,
          gifUrl,
          audioDataUrl,
          audioUrl,
          fileDataUrl,
          fileUrl,
          fileName,
          mediaType,
          ptt,
          mimetype: mimeIn,
          seconds,
          quoted,
          edit,
          forwardKey,
          mentionedJid,
          mentions,
          contactName,
          contactPhone,
        } = body || {};
        const address = String(phoneE164 || jidIn || "").trim();
        const caption = String(text || "").trim();
        const mentionList = [
          ...new Set(
            (Array.isArray(mentionedJid)
              ? mentionedJid
              : Array.isArray(mentions)
                ? mentions
                : []
            )
              .map((x) => String(x || "").trim())
              .filter(Boolean)
          ),
        ];
        const hasImage =
          typeof imageDataUrl === "string" &&
          imageDataUrl.startsWith("data:image");
        const hasImageUrl = /^https?:\/\//i.test(String(imageUrl || ""));
        const hasSticker =
          typeof stickerDataUrl === "string" &&
          stickerDataUrl.startsWith("data:image/webp;base64,");
        const hasStickerUrl = /^https?:\/\//i.test(String(stickerUrl || ""));
        const hasGif =
          typeof gifDataUrl === "string" &&
          gifDataUrl.startsWith("data:image/gif;base64,");
        const hasGifUrl = /^https?:\/\//i.test(String(gifUrl || ""));
        const hasAudio =
          typeof audioDataUrl === "string" &&
          audioDataUrl.startsWith("data:audio");
        const hasAudioUrl = /^https?:\/\//i.test(String(audioUrl || ""));
        const hasFile =
          typeof fileDataUrl === "string" &&
          fileDataUrl.startsWith("data:") &&
          (mediaType === "document" || mediaType === "file");
        const hasFileUrl = /^https?:\/\//i.test(String(fileUrl || ""));
        const contactCard =
          mediaType === "contact"
            ? buildContactVcard(contactName, contactPhone)
            : null;

        // 编辑：只改已有消息正文
        if (edit?.id && edit?.remoteJid) {
          if (!caption) return json(res, 400, { error: "编辑内容为空" });
          const result = await d.socket.sendMessage(edit.remoteJid, {
            text: caption,
            edit: {
              remoteJid: edit.remoteJid,
              fromMe: edit.fromMe !== false,
              id: edit.id,
              participant: edit.participant,
            },
          });
          return json(res, 200, {
            ok: true,
            id: result?.key?.id || edit.id,
            jid: edit.remoteJid,
            edited: true,
          });
        }

        // 转发：从 bridge 保留的原始消息中取完整内容，保留媒体与 WhatsApp 转发标记
        if (forwardKey?.id) {
          const to = await d.resolveSendJid(address);
          if (!to) return json(res, 400, { error: "转发目标无效" });
          const stored = d.findStoredMessageByKey(forwardKey);
          const original =
            (await d.getRawWaByKey?.(forwardKey)) ||
            d.rawWaByMsgId.get(forwardKey.id) ||
            (stored?.id ? d.rawWaByMsgId.get(stored.id) : null) ||
            (stored?.waKey?.id ? d.rawWaByMsgId.get(stored.waKey.id) : null) ||
            body.forward;
          if (!original?.message) {
            return json(res, 404, {
              error: "原消息已不在 bridge 缓存中，请重新同步后再转发",
            });
          }
          const result = await d.socket.sendMessage(to, {
            forward: original,
          });
          return json(res, 200, {
            ok: true,
            id: result?.key?.id,
            jid: to,
            forwarded: true,
          });
        }

        if (
          !address ||
          (!caption && !hasImage && !hasImageUrl && !hasSticker && !hasStickerUrl && !hasGif && !hasGifUrl && !hasAudio && !hasAudioUrl && !hasFile && !hasFileUrl && !contactCard)
        )
          return json(res, 400, { error: "号码或消息为空" });

        const jid = await d.resolveSendJid(address);
        if (!jid || jid === "@s.whatsapp.net")
          return json(res, 400, { error: "无法解析发送目标" });

        /** @type {Record<string, unknown> | undefined} */
        let quotedOpt;
        if (quoted?.id && (quoted.remoteJid || jid)) {
          quotedOpt = {
            key: {
              remoteJid: quoted.remoteJid || jid,
              fromMe: Boolean(quoted.fromMe),
              id: quoted.id,
              participant: quoted.participant,
            },
            message: quoted.message || {
              conversation: String(quoted.body || caption || " ").slice(0, 500),
            },
          };
        }

        let result;
        if (contactCard) {
          result = await d.socket.sendMessage(
            jid,
            {
              contacts: {
                displayName: contactCard.displayName,
                contacts: [{
                  displayName: contactCard.displayName,
                  vcard: contactCard.vcard,
                }],
              },
            },
            quotedOpt ? { quoted: quotedOpt } : undefined
          );
        } else if (hasAudioUrl) {
          result = await d.socket.sendMessage(jid, {
            audio: { url: String(audioUrl) },
            mimetype: mimeIn || "audio/mpeg",
            ptt: ptt === true,
          }, quotedOpt ? { quoted: quotedOpt } : undefined);
        } else if (hasAudio || mediaType === "audio" || mediaType === "ptt") {
          const asPtt = ptt !== false; // 默认语音条
          console.log(
            `[ptt] input audioDataUrl=${String(audioDataUrl || "").slice(0, 40)} len=${String(audioDataUrl || "").length} mime=${mimeIn || "-"} seconds=${seconds} ptt=${asPtt}`
          );
          let buf;
          let mimetype;
          let waveform;
          if (asPtt) {
            // Recorded voice notes must be OGG/Opus and get a waveform.
            ({ buf, mimetype, waveform } = await ensureOggOpusPtt(
              audioDataUrl,
              mimeIn || "",
              MAX_WHATSAPP_AUDIO_SECONDS
            ));
          } else {
            // File-selected audio is regular WhatsApp audio. Keep the source
            // bytes and duration; forcing it through the PTT ffmpeg pipeline
            // caused valid MP3/M4A files to fail with code 234.
            const parsed = parseDataUrl(audioDataUrl);
            if (!parsed?.buf?.length) {
              return json(res, 400, { error: "音频 dataUrl 无效" });
            }
            if (parsed.buf.length > 14_000_000) {
              return json(res, 400, { error: "音频过大（限约 14MB）" });
            }
            buf = parsed.buf;
            mimetype = mimeIn || parsed.mime || "audio/mp4";
          }
          console.log(
            `[ptt] converted ogg bytes=${buf.length} waveform=${waveform?.length || 0}`
          );
          const sec =
            typeof seconds === "number" && seconds > 0
              ? Math.round(seconds)
              : undefined;
          result = await d.socket.sendMessage(
            jid,
            {
              audio: buf,
              mimetype,
              ptt: asPtt,
              seconds: sec,
              ...(asPtt && waveform ? { waveform } : {}),
            },
            quotedOpt ? { quoted: quotedOpt } : undefined
          );
          console.log(
            `[ptt] sent id=${result?.key?.id} type=${result?.message?.audioMessage ? "audio" : JSON.stringify(Object.keys(result?.message || {}))} seconds=${result?.message?.audioMessage?.seconds} ptt=${result?.message?.audioMessage?.ptt} mimetype=${result?.message?.audioMessage?.mimetype} len=${result?.message?.audioMessage?.fileLength}`
          );
        } else if (hasGifUrl) {
          result = await d.socket.sendMessage(jid, {
            video: { url: String(gifUrl) },
            gifPlayback: true,
            ...(caption ? { caption } : {}),
          }, quotedOpt ? { quoted: quotedOpt } : undefined);
        } else if (hasGif || mediaType === "gif") {
          const { buf, mimetype } = await ensureGifMp4(gifDataUrl);
          result = await d.socket.sendMessage(
            jid,
            {
              video: buf,
              mimetype,
              gifPlayback: true,
              ...(caption ? { caption } : {}),
            },
            quotedOpt ? { quoted: quotedOpt } : undefined
          );
        } else if (hasStickerUrl) {
          result = await d.socket.sendMessage(jid, {
            sticker: { url: String(stickerUrl) },
          }, quotedOpt ? { quoted: quotedOpt } : undefined);
        } else if (hasSticker || mediaType === "sticker") {
          const parsed = parseDataUrl(stickerDataUrl);
          if (!parsed?.buf?.length || parsed.mime !== "image/webp")
            return json(res, 400, { error: "贴纸 WebP 数据无效" });
          if (parsed.buf.length > 2_000_000)
            return json(res, 400, { error: "贴纸过大（限约 2MB）" });
          result = await d.socket.sendMessage(
            jid,
            { sticker: parsed.buf },
            quotedOpt ? { quoted: quotedOpt } : undefined
          );
        } else if (hasImageUrl) {
          result = await d.socket.sendMessage(jid, {
            image: { url: String(imageUrl) },
            caption: caption || undefined,
          }, quotedOpt ? { quoted: quotedOpt } : undefined);
        } else if (hasImage || mediaType === "image") {
          const m = String(imageDataUrl).match(
            /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
          );
          if (!m) return json(res, 400, { error: "图片 dataUrl 无效" });
          const buf = Buffer.from(m[2], "base64");
          if (!buf.length || buf.length > 8_000_000)
            return json(res, 400, { error: "图片过大或为空" });
          result = await d.socket.sendMessage(
            jid,
            {
              image: buf,
              mimetype: m[1],
              caption: caption || undefined,
            },
            quotedOpt ? { quoted: quotedOpt } : undefined
          );
        } else if (hasFileUrl) {
          result = await d.socket.sendMessage(jid, {
            document: { url: String(fileUrl) },
            mimetype: mimeIn || "application/octet-stream",
            fileName: String(fileName || "file").slice(0, 180),
            caption: caption || undefined,
          }, quotedOpt ? { quoted: quotedOpt } : undefined);
        } else if (hasFile) {
          const parsed = parseDataUrl(fileDataUrl);
          if (!parsed?.buf?.length)
            return json(res, 400, { error: "文件 dataUrl 无效" });
          if (parsed.buf.length > 15_000_000)
            return json(res, 400, { error: "文件过大（限约 15MB）" });
          const name =
            String(fileName || "file").slice(0, 180) || "file.bin";
          result = await d.socket.sendMessage(
            jid,
            {
              document: parsed.buf,
              mimetype: mimeIn || parsed.mime || "application/octet-stream",
              fileName: name,
              caption: caption || undefined,
            },
            quotedOpt ? { quoted: quotedOpt } : undefined
          );
        } else {
          result = await d.socket.sendMessage(
            jid,
            {
              text: caption,
              ...(mentionList.length ? { mentions: mentionList } : {}),
            },
            quotedOpt ? { quoted: quotedOpt } : undefined
          );
        }
        return json(res, 200, {
          ok: true,
          id: result?.key?.id,
          jid,
        });
      }

      // 正在输入 / 在线状态（出站）；subscribe=true 时向该会话订阅对方 presence
      if (req.method === "POST" && url.pathname === "/presence") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const type = String(body.type || "composing"); // composing | paused | available | unavailable | subscribe
        const rawCandidates = [
          body.jid,
          body.channelAddress,
          body.phoneE164,
          ...(Array.isArray(body.jids) ? body.jids : []),
        ]
          .map((x) => String(x || "").trim())
          .filter(Boolean);

        // 订阅时：原始地址 + resolve 后的 PN/LID 都订一遍（只订 PN 会丢 @lid 会话）
        const subTargets = new Set();
        for (const raw of rawCandidates) {
          subTargets.add(raw);
          if (raw.includes("@c.us")) {
            subTargets.add(raw.replace(/@c\.us$/, "@s.whatsapp.net"));
          }
          try {
            const resolved = await d.resolveSendJid(raw);
            if (resolved) subTargets.add(resolved);
          } catch {
            /* ignore */
          }
          const c = d.findContactByAnyJid(raw);
          if (c?.jid) subTargets.add(c.jid);
          if (c?.pnJid) subTargets.add(c.pnJid);
          if (c?.lidJid) subTargets.add(c.lidJid);
          if (c?.phoneE164) {
            const d = c.phoneE164.replace(/\D/g, "");
            if (d) subTargets.add(`${d}@s.whatsapp.net`);
          }
        }

        const subscribed = [];
        const subErrors = [];
        if (body.subscribe || type === "subscribe" || body.subscribeOnly) {
          // 先亮一下自己在线，部分环境否则不推 chatstate
          try {
            await d.socket.sendPresenceUpdate("available");
          } catch {
            /* ignore */
          }
          for (const target of subTargets) {
            if (!target.includes("@") && !/^\+?\d{7,15}$/.test(target)) {
              continue;
            }
            let jid = target;
            if (!target.includes("@") && /^\+?\d{7,15}$/.test(target)) {
              jid = `${target.replace(/\D/g, "")}@s.whatsapp.net`;
            }
            try {
              await d.socket.presenceSubscribe(jid);
              subscribed.push(jid);
            } catch (e) {
              subErrors.push(`${jid}:${String(e?.message || e)}`);
            }
          }
        }

        if (type === "subscribe" || body.subscribeOnly) {
          return json(res, 200, {
            ok: true,
            type: "subscribe",
            subscribed,
            errors: subErrors.slice(0, 5),
          });
        }

        // 出站 composing/paused：优先用 resolve 后的主 jid
        let jid =
          subscribed[0] ||
          (rawCandidates[0] ? await d.resolveSendJid(rawCandidates[0]) : "");
        if (!jid && rawCandidates[0]) jid = rawCandidates[0];
        await d.socket.sendPresenceUpdate(type, jid || undefined);
        return json(res, 200, {
          ok: true,
          type,
          jid: jid || null,
          subscribed,
        });
      }
      if (req.method === "POST" && url.pathname === "/logout") {
        try {
          await d.socket?.logout?.();
        } catch {
          /* ignore */
        }
        d.connection = "logged_out";
        d.qrDataUrl = "";
        d.lastError = "";
        // 退出后自动准备新码
        void d.connect({ clearAuth: true }).catch(() => {});
        return json(res, 200, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/contacts/save_batch") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const inputItems = Array.isArray(body.items) ? body.items : [];
        if (!inputItems.length || inputItems.length > 500)
          return json(res, 400, { error: "联系人批次应包含 1 至 500 项" });
        const items = [];
        for (const item of inputItems) {
          const name = String(item?.name || "").trim().slice(0, 100);
          const phoneE164 = String(item?.phoneE164 || "").trim();
          const digits = phoneE164.replace(/^\+/, "");
          if (!name || !(digits.length >= 7 && digits.length <= 15) || !/^\d+$/.test(digits)) {
            items.push({ status: "failed", error: "联系人姓名或号码无效" });
            continue;
          }
          try {
            const jid = await d.resolveSendJid(phoneE164);
            if (!jid) {
              items.push({ status: "failed", error: "无法解析 WhatsApp 联系人" });
              continue;
            }
            await d.socket.chatModify(
              {
                contact: {
                  fullName: name,
                  firstName: name,
                  // false = 保存到 WhatsApp 云端联系人，不写手机主通讯录
                  saveOnPrimaryAddressbook: false,
                },
              },
              jid
            );
            items.push({ status: "saved" });
          } catch (error) {
            items.push({
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return json(res, 200, { ok: true, items });
      }

      // —— 会话 / 消息协议操作 ——
      if (req.method === "POST" && url.pathname === "/chat/modify") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const jid = await d.resolveSendJid(
          body.jid || body.phoneE164 || body.channelAddress || ""
        );
        if (!jid) return json(res, 400, { error: "无效会话" });
        const action = String(body.action || "");
        /** @type {Record<string, unknown>} */
        let mod = null;
        if (action === "archive") mod = { archive: body.value !== false };
        else if (action === "unarchive") mod = { archive: false };
        else if (action === "pin") mod = { pin: body.value !== false };
        else if (action === "unpin") mod = { pin: false };
        else if (action === "mute") {
          // value: 时长 ms；null/0 = 取消静音
          const ms =
            typeof body.durationMs === "number"
              ? body.durationMs
              : body.value === false
                ? null
                : 8 * 60 * 60 * 1000; // 默认 8 小时
          mod = { mute: ms };
        } else if (action === "unmute") mod = { mute: null };
        else if (action === "markRead") {
          const lastMessages = Array.isArray(body.lastMessages)
            ? body.lastMessages.filter(
                (message) =>
                  message?.key?.remoteJid &&
                  message?.key?.id &&
                  Number.isFinite(message?.messageTimestamp)
              )
            : [];
          mod = {
            markRead: true,
            ...(lastMessages.length ? { lastMessages } : {}),
          };
        } else if (action === "markUnread") mod = { markRead: false };
        else if (action === "delete") mod = { delete: true };
        else if (action === "clear") mod = { clear: true };
        else return json(res, 400, { error: `未知 action: ${action}` });

        await d.socket.chatModify(mod, jid);
        return json(res, 200, { ok: true, jid, action, mod });
      }

      if (req.method === "POST" && url.pathname === "/messages/read") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const keys = Array.isArray(body.keys) ? body.keys : [];
        const cleaned = keys
          .map((k) => ({
            remoteJid: k.remoteJid || k.jid,
            id: k.id,
            fromMe: Boolean(k.fromMe),
            participant: k.participant,
          }))
          .filter((k) => k.remoteJid && k.id);
        if (!cleaned.length)
          return json(res, 400, { error: "keys 为空" });
        await d.socket.readMessages(cleaned);
        return json(res, 200, { ok: true, count: cleaned.length });
      }

      if (req.method === "POST" && url.pathname === "/messages/history") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const key = body.key || {};
        const remoteJid = String(key.remoteJid || body.jid || "").trim();
        const id = String(key.id || "").trim();
        const timestamp = Number(
          body.oldestMsgTimestampMs || body.timestampMs || 0
        );
        if (!remoteJid || !id || !Number.isFinite(timestamp) || timestamp <= 0)
          return json(res, 400, { error: "缺少历史消息游标" });
        const count = Math.max(1, Math.min(50, Number(body.count) || 50));
        const requestId = await d.socket.fetchMessageHistory(
          count,
          {
            remoteJid,
            id,
            fromMe: Boolean(key.fromMe),
            participant: key.participant || undefined,
          },
          timestamp
        );
        return json(res, 200, { ok: true, count, requestId });
      }

      if (req.method === "POST" && url.pathname === "/message/delete") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const key = body.key || {};
        if (!key.remoteJid || !key.id)
          return json(res, 400, { error: "缺少 message key" });
        // forEveryone=true → 双方撤回；false → 仅自己（若支持）
        const forEveryone = body.forEveryone !== false;
        if (forEveryone) {
          await d.socket.sendMessage(key.remoteJid, { delete: key });
        } else {
          await d.socket.chatModify(
            {
              deleteForMe: {
                deleteMedia: true,
                key,
              },
            },
            key.remoteJid
          );
        }
        return json(res, 200, { ok: true, forEveryone });
      }

      if (req.method === "POST" && url.pathname === "/message/react") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const rawKey = body.key || {};
        // 空 text = 取消反应（WhatsApp 协议）
        const text = String(body.text ?? body.emoji ?? "");
        if (!rawKey.remoteJid || !rawKey.id)
          return json(res, 400, { error: "缺少 message key" });
        const key = {
          remoteJid: String(rawKey.remoteJid),
          id: String(rawKey.id),
          fromMe: Boolean(rawKey.fromMe),
        };
        if (rawKey.participant) {
          key.participant = String(rawKey.participant);
        } else {
          // 群消息反应需要 participant；尽量从缓存补全
          try {
            const stored = d.findStoredMessageByKey?.(key);
            const p =
              stored?.waKey?.participant ||
              stored?.senderJid ||
              d.rawWaByMsgId?.get(key.id)?.key?.participant;
            if (p) key.participant = String(p);
          } catch {
            /* ignore */
          }
        }
        await d.socket.sendMessage(key.remoteJid, {
          react: { text, key },
        });
        return json(res, 200, { ok: true, text, key });
      }

      // 按协议 key 补下媒体（会话内「重新加载」）
      if (req.method === "POST" && url.pathname === "/message/media") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const key = body.key || {};
        if (!key.id) return json(res, 400, { error: "缺少 message key.id" });
        const stored = d.findStoredMessageByKey(key);
        const wa =
          d.rawWaByMsgId.get(key.id) ||
          (stored?.id ? d.rawWaByMsgId.get(stored.id) : null) ||
          (stored?.waKey?.id ? d.rawWaByMsgId.get(stored.waKey.id) : null) ||
          (await d.loadRawWaById?.(key.id)) ||
          (stored?.id ? await d.loadRawWaById?.(stored.id) : null) ||
          (stored?.waKey?.id
            ? await d.loadRawWaById?.(stored.waKey.id)
            : null);
        if (!wa) {
          return json(res, 404, {
            error:
              "桥接内存中无此消息的原始媒体（重启后历史需对方重发或重新同步后的新消息）",
          });
        }
        const mediaType =
          body.mediaType ||
          stored?.mediaType ||
          describeMessage(wa)?.mediaType ||
          "";
        const mimetype =
          body.mimetype || stored?.mediaMime || describeMessage(wa)?.mimetype;
        if (
          !mediaType ||
          !["image", "sticker", "gif", "audio", "video", "document"].includes(
            mediaType
          )
        ) {
          return json(res, 400, { error: "无法识别媒体类型" });
        }
        const dataUrl = await d.mediaToDataUrl(wa, mediaType, mimetype, {
          force: true,
        });
        if (!dataUrl) {
          return json(res, 502, {
            error: "下载失败或文件过大",
          });
        }
        if (stored) {
          stored.mediaUrl = dataUrl;
          stored.mediaType = mediaType;
          if (mimetype) stored.mediaMime = mimetype;
          d.messages.set(stored.id, stored);
          d.push("messages.sync", {
            items: [stored],
            live: false,
            source: "enrich",
          });
        }
        return json(res, 200, {
          ok: true,
          mediaUrl: dataUrl,
          mediaType,
          mediaMime: mimetype || "",
          mediaFileName: stored?.mediaFileName || "",
          id: stored?.id || key.id,
        });
      }

      // 个人资料：昵称 / 个性签名 / 头像
      if (req.method === "POST" && url.pathname === "/profile") {
        if (d.connection !== "connected" || !d.socket)
          return json(res, 409, { error: "WhatsApp 尚未连接" });
        const body = await requestBody(req);
        const { name, status, avatarDataUrl } = body || {};
        const results = { name: false, status: false, avatar: false };
        if (typeof name === "string" && name.trim()) {
          await d.socket.updateProfileName(name.trim());
          results.name = true;
        }
        if (typeof status === "string" && status.trim()) {
          await d.socket.updateProfileStatus(status.trim());
          results.status = true;
        }
        if (
          typeof avatarDataUrl === "string" &&
          avatarDataUrl.startsWith("data:image")
        ) {
          const parsed = parseDataUrl(avatarDataUrl);
          if (!parsed?.buf?.length)
            return json(res, 400, { error: "头像数据无效" });
          await d.socket.updateProfilePicture(
            d.socket.user?.id || "",
            parsed.buf
          );
          results.avatar = true;
        }
        if (!results.name && !results.status && !results.avatar)
          return json(res, 400, { error: "没有可更新的内容" });
        return json(res, 200, { ok: true, ...results });
      }

      // 写路由优先（含 GET invite）；再只读 metadata
      if (await tryHandleCatalogRoutes(req, res, url, d)) return;
      if (await tryHandleGroupWriteRoutes(req, res, url, d)) return;
      if (await tryHandleBlocklistRoutes(req, res, url, d)) return;
      if (await tryHandleGroupRoutes(req, res, url, d)) return;

      return json(res, 404, { error: "not found" });
    } catch (error) {
      console.error(`[${req.method} ${req.url || ""}]`, error);
      return json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  
  };
}

export function startBaileysHttpServer(listenPort, getD) {
  const server = http.createServer(createBaileysRequestHandler(getD));
  server.listen(listenPort, "127.0.0.1", () => {
    const d = typeof getD === "function" ? getD() : getD;
    void d.connect({ clearAuth: false }).catch((error) => {
      d.connection = "error";
      d.lastError = String(error);
      d.push("baileys.error", { message: String(error) });
    });
  });
  return server;
}
