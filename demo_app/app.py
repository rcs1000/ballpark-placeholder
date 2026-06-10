"""Ballpark demo — server-side RC1 quote orchestrator.

Serves the /demo quote console and fans one RC1 QuoteRequest
(rc1-quote-package.md v1.0) out to the engines chosen in the page:
POST {base}/rate with an optional X-Rater-Key header, in parallel.
Doing the calls here (not in the browser) avoids CORS and keeps any
engine secrets off the client.

Run behind nginx, which proxies /demo -> 127.0.0.1:5000.
"""

import concurrent.futures
import ipaddress
import socket
from urllib.parse import urlparse

import requests
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/demo/static")

RATE_TIMEOUT = 15   # seconds per engine /rate call
META_TIMEOUT = 8


def base_url(u: str) -> str:
    """Normalize an engine base URL: drop trailing slash and a pasted /rate."""
    u = (u or "").strip().rstrip("/")
    if u.lower().endswith("/rate"):
        u = u[:-len("/rate")]
    return u


def is_safe(url: str) -> bool:
    """Basic SSRF guard: http(s) only, and refuse private/loopback targets.

    /demo is publicly reachable, so without this anyone could make this
    server probe the LXC's internal network. Not airtight (no DNS-rebind
    defense), but blocks the obvious cases. Engines are public hosts.
    """
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        return False
    host = p.hostname
    if not host or host == "localhost":
        return False
    candidates = []
    try:
        candidates.append(ipaddress.ip_address(host))   # literal IP
    except ValueError:
        try:                                             # resolve hostname
            for info in socket.getaddrinfo(host, None):
                candidates.append(ipaddress.ip_address(info[4][0]))
        except Exception:
            return True   # unresolvable here; let the request attempt and fail
    return all(
        not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
             or ip.is_multicast or ip.is_unspecified)
        for ip in candidates
    )


def friendly(err: Exception) -> str:
    if isinstance(err, requests.Timeout):
        return "timed out"
    if isinstance(err, requests.ConnectionError):
        return "connection failed (DNS/refused)"
    if isinstance(err, ValueError):
        return "engine returned non-JSON"
    return (str(err) or "error")[:200]


@app.get("/demo")
@app.get("/demo/")
def page():
    return send_from_directory(app.root_path, "index.html")


@app.post("/demo/api/meta")
def meta():
    """Test Connection — GET {base}/meta for one engine (§5)."""
    data = request.get_json(force=True, silent=True) or {}
    base = base_url(data.get("url"))
    if not base or not is_safe(base):
        return jsonify({"ok": False, "error": "blocked or invalid URL"})
    headers = {"X-Rater-Key": data["key"]} if data.get("key") else {}
    try:
        r = requests.get(base + "/meta", headers=headers, timeout=META_TIMEOUT)
        r.raise_for_status()
        return jsonify({"ok": True, "meta": r.json()})
    except Exception as e:
        return jsonify({"ok": False, "error": friendly(e)})


@app.post("/demo/api/rate")
def rate():
    """Fan one RC1 QuoteRequest out to every engine in parallel (§7.3)."""
    data = request.get_json(force=True, silent=True) or {}
    rc1 = data.get("request")
    engines = data.get("engines") or []
    if not isinstance(rc1, dict) or not engines:
        return jsonify({"error": "missing request or engines"}), 400

    def call(eng: dict) -> dict:
        name = eng.get("name") or eng.get("url") or "engine"
        base = base_url(eng.get("url"))
        out = {"engine": {"name": name, "url": base}}
        if not base or not is_safe(base):
            return {**out, "status": "unavailable", "error": "blocked or invalid URL"}
        headers = {"Content-Type": "application/json"}
        if eng.get("key"):
            headers["X-Rater-Key"] = eng["key"]
        try:
            r = requests.post(base + "/rate", json=rc1, headers=headers, timeout=RATE_TIMEOUT)
            if r.status_code == 401:
                return {**out, "status": "unavailable", "error": "401 — bad X-Rater-Key"}
            if not r.ok:
                return {**out, "status": "unavailable", "error": f"HTTP {r.status_code}"}
            body = r.json()
            return {**out, "status": body.get("status", "priced"), "response": body}
        except Exception as e:
            return {**out, "status": "unavailable", "error": friendly(e)}

    workers = min(8, len(engines))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(call, engines))
    return jsonify({"results": results})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
