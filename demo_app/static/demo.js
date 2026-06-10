/* Ballpark demo — RC1 quote console (server-side fan-out).
 *
 * Builds one RC1 QuoteRequest (rc1-quote-package.md v1.0) from the form and
 * sends it, with the chosen engine list, to our own Flask proxy:
 *   POST /demo/api/rate   { request, engines:[{name,url,key}] }
 * The proxy fans out to each engine's POST {base}/rate server-side (no CORS),
 * and returns results bucketed by `status`. Tiers are ranked by
 * premium.monthly — the universal cross-engine comparison metric (§4.1).
 */

const STORE_KEY = 'ballpark_demo_engines_v1';
const TIER_ORDER = ['state_minimum', 'standard', 'full', 'custom'];

const DEFAULT_ENGINES = [
  { id: 'just',        name: 'Just Insure', url: 'https://quote.sfinsure.tech', key: '', enabled: true },
  { id: 'progressive', name: 'Progressive', url: '', key: '', enabled: false },
  { id: 'goauto',      name: 'Go Auto',     url: '', key: '', enabled: false },
];

// ───────────────────────── Engine store ─────────────────────────
function loadEngines() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (_) {}
  return structuredClone(DEFAULT_ENGINES);
}
function saveEngines() { localStorage.setItem(STORE_KEY, JSON.stringify(engines)); }

let engines = loadEngines();

// ───────────────────────── Engine UI ─────────────────────────
const enginesEl = document.getElementById('engines');

function renderEngines() {
  enginesEl.innerHTML = '';
  engines.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'engine';
    row.innerHTML = `
      <div class="engine__row1">
        <input type="text" class="name" value="${esc(e.name)}" placeholder="Name" aria-label="Engine name" />
        <input type="text" class="url"  value="${esc(e.url)}"  placeholder="https://engine.example.com" aria-label="Base URL" />
      </div>
      <label class="key">Key <span class="opt">(X-Rater-Key, optional)</span>
        <input type="text" class="keyf" value="${esc(e.key)}" placeholder="leave blank if open" />
      </label>
      <div class="engine__row2">
        <label class="toggle"><input type="checkbox" class="en" ${e.enabled ? 'checked' : ''} /> enabled</label>
        <button type="button" class="btn btn--sm test">Test</button>
        <span class="meta"></span>
        <button type="button" class="btn btn--danger del" title="Remove">✕</button>
      </div>`;

    const [nameI, urlI] = row.querySelectorAll('.engine__row1 input');
    const keyI = row.querySelector('.keyf');
    const enI = row.querySelector('.en');
    const metaEl = row.querySelector('.meta');

    nameI.oninput = () => { e.name = nameI.value; saveEngines(); };
    urlI.oninput  = () => { e.url  = urlI.value;  saveEngines(); };
    keyI.oninput  = () => { e.key  = keyI.value;  saveEngines(); };
    enI.onchange  = () => { e.enabled = enI.checked; saveEngines(); };
    row.querySelector('.del').onclick = () => {
      engines = engines.filter((x) => x !== e); saveEngines(); renderEngines();
    };
    row.querySelector('.test').onclick = () => testEngine(e, metaEl);

    enginesEl.appendChild(row);
  });
}

document.getElementById('add-engine').onclick = () => {
  engines.push({ id: 'e' + Date.now(), name: 'New engine', url: '', key: '', enabled: true });
  saveEngines(); renderEngines();
};

// Test Connection — proxied GET /meta (§5)
async function testEngine(e, metaEl) {
  if (!e.url.trim()) { metaEl.className = 'meta bad'; metaEl.textContent = 'no URL'; return; }
  metaEl.className = 'meta'; metaEl.textContent = 'testing…';
  try {
    const res = await fetch('/demo/api/meta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: e.url, key: e.key }),
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'failed');
    const m = d.meta || {};
    metaEl.className = 'meta ok';
    metaEl.textContent = `✓ ${m.engine_name || m.engine_id || 'ok'} · ${(m.appetite_states || []).join('/') || '—'}`
      + ` · ${m.is_estimate ? 'estimate' : 'real'}`;
  } catch (err) {
    metaEl.className = 'meta bad';
    metaEl.textContent = '✗ ' + (err.message || 'error');
  }
}

// ───────────────────────── Build RC1 QuoteRequest ─────────────────────────
function num(v) { const n = parseInt(String(v).trim(), 10); return Number.isFinite(n) ? n : null; }

function buildRequest(f) {
  const now = new Date().toISOString();
  const state = f.state.value;

  const monthly = num(f.monthly_mileage.value);
  const annual  = num(f.annual_mileage.value);

  const tiers = [...f.querySelectorAll('input[name="tier"]:checked')].map((c) => c.value);

  return {
    schema_version: '1.0',
    request_id: (crypto.randomUUID ? crypto.randomUUID() : 'req-' + now),
    created_at: now,
    meta: { source_type: 'rating_platform', source_name: 'ballpark', source_url: location.href, captured_at: now },
    policy: {
      state,
      zip: f.zip.value.trim(),
      effective_date: null,
      term_months: 6,
      prior_insurance: f.prior_insurance.checked,
      prior_insurance_months: null,
      prior_carrier: null,
      prior_bi_limit: null,
      home_owner: f.home_owner.checked,
      residence_months: null,
    },
    drivers: [{
      driver_id: 'd1',
      role: 'primary',
      relationship_to_primary: 'self',
      dob: f.dob.value || null,
      age: num(f.age.value),
      years_licensed: num(f.years_licensed.value),
      gender: f.gender.value,
      marital_status: f.marital.value,
      license_status: 'valid',
      license_state: state,
      sr22: f.sr22.checked,
      credit: { score: num(f.credit_score.value), band: f.credit_band.value, source: 'self_reported' },
      // quick-quote only carries counts (Just's acvCount); detailed incidents[] omitted (§3.1.1)
      incidents: [],
      incident_counts: {
        accidents: num(f.accidents.value) || 0,
        violations: num(f.violations.value) || 0,
        duis: num(f.duis.value) || 0,
        claims: num(f.claims.value) || 0,
      },
    }],
    vehicles: [{
      vehicle_id: 'v1',
      assigned_driver_ids: null,
      vin: f.vin.value.trim() || null,
      year: num(f.year.value),
      make: f.make.value.trim() || null,
      model: f.model.value.trim() || null,
      trim: null,
      ownership: f.ownership.value,
      primary_use: f.use.value,
      // never invent mileage (§5 rule 5) — derive only across the pair the user gave
      annual_mileage: annual != null ? annual : (monthly != null ? monthly * 12 : null),
      monthly_mileage: monthly != null ? monthly : (annual != null ? Math.round(annual / 12) : null),
      garaging_zip: null,
    }],
    coverages: tiers,        // [] ⇒ each engine returns its native set (Just → its 3 packages)
    identity: null,
  };
}

function validate(req, f) {
  clearBad(f);
  const errs = [];
  if (!/^\d{5}$/.test(req.policy.zip)) errs.push(['zip', 'ZIP must be 5 digits']);
  if (req.drivers[0].dob == null && req.drivers[0].age == null) errs.push(['age', 'Enter a DOB or age']);
  const v = req.vehicles[0];
  if (!v.vin && !(v.year && v.make && v.model)) errs.push(['year', 'Enter VIN or year+make+model']);
  if (v.monthly_mileage == null) errs.push(['monthly_mileage', 'Enter monthly (or annual) mileage']);
  return errs;
}

// ───────────────────────── Submit → proxy → render ─────────────────────────
const form = document.getElementById('quote-form');
const resultsEl = document.getElementById('results');
const msgEl = document.getElementById('form-msg');
const runBtn = document.getElementById('run');

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const req = buildRequest(form);

  const errs = validate(req, form);
  if (errs.length) {
    errs.forEach(([name]) => form[name]?.classList.add('bad'));
    msg(errs[0][1], true);
    return;
  }
  msg('');

  const targets = engines.filter((e) => e.enabled && e.url.trim())
    .map((e) => ({ name: e.name, url: e.url, key: e.key }));
  if (!targets.length) { msg('Enable at least one engine with a URL', true); return; }

  document.getElementById('reqbox').hidden = false;
  document.getElementById('reqjson').textContent = JSON.stringify(req, null, 2);

  runBtn.disabled = true; runBtn.textContent = 'Rating…';
  resultsEl.className = '';
  resultsEl.innerHTML = `<p class="results-empty">Rating across ${targets.length} engine(s)…</p>`;

  try {
    const res = await fetch('/demo/api/rate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: req, engines: targets }),
    });
    if (!res.ok) throw new Error('proxy HTTP ' + res.status);
    const data = await res.json();
    renderResults(data.results || []);
  } catch (err) {
    resultsEl.className = 'results-empty';
    resultsEl.textContent = 'Could not reach the demo orchestrator: ' + (err.message || 'error');
  } finally {
    runBtn.disabled = false; runBtn.textContent = 'Get estimates';
  }
});

function renderResults(results) {
  resultsEl.className = '';
  const frag = document.createDocumentFragment();

  // comparison grid: tier (rows) × engine (cols), ranked by monthly (§7)
  const priced = results.filter((r) => r.response && (r.status === 'priced' || r.status === 'partial'));
  if (priced.length) frag.appendChild(buildGrid(priced));

  results.forEach((r) => frag.appendChild(buildCard(r)));
  resultsEl.innerHTML = '';
  if (!results.length) { resultsEl.className = 'results-empty'; resultsEl.textContent = 'No engines responded.'; return; }
  resultsEl.appendChild(frag);
}

function buildGrid(priced) {
  const tierNames = [];
  priced.forEach((r) => (r.response.tiers || []).forEach((t) => {
    if (!tierNames.includes(t.tier_name)) tierNames.push(t.tier_name);
  }));
  tierNames.sort((a, b) => (TIER_ORDER.indexOf(a) + 1 || 99) - (TIER_ORDER.indexOf(b) + 1 || 99));

  const wrap = document.createElement('div');
  let html = '<table class="gridtable"><thead><tr><th>Tier</th>';
  priced.forEach((r) => { html += `<th>${esc(r.response.engine_name || r.engine.name)}${r.response.is_estimate ? ' <span class="tag tag--est">est</span>' : ''}</th>`; });
  html += '</tr></thead><tbody>';

  tierNames.forEach((tn) => {
    const cells = priced.map((r) => {
      const t = (r.response.tiers || []).find((x) => x.tier_name === tn);
      return t ? t.premium.monthly : null;
    });
    const min = Math.min(...cells.filter((c) => c != null));
    html += `<tr><td>${label(tn)}</td>`;
    cells.forEach((m, i) => {
      if (m == null) { html += '<td>—</td>'; return; }
      const t = priced[i].response.tiers.find((x) => x.tier_name === tn);
      const band = t.confidence ? `<span class="band">±${t.confidence.pct}% · $${fmt(t.confidence.low)}–$${fmt(t.confidence.high)}</span>` : '';
      html += `<td class="num ${m === min ? 'cheapest' : ''}">$${fmt(m)}/mo${band}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
  return wrap;
}

function buildCard(r) {
  const card = document.createElement('div');
  card.className = 'ecard';
  const name = (r.response && r.response.engine_name) || r.engine.name;
  let detail = '';

  if (r.response && (r.status === 'priced' || r.status === 'partial')) {
    const re = r.response;
    const cheapest = Math.min(...(re.tiers || []).map((t) => t.premium.monthly));
    detail = `<div class="ecard__detail">`
      + `${(re.tiers || []).length} tier(s) · native term <b>${re.native_term_months}mo</b>`
      + `${re.product ? ' · ' + esc(re.product) : ''} · cheapest <b>$${fmt(cheapest)}/mo</b>`
      + (re.notes ? `<br><span class="opt">${esc(re.notes)}</span>` : '')
      + `</div>`;
  } else if (r.status === 'declined' && r.response) {
    const d = r.response.decline || {};
    detail = `<div class="ecard__detail">Declined — <b>${esc(d.reason || 'appetite')}</b>${d.message ? ': ' + esc(d.message) : ''}</div>`;
  } else {
    detail = `<div class="ecard__detail">${esc(r.error || 'Unavailable')}</div>`;
  }

  card.innerHTML = `<div class="ecard__head">
      <span class="ecard__name">${esc(name)}</span>
      <span class="tag tag--${r.status}">${r.status}</span>
    </div>${detail}`;

  if (r.response) {
    const raw = document.createElement('details');
    raw.className = 'raw';
    raw.innerHTML = `<summary>RC1 response</summary><pre>${esc(JSON.stringify(r.response, null, 2))}</pre>`;
    card.appendChild(raw);
  }
  return card;
}

// ───────────────────────── helpers ─────────────────────────
function label(t) { return ({ state_minimum: 'State minimum', standard: 'Standard', full: 'Full', custom: 'Custom' }[t] || t); }
function fmt(n) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function msg(t, bad) { msgEl.textContent = t; msgEl.className = 'form-msg' + (bad ? ' bad' : ''); }
function clearBad(f) { f.querySelectorAll('.bad').forEach((el) => el.classList.remove('bad')); }

renderEngines();
