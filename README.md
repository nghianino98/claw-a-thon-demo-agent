hello

# Daily Companion Agent

Một agent nhỏ để nói chuyện hằng ngày bằng tiếng Việt. Agent chạy được ngay bằng Python standard library, có:

- HTTP API tương thích kiểu runtime: `GET /health`, `POST /invocations`
- CLI để chat trong terminal
- Memory SQLite lưu hội thoại và vài sở thích/cách gọi của bạn
- LLM provider dạng OpenAI-compatible, nhưng vẫn có fallback local khi chưa set API key
- Telegram webhook adapter để chạy bot Telegram bằng cùng agent

## Chạy nhanh

```bash
python3 main.py chat
```

Hoặc chạy API:

```bash
python3 main.py serve --port 8080
curl -s http://localhost:8080/health
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "X-Agent-Api-Key: $AGENT_API_KEY" \
  -H "X-GreenNode-AgentBase-User-Id: local-user" \
  -H "X-GreenNode-AgentBase-Session-Id: daily" \
  -d '{"message":"Chào Mây, nhớ là mình thích cà phê sữa đá"}'
```

## Bật LLM

Tạo file `.env` từ `.env.example`, rồi điền provider OpenAI-compatible bạn muốn dùng:

```bash
cp .env.example .env
```

Ví dụ:

```env
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=...
LLM_MODEL=your-model
```

Nếu dùng GreenNode AI Platform hoặc provider khác, đặt `LLM_BASE_URL` và `LLM_MODEL` theo provider đó.

## API

`POST /invocations`

Nếu `AGENT_API_KEY` được cấu hình, gửi một trong hai header:

```http
X-Agent-Api-Key: <key>
Authorization: Bearer <key>
```

```json
{
  "message": "Hôm nay mình hơi mệt",
  "user_id": "local-user",
  "session_id": "daily"
}
```

Headers `X-GreenNode-AgentBase-User-Id` và `X-GreenNode-AgentBase-Session-Id` cũng được hỗ trợ, ưu tiên hơn body.

`GET /memories?user_id=local-user` xem memory đã lưu.

`POST /memories/clear` với body `{"user_id":"local-user"}` xóa memory của user đó.

## Telegram

Điền vào `.env`:

```env
TELEGRAM_BOT_TOKEN=token-tu-botfather
TELEGRAM_WEBHOOK_SECRET=mot-chuoi-bi-mat
# Empty means anyone can chat. Set numeric Telegram user IDs to restrict access.
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321
# Owners receive access requests and can approve users from Telegram buttons.
TELEGRAM_OWNER_USER_IDS=123456789
```

Webhook path:

```text
POST /telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>
```

Sau khi deploy runtime public, set webhook với Telegram Bot API:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://your-agentbase-endpoint/telegram/webhook/$TELEGRAM_WEBHOOK_SECRET"
```

Kiểm tra cấu hình không lộ secret:

```bash
curl -s https://your-agentbase-endpoint/telegram/status
```

## Test

```bash
python3 -m unittest discover -s tests
```

## Docker

```bash
docker build -t daily-companion-agent:test .
docker run --rm -p 8080:8080 --env-file .env daily-companion-agent:test
```
