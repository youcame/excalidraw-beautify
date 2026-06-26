# Deploy — excalidraw.saycraft.ai

Deploys to **tencent-us** (43.162.82.43), the same box that already serves
`saycraft.ai`. The static Excalidraw build is served by the host nginx; the
DeepSeek-backed AI 美化 proxy runs as a small Docker container bound to
`127.0.0.1:8787`.

## Prerequisites

1. SSH alias `tencent-us` configured (already present in `~/.ssh/config`).
2. DNS: `excalidraw.saycraft.ai` → `43.162.82.43` (A record) must resolve
   **before** the first deploy — Let's Encrypt validates over HTTP.
3. A DeepSeek API key (the proxy falls back to a deterministic grid-align if
   absent, so the demo still works without it).

## One command

```bash
DEEPSEEK_API_KEY=sk-xxxxx bash deploy/deploy-excalidraw.sh
```

It will: build the frontend locally → rsync `build/` + `beautify-proxy/` →
start the proxy container (key written only to the server `.env`, mode 0600) →
obtain the TLS cert (if missing) → install + reload the nginx vhost.

## Files

| File | Role |
| --- | --- |
| `deploy-excalidraw.sh` | end-to-end deploy script (idempotent) |
| `nginx.excalidraw.saycraft.ai.conf` | host vhost: static + `/beautify-api/` proxy + TLS |
| `docker-compose.excalidraw.yml` | the beautify-proxy service (port 8787) |
| `../beautify-proxy/` | the proxy source + Dockerfile |

## Notes

- The live box uses 宝塔 (BT panel) for some vhosts. If `/etc/nginx/sites-available`
  is not the active include path, the script prints the vhost path so it can be
  added through the BT panel instead — it never edits other sites' configs.
- Rollback: `git revert` the change and re-run, or `docker compose -f
  docker-compose.excalidraw.yml down` to stop the proxy (frontend keeps serving
  with the fallback disabled — beautify would then 502 until restarted).
