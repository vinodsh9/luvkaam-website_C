// POST /api/request  { email, type, message }
// Records an access, correction, erasure or grievance request for the team to handle.
import { json, readJson, checkOrigin, cleanEmail, cleanText } from './_util.js';

const TYPES = ['access', 'correction', 'erasure', 'grievance'];

export async function onRequestPost({ request, env }) {
  if (!checkOrigin(request)) return json({ error: 'This request is not allowed.' }, 403);
  if (!env.DB) return json({ error: 'This service is temporarily unavailable. Please try again later.' }, 503);

  let body;
  try { body = await readJson(request, 6000); } catch (e) { return json({ error: e.message }, 400); }
  if (typeof body.website === 'string' && body.website.trim() !== '') return json({ ok: true });

  const email = cleanEmail(body.email);
  const type = String(body.type || '');
  const message = cleanText(body.message, 1500);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);
  if (!TYPES.includes(type)) return json({ error: 'Choose the kind of request.' }, 400);
  if (type !== 'access' && type !== 'erasure' && message.length < 5) {
    return json({ error: 'Add a short description of your request.' }, 400);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO privacy_requests (email, type, message, status, created_at) VALUES (?, ?, ?, 'open', ?)"
    ).bind(email, type, message || null, new Date().toISOString()).run();
    return json({ ok: true });
  } catch (e) {
    console.error('request failed', e && e.message);
    return json({ error: 'We could not save your request. Please try again or email us.' }, 500);
  }
}

export function onRequest() {
  return json({ error: 'Method not allowed.' }, 405, { allow: 'POST' });
}
