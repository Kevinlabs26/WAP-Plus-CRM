import { readAiJson } from "./aiResponse.ts";

export const VERTEX_DEFAULT_MODEL = "gemini-3.5-flash";
export const VERTEX_CREDENTIAL_LIMIT = 16_384;
const VERTEX_HOST = "https://aiplatform.googleapis.com";
const VERTEX_ROOT = `${VERTEX_HOST}/v1`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_MODELS = "publishers/google/models";

export type VertexCredentials = {
  mode: "express" | "service_account";
  apiKey: string;
  serviceAccountJson: string;
};

export function unpackVertexCredentials(raw: string): VertexCredentials {
  const value = raw.trim();
  if (value.startsWith("{")) {
    try {
      const saved = JSON.parse(value);
      if (saved.type === "bridgecrm_vertex_credentials"
        && (saved.mode === "express" || saved.mode === "service_account")
        && typeof saved.apiKey === "string" && typeof saved.serviceAccountJson === "string") {
        return { mode: saved.mode, apiKey: saved.apiKey, serviceAccountJson: saved.serviceAccountJson };
      }
    } catch {
      // Preserve legacy JSON so the service account validator can report its error.
    }
    return { mode: "service_account", apiKey: "", serviceAccountJson: value };
  }
  return { mode: "express", apiKey: value, serviceAccountJson: "" };
}

export function packVertexCredentials({ mode, apiKey, serviceAccountJson }: VertexCredentials): string {
  if (!apiKey.trim() || !serviceAccountJson) return apiKey.trim() || serviceAccountJson;
  return JSON.stringify({ type: "bridgecrm_vertex_credentials", mode, apiKey: apiKey.trim(), serviceAccountJson });
}

// shortcut: Express has no catalog API. Probe the documented text models and sample IDs until Google adds one.
const EXPRESS_TEXT_MODELS = [
  "gemini-3.8-flash", VERTEX_DEFAULT_MODEL, "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-3-flash-preview",
  "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
];

function isVertexTextModel(id: string) {
  return /^gemini-[a-z0-9][a-z0-9.-]{0,151}$/.test(id)
    && !/(?:^|-)(?:image|live|audio|tts|embedding|omni|robotics|computer-use)(?:-|$)/.test(id);
}

export function parseVertexServiceAccount(raw: string) {
  try {
    if (raw.length > VERTEX_CREDENTIAL_LIMIT) throw Error();
    const account = JSON.parse(raw);
    if (account.type !== "service_account"
      || typeof account.project_id !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(account.project_id)
      || typeof account.client_email !== "string" || !/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(account.client_email)
      || typeof account.private_key !== "string" || !/^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+-----END PRIVATE KEY-----\s*$/.test(account.private_key)) throw Error();
    return {
      type: "service_account",
      project_id: account.project_id as string,
      client_email: account.client_email as string,
      private_key: account.private_key as string,
    };
  } catch {
    throw Error("Invalid Google Cloud service account JSON");
  }
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function vertexRequest(credential: string, signal: AbortSignal) {
  const { mode, apiKey, serviceAccountJson } = unpackVertexCredentials(credential);
  if (mode === "express") {
    const value = apiKey.trim();
    if (!/^[A-Za-z0-9._-]{1,256}$/.test(value)) throw Error("Invalid Vertex AI API key");
    return { base: `${VERTEX_ROOT}/${GOOGLE_MODELS}`, headers: new Headers({ "x-goog-api-key": value }) };
  }

  const account = parseVertexServiceAccount(serviceAccountJson);
  const pem = account.private_key.replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), char => char.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const encoder = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(encoder.encode(JSON.stringify({
    iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: TOKEN_URL, iat: now, exp: now + 3600,
  })));
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  signal.throwIfAborted();
  // shortcut: exchange per request, cache short-lived tokens if this becomes a measurable delay.
  const response = await fetch(TOKEN_URL, {
    method: "POST", signal, redirect: "error",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}`,
    }),
  });
  if (!response.ok) throw Error(`Vertex AI OAuth (${response.status})`);
  const data = await readAiJson(response) as { access_token?: string } | null;
  if (typeof data?.access_token !== "string" || !/^[A-Za-z0-9._~+/=-]+$/.test(data.access_token)) throw Error("Invalid Vertex AI OAuth response");
  return {
    base: `${VERTEX_ROOT}/projects/${account.project_id}/locations/global/${GOOGLE_MODELS}`,
    headers: new Headers({ Authorization: `Bearer ${data.access_token}` }),
  };
}

export async function listVertexModels(credential: string, selected: string, signal: AbortSignal): Promise<string[]> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const { base, headers } = await vertexRequest(credential, requestSignal);
  requestSignal.throwIfAborted();
  const candidates = new Set([selected, ...EXPRESS_TEXT_MODELS].filter(isVertexTextModel));

  if (headers.has("Authorization")) {
    const catalog = new URL(`${VERTEX_HOST}/v1beta1/${GOOGLE_MODELS}`);
    catalog.searchParams.set("pageSize", "100");
    const visited = new Set<string>();
    do {
      const response = await fetch(catalog.toString(), { headers, signal: requestSignal, redirect: "error" });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 403 || response.status === 404) break;
        throw Error(`Vertex AI (${response.status})`);
      }
      const data = await readAiJson(response) as { publisherModels?: { name?: string }[]; nextPageToken?: string } | null;
      for (const model of Array.isArray(data?.publisherModels) ? data.publisherModels : []) {
        const name = model?.name;
        const id = typeof name === "string" && name.startsWith(`${GOOGLE_MODELS}/`) ? name.slice(GOOGLE_MODELS.length + 1) : "";
        if (isVertexTextModel(id)) candidates.add(id);
      }
      const nextPage = data?.nextPageToken;
      if (typeof nextPage !== "string" || !nextPage || visited.has(nextPage)) break;
      visited.add(nextPage);
      catalog.searchParams.set("pageToken", nextPage);
    } while (true);
  }

  headers.set("Content-Type", "application/json");
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "OK" }] }] });
  const available: string[] = [];
  const ids = [...candidates];
  for (let index = 0; index < ids.length; index += 4) {
    requestSignal.throwIfAborted();
    const batch = await Promise.all(ids.slice(index, index + 4).map(async id => {
      const response = await fetch(`${base}/${id}:countTokens`, {
        method: "POST", headers, body, signal: requestSignal, redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([400, 403, 404].includes(response.status)) return "";
        throw Error(`Vertex AI (${response.status})`);
      }
      const data = await readAiJson(response) as { totalTokens?: number } | null;
      return typeof data?.totalTokens === "number" && data.totalTokens > 0 ? id : "";
    }));
    available.push(...batch.filter(Boolean));
  }
  requestSignal.throwIfAborted();
  return available.sort();
}
