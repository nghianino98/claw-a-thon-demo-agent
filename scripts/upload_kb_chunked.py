#!/usr/bin/env python3
import os
import sys
import argparse
import uuid
import tempfile
import shutil
from pathlib import Path
import httpx

def main():
    parser = argparse.ArgumentParser(description="Upload KB zip in chunks reusing TCP connections")
    parser.add_argument("url", help="Base URL of the Agent endpoint")
    parser.add_argument("zip_path", help="Path to wealth-kb.zip")
    parser.add_argument("--activate", default="true", help="Activate KB after upload (true/false)")
    parser.add_argument("--part-size", default="15m", help="Part size (e.g. 15m)")
    args = parser.parse_args()

    base_url = args.url.rstrip("/")
    zip_path = Path(args.zip_path)
    activate_val = args.activate.lower() == "true"
    
    # Parse part size in bytes
    part_size_str = args.part_size.lower()
    if part_size_str.endswith("m"):
        part_size_bytes = int(part_size_str[:-1]) * 1024 * 1024
    elif part_size_str.endswith("k"):
        part_size_bytes = int(part_size_str[:-1]) * 1024
    else:
        part_size_bytes = int(part_size_str)

    admin_token = os.getenv("AGENT_ADMIN_TOKEN")
    if not admin_token:
        print("ERROR: AGENT_ADMIN_TOKEN must be set in the environment", file=sys.stderr)
        sys.exit(2)

    if not zip_path.exists():
        print(f"ERROR: Zip file not found at {zip_path}", file=sys.stderr)
        sys.exit(2)

    headers = {
        "Authorization": f"Bearer {admin_token}",
        "X-Acting-User": os.getenv("ACTING_USER", "duy"),
        "X-Acting-Role": os.getenv("ACTING_ROLE", "superadmin")
    }

    # Split files manually in Python to avoid external dependencies
    temp_dir = Path(tempfile.mkdtemp())
    try:
        print(f"Splitting {zip_path.name} into {args.part_size} parts...")
        parts = []
        with open(zip_path, "rb") as f:
            part_no = 0
            while True:
                chunk = f.read(part_size_bytes)
                if not chunk:
                    break
                part_file = temp_dir / f"part-{part_no:05d}"
                part_file.write_bytes(chunk)
                parts.append(part_file)
                part_no += 1

        total_parts = len(parts)
        print(f"Split completed. Total parts: {total_parts}")

        # Use HTTP client with connection pool
        with httpx.Client(timeout=120) as client:
            # 1. Start chunked upload
            start_url = f"{base_url}/admin/api/kb/chunked/start"
            start_payload = {
                "filename": zip_path.name,
                "total_parts": total_parts,
                "activate": activate_val
            }
            resp = client.post(start_url, headers=headers, json=start_payload)
            resp.raise_for_status()
            upload_id = resp.json()["upload_id"]
            print(f"Started upload session. upload_id={upload_id}")

            # 2. Upload each part
            for i, part_file in enumerate(parts):
                print(f"Uploading part {i+1}/{total_parts} ({part_file.stat().st_size / 1024 / 1024:.2f} MB)...")
                part_url = f"{base_url}/admin/api/kb/chunked/{upload_id}/part/{i}"
                with open(part_file, "rb") as pf:
                    files = {"file": (part_file.name, pf, "application/octet-stream")}
                    resp = client.post(part_url, headers=headers, files=files)
                    resp.raise_for_status()

            # 3. Complete chunked upload
            print("Completing chunked upload...")
            complete_url = f"{base_url}/admin/api/kb/chunked/{upload_id}/complete"
            resp = client.post(complete_url, headers=headers)
            resp.raise_for_status()
            print("Upload completed successfully!")
            print(resp.json())

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == "__main__":
    main()
