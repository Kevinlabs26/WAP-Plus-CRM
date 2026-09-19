/**
 * 黑名单 HTTP：GET 列表 / POST block|unblock
 */
import { json, requestBody } from "./httpUtil.mjs";

function fail(res, e) {
  const code = e?.code || "";
  const status =
    code === "not_connected"
      ? 409
      : code === "invalid_jid" || code === "invalid_action"
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

/**
 * @returns {Promise<boolean>}
 */
export async function tryHandleBlocklistRoutes(req, res, url, d) {
  const path = url.pathname;
  if (!path.startsWith("/blocklist")) return false;
  const svc = d.blocklistService;
  if (!svc) {
    json(res, 503, { error: "blocklist_unavailable" });
    return true;
  }
  const status = d.statusPayload?.() || {};

  if (req.method === "GET" && path === "/blocklist") {
    try {
      const force = url.searchParams.get("refresh") === "1";
      const jids = await svc.fetch(force);
      json(res, 200, {
        ok: true,
        protocolVersion: status.protocolVersion,
        baileysVersion: status.baileysVersion,
        jids,
      });
    } catch (e) {
      fail(res, e);
    }
    return true;
  }

  if (req.method === "POST" && path === "/blocklist") {
    try {
      const body = await requestBody(req);
      const out = await svc.setStatus(
        body.jid || body.phoneE164 || body.phone || "",
        body.action || body.status || ""
      );
      json(res, 200, {
        ok: true,
        protocolVersion: status.protocolVersion,
        baileysVersion: status.baileysVersion,
        ...out,
      });
    } catch (e) {
      fail(res, e);
    }
    return true;
  }

  return false;
}
