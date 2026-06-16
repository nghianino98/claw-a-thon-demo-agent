import os
import runpy
import sys
from pathlib import Path


SCRIPT_MAP = {
    "confluence": "crawl_confluence.py",
    "jira": "crawl_jira.py",
    "gitlab": "crawl_gitlab.py",
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in SCRIPT_MAP:
        print("[!] Target required (confluence|jira|gitlab)", flush=True)
        sys.exit(1)

    target = sys.argv[1]
    rest = sys.argv[2:]
    username = os.environ.get("CRAWLER_USERNAME", "")
    api_key = os.environ.get("CRAWLER_API_KEY", "")
    if not username or not api_key:
        print("[!] Missing crawler credential env", flush=True)
        sys.exit(1)

    script = Path(__file__).resolve().parent / SCRIPT_MAP[target]
    if not script.exists():
        print(f"[!] Target script not found: {script.name}", flush=True)
        sys.exit(1)

    sys.argv = [
        str(script),
        *rest,
        "--username",
        username,
        "--api-key",
        api_key,
    ]
    runpy.run_path(str(script), run_name="__main__")


if __name__ == "__main__":
    main()
