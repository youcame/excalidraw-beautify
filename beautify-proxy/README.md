# Excalidraw AI 美化 — DeepSeek proxy

A tiny, zero-dependency Node service (Node ≥18) that the Excalidraw frontend
calls to beautify a canvas. It holds the DeepSeek API key server-side so the key
never reaches the browser.

## Endpoint

`POST /api/beautify`

```json
{ "elements": [{ "i": 0, "t": "r", "x": 217, "y": 80, "w": 217, "h": 115 }] }
```

Response:

```json
{ "patch": [{ "i": 0, "x": 220, "y": 80, "w": 220, "h": 120 }], "source": "deepseek", "model": "deepseek-chat" }
```

`GET /health` → `ok`.

## Config (env)

| Var | Default | Notes |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | _(empty)_ | When empty, the proxy uses a deterministic grid-align fallback (no network). |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI-compatible base. |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | DeepSeek flash (reasoning) model id. |
| `PORT` | `8787` | |

## Why a fallback?

If DeepSeek is unreachable or no key is configured, the proxy still returns a
clean grid-aligned layout. The demo (and the e2e suite) therefore never fail,
and DeepSeek is a quality upgrade rather than a hard dependency.

## Run

```bash
DEEPSEEK_API_KEY=sk-... node server.mjs
# or in Docker
docker build -t beautify-proxy . && docker run -p 8787:8787 -e DEEPSEEK_API_KEY=sk-... beautify-proxy
```
