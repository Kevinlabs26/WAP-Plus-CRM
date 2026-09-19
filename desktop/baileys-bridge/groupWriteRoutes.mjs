/**
 * 群写操作 HTTP 路由。与只读 groupRoutes 分离。
 */
import { json, requestBody } from "./httpUtil.mjs";

function statusOf(e) {
  const code = e?.code || "";
  if (code === "not_connected") return 409;
  if (
    code === "invalid_jid" ||
    code === "invalid_subject" ||
    code === "invalid_action" ||
    code === "invalid_participant" ||
    code === "invalid_invite" ||
    code === "empty_participants" ||
    code === "empty_settings"
  )
    return 400;
  if (code === "unsupported") return 501;
  return 502;
}

function fail(res, e) {
  json(res, statusOf(e), {
    ok: false,
    error: e instanceof Error ? e.message : String(e),
    code: e?.code || "",
  });
}

function ok(res, d, extra = {}) {
  const status = d.statusPayload?.() || {};
  json(res, 200, {
    ok: true,
    protocolVersion: status.protocolVersion,
    baileysVersion: status.baileysVersion,
    ...extra,
  });
}

/**
 * 解析 /groups/:jid/... 中的 jid（支持 encodeURIComponent）
 * @returns {{ jid: string, rest: string } | null}
 */
function parseGroupPath(pathname) {
  if (!pathname.startsWith("/groups/")) return null;
  const restFull = pathname.slice("/groups/".length);
  if (
    !restFull ||
    restFull === "invite-info" ||
    restFull === "invite-accept" ||
    restFull === "create"
  ) {
    return null;
  }
  // jid 可能含 @，path 应为 encode 后的整段 + /action
  // 形式：encode(jid) 或 encode(jid)/subject
  const slash = restFull.indexOf("/");
  const head = slash >= 0 ? restFull.slice(0, slash) : restFull;
  const rest = slash >= 0 ? restFull.slice(slash + 1) : "";
  let jid = decodeURIComponent(head);
  if (!jid.includes("@") && /^\d+/.test(jid)) jid = `${jid}@g.us`;
  return { jid, rest };
}

/**
 * @returns {Promise<boolean>}
 */
export async function tryHandleGroupWriteRoutes(req, res, url, d) {
  const path = url.pathname;
  const w = d.groupWriteService;
  if (!w) return false;

  // POST /groups/invite-accept
  if (req.method === "POST" && path === "/groups/invite-accept") {
    try {
      const body = await requestBody(req);
      const result = await w.acceptInvite(body.code || body.url || body.invite || "");
      ok(res, d, result);
    } catch (e) {
      fail(res, e);
    }
    return true;
  }

  // POST /groups/create  { subject, participants? }
  if (req.method === "POST" && path === "/groups/create") {
    try {
      const body = await requestBody(req);
      const result = await w.createGroup(
        body.subject || body.name || "",
        body.participants || body.jids || []
      );
      ok(res, d, result);
    } catch (e) {
      fail(res, e);
    }
    return true;
  }

  const parsed = parseGroupPath(path);
  if (!parsed) return false;
  const { jid, rest } = parsed;

  try {
    if (req.method === "POST" && rest === "subject") {
      const body = await requestBody(req);
      const group = await w.updateSubject(jid, body.subject || body.name || "");
      ok(res, d, { group });
      return true;
    }
    if (req.method === "POST" && (rest === "description" || rest === "desc")) {
      const body = await requestBody(req);
      const group = await w.updateDescription(
        jid,
        body.description ?? body.desc ?? ""
      );
      ok(res, d, { group });
      return true;
    }
    if (req.method === "POST" && rest === "participants") {
      const body = await requestBody(req);
      const out = await w.participantsUpdate(
        jid,
        body.action,
        body.participants || body.jids || []
      );
      ok(res, d, out);
      return true;
    }
    if (req.method === "GET" && rest === "invite") {
      const invite = await w.getInviteCode(jid);
      ok(res, d, invite);
      return true;
    }
    if (req.method === "POST" && rest === "invite/revoke") {
      const invite = await w.revokeInvite(jid);
      ok(res, d, invite);
      return true;
    }
    if (req.method === "POST" && rest === "leave") {
      const out = await w.leave(jid);
      ok(res, d, out);
      return true;
    }
    if (req.method === "POST" && rest === "settings") {
      const body = await requestBody(req);
      const out = await w.updateSettings(jid, body);
      ok(res, d, out);
      return true;
    }
    if (req.method === "GET" && (rest === "join-requests" || rest === "requests")) {
      const pending = await w.listJoinRequests(jid);
      ok(res, d, { pending });
      return true;
    }
    if (req.method === "POST" && (rest === "join-requests" || rest === "requests")) {
      const body = await requestBody(req);
      const out = await w.updateJoinRequests(
        jid,
        body.action,
        body.participants || body.jids || []
      );
      ok(res, d, out);
      return true;
    }
  } catch (e) {
    fail(res, e);
    return true;
  }

  return false;
}
