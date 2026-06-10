# Ballpark — placeholder site

A static, single-page "coming soon" site for **https://ballpark.insure** that pitches the
free comparative-rater concept to independent insurance agencies and captures interest
sign-ups.

## Files

| Path | Purpose |
|------|---------|
| `public/index.html` | Marketing page — hero pitch, value props, price comparison, interest form |
| `public/styles.css` | All styling for the marketing site (dark fintech look, responsive) |
| `public/script.js` | Interest-form validation + submission |
| `demo_app/` | Flask **/demo** quote console (RC1 orchestrator) — see below |
| `setup.sh` | Deploy the static site + Cloudflare Tunnel in an LXC |
| `setup-demo.sh` | Deploy the `/demo` Flask service + nginx proxy in the LXC |

The marketing site has no build step or dependencies (only the Google Fonts stylesheet);
the `/demo` console is a small Flask app (Flask + requests + gunicorn).

## Preview locally

```bash
cd placeholder_site
python3 -m http.server 8000
# open http://localhost:8000
```

## Wiring up the interest form

Out of the box the form **stores sign-ups in `localStorage`** so the page demos cleanly with
no backend. Before going live, point it at a real collector by editing one line in
`script.js`:

```js
const FORM_ENDPOINT = "https://...";   // your endpoint
```

It POSTs JSON `{ name, email, agency, state }`. Options:

- **Formspree** (zero infra): create a form, paste its `https://formspree.io/f/xxxx` URL.
- **Cloudflare Worker / Pages Function** (you're behind Cloudflare anyway): a tiny handler
  that writes to KV/D1 or forwards to email.
- **The real Ballpark app later**: add `POST /api/interest` to the FastAPI app and use that.

## Deploying — Proxmox LXC + Cloudflare Tunnel

A small LXC running native `nginx` (serves `./public`) + `cloudflared` (a token-based tunnel
systemd service). No Docker. **Nothing is opened on the Proxmox host** — `cloudflared` makes
an outbound-only connection to Cloudflare, which reaches nginx on `localhost:80`. TLS is
handled at the Cloudflare edge. `setup.sh` does the whole install.

```
placeholder_site/
├── public/     ← the site (nginx web root — only this is served)
├── setup.sh    ← run inside the LXC; installs + wires everything
└── README.md
```

### 1. Create the LXC (on the Proxmox host)

A **Debian 12** unprivileged container is plenty: 1 vCPU, 512 MB RAM, 4 GB disk. Give it
network/DHCP and start it. (cloudflared only needs outbound 443, so no port forwards.)

### 2. Create the tunnel (Cloudflare dashboard)

1. Make sure **ballpark.insure** is a zone in your Cloudflare account (nameservers point at
   Cloudflare). The tunnel auto-creates the DNS record.
2. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, name it `ballpark`,
   **Save**.
3. On the "Install connector" screen, copy the **token** — the long `eyJ...` string (just
   the token, not the whole command).
4. **Public Hostname** tab → **Add a public hostname**:
   - **Subdomain:** *(blank)* · **Domain:** `ballpark.insure`
   - **Type:** `HTTP` · **URL:** `localhost:80`
   - Save. (Repeat for `www`, or add a Cloudflare redirect rule.)

### 3. Run setup (inside the LXC)

The LXC only needs **outbound** internet — it pulls everything (site + this installer)
from GitHub, so it doesn't need to be reachable from your laptop. As root:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/rcs1000/ballpark-placeholder.git
cd ballpark-placeholder
TUNNEL_TOKEN='eyJ...paste...' bash setup.sh
```

Then visit **https://ballpark.insure**. Check status anytime with
`systemctl status cloudflared nginx`.

**Update the site later:** edit + push from your dev box, then on the LXC:

```bash
cd ballpark-placeholder && git pull && cp -r public/. /var/www/html/
```

(no service restart needed).

> **Alternative:** it's just static files, so Cloudflare Pages (drag-and-drop `public/`)
> works with zero infra — but the LXC keeps everything on your homelab, which is the
> spec's intent.

## The `/demo` quote console (RC1 orchestrator)

A super-simple working rater at **`/demo`**. It takes the same inputs as a Just Insure
quick quote, builds one [RC1 `QuoteRequest`](../rc1-quote-package.md) (v1.0), and fans it
out — **server-side** — to a list of engines you edit right on the page (seeded with Just
Insure; add Progressive / Go Auto by filling in their URLs). Results come back bucketed
*priced / declined / unavailable* and ranked by `premium.monthly`, with a tier×engine
comparison grid and the raw RC1 JSON for each engine.

**Why server-side:** the browser POSTs the risk + engine list to a small Flask proxy
(`/demo/api/rate`), which makes the actual `POST {base}/rate` calls in parallel. This
avoids cross-origin (CORS) problems and keeps any `X-Rater-Key` secrets off the client. A
basic SSRF guard blocks private/loopback targets since `/demo` is publicly reachable.

```
demo_app/
├── app.py              Flask: serves /demo + /demo/api/rate + /demo/api/meta (fan-out)
├── index.html          the console page
├── static/{demo.css,demo.js}
└── requirements.txt    Flask · requests · gunicorn
```

### Run locally

```bash
cd demo_app
python3 -m venv venv && venv/bin/pip install -r requirements.txt
venv/bin/python app.py        # http://127.0.0.1:5000/demo
```

### Deploy on the LXC

After `setup.sh`, run `setup-demo.sh` once. It installs the app under `/opt/ballpark-demo`,
runs it via gunicorn as the `ballpark-demo` systemd service on `127.0.0.1:5000`, and
rewrites the nginx site to serve the static pages **and** reverse-proxy `/demo` to it. The
Cloudflare Tunnel is untouched (still → nginx:80).

```bash
cd ~/ballpark-placeholder && git pull && bash setup-demo.sh
# verify:  systemctl status ballpark-demo --no-pager ; curl -sI http://localhost/demo
```

> **Heads-up — engine endpoints:** the demo calls each engine's RC1 `POST /rate`. As of now
> `https://quote.sfinsure.tech` returns **404** on `/rate`, `/meta`, and `/health`, so the
> RC1 adapter described in `rc1-quote-package.md` §5.1 isn't deployed there yet — every
> quote will show as *unavailable* until it is. The console is ready the moment it's live.

## Notes

- Copy is deliberately honest per the build spec — "estimated indication, not a carrier
  quote" appears on the demo card and in the footer.
- Rollout states in the dropdown match the spec sequence (NV → AZ → CA → IN/GA/SC/TX/MO).
- `hello@ballpark.insure` is referenced as a fallback contact in the form's error state —
  set that mailbox up (or change the address) before launch.
