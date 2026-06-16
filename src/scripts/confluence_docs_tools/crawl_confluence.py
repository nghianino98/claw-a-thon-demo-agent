import os
import argparse
import sys
import json
import requests
import markdownify
import urllib.parse
from requests.auth import HTTPBasicAuth
from datetime import datetime

def probe_auth(base_url, username, api_key):
    """Tự động phát hiện phương thức xác thực và xác minh token còn hiệu lực.
    Thử Basic Auth trước, nếu bị 401 thì chuyển sang Bearer Token (PAT).
    Dùng /rest/api/user/current để kiểm tra xem user có bị nhận là 'anonymous' không.
    Trả về: (auth_object, headers_dict)
    """
    candidates = []

    if username and username.strip() not in ('', '_pat'):
        candidates.append(("Basic Auth", HTTPBasicAuth(username, api_key), {"Accept": "application/json"}))

    candidates.append(("Bearer Token (PAT)", None, {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}))

    for method_name, auth_obj, headers in candidates:
        try:
            r = requests.get(f"{base_url}/rest/api/user/current", auth=auth_obj, headers=headers, timeout=15)
            
            # Phát hiện server trả về HTML (trang login/error) thay vì JSON
            content_type = r.headers.get('Content-Type', '')
            if 'text/html' in content_type or r.text.strip().startswith('<!DOCTYPE'):
                print(f"[!] {method_name}: Server trả về trang HTML thay vì JSON — Token đã hết hạn hoặc cần xác thực lại qua VPN.", flush=True)
                continue
            
            if r.status_code == 200:
                data = r.json()
                user_type = data.get("type", "")
                display_name = data.get("displayName", "")
                if user_type == "anonymous":
                    print(f"[!] {method_name}: Token không hợp lệ hoặc đã hết hạn (nhận diện là Anonymous).", flush=True)
                    continue  # Thử phương án tiếp theo
                else:
                    print(f"[*] Chế độ xác thực: {method_name} ✓ (Xin chào, {display_name})", flush=True)
                    return auth_obj, headers
            else:
                print(f"[*] {method_name} không thành công (HTTP {r.status_code}), thử phương thức khác...", flush=True)
        except Exception as e:
            print(f"[*] {method_name} gặp lỗi kết nối: {e}", flush=True)

    # Tất cả đều thất bại
    print("", flush=True)
    print("=" * 60, flush=True)
    print("[!!!] XÁC THỰC THẤT BẠI - TOKEN/MẬT KHẨU KHÔNG HỢP LỆ HOẶC ĐÃ HẾT HẠN", flush=True)
    print("[!!!] Cách khắc phục:", flush=True)
    print("  1. Đăng nhập vào Confluence tại trình duyệt", flush=True)
    print(f"  2. Truy cập: {base_url}/plugins/personalaccesstokens/usertokens.action", flush=True)
    print("  3. Tạo Personal Access Token mới", flush=True)
    print("  4. Cập nhật lại API Key trong cài đặt task của Didi Tool", flush=True)
    print("=" * 60, flush=True)
    print("", flush=True)
    sys.exit(1)  # Thoát ngay, không tiếp tục crawl vô nghĩa

def get_unix_time(dt_str):
    if not dt_str: return 0
    dt_str = dt_str.strip()
    if dt_str.endswith("Z"): dt_str = dt_str[:-1] + "+00:00"
    if len(dt_str) >= 5 and dt_str[-5] in "+-" and dt_str[-3] != ":":
        dt_str = dt_str[:-2] + ":" + dt_str[-2:]
    try:
        return datetime.fromisoformat(dt_str).timestamp()
    except Exception:
        try:
            return datetime.strptime(dt_str[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S").timestamp()
        except Exception:
            return 0

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)

def search_confluence(base_url, auth, headers, keyword):
    print(f"[*] Đang tìm kiếm từ khoá: {keyword}", flush=True)
    cql = f'text ~ "{keyword}" AND type = "page"'
    try:
        response = requests.get(
            f"{base_url}/rest/api/content/search",
            auth=auth, headers=headers,
            params={"cql": cql, "expand": "body.storage,body.view,version", "limit": 50},
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        results = data.get("results", [])
        print(f"   -> Tìm thấy {len(results)} kết quả cho từ khoá '{keyword}'.", flush=True)
        return results
    except Exception as e:
        print(f"[!] Lỗi khi tìm kiếm '{keyword}': {e}", flush=True)
        return []

def get_page_by_id(base_url, auth, headers, page_id):
    try:
        response = requests.get(
            f"{base_url}/rest/api/content/{page_id}",
            auth=auth, headers=headers,
            params={"expand": "body.storage,body.view,version"},
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"[!] Lỗi khi lấy trang ID {page_id}: {e}", flush=True)
        return None

def get_all_child_pages_recursive(base_url, auth, headers, parent_id):
    all_children = []
    # Lấy child pages (cấp 1) của parent_id
    try:
        response = requests.get(
            f"{base_url}/rest/api/content/{parent_id}/child/page",
            auth=auth, headers=headers,
            params={"expand": "body.storage,body.view,version", "limit": 100},
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        results = data.get("results", [])
        all_children.extend(results)
        
        # Đệ quy lấy con của từng child
        for child in results:
            all_children.extend(get_all_child_pages_recursive(base_url, auth, headers, child.get("id")))
    except Exception as e:
        print(f"[!] Lỗi khi lấy các trang con cho (ID: {parent_id}): {e}", flush=True)
        
    return all_children

class ConfluenceConverter(markdownify.MarkdownConverter):
    def convert_td(self, el, text, convert_as_inline):
        cleaned_text = str(text).replace('\n', '<br>')
        while cleaned_text.startswith('<br>'): cleaned_text = cleaned_text[4:]
        while cleaned_text.endswith('<br>'): cleaned_text = cleaned_text[:-4]
        cleaned_text = cleaned_text.replace('|', '&#124;')
        
        colspan = 1
        if 'colspan' in el.attrs and el['colspan'].isdigit():
            colspan = int(el['colspan'])
        return ' ' + cleaned_text.strip() + ' |' * colspan

    def convert_th(self, el, text, convert_as_inline):
        cleaned_text = str(text).replace('\n', '<br>')
        while cleaned_text.startswith('<br>'): cleaned_text = cleaned_text[4:]
        while cleaned_text.endswith('<br>'): cleaned_text = cleaned_text[:-4]
        cleaned_text = cleaned_text.replace('|', '&#124;')
        
        colspan = 1
        if 'colspan' in el.attrs and el['colspan'].isdigit():
            colspan = int(el['colspan'])
        return ' ' + cleaned_text.strip() + ' |' * colspan

def download_and_convert(base_url, page, output_dir, formats, file_index):
    title = page.get("title", "Untitled").replace("/", "_").replace("\\", "_")
    page_id = page.get("id")
    print(f"  -> Tải page: {title} (ID: {page_id})", flush=True)
    
    body_content = page.get("body", {}).get("view", {}).get("value", "") or page.get("body", {}).get("storage", {}).get("value", "")
    if not body_content:
        print("    [!] Không tìm thấy nội dung.", flush=True)
        return False
        
    # Chuyển đổi sang Markdown để kiểm tra xem trang có text/hình ảnh không
    md_content = ConfluenceConverter(heading_style="ATX").convert(body_content)
    md_content = md_content.replace('\xa0', ' ') # Lọc các ký tự space ẩn đặc biệt
    
    if not md_content.strip():
        print(f"    [-] Trang '{title}' không có nội dung thực tế (trang trắng). Bỏ qua xuất file.", flush=True)
        return False

    export_md = "md" in formats
    export_pdf = "pdf" in formats

    if export_md:
        md_filename = os.path.join(output_dir, f"{page_id}_{title}.md")
        with open(md_filename, "w", encoding="utf-8") as f:
            f.write(f"# {title}\n\n")
            f.write(f"Source: {base_url}/pages/viewpage.action?pageId={page_id}\n\n")
            f.write(md_content)
        print(f"    [+] Đã lưu Markdown: {md_filename}", flush=True)
        
    if export_pdf:
        pdf_filename = os.path.join(output_dir, f"{page_id}_{title}.pdf")
        try:
            from weasyprint import HTML
            # Add base_url so Weasyprint can resolve relative images inside the PDF
            HTML(string=body_content, base_url=base_url).write_pdf(pdf_filename)
            print(f"    [+] Đã lưu PDF: {pdf_filename}", flush=True)
        except Exception as e:
            print(f"    [!] Lỗi lưu PDF (Weasyprint): {str(e)[:50]}...", flush=True)
            print(f"    [!] Lỗi lưu PDF (có thể thiếu wkhtmltopdf): {str(e)[:50]}...", flush=True)

    print(f"[PROGRESS] Đã tải xong file thứ {file_index}: {title}", flush=True)
            
    return True

def extract_page_id(url, base_url=None, auth=None, headers=None):
    try:
        # Hỗ trợ dạng viewpage.action?pageId=xxx
        parsed = urllib.parse.urlparse(url)
        query_params = urllib.parse.parse_qs(parsed.query)
        if "pageId" in query_params:
            return query_params["pageId"][0]

        path_segments = [s for s in parsed.path.split("/") if s]
        
        # Hỗ trợ dạng /spaces/SPACEKEY/pages/PAGEID/Title
        if "pages" in path_segments:
            idx = path_segments.index("pages")
            if idx + 1 < len(path_segments):
                possible_id = path_segments[idx + 1]
                if possible_id.isdigit():
                    return possible_id
                    
        # Hỗ trợ dạng /display/SpaceKey/Page+Title
        if "display" in path_segments:
            idx = path_segments.index("display")
            if idx + 2 < len(path_segments):
                space_key = path_segments[idx + 1]
                title = urllib.parse.unquote_plus(path_segments[idx + 2])
                
                if base_url and headers:
                    print(f"  [*] Đang tự động tìm pageId cho Space: '{space_key}' - Title: '{title}'...", flush=True)
                    
                    best_resp = None
                    
                    try:
                        # Phương án 1: Exact match qua REST params
                        r1 = requests.get(
                            f"{base_url}/rest/api/content",
                            auth=auth, headers=headers,
                            params={"type": "page", "spaceKey": space_key, "title": title},
                            timeout=30
                        )
                        if r1.status_code == 200:
                            best_resp = r1
                        else:
                            print(f"  [*] Exact match (REST) trả về {r1.status_code}: {r1.text[:200]}", flush=True)
                    except Exception as e:
                        print(f"  [*] Exact match (REST) gặp lỗi: {e}", flush=True)
                    
                    if best_resp is None:
                        try:
                            # Phương án 2: CQL search - escape ~ trong space key
                            escaped_title = title.replace('"', '\\"')
                            cql_space_key = space_key.replace('~', '\\~')
                            cql = f'space="{cql_space_key}" AND title="{escaped_title}" AND type="page"'
                            r2 = requests.get(
                                f"{base_url}/rest/api/content/search",
                                auth=auth, headers=headers,
                                params={"cql": cql},
                                timeout=30
                            )
                            if r2.status_code == 200:
                                best_resp = r2
                            else:
                                print(f"  [*] CQL search trả về {r2.status_code}: {r2.text[:200]}", flush=True)
                        except Exception as e:
                            print(f"  [*] CQL search gặp lỗi: {e}", flush=True)

                    if best_resp is None:
                        try:
                            # Phương án 3: CQL với space key không trong quotes (dành cho personal space ~user)
                            escaped_title = title.replace('"', '\\"')
                            cql = f'type="page" AND title="{escaped_title}"'
                            r3 = requests.get(
                                f"{base_url}/rest/api/content/search",
                                auth=auth, headers=headers,
                                params={"cql": cql, "limit": 10},
                                timeout=30
                            )
                            if r3.status_code == 200:
                                best_resp = r3
                                print(f"  [*] Tìm thấy kết quả qua tìm kiếm theo title (không lọc space): OK", flush=True)
                            else:
                                print(f"  [*] Title-only search trả về {r3.status_code}: {r3.text[:200]}", flush=True)
                        except Exception as e:
                            print(f"  [*] Title-only search gặp lỗi: {e}", flush=True)

                    if best_resp is not None:
                        data = best_resp.json()
                        results = data.get("results", [])
                        if results:
                            found_id = results[0].get("id")
                            print(f"  [+] Đã tìm thấy pageId: {found_id}", flush=True)
                            return found_id
                        else:
                            print(f"  [!] API trả về thành công nhưng không tìm thấy page nào trùng khớp.", flush=True)
                    else:
                        print(f"  [!] Tất cả phương án tìm pageId đều thất bại. Kiểm tra lại API key và quyền truy cập.", flush=True)
        
        print("[!] Không thể tự động trích xuất pageId từ URL được cung cấp.", flush=True)
        print("[!] Gợi ý: Mở trang Confluence → More options (...) → Copy pageId → Dùng URL dạng ?pageId=xxx", flush=True)
    except Exception as e:
        print(f"[!] Lỗi phân tích URL: {e}", flush=True)
    return None

def main():
    parser = argparse.ArgumentParser(description="Crawl Confluence pages.")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--rules-json", default="[]", help="JSON string chứa mảng các rules")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--format", required=True, help="Các định dạng file (Vd: md,pdf hoặc pdf)")
    parser.add_argument("--modified-since", required=False, help="Chỉ tải các tài liệu sửa đổi sau thời gian này (ISO 8601)")
    
    args = parser.parse_args()
    
    ensure_dir(args.output_dir)
    print("[*] Đang kiểm tra kết nối và xác thực với Confluence...", flush=True)
    auth, base_headers = probe_auth(args.base_url, args.username, args.api_key)

    formats = args.format.lower().split(",")
    try:
        rules = json.loads(args.rules_json)
    except json.JSONDecodeError:
        print("[!] Lỗi: Tham số --rules-json không phải là JSON hợp lệ.", flush=True)
        rules = []
    
    seen_ids = set()
    total_downloaded = 0
    
    print("====== BẮT ĐẦU CHẠY YÊU CẦU CRAWL CONFLUENCE ======", flush=True)
    
    threshold_ts = get_unix_time(args.modified_since) if args.modified_since else 0

    def is_page_modified(page):
        page_id = page.get("id")
        # 1. Nếu không có file cục bộ tương ứng với page_id này, bắt buộc tải về
        import glob
        existing_files = glob.glob(os.path.join(args.output_dir, f"{page_id}_*"))
        if not existing_files:
            return True  # File chưa có → download mới

        # 2. Không có threshold → không có thông tin sync trước → luôn tải lại để đảm bảo
        if not threshold_ts:
            return True

        # 3. Có threshold → chỉ tải lại nếu page trên server mới hơn
        page_ts = get_unix_time(page.get("version", {}).get("when"))
        if not page_ts:
            # Không đọc được thời gian sửa đổi → an toàn hơn là tải lại
            return True
        return page_ts > threshold_ts  # Dùng > thay >= để tránh re-download không cần thiết

    for idx, rule in enumerate(rules):
        print(f"\n[*] Đang thực thi Rule #{idx + 1}...", flush=True)
        keywords = [k.strip() for k in rule.get("keywords", "").split(",")] if rule.get("keywords") else []
        parent_url = rule.get("parentUrl", "").strip()
        include_children = rule.get("includeChildren", False)

        # 1. Tìm kiếm và tải theo keywords ĐỘC LẬP (Chỉ có keyword, KHÔNG có parentUrl)
        if keywords and not parent_url:
            print(f"  [Rule {idx + 1}] Chế độ quét theo Keyword.", flush=True)
            for kw in keywords:
                if not kw: continue
                results = search_confluence(args.base_url, auth, base_headers, kw)
                for page in results:
                    page_id = page.get("id")
                    if page_id not in seen_ids:
                        seen_ids.add(page_id)
                        if not is_page_modified(page):
                            print(f"    [-] Bỏ qua trang ID {page_id} do không có thay đổi mới.", flush=True)
                        else:
                            if download_and_convert(args.base_url, page, args.output_dir, formats, total_downloaded + 1):
                                total_downloaded += 1
                            
                        # Mở rộng lấy page con nếu được chỉ định
                        if include_children:
                            print(f"    [Rule {idx + 1}] Lấy thêm các trang con của {page_id}...", flush=True)
                            child_pages = get_all_child_pages_recursive(args.base_url, auth, base_headers, page_id)
                            for child in child_pages:
                                child_id = child.get("id")
                                if child_id not in seen_ids:
                                    seen_ids.add(child_id)
                                    if not is_page_modified(child):
                                        print(f"      [-] Bỏ qua trang con ID {child_id} do không có thay đổi mới.", flush=True)
                                    else:
                                        if download_and_convert(args.base_url, child, args.output_dir, formats, total_downloaded + 1):
                                            total_downloaded += 1

        # 2. Xử lý tải theo parent URL (Có thể CÓ hoặc KHÔNG có keywords đi kèm - AND Logic)
        if parent_url:
            if keywords:
                print(f"  [Rule {idx + 1}] Chế độ quét theo Parent URL (AND Keyword Filter): {parent_url}", flush=True)
            else:
                print(f"  [Rule {idx + 1}] Chế độ quét theo Parent URL: {parent_url}", flush=True)
                
            parent_page_id = extract_page_id(parent_url, args.base_url, auth, base_headers)
            
            if parent_page_id and parent_page_id not in seen_ids:
                parent_page = get_page_by_id(args.base_url, auth, base_headers, parent_page_id)
                # Nếu có keywords, phải check xem content trang gốc có chứa keyword ko
                keyword_match = True
                if parent_page and keywords:
                    content_html = parent_page.get("body", {}).get("view", {}).get("value", "")
                    content_text = markdownify.markdownify(content_html, heading_style="ATX").lower()
                    keyword_match = any(kw.lower() in content_text for kw in keywords if kw)
                    
                if parent_page and keyword_match:
                    seen_ids.add(parent_page_id)
                    if not is_page_modified(parent_page):
                        print(f"    [-] Bỏ qua trang cha ID {parent_page_id} do không có thay đổi mới.", flush=True)
                    else:
                        if download_and_convert(args.base_url, parent_page, args.output_dir, formats, total_downloaded + 1):
                            total_downloaded += 1
                        
                # Lấy các trang con
                if include_children:
                    print(f"    [Rule {idx + 1}] Lấy thêm các trang con của {parent_page_id}...", flush=True)
                    child_pages = get_all_child_pages_recursive(args.base_url, auth, base_headers, parent_page_id)
                    for child in child_pages:
                        child_id = child.get("id")
                        if child_id not in seen_ids:
                            seen_ids.add(child_id)
                            # Lọc keyword AND condition cho trang con
                            child_match = True
                            if keywords:
                                child_html = child.get("body", {}).get("view", {}).get("value", "")
                                child_text = markdownify.markdownify(child_html, heading_style="ATX").lower()
                                child_match = any(kw.lower() in child_text for kw in keywords if kw)
                                
                            if child_match:
                                if not is_page_modified(child):
                                    print(f"      [-] Bỏ qua trang con ID {child_id} do không có thay đổi mới.", flush=True)
                                else:
                                    if download_and_convert(args.base_url, child, args.output_dir, formats, total_downloaded + 1):
                                        total_downloaded += 1
                            else:
                                print(f"      [-] Bỏ qua trang con {child_id} vì không chứa từ khoá yêu cầu.", flush=True)

    print(f"\n[v] Hoàn tất! Đã tải và chuyển đổi thành công {total_downloaded} tài liệu.", flush=True)
    print(f"FOLDER_LOCATION_SIGNAL: {os.path.abspath(args.output_dir)}", flush=True)
    
if __name__ == "__main__":
    main()
