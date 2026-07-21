#!/usr/bin/env python3
"""Deploy Craft AI to Amvera from the current checkout.

Policy: run this from an up-to-date `main` after PRs are merged.
Requires AMVERA_TOKEN and /tmp/amvera_mcp.py (or AMVERA_MCP_PATH).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SLUG = os.environ.get("AMVERA_SLUG", "attached-assets")
MCP = Path(os.environ.get("AMVERA_MCP_PATH", "/tmp/amvera_mcp.py"))

# Core app surfaces that must stay in sync across features.
DEFAULT_FILES = [
    "server/routes.ts",
    "server/auth.ts",
    "server/storage.ts",
    "server/scroll-world.ts",
    "server/site3d-anim.ts",
    "server/motion-reveal.ts",
    "server/kie-errors.ts",
    "server/agent-runtime.ts",
    "server/seo-routes.ts",
    "server/telegram-bot-auth.ts",
    "server/url-guard.ts",
    "shared/schema.ts",
    "shared/project-files.ts",
    "client/src/pages/dashboard.tsx",
    "client/src/pages/editor.tsx",
    "client/src/pages/auth-page.tsx",
    "client/src/pages/landing.tsx",
    "client/src/pages/admin.tsx",
    "client/src/pages/profile.tsx",
    "client/public/scroll-world-engine.js",
    "client/public/yandex-suggest-token.html",
    "AGENTS.md",
]


def die(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def require_main() -> None:
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if branch != "main" and os.environ.get("AMVERA_ALLOW_NON_MAIN") != "1":
        die(
            f"Refusing to deploy from branch '{branch}'. "
            "Merge to main first, or set AMVERA_ALLOW_NON_MAIN=1 for emergencies."
        )
    # Warn if local main is behind origin/main
    try:
        git("fetch", "origin", "main")
        behind = git("rev-list", "--count", "HEAD..origin/main")
        if behind != "0":
            die(f"Local main is {behind} commit(s) behind origin/main. Pull first.")
    except subprocess.CalledProcessError:
        print("WARN: could not fetch origin/main — continuing with local tip")


def mcp_call(name: str, args: dict, attempts: int = 5) -> dict:
    if not MCP.exists():
        die(f"Amvera MCP helper not found at {MCP}")
    if not os.environ.get("AMVERA_TOKEN"):
        die("AMVERA_TOKEN is not set")
    args_path = Path("/tmp/amvera_deploy_args.json")
    args_path.write_text(json.dumps(args, ensure_ascii=False), encoding="utf-8")
    script = f"""
import json
exec(open({str(MCP)!r}).read().split("def main")[0])
rpc("initialize", {{"protocolVersion":"2024-11-05","capabilities":{{}},"clientInfo":{{"name":"deploy-amvera","version":"1"}}}})
rpc("notifications/initialized", notify=True)
args = json.load(open({str(args_path)!r}))
r = tool({name!r}, args)
print(json.dumps(r, ensure_ascii=False))
"""
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            out = subprocess.check_output(
                ["python3", "-c", script], text=True, timeout=600
            )
            return json.loads(out)
        except Exception as e:  # noqa: BLE001 — network/timeouts from Amvera MCP
            last_err = e
            wait = 4 * (2**i)
            print(f"  mcp_call {name} failed (try {i + 1}/{attempts}): {e}")
            time.sleep(wait)
    die(f"mcp_call {name} failed after {attempts} attempts: {last_err}")
    raise RuntimeError("unreachable")


def upload_file(rel: str) -> None:
    abs_path = ROOT / rel
    if not abs_path.exists():
        print(f"skip missing {rel}")
        return
    text = abs_path.read_text(encoding="utf-8")
    parent = Path(rel).parent
    # Amvera rejects null/empty path — use "/" for repo root.
    path = "/" if str(parent) in (".", "") else str(parent).replace("\\", "/")
    filename = Path(rel).name
    print(f"upload {rel} ({len(text)} chars)…")
    r = mcp_call(
        "uploadFiles",
        {
            "slug": SLUG,
            "filePath": "",
            "fileText": text,
            "fileBase64": "",
            "filename": filename,
            "path": path,
            "commitMessage": f"Deploy from main: {rel}",
            "branch": "master",
        },
    )
    content = (((r.get("result") or {}).get("content") or [{}])[0].get("text") or "")
    if r.get("result", {}).get("isError") or "Uploaded" not in content:
        print(json.dumps(r, ensure_ascii=False)[:800])
        die(f"upload failed for {rel}")
    print(" ", content[:200])
    time.sleep(0.8)


def wait_running(timeout_s: int = 900) -> None:
    print("rebuild…")
    r = mcp_call("rebuildProject", {"slug": SLUG})
    print((((r.get("result") or {}).get("content") or [{}])[0].get("text") or r)[:300])
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        time.sleep(15)
        info = mcp_call("getProject", {"slug": SLUG})
        text = (((info.get("result") or {}).get("content") or [{}])[0].get("text") or "")
        last = text
        status_line = next((ln for ln in text.splitlines() if ln.startswith("Status:")), text[:120])
        print(status_line)
        if "Status: RUNNING" in text:
            print("OK: Amvera RUNNING")
            return
        if "Status: ERROR" in text or "Status: FAILED" in text or "BUILD_ERROR" in text:
            die(f"Amvera failed:\n{text}")
    die(f"Timed out waiting for RUNNING.\n{last}")


def main() -> None:
    os.chdir(ROOT)
    require_main()
    tip = git("rev-parse", "--short", "HEAD")
    print(f"Deploying {SLUG} from {git('rev-parse', '--abbrev-ref', 'HEAD')} @ {tip}")
    files = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_FILES
    for rel in files:
        upload_file(rel)
    wait_running()


if __name__ == "__main__":
    main()
