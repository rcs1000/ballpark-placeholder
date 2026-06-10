#!/usr/bin/env bash
#
# Ballpark demo — deploy the /demo Flask orchestrator inside the LXC.
# Run AFTER setup.sh (which installs nginx + the static site). As root:
#
#   cd ~/ballpark-placeholder && bash setup-demo.sh
#
# Result: gunicorn runs the Flask app on 127.0.0.1:5000 (systemd service
# `ballpark-demo`); nginx serves the static site and reverse-proxies /demo
# to it. The Cloudflare Tunnel is untouched — it still points at nginx:80.
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
APPDIR=/opt/ballpark-demo

echo "==> Installing Python + nginx"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv nginx

echo "==> Deploying app to ${APPDIR}"
mkdir -p "${APPDIR}"
cp -r "${REPO}/demo_app/." "${APPDIR}/"

echo "==> Python venv + dependencies"
python3 -m venv "${APPDIR}/venv"
"${APPDIR}/venv/bin/pip" install -q --upgrade pip
"${APPDIR}/venv/bin/pip" install -q -r "${APPDIR}/requirements.txt"

echo "==> systemd service (ballpark-demo)"
cat > /etc/systemd/system/ballpark-demo.service <<EOF
[Unit]
Description=Ballpark demo (RC1 quote console)
After=network.target

[Service]
WorkingDirectory=${APPDIR}
ExecStart=${APPDIR}/venv/bin/gunicorn -w 2 -b 127.0.0.1:5000 app:app
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now ballpark-demo

echo "==> nginx: static site + /demo proxy"
cat > /etc/nginx/sites-available/ballpark <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    root /var/www/html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # Hand /demo (page, assets, and API) to the Flask orchestrator.
    location /demo {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
EOF
ln -sf /etc/nginx/sites-available/ballpark /etc/nginx/sites-enabled/ballpark
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo
echo "Done. Static site on nginx; /demo proxied to gunicorn:5000."
echo "Check:  systemctl status ballpark-demo --no-pager"
echo "        curl -sI http://localhost/demo"
echo "Update later:  cd ${REPO} && git pull && bash setup-demo.sh"
