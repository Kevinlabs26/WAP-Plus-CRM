import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseGoogleDesktopClient } from "../../desktop/src/lib/googleOAuth.ts";

const raw = process.env.GOOGLE_DESKTOP_CLIENT_JSON;
try {
  if (!raw) throw new Error();
  parseGoogleDesktopClient(raw);
  if (!process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) throw new Error();
} catch {
  process.stderr.write("Missing or invalid GOOGLE_DESKTOP_CLIENT_JSON desktop OAuth configuration. Release stopped.\n");
  process.exit(1);
}
mkdirSync(process.env.RUNNER_TEMP, { recursive: true });
const path = join(process.env.RUNNER_TEMP, "wap-google-desktop-client.json");
writeFileSync(path, raw, { mode: 0o600 });
appendFileSync(process.env.GITHUB_ENV, `WAP_GOOGLE_CLIENT_PATH=${path}\nWAP_REQUIRE_GOOGLE_CLIENT=1\n`);
process.stdout.write("Google desktop client configuration validated for release.\n");
