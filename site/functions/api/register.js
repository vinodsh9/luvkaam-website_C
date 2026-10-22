// POST /api/register
// Stores a registration and the consent the person gave. Needs a D1 database bound as "DB".
import { json, readJson, checkOrigin, cleanName, cleanEmail, cleanPhone, CONSENT_VERSION } from './_util.js';

export async function onRequestPost({ request, env }) {
  if (!checkOrigin(request)) return json({ error: 'This request is not allowed.' }, 403);
  if (!env.DB) {
    console.error('The D1 binding "DB" is missing. Add it under Pages > Settings > Bindings.');
    return json({ error: 'Registration is temporarily unavailable. Please try again later.' }, 503);
  }

  let body;
  try { body = await readJson(request); } catch (e) { return json({ error: e.message }, 400); }

  // Hidden field that people never see. Bots fill it in. Pretend it worked and store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') return json({ ok: true });

  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const phone = cleanPhone(body.phone);
  if (!name) return json({ error: 'Enter your full name (2 to 80 characters).' }, 400);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);
  if (!phone) return json({ error: 'Enter a valid phone number, with the country code if it is not an Indian number.' }, 400);
  if (body.acceptTerms !== true || body.confirmAge !== true) {
    return json({ error: 'Please confirm you are 18 or older and accept the Terms of Use and Privacy Policy.' }, 400);
  }
  if (body.consentVersion !== CONSENT_VERSION) {
    return json({ error: 'The registration notice was updated. Please reload the page and try again.' }, 409);
  }
  const promo = body.promo === true ? 1 : 0;
  const now = new Date().toISOString();

  try {
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    // Someone who is already registered just gets access again. Their saved consent is not changed here.
    if (existing) return json({ ok: true, existing: true });

    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO users (name, email, phone, accepted_terms, consent_promo, consent_version, consent_at, promo_changed_at, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)'
      ).bind(name, email, phone, promo, CONSENT_VERSION, now, promo ? now : null, now),
      env.DB.prepare(
        'INSERT INTO consent_log (user_id, event, consent_version, created_at) VALUES ((SELECT id FROM users WHERE email = ?), ?, ?, ?)'
      ).bind(email, 'register', CONSENT_VERSION, now),
      ...(promo
        ? [env.DB.prepare(
            'INSERT INTO consent_log (user_id, event, consent_version, created_at) VALUES ((SELECT id FROM users WHERE email = ?), ?, ?, ?)'
          ).bind(email, 'promo_opt_in', CONSENT_VERSION, now)]
        : []),
    ]);
    return json({ ok: true, existing: false });
  } catch (e) {
    if (String(e && e.message).includes('UNIQUE')) return json({ ok: true, existing: true });
    console.error('register failed', e && e.message);
    return json({ error: 'We could not save your registration. Please try again.' }, 500);
  }
}

export function onRequest() {
  return json({ error: 'Method not allowed.' }, 405, { allow: 'POST' });
}
