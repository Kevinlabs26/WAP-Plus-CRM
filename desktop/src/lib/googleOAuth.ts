export interface GoogleDesktopClient {
  clientId: string;
  clientSecret: string;
}

/** Google issues a client configuration, not an account password or an access token. */
export function parseGoogleDesktopClient(json: string): GoogleDesktopClient {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error("Invalid Google client JSON"); }
  if (!data || typeof data !== "object" || !("installed" in data)) throw new Error("A Google desktop application client is required");
  const installed = (data as { installed?: unknown }).installed;
  if (!installed || typeof installed !== "object") throw new Error("Invalid Google desktop client");
  const client = installed as Record<string, unknown>;
  if (typeof client.client_id !== "string" || !client.client_id.endsWith(".apps.googleusercontent.com") || typeof client.client_secret !== "string" || !client.client_secret) {
    throw new Error("Invalid Google desktop client credentials");
  }
  return { clientId: client.client_id, clientSecret: client.client_secret };
}
