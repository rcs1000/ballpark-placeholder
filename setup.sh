#!/usr/bin/env bash
#
# Ballpark placeholder — one-shot deploy inside a Debian/Ubuntu LXC.
# Installs nginx (serves ./public) + cloudflared (token-based tunnel service).
#
#   1. Create the tunnel in Cloudflare → copy the token.
#   2. Copy this whole placeholder_site/ folder onto the LXC.
#   3. Run as root:   TUNNEL_TOKEN='eyJ...' bash setup.sh
#
set -euo pipefail

: "${TUNNEL_TOKEN:?Set TUNNEL_TOKEN to your Cloudflare tunnel token (the long eyJ... string)}"

SRC="$(cd "$(dirname "$0")" && pwd)/public"
WEBROOT="/var/www/html"

echo "==> Installing nginx + curl"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx curl

echo "==> Publishing site to ${WEBROOT}"
rm -f "${WEBROOT}"/index.nginx-debian.html
cp -r "${SRC}"/. "${WEBROOT}/"
systemctl enable --now nginx

echo "==> Installing cloudflared"
ARCH="$(dpkg --print-architecture)"   # amd64 or arm64
curl -fsSL -o /tmp/cloudflared.deb \
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
dpkg -i /tmp/cloudflared.deb
rm -f /tmp/cloudflared.deb

echo "==> Registering tunnel as a systemd service"
cloudflared service install "${TUNNEL_TOKEN}"

echo
echo "Done. nginx + cloudflared are running."
echo "Finish in Cloudflare: map ballpark.insure -> HTTP -> http://localhost:80"
echo "Re-deploy site later with:  cp -r ${SRC}/. ${WEBROOT}/"
