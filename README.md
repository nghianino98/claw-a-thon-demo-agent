# Didi AI Tool & Quéo Solution Agent

This repository contains both the Next.js frontend (**Didi AI Tool**) and the FastAPI backend agent (**Quéo Solution Agent**).

---

## 1. Didi AI Tool (NextJS Frontend)

Didi AI Tool is a Next.js application for crawling knowledge sources, managing workflow automation, and administering agent/bot connections.

### Requirements & Setup
- Node.js 22+
- Python 3 with `venv`
- macOS (for click-to-run `.command` helpers)

Install dependencies:
```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r src/scripts/confluence_docs_tools/requirements.txt
```

### Running the Frontend
Development mode:
```bash
npm run dev
```

Production build:
```bash
npm run build
npm run start
```

On macOS, `Cài đặt Tool.command`, `Start App.command`, and `Stop App.command` provide click-to-run capabilities.

---

## 2. Quéo Solution Agent (FastAPI Backend)

Runtime-first implementation of the Quéo bot, featuring SQLite storage, hybrid KB tools (FTS5 search + ripgrep live scan), and Telegram polling/webhook mode.

### Requirements & Setup
- Python 3.10+

Install dependencies:
```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m app.cli migrate
```

### Running the Backend
Start the server:
```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
```

Index a Knowledge Base (KB) folder:
```bash
python -m app.cli index-kb --source "/path/to/Wealth Solution" --activate
```

Chat locally through the core CLI loop:
```bash
python -m app.cli chat
```
