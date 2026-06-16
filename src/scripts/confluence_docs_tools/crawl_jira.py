import os
import argparse
import sys
import json
import re
from jira import JIRA
from datetime import datetime

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path, exist_ok=True)

def get_unix_time(dt_str):
    if not dt_str: return 0
    dt_str = dt_str.strip()
    if dt_str.endswith("Z"): dt_str = dt_str[:-1] + "+00:00"
    # Handle missing colon in timezone offset (e.g., +0700 -> +07:00)
    if len(dt_str) >= 5 and dt_str[-5] in "+-" and dt_str[-3] != ":":
        dt_str = dt_str[:-2] + ":" + dt_str[-2:]
    try:
        return datetime.fromisoformat(dt_str).timestamp()
    except Exception:
        try:
            return datetime.strptime(dt_str[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S").timestamp()
        except Exception:
            return 0

def main():
    parser = argparse.ArgumentParser(description="Crawl Jira issues and export to Markdown.")
    parser.add_argument("--base-url", required=True, help="Jira instance URL (e.g. https://your-domain.atlassian.net)")
    parser.add_argument("--api-key", required=True, help="Jira API Token")
    parser.add_argument("--username", required=True, help="Email for authentication")
    parser.add_argument("--project-key", help="Project Key (optional if JQL is used)")
    parser.add_argument("--jql", help="JQL query to filter issues")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--modified-since", help="ISO 8601 timestamp for incremental sync (YYYY-MM-DD HH:MM)")
    
    args = parser.parse_args()
    
    ensure_dir(args.output_dir)
    
    # Jira options with modern browser-like headers for compatibility
    options = {
        "server": args.base_url,
        "headers": {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "X-Atlassian-Token": "no-check"
        }
    }

    try:
        # Priority: Try Token Auth for Jira Server PATs (Personal Access Tokens)
        print(f"[*] Đang kết nối Jira qua Token: {args.base_url}...", flush=True)
        jira = JIRA(options=options, token_auth=args.api_key)
    except Exception as e:
        # Fallback: Basic Auth (Password/Token as password)
        print(f"[*] Token Auth thất bại ({e}), thử Basic Auth...", flush=True)
        try:
            jira = JIRA(options=options, basic_auth=(args.username, args.api_key))
        except Exception as e2:
            print(f"[!] Lỗi kết nối Jira: {e2}", flush=True)
            sys.exit(1)
        
    # Construct JQL
    jql = args.jql if args.jql else ""
    if args.project_key:
        if jql:
            jql = f"({jql}) AND project = {args.project_key}"
        else:
            jql = f"project = {args.project_key}"
            
    # Fetch issues
    print(f"====== BẮT ĐẦU CRAWL JIRA ISSUES ======", flush=True)
    print(f"[*] JQL: {jql}", flush=True)

    threshold_ts = 0
    if args.modified_since:
        threshold_ts = get_unix_time(args.modified_since)

    total_downloaded = 0
    try:
        # --- Pagination: Lấy TOÀN BỘ issues (jira-python mặc định chỉ trả 50/lần) ---
        all_issues = []
        start_at = 0
        page_size = 100  # Jira Server cho phép tối đa 100/request
        while True:
            batch = jira.search_issues(jql, startAt=start_at, maxResults=page_size)
            if not batch:
                break
            all_issues.extend(batch)
            print(f"[*] Đã tải {len(all_issues)} issues (batch {start_at // page_size + 1})...", flush=True)
            if len(batch) < page_size:
                break  # Đây là batch cuối cùng
            start_at += page_size

        print(f"[*] Tổng cộng tìm thấy {len(all_issues)} issues phù hợp với filter.", flush=True)
        
        import glob
        for issue in all_issues:
            issue_key = issue.key
            summary = issue.fields.summary
            description = issue.fields.description or "_(Không có mô tả)_"
            updated_str = getattr(issue.fields, 'updated', '') or ''
            issue_ts = get_unix_time(updated_str)

            # 1. Kiểm tra file cục bộ có tồn tại hay chưa
            existing_files = glob.glob(os.path.join(args.output_dir, f"{issue_key}_*"))
            
            # Logic đồng bộ thông minh
            should_sync = False
            if not existing_files:
                should_sync = True  # File chưa có → download mới
            elif not threshold_ts:
                # Không có modified-since → luôn sync để đảm bảo đầy đủ
                should_sync = True
            elif issue_ts and issue_ts > threshold_ts:
                # Có threshold và issue được cập nhật SAU lần sync trước
                should_sync = True
            elif not issue_ts:
                # Không đọc được thời gian cập nhật → an toàn hơn là sync lại
                should_sync = True
            
            # Kiểm tra xem file cũ có bị thiếu trường không (Retroactive update)
            if not should_sync and existing_files:
                try:
                    with open(existing_files[0], "r", encoding="utf-8") as rf:
                        content_head = rf.read(1000)
                        if "**Sprint:**" not in content_head or "**Epic:**" not in content_head:
                            should_sync = True
                except Exception:
                    pass

            if not should_sync:
                # print(f"    [-] Bỏ qua issue {issue_key} do không có thay đổi.", flush=True)
                continue

            # Export to Markdown
            clean_summary = summary.replace('/', '_').replace('\\', '_')[:50]
            md_filename = f"{issue_key}_{clean_summary}.md"
            md_path = os.path.join(args.output_dir, md_filename)
            
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(f"# Jira Issue: {issue_key}\n\n")
                f.write(f"## {summary}\n\n")
                f.write(f"**Status:** {issue.fields.status.name}\n\n")
                f.write(f"**Assignee:** {issue.fields.assignee.displayName if issue.fields.assignee else 'Unassigned'}\n\n")
                f.write(f"**Updated:** {updated_str}\n\n")
                
                # Sprint & Epic
                sprints = getattr(issue.fields, 'customfield_10100', None)
                sprint_val = "N/A"
                if sprints and isinstance(sprints, list):
                    sprint_names = []
                    for s in sprints:
                        match = re.search(r"name=([^,\]]+)", str(s))
                        if match: sprint_names.append(match.group(1))
                    if sprint_names: sprint_val = ", ".join(sprint_names)
                f.write(f"**Sprint:** {sprint_val}\n\n")

                epic_link = getattr(issue.fields, 'customfield_10101', "N/A")
                f.write(f"**Epic:** {epic_link}\n\n")

                f.write(f"### Description\n\n{description}\n\n")
                
                # Comments
                comments = jira.comments(issue)
                if comments:
                    f.write(f"### Comments\n\n")
                    for comment in comments:
                        f.write(f"**{comment.author.displayName}** ({comment.created}):\n")
                        f.write(f"{comment.body}\n\n---\n\n")

            total_downloaded += 1
            print(f"[PROGRESS] Đã tải xong issue: {issue_key}", flush=True)

    except Exception as e:
        print(f"[!] Lỗi khi crawl Jira: {e}", flush=True)
        sys.exit(1)

    print(f"\n[v] Hoàn tất! Đã tải thành công {total_downloaded} issues từ Jira.", flush=True)
    print(f"FOLDER_LOCATION_SIGNAL: {os.path.abspath(args.output_dir)}", flush=True)

if __name__ == "__main__":
    main()
