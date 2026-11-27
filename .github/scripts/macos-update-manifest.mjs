import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [version, tag, directory] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || tag !== `v${version}` || !directory) {
  throw new Error("Expected a release version, matching desktop release tag and asset directory");
}

const platforms = {};
for (const [arch, target] of [["arm64", "darwin-aarch64"], ["x86_64", "darwin-x86_64"]]) {
  const asset = `WAP-Plus-CRM-${version}-macOS-${arch}.app.tar.gz`;
  if (!statSync(join(directory, asset)).size) throw new Error(`Empty update archive: ${asset}`);
  const signature = readFileSync(join(directory, `${asset}.sig`), "utf8").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error(`Invalid updater signature: ${asset}.sig`);
  platforms[target] = {
    signature,
    url: `https://github.com/Kevinlabs26/WAP-Plus-CRM/releases/download/${tag}/${asset}`,
  };
}

process.stdout.write(`${JSON.stringify({ version, platforms }, null, 2)}\n`);
