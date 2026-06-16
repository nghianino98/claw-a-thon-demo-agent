# Quéo Agent — Chống mất KB khi `/data` bị wipe

> Mục tiêu: KB **không bị mất** mỗi khi platform redeploy/restart container (`/data` là ephemeral, không có volume bền).

## Hai cơ chế (bổ sung cho nhau)

| Cơ chế | Cần creds? | Giữ được gì | Khi nào dùng |
|---|---|---|---|
| **A. Boot-seed từ image** (đã bật mặc định) | KHÔNG | Chỉ KB (`05. Knowledge`) | Floor an toàn — KB luôn sống lại sau restart |
| **B. S3 backup/restore** (cần cấu hình) | Có (S3) | KB **+** DB state (usage history, MCP servers, settings) | Khi muốn giữ cả state động, không chỉ KB |

> Hiện đang chạy **chỉ cơ chế A** (không có S3 creds). Phần dưới mô tả cả hai.

---

## A. Boot-seed từ image (KHÔNG cần creds — đang dùng)

KB (`05. Knowledge`) được **nướng sẵn vào Docker image** tại `seed/kb-seed.zip`. Lúc container khởi động, nếu `/data` trống (chưa có KB active), agent **tự động `build_from_zip` + activate** từ file seed này. Indexing là BM25/FTS local (không gọi embedding API) nên re-seed mỗi boot rất nhanh và không tốn token.

- Code: `app/main.py` (lifespan, sau `build_services`) + setting `KB_SEED_ZIP` (mặc định `seed/kb-seed.zip`).
- Tự bỏ qua nếu đã có KB active (vd vừa restore từ S3 hoặc live-sync) → không ghi đè.

### Cách cập nhật KB đã nướng (khi `05. Knowledge` đổi)

```bash
# 1. Pack lại 05. Knowledge thành seed zip (cấu trúc: "05. Knowledge/...")
python scripts/pack_kb.py --source "<đường dẫn>/Wealth Solution/05. Knowlege" --out seed/kb-seed.zip
#    (hoặc copy zip đã pack: cp <packed>.zip seed/kb-seed.zip)

# 2. Commit seed mới + rebuild & push image, rồi runtime.sh update như thường lệ
git add seed/kb-seed.zip && git commit -m "Update baked KB seed"
```

> Đánh đổi: cập nhật KB phải rebuild image. Live delta-sync vẫn patch được instance đang chạy (tồn tại tới lần restart kế, sau đó boot-seed nạp lại bản trong image).

---

## B. S3 Backup/Restore (cần creds — chưa bật)

Code backup/restore **đã sẵn sàng** (`app/services/backup.py` + wiring trong `app/main.py`) — chỉ thiếu **cấu hình S3 credentials** trên runtime. Bật cơ chế này nếu muốn giữ cả DB state (không chỉ KB).

---

## 1. Vì sao cần

`/data` của runtime là **ephemeral** (không có volume bền). Mỗi lần redeploy/restart → wipe sạch: KB versions, bảng `llm_calls` (data usage dashboard), MCP servers thêm lúc runtime, settings sửa qua API.

Agent đã có sẵn cơ chế tự cứu:

| Cơ chế | Vị trí | Hành vi |
|---|---|---|
| **Boot restore** | `app/main.py` lifespan | Mỗi lần khởi động, nếu S3 bật → tự `restore()` bản backup mới nhất từ S3 |
| **Scheduled backup** | `app/main.py` background task | Tự backup mỗi `BACKUP_INTERVAL_HOURS` (mặc định 24h) |
| **Manual backup/restore** | `POST /admin/api/backup`, `POST /admin/api/restore` | Trigger thủ công qua admin API |

→ Chỉ cần set 5 biến `S3_*` là toàn bộ pipeline sống dậy. Backup gồm: DB (VACUUM INTO) + thư mục KB version đang active, nén `tar.zst`, giữ `BACKUP_KEEP` bản (mặc định 7).

---

## 2. Tạo bucket trên VNG vStorage (dashboard.console.vngcloud.vn)

1. Đăng nhập <https://dashboard.console.vngcloud.vn/>.
2. Vào dịch vụ **vStorage** (Object Storage / Lưu trữ đối tượng).
3. **Tạo Bucket**:
   - Tên: ví dụ `queo-agent-backups` (đặt tên duy nhất).
   - Region: chọn **HCM** (cùng vùng với runtime để egress thấp, restore nhanh).
   - Access: **Private** (KHÔNG để public — backup chứa toàn bộ DB + KB).
4. **Tạo S3 Access Key**: tìm mục **S3 Keys / Access Keys / Khóa truy cập S3** trong vStorage → tạo cặp **Access Key ID** + **Secret Access Key**. Lưu lại Secret ngay (chỉ hiện 1 lần).
5. **Lấy S3 Endpoint**: trong trang bucket/region có ghi **S3 Endpoint URL** (dạng `https://<region>.vstorage.vngcloud.vn`). **Copy đúng giá trị dashboard hiển thị** — đừng đoán hostname.

> 5 giá trị cần lấy: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`.

---

## 3. Cấu hình các biến S3 lên runtime

`backup.py` dùng `boto3` với `endpoint_url` + signature `s3v4` → tương thích mọi S3-compatible (VNG vStorage, AWS S3, MinIO).

| Biến env | Giá trị | Ghi chú |
|---|---|---|
| `S3_ENDPOINT` | URL endpoint từ dashboard | bắt buộc |
| `S3_BUCKET` | `queo-agent-backups` | bắt buộc |
| `S3_ACCESS_KEY` | Access Key ID | bắt buộc |
| `S3_SECRET_KEY` | Secret Access Key | bắt buộc |
| `S3_REGION` | vd `hcm-03` (theo dashboard) | có thể để trống nếu provider không yêu cầu |
| `BACKUP_INTERVAL_HOURS` | `24` (mặc định) | chu kỳ backup nền |
| `BACKUP_KEEP` | `7` (mặc định) | số bản giữ lại |
| `BACKUP_INCLUDE_ARTIFACTS` | `0` | `1` nếu muốn backup cả artifacts |

### ⚠️ CẢNH BÁO QUAN TRỌNG khi update runtime

`runtime.sh update` là **PATCH ghi đè toàn bộ env + flavor + autoscaling**. Runtime prod hiện có **~47 biến env**; file `.env` local chỉ có ~14 biến. **Nếu update bằng `.env` local sẽ mất sạch các biến quan trọng** (MCP_SECRET_KEY, LLM_API_KEY, AGENT_ADMIN_TOKEN, TELEGRAM_*, …).

**Quy trình an toàn:**

```bash
# 1. Lấy CHÍNH XÁC toàn bộ env đang chạy (có full environmentVariables)
runtime.sh versions <RID>

# 2. Clone đủ 47 biến đó ra một env-file mới, RỒI THÊM 5 biến S3_* phía trên
#    (đừng bỏ sót biến nào — đối chiếu lại danh sách trước khi update)

# 3. Update runtime với env-file đầy đủ
runtime.sh update <RID> \
  --image <image-url-đang-chạy> \
  --flavor runtime-s2-general-2x4 \
  --from-cr \
  --min-replicas 1 --max-replicas 1 \
  --cpu-scale 50 --mem-scale 50 \
  --env-file <env-file-đầy-đủ>
```

> Scripts `runtime.sh` ở: `greennode-agentbase-skills/.claude/skills/agentbase/scripts/`.
> Creds greennode: `~/Lab/Claw-a-thon-demo-agent/.greennode.json` → export `GREENNODE_CLIENT_ID/SECRET`.

---

## 4. Tạo bản backup ĐẦU TIÊN ngay (đừng đợi 24h)

Sau khi redeploy với S3 bật:
- **Boot làm `restore()` TRƯỚC** → lần đầu chưa có backup nào → log `boot_restore_no_backup` (bình thường).
- Scheduled backup **đợi hết `BACKUP_INTERVAL_HOURS` (24h)** mới chạy lần đầu.

→ Nếu container restart trong 24h đầu, **vẫn mất KB**. Vì vậy phải **trigger backup thủ công ngay**:

```bash
curl -X POST "https://<agent-endpoint>/admin/api/backup" \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H "X-Acting-User: superadmin" -H "X-Acting-Role: superadmin"
```

Kiểm tra đã có bản backup trên S3:

```bash
curl -s "https://<agent-endpoint>/admin/api/backups" \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H "X-Acting-User: superadmin" -H "X-Acting-Role: superadmin"
```

---

## 5. Verify restore hoạt động

1. Đảm bảo đã có ít nhất 1 backup (mục 4).
2. Restart runtime (hoặc redeploy).
3. Xem log boot — phải thấy: `boot_restore_started` → `boot_restore_succeeded`.
4. Hỏi agent một câu cần KB → trả lời đúng từ KB đã restore.

---

## 6. Checklist sau mỗi lần verify

- [ ] Bucket `queo-agent-backups` đã tạo, **private**, region HCM.
- [ ] 5 biến `S3_*` đã set trên runtime (qua quy trình clone-đủ-env ở mục 3).
- [ ] Redeploy/restart → log không còn `backup_disabled` / `production_backup_disabled`.
- [ ] Đã trigger backup thủ công lần đầu → `GET /admin/api/backups` trả về ≥1 bản.
- [ ] Restart thử → log `boot_restore_succeeded` + agent trả lời được từ KB.

> Khi đã bật S3 backup, không còn cần các bước re-upload KB / re-rename MCP thủ công sau mỗi redeploy — boot-restore lo việc đó.
