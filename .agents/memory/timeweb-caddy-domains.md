---
name: Timeweb Caddy proxy for custom domains
description: How client custom domains are served (bucket-per-domain + Caddy on-demand TLS on a Timeweb VPS) and Timeweb API quirks learned while provisioning
---

# Timeweb VPS + Caddy for custom domains (July 2026 architecture)

Custom client domains are served WITHOUT Yandex CDN/Certificate Manager: one Yandex Object Storage bucket named exactly the apex domain + a single generic Caddy reverse proxy on a Timeweb VPS with on-demand TLS.

- VPS: Timeweb ID **8611593**, IP **45.153.69.131** (= env `DOMAIN_PROXY_IP`), Ubuntu 24.04, ru-2, ~207₽/mo. Caddy config at `/etc/caddy/Caddyfile`. SSH key `craft-ai-agent` (Timeweb key id 719979) attached; private key was ephemeral (/tmp) — regenerate + re-attach via API if SSH needed again.
- Caddy: `on_demand_tls { ask https://craft-ai.ru/api/domains/check }`, www→apex redirect, `reverse_proxy https://website.yandexcloud.net { header_up Host {host}.website.yandexcloud.net }` — works for ANY domain because bucket name == apex domain.
- **Why:** per-domain Yandex CDN costs 150₽/mo each + 20-resource quota; Caddy VPS is flat-cost and unlimited. Replit-hosted app itself cannot terminate TLS for arbitrary domains (no port-443/SNI control), so the tiny external VPS is required.
- **How to apply:** cert issuance works ONLY while production craft-ai.ru serves the public ask endpoint; if certs stop issuing, check that endpoint first, then `systemctl status caddy` on the VPS.

## Timeweb API quirks (hard-won)
- Server may be created with NO public IP (ips list stays empty even when status=on). Fix: `POST /api/v1/servers/{id}/ips` with `{"type":"ipv4"}` → 201 returns the IP instantly.
- If the server boots without network, cloud-init `packages:` silently fails (config files still written). Install packages later via SSH.
- Attach SSH key to a running server: `POST /api/v1/servers/{id}/ssh-keys` with `{"ssh_key_ids":[id]}` (204); the key only applies after a **reboot**.
- `apt-get install caddy` prompts about the pre-existing Caddyfile conffile → use `-o Dpkg::Options::="--force-confold"` and restore your Caddyfile after.
