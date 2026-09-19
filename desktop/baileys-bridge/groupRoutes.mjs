/**
 * 群相关 HTTP 路由（只读）。
 * 由 httpServer 在主 handler 里调用 tryHandleGroupRoutes。
 */
import { json, requestBody } from "./httpUtil.mjs";

/**
 * @returns {Promise<boolean>} true = 已处理
 */
export async function tryHandleGroupRoutes(req, res, url, d) {
  const path = url.pathname;

  // POST /groups/common  body: { jids?: string[], phone?: string }
  if (req.method === "POST" && path === "/groups/common") {
    if (!d.groupService) {
      json(res, 503, { error: "group_service_unavailable" });
      return true;
    }
    try {
      const body = await requestBody(req);
      const groups = await d.groupService.fetchCommonGroups(
        {
          jids: Array.isArray(body.jids) ? body.jids.slice(0, 8) : [],
          phone: body.phone,
        },
        { force: body.force === true }
      );
      const status = d.statusPayload?.() || {};
      json(res, 200, {
        ok: true,
        protocolVersion: status.protocolVersion,
        baileysVersion: status.baileysVersion,
        groups,
      });
    } catch (e) {
      const code = e?.code || "";
      const status = code === "not_connected" ? 409 : code === "unsupported" ? 501 : 502;
      json(res, status, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        code,
      });
    }
    return true;
  }

  // GET /groups/:jid — 完整 metadata + participants（不含 /invite 等子路径）
  if (req.method === "GET" && path.startsWith("/groups/")) {
    if (path === "/groups/invite-info") return false;
    const rawPath = path.slice("/groups/".length);
    // encode 后的 jid 不应再含未编码的 /action；若有第二段交给 write routes
    if (rawPath.includes("/") && !rawPath.endsWith("@g.us")) {
      // e.g. ENCODED_JID/invite
      return false;
    }
    const raw = decodeURIComponent(rawPath);
    if (raw.includes("/") && !raw.endsWith("@g.us")) return false;
    const jid = raw.includes("@") ? raw : `${raw}@g.us`;
    if (!d.groupService) {
      json(res, 503, { error: "group_service_unavailable" });
      return true;
    }
    try {
      const meta = await d.groupService.fetchMetadata(jid, {
        apply: true,
        push: true,
      });
      const status = d.statusPayload?.() || {};
      json(res, 200, {
        ok: true,
        protocolVersion: status.protocolVersion,
        baileysVersion: status.baileysVersion,
        group: meta,
      });
    } catch (e) {
      const code = e?.code || "";
      const status =
        code === "not_connected"
          ? 409
          : code === "invalid_jid"
            ? 400
            : 502;
      json(res, status, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        code,
      });
    }
    return true;
  }

  // POST /groups/invite-info  body: { code | url }
  if (req.method === "POST" && path === "/groups/invite-info") {
    if (!d.groupService) {
      json(res, 503, { error: "group_service_unavailable" });
      return true;
    }
    try {
      const body = await requestBody(req);
      const codeOrUrl = body.code || body.url || body.invite || "";
      const info = await d.groupService.fetchInviteInfo(codeOrUrl);
      const status = d.statusPayload?.() || {};
      json(res, 200, {
        ok: true,
        protocolVersion: status.protocolVersion,
        baileysVersion: status.baileysVersion,
        invite: info,
      });
    } catch (e) {
      const code = e?.code || "";
      const status =
        code === "not_connected"
          ? 409
          : code === "invalid_invite"
            ? 400
            : code === "unsupported"
              ? 501
              : 502;
      json(res, status, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        code,
      });
    }
    return true;
  }

  return false;
}
