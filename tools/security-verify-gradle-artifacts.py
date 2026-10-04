"""Verify Gradle's bootstrap hashes against bytes from official HTTPS repositories."""
import argparse
import concurrent.futures
import hashlib
import json
import time
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
NS = "https://schema.gradle.org/dependency-verification"
q = lambda name: f"{{{NS}}}{name}"
REPOS = ["https://repo.maven.apache.org/maven2/", "https://dl.google.com/dl/android/maven2/", "https://plugins.gradle.org/m2/"]
HOSTS = {"repo.maven.apache.org", "dl.google.com", "plugins.gradle.org", "plugins-artifacts.gradle.org"}

def verify(record):
    group, name, version, filename = (record[k] for k in ("group", "name", "version", "artifact"))
    base = "/".join(urllib.parse.quote(p, safe="") for p in [*group.split("."), name, version]) + "/"
    repos = [REPOS[1], REPOS[0], REPOS[2]] if group.startswith(("androidx.", "com.android.", "com.google.testing.")) else REPOS
    # Android variant metadata names the file '*-release.aar', but publishes it at the canonical Maven URL.
    filenames = [filename] + ([f"{name}-{version}.aar"] if filename.endswith("-release.aar") else [])
    last = {**record, "error": "not found in official repositories", "verified": False}
    for repo, filename in [(r, f) for r in repos for f in filenames]:
        url = repo + base + urllib.parse.quote(filename, safe="")
        try:
            with urllib.request.urlopen(url, timeout=45) as response:
                final = urllib.parse.urlparse(response.url)
                if final.scheme != "https" or final.hostname not in HOSTS:
                    raise ValueError("unexpected repository redirect")
                digest = hashlib.sha256()
                size = 0
                started = time.monotonic()
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > 512 * 1024 * 1024 or time.monotonic() - started > 180:
                        raise ValueError("repository artifact exceeds size/time limit")
                    digest.update(chunk)
                value = digest.hexdigest()
                last = {**record, "url": url, "bytes": size, "sha256": value, "verified": value in record["expected"]}
                if last["verified"]:
                    return last
        except urllib.error.HTTPError as error:
            if error.code == 404:
                continue
            return {**record, "url": url, "error": str(error), "verified": False}
        except Exception as error:
            return {**record, "url": url, "error": str(error), "verified": False}
    return last

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="replace bootstrap hashes only when every artifact is verified")
    args = parser.parse_args()
    metadata = ROOT / "android/gradle/verification-metadata.xml"
    tree = ET.parse(metadata)
    records, artifacts = [], []
    for component in tree.getroot().find(q("components")):
        for artifact in component.findall(q("artifact")):
            hashes = artifact.findall(q("sha256"))
            expected = [h.get("value") for h in hashes] + [a.get("value") for h in hashes for a in h.findall(q("also-trust"))]
            records.append({**component.attrib, "artifact": artifact.get("name"), "expected": expected})
            artifacts.append(artifact)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(verify, records))
    failures = [r for r in results if not r["verified"]]
    output = ROOT / "docs/security/gradle-official-verification.json"
    output.write_text(json.dumps({"artifacts": len(results), "verified": len(results) - len(failures), "results": results}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"artifacts": len(results), "verified": len(results) - len(failures), "failures": failures}, indent=2), flush=True)
    if failures:
        raise SystemExit(1)
    if args.apply:
        for artifact, result in zip(artifacts, results):
            for old in artifact.findall(q("sha256")):
                artifact.remove(old)
            ET.SubElement(artifact, q("sha256"), value=result["sha256"], origin=result["url"])
        ET.register_namespace("", NS)
        ET.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")
        ET.indent(tree, space="   ")
        tree.write(metadata, encoding="UTF-8", xml_declaration=True)

if __name__ == "__main__":
    main()
