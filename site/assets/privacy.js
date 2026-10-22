/* Forms on the Privacy page: withdraw promotional consent, and send privacy requests. */
(function () {
'use strict';
function $(id) { return document.getElementById(id); }

function wire(formId, url, build, okText) {
  var form = $(formId); if (!form) return;
  var out = form.querySelector('.msg');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    out.hidden = false; out.className = 'msg'; out.textContent = 'Sending…';
    try {
      var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(build(form)) });
      var data = {}; try { data = await r.json(); } catch (x) { /* ignore */ }
      if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again or email us.');
      out.className = 'msg ok'; out.textContent = okText; form.reset();
    } catch (err) {
      out.className = 'msg err'; out.textContent = err.message;
    } finally { btn.disabled = false; }
  });
}

wire('optoutForm', '/api/optout', function (f) {
  return { email: f.elements.email.value.trim(), website: f.elements.website.value };
}, 'Done. We will not use your details for promotional messages. Service messages about your account may still be sent.');

wire('requestForm', '/api/request', function (f) {
  return { email: f.elements.email.value.trim(), type: f.elements.type.value, message: f.elements.message.value.trim(), website: f.elements.website.value };
}, 'Request received. We will reply to this email address after confirming it is you.');
})();
