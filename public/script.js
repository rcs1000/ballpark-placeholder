/* Ballpark placeholder — interest-registration form handling.
 *
 * ── Wiring the form up ──────────────────────────────────────────────
 * Set FORM_ENDPOINT below to wherever you want submissions to go, e.g.
 *   • a Cloudflare Worker / Pages Function you control
 *   • a Formspree form URL (https://formspree.io/f/xxxxxxx)
 *   • the eventual Ballpark FastAPI app (POST /api/interest)
 *
 * Submissions are sent as JSON via fetch(). If FORM_ENDPOINT is null
 * (the default for this placeholder), the form falls back to storing
 * sign-ups in localStorage so the page still demos cleanly. Swap in a
 * real endpoint before going live so you actually capture the leads.
 * ────────────────────────────────────────────────────────────────────
 */
const FORM_ENDPOINT = null; // TODO: set to your collection endpoint before launch

// Keep the footer year current.
document.getElementById('year').textContent = new Date().getFullYear();

const form = document.getElementById('interest-form');
const msg = document.getElementById('form-msg');
const submitBtn = document.getElementById('submit-btn');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setMsg(text, kind) {
  msg.textContent = text;
  msg.className = 'form__msg' + (kind ? ' ' + kind : '');
}

function clearInvalid() {
  form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
}

function validate(data) {
  const errors = [];
  if (!data.name.trim()) errors.push(['name', 'Please tell us your name.']);
  if (!EMAIL_RE.test(data.email)) errors.push(['email', 'Enter a valid work email.']);
  if (!data.state) errors.push(['state', 'Pick the state you write in.']);
  return errors;
}

async function send(payload) {
  if (!FORM_ENDPOINT) {
    // Placeholder fallback: persist locally so nothing is lost during preview.
    const key = 'ballpark_interest';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push({ ...payload, at: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(existing));
    return true;
  }
  const res = await fetch(FORM_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Request failed: ' + res.status);
  return true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearInvalid();

  const data = {
    name: form.name.value,
    email: form.email.value,
    agency: form.agency.value,
    state: form.state.value,
  };

  const errors = validate(data);
  if (errors.length) {
    errors.forEach(([field]) => form[field].classList.add('invalid'));
    setMsg(errors[0][1], 'err');
    return;
  }

  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = 'Sending…';
  setMsg('', '');

  try {
    await send(data);
    // Replace the form body with a friendly confirmation.
    form.innerHTML =
      '<div class="form--done">' +
      '<div class="form__check" aria-hidden="true">⚾</div>' +
      '<h3>You\'re on the list.</h3>' +
      '<p style="color:var(--ink-soft)">Thanks, ' +
      escapeHtml(data.name.trim().split(' ')[0]) +
      '. We\'ll email you the moment Ballpark goes live in ' +
      escapeHtml(data.state) +
      '.</p>' +
      '</div>';
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = original;
    setMsg('Something went wrong — please try again, or email hello@ballpark.insure.', 'err');
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
