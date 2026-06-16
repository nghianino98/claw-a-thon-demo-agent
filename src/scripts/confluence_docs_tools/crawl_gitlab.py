import os
import argparse
import sys
import json
import gitlab
from datetime import datetime
import base64

def get_unix_time(dt_str):
    if not dt_str: return 0
    dt_str = dt_str.strip()
    if dt_str.endswith("Z"): dt_str = dt_str[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(dt_str).timestamp()
    except Exception:
        try:
            return datetime.strptime(dt_str[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S").timestamp()
        except Exception:
            return 0

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path, exist_ok=True)

def main():
    parser = argparse.ArgumentParser(description="Crawl GitLab project files and wikis.")
    parser.add_argument("--base-url", required=True, help="GitLab instance URL (e.g. https://gitlab.com)")
    parser.add_argument("--username", help="GitLab username (optional)")
    parser.add_argument("--api-key", required=True, help="Personal Access Token")
    parser.add_argument("--project-id", help="Project ID or Path (e.g. group/project)")
    parser.add_argument("--group-id", help="Group ID or Path (e.g. group/sub-group)")
    parser.add_argument("--branch", default="main", help="Branch to crawl")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--modified-since", help="ISO 8601 timestamp for incremental sync")
    
    args = parser.parse_args()
    
    if not args.project_id and not args.group_id:
        print("[!] Phải cung cấp ít nhất --project-id hoặc --group-id", flush=True)
        sys.exit(1)
        
    ensure_dir(args.output_dir)
    gl = gitlab.Gitlab(args.base_url, private_token=args.api_key)
    
    projects_to_crawl = []
    
    if args.group_id:
        try:
            group = gl.groups.get(args.group_id)
            print(f"[*] Đang lấy danh sách các projects trong group: {group.full_path}", flush=True)
            # Fetch all projects in the group recursively
            group_projects = group.projects.list(all=True, include_subgroups=True)
            for gp in group_projects:
                # We need to get the actual project object to access repository contents
                p = gl.projects.get(gp.id)
                projects_to_crawl.append(p)
        except Exception as e:
            print(f"[!] Lỗi khi lấy group {args.group_id}: {e}", flush=True)
            sys.exit(1)
    else:
        try:
            p = gl.projects.get(args.project_id)
            projects_to_crawl.append(p)
        except Exception as e:
            print(f"[!] Lỗi khi lấy project {args.project_id}: {e}", flush=True)
            sys.exit(1)
            
    threshold_ts = get_unix_time(args.modified_since) if args.modified_since else 0
    total_downloaded_all = 0
    
    for project in projects_to_crawl:
        print(f"\n====== BẮT ĐẦU CRAWL GITLAB PROJECT: {project.path_with_namespace} ======", flush=True)
        
        # Determine output directory for this project
        project_output_dir = args.output_dir
        if args.group_id:
            # Reconstruct local path based on project's path within the group
            base_group_path = gl.groups.get(args.group_id).full_path
            rel_path = project.path_with_namespace.replace(base_group_path, "").strip("/")
            project_output_dir = os.path.join(args.output_dir, rel_path)
            ensure_dir(project_output_dir)

        if threshold_ts:
            print(f"[*] Chế độ đồng bộ vi sai: Chỉ lấy file thay đổi sau {args.modified_since}", flush=True)

        total_downloaded_project = 0
        
        # 1. Crawl Repository Files
        # Determine branch to crawl for this project
        target_branch = args.branch
        try:
            # Check if requested branch exists
            project.branches.get(args.branch)
        except Exception:
            # Fallback to default branch if requested one fails
            target_branch = project.default_branch
            print(f"[*] Branch '{args.branch}' không tồn tại, tự động chuyển sang branch mặc định: {target_branch}", flush=True)

        print(f"[*] Đang duyệt cây thư mục project: {project.name} (branch: {target_branch})...", flush=True)
        try:
            items = project.repository_tree(ref=target_branch, recursive=True, all=True)
            for item in items:
                if item['type'] == 'blob':
                    file_path = item['path']
                    local_file_path = os.path.join(project_output_dir, file_path)
                    
                    # Logic đồng bộ thông minh
                    should_sync = False
                    if not os.path.exists(local_file_path):
                        should_sync = True
                    elif threshold_ts:
                        commits = project.commits.list(query_parameters={'path': file_path, 'ref_name': target_branch, 'per_page': 1}, get_all=False)
                        if commits:
                            cmt_ts = get_unix_time(commits[0].committed_date)
                            if cmt_ts >= threshold_ts:
                                should_sync = True
                    else:
                        # Không có threshold_ts -> Luôn sync
                        should_sync = True

                    if not should_sync:
                        continue

                    print(f"  -> Tải file: {file_path}", flush=True)
                    try:
                        file_content = project.files.get(file_path=file_path, ref=target_branch)
                        
                        ensure_dir(os.path.dirname(local_file_path))
                        
                        with open(local_file_path, "wb") as f:
                            f.write(file_content.decode())
 # gitlab-python handle decode for us usually
                        
                        total_downloaded_project += 1
                        print(f"[PROGRESS] Đã tải xong file: {file_path}", flush=True)
                    except Exception as e:
                        print(f"  [!] Lỗi khi tải/lưu file {file_path}: {e}", flush=True)

        except Exception as e:
            if "Tree not found" in str(e) or "Empty repository" in str(e):
                print(f"[*] Repo {project.name} rỗng, bỏ qua.", flush=True)
            else:
                print(f"[!] Lỗi khi crawl repository {project.name}: {e}", flush=True)

        # 2. Crawl Wiki
        print(f"[*] Đang duyệt Wiki project: {project.name}...", flush=True)
        try:
            wikis = project.wikis.list(all=True)
            for wiki in wikis:
                try:
                    wiki_filename = f"wiki_{wiki.slug}.md"
                    wiki_path = os.path.join(project_output_dir, wiki_filename)
                    
                    # Wiki smart sync
                    should_sync_wiki = False
                    if not os.path.exists(wiki_path):
                        should_sync_wiki = True
                    else:
                        # GitLab Wiki objects don't have a direct 'updated_at' in the list
                        # For simplicity, we sync if missing, or if no threshold_ts.
                        # Advanced: we could fetch the full wiki and check timestamps if available.
                        if not threshold_ts:
                            should_sync_wiki = True
                    
                    if not should_sync_wiki:
                        continue

                    print(f"  -> Tải Wiki: {wiki.title}", flush=True)
                    w = project.wikis.get(wiki.slug)
                    
                    with open(wiki_path, "w", encoding="utf-8") as f:
                        f.write(f"# Wiki: {wiki.title}\n\n")
                        f.write(w.content)
                    
                    total_downloaded_project += 1
                    print(f"[PROGRESS] Đã tải xong Wiki: {wiki.title}", flush=True)
                except Exception as e:
                    print(f"  [!] Lỗi khi tải Wiki {wiki.slug}: {e}", flush=True)

        except Exception as e:
            pass
            
        print(f"[v] Đã hoàn thành project: {project.name}. Số file: {total_downloaded_project}", flush=True)
        total_downloaded_all += total_downloaded_project
        
    print(f"\n[v] HOÀN TẤT TOÀN BỘ! Đã tải thành công {total_downloaded_all} tài liệu/file từ GitLab.", flush=True)
    print(f"FOLDER_LOCATION_SIGNAL: {os.path.abspath(args.output_dir)}", flush=True)

if __name__ == "__main__":
    main()
