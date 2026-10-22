/* Luvkaam registration: sign-up form, consent capture and the "registered" gate for the tools. */
(function () {
'use strict';

// Must match CONSENT_VERSION in functions/api/_util.js. Change both whenever the notice wording changes.
var CONSENT_VERSION = '2026-10-20';
// Promotional consent is optional by default. Indian data protection law expects consent to be
// specific and not bundled with access to the service. Set to true only if you have taken legal advice.
var PROMO_REQUIRED = false;

var KEY = 'luvkaam.registered';
var memory = null;
function $(id) { return document.getElementById(id); }

function readFlag() {
  try { var v = localStorage.getItem(KEY); return v ? JSON.parse(v) : memory; } catch (e) { return memory; }
}
function writeFlag(obj) {
  memory = obj;
  try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* private mode: keep in memory only */ }
}
function clearFlag() { memory = null; try { localStorage.removeItem(KEY); } catch (e) {} }

var toastTimer;
function toast(m) {
  var t = $('toast'); if (!t) return;
  t.textContent = m; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
}

var modal, lastFocus = null, pendingResume = null;
function isRegistered() { var f = readFlag(); return !!(f && f.v === 1); }

function refreshNav() {
  var f = readFlag(), reg = isRegistered();
  ['openRegister', 'heroRegister', 'ctaRegister'].forEach(function (id) {
    var b = $(id); if (!b) return;
    if (id === 'openRegister') {
      b.classList.toggle('done', reg);
      b.innerHTML = reg ? 'Registered <span aria-hidden="true">✓</span>' : 'Register free <span aria-hidden="true">↗</span>';
      b.setAttribute('aria-label', reg ? 'You are registered on this browser' : 'Register free');
    } else { b.hidden = reg && id !== 'ctaRegister'; if (id === 'ctaRegister') b.hidden = reg; }
  });
  var so = $('signOut'); if (so) so.hidden = !reg;
}

function openRegister(resume) {
  if (!modal) return;
  pendingResume = typeof resume === 'function' ? resume : null;
  lastFocus = document.activeElement;
  var m = $('registerMessage'); m.hidden = true; m.textContent = ''; m.className = 'modalnote';
  modal.classList.add('open');
  setTimeout(function () { var n = $('regName'); if (n) n.focus(); }, 30);
}
function closeRegister() {
  if (!modal) return;
  modal.classList.remove('open');
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
}

function requireRegistration() {
  if (isRegistered()) return true;
  openRegister();
  toast('Register free to use the tools.');
  return false;
}

function showError(msg, fieldId) {
  var m = $('registerMessage'); m.hidden = false; m.className = 'modalnote err'; m.textContent = msg;
  if (fieldId && $(fieldId)) $(fieldId).focus();
}
function phoneLooksValid(v) {
  var d = (v.match(/\d/g) || []).length;
  return d >= 8 && d <= 15 && /^[+0-9() .-]+$/.test(v.trim());
}

async function submit(e) {
  e.preventDefault();
  var name = $('regName').value.trim(), email = $('regEmail').value.trim(), phone = $('regPhone').value.trim();
  var terms = $('regTerms').checked, promo = $('regPromo').checked, website = $('regWebsite').value;
  if (name.length < 2) return showError('Enter your full name.', 'regName');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showError('Enter a valid email address.', 'regEmail');
  if (!phoneLooksValid(phone)) return showError('Enter a valid phone number. Add the country code if it is not an Indian number.', 'regPhone');
  if (!terms) return showError('Please confirm that you are 18 or older and accept the Terms of Use and Privacy Policy.', 'regTerms');
  if (PROMO_REQUIRED && !promo) return showError('Please agree to promotional communication to continue.', 'regPromo');

  var btn = $('regSubmit'), m = $('registerMessage');
  btn.disabled = true; m.hidden = false; m.className = 'modalnote'; m.textContent = 'Saving your registration…';
  try {
    var r = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, phone: phone, acceptTerms: true, confirmAge: true, promo: promo, consentVersion: CONSENT_VERSION, website: website })
    });
    var data = {};
    try { data = await r.json(); } catch (err) { /* keep empty */ }
    if (!r.ok || !data.ok) throw new Error(data.error || 'Registration failed. Please try again.');
    writeFlag({ v: 1, name: name, at: new Date().toISOString(), consent: CONSENT_VERSION });
    m.className = 'modalnote ok';
    m.textContent = data.existing ? 'Welcome back. This browser now has access. Your saved choices were not changed.' : 'You are registered. All tools are unlocked on this browser.';
    refreshNav(); toast('You are registered. All tools are unlocked.');
    $('registerForm').reset();
    var resume = pendingResume; pendingResume = null;
    setTimeout(function () { closeRegister(); if (resume) resume(); }, 1400);
  } catch (err) {
    showError(err.message || 'Registration failed. Please try again.');
  } finally { btn.disabled = false; }
}

function init() {
  modal = $('registerModal');
  if (modal) {
    ['openRegister', 'heroRegister', 'ctaRegister'].forEach(function (id) {
      var b = $(id); if (!b) return;
      b.addEventListener('click', function () { if (id === 'openRegister' && isRegistered()) { toast('You are registered on this browser.'); return; } openRegister(); });
    });
    $('registerClose').addEventListener('click', closeRegister);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeRegister(); });
    $('registerForm').addEventListener('submit', submit);
    var promoText = $('promoRequiredMark'); if (promoText) promoText.textContent = PROMO_REQUIRED ? '(Required)' : '(Optional)';
    if (PROMO_REQUIRED) $('regPromo').required = true;
    document.addEventListener('keydown', function (e) {
      if (!modal.classList.contains('open')) return;
      if (e.key === 'Escape') closeRegister();
      if (e.key === 'Tab') {
        var f = modal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([tabindex="-1"]),select,textarea');
        f = Array.prototype.filter.call(f, function (x) { return x.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  var so = $('signOut'); if (so) so.addEventListener('click', function () { clearFlag(); refreshNav(); toast('Signed out on this browser. Your registration is still saved with us.'); });
  refreshNav();
}

window.Luvkaam = { isRegistered: isRegistered, requireRegistration: requireRegistration, openRegister: openRegister, toast: toast, CONSENT_VERSION: CONSENT_VERSION };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
