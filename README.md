# Interview Agent Q&A

A lightweight Python CLI to support AI Agent interview preparation:
- list interview questions by level
- score a candidate answer using expected key points
- run a mock interview session in terminal
- export question bank to markdown

It also exposes an HTTP API for runtime deployment:
- `GET /health`
- `GET /questions?level=basic&limit=5`
- `POST /score`

## Quick start

```bash
cd /Users/lap15642-local/nghiata/zalopay-fin/fi/claw-a-thon-demo-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Usage

List all questions:

```bash
interview-agent list
```

List only senior questions:

```bash
interview-agent list --level senior
```

Score one answer:

```bash
interview-agent score --question-id B02 --answer "Use API function calls to increase accuracy and actionability"
```

Run a mock interview:

```bash
interview-agent mock --level intermediate --count 3 --seed 42
```

Export markdown Q&A document:

```bash
interview-agent export --output ./docs/interview-qa.md --level basic
```

## Run tests

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"
```

## Run API locally

```bash
pip install -e .
uvicorn interview_agent.server:app --host 0.0.0.0 --port 8080
```

Example requests:

```bash
curl -s http://127.0.0.1:8080/health
curl -s "http://127.0.0.1:8080/questions?level=basic&limit=2"
curl -s -X POST http://127.0.0.1:8080/score -H "Content-Type: application/json" -d '{"question_id":"B02","answer":"Use API function calls for accuracy and action."}'
```

## Docker

```bash
docker build --platform linux/amd64 -t interview-agent:latest .
docker run --rm -p 8080:8080 interview-agent:latest
```

