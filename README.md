# Ballpark — placeholder site

A static, single-page "coming soon" site for **https://ballpark.insure** that pitches the
free comparative-rater concept to independent insurance agencies and captures interest
sign-ups.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The page — hero pitch, value props, price comparison, how-it-works, interest form |
| `styles.css` | All styling (dark fintech look, fully responsive, no framework) |
| `script.js` | Form validation + submission |

No build step, no dependencies. The only external request is the Google Fonts stylesheet
(Inter); everything else is self-contained, including the ⚾ favicon (inline SVG).

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

Copy this folder onto the container and run the script with your token:

```bash
# from your dev box:
scp -r placeholder_site root@<lxc-ip>:/root/

# inside the LXC, as root:
cd /root/placeholder_site
TUNNEL_TOKEN='eyJ...paste...' bash setup.sh
```

Then visit **https://ballpark.insure**. Check status anytime with
`systemctl status cloudflared nginx`.

**Update the site later:** re-copy `public/` and refresh the web root —
`cp -r public/. /var/www/html/` (no service restart needed).

> **Alternative:** it's just static files, so Cloudflare Pages (drag-and-drop `public/`)
> works with zero infra — but the LXC keeps everything on your homelab, which is the
> spec's intent.

## Notes

- Copy is deliberately honest per the build spec — "estimated indication, not a carrier
  quote" appears on the demo card and in the footer.
- Rollout states in the dropdown match the spec sequence (NV → AZ → CA → IN/GA/SC/TX/MO).
- `hello@ballpark.insure` is referenced as a fallback contact in the form's error state —
  set that mailbox up (or change the address) before launch.
