// POST /api/optout  { email }
// Withdraws consent for promotional messages. Always answers the same way, so the
// response never reveals whether an email address is registered.
import { json, readJson, checkOrigin, cleanEmail, CONSENT_VERSION } from './_util.js';

export async function onRequestPost({ request, env }) {
  if (!checkOrigin(request)) return json({ error: 'This request is not allowed.' }, 403);
  if (!env.DB) return json({ error: 'This service is temporarily unavailable. Please try again later.' }, 503);

  let body;
  try { body = await readJson(request); } catch (e) { return json({ error: e.message }, 400); }
  if (typeof body.website === 'string' && body.website.trim() !== '') return json({ ok: true });

  const email = cleanEmail(body.email);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);
  const now = new Date().toISOString();

  try {
    const res = await env.DB.prepare(
      'UPDATE users SET consent_promo = 0, promo_changed_at = ? WHERE email = ? AND consent_promo = 1'
    ).bind(now, email).run();
    if (res && res.meta && res.meta.changes > 0) {
      await env.DB.prepare(
        'INSERT INTO consent_log (user_id, event, consent_version, created_at) VALUES ((SELECT id FROM users WHERE email = ?), ?, ?, ?)'
      ).bind(email, 'promo_opt_out', CONSENT_VERSION, now).run();
    }
    return json({ ok: true });
  } catch (e) {
    console.error('optout failed', e && e.message);
    return json({ error: 'We could not process this. Please try again or email us.' }, 500);
  }
}

export function onRequest() {
  return json({ error: 'Method not allowed.' }, 405, { allow: 'POST' });
}
