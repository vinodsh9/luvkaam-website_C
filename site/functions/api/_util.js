// Shared helpers for the Luvkaam API (Cloudflare Pages Functions).
// A file whose name starts with "_" and exports no onRequest handler is not a route.

// Must match CONSENT_VERSION in assets/register.js. Change both whenever the
// wording of the registration notice or the privacy policy changes in a way
// that affects what people agree to.
export const CONSENT_VERSION = '2026-10-20';

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

// Reject cross-site browser requests. Requests with no Origin header (curl, server to server)
// pass here and are still subject to the validation below.
export function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch (e) { return false; }
}

export async function readJson(request, maxBytes = 4096) {
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('application/json')) throw new Error('Send the request as JSON.');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('The request is too large.');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('bad');
    return value;
  } catch (e) {
    throw new Error('The request could not be read.');
  }
}

export function cleanName(value) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 80) return null;
  if (/[<>\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

export function cleanEmail(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (s.length < 5 || s.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

// Returns a normalised phone number such as +919876543210, or null.
// A 10 digit number starting 6-9 is treated as an Indian mobile number.
export function cleanPhone(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!/^[+0-9()\s.-]{8,25}$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  const plus = raw.startsWith('+');
  if (!plus) {
    if (digits.length === 10 && /^[6-9]/.test(digits)) digits = '91' + digits;
    else if (digits.length === 11 && digits[0] === '0') digits = '91' + digits.slice(1);
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return '+' + digits;
}

export function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
