/* Luvkaam tools. Every tool runs in the visitor's browser. Files are never uploaded. */
(function () {
'use strict';

var MAX_MB = 25, MAX_BYTES = MAX_MB * 1024 * 1024, OCR_MAX_PAGES = 20;
var CDN = 'https://cdn.jsdelivr.net/npm/';
var URLS = {
  pdflib: CDN + 'pdf-lib@1.17.1/dist/pdf-lib.min.js',
  pdfjs: CDN + 'pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfjsWorker: CDN + 'pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  jszip: CDN + 'jszip@3.10.1/dist/jszip.min.js',
  xlsx: CDN + 'xlsx@0.18.5/dist/xlsx.full.min.js',
  tess: CDN + 'tesseract.js@5.1.1/dist/tesseract.min.js',
  tessWorker: CDN + 'tesseract.js@5.1.1/dist/worker.min.js',
  tessCore: CDN + 'tesseract.js-core@5.1.0',
  tessLang: CDN + '@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
  qpdf: CDN + '@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.js',
  qpdfWasm: CDN + '@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.wasm'
};

/* ---------- small helpers ---------- */
function UserError(message) { var e = new Error(message); e.name = 'UserError'; return e; }
function h(tag, props) {
  var el = document.createElement(tag), k, v, kids = Array.prototype.slice.call(arguments, 2);
  props = props || {};
  for (k in props) {
    v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  (function add(list) {
    list.forEach(function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) return add(c);
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
  })(kids);
  return el;
}
function $(id) { return document.getElementById(id); }
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
function fmt(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB'; }
function stem(n) { return String(n).replace(/\.[^.]+$/, ''); }
function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function toast(m) { if (window.Luvkaam) window.Luvkaam.toast(m); }
function canvasBlob(c, type, q) {
  return new Promise(function (res, rej) {
    c.toBlob(function (b) { b ? res(b) : rej(UserError('Your browser could not create the image.')); }, type, q);
  });
}
function xmlEscape(s) {
  return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function download(blob, name) {
  var url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}
function friendly(e) {
  var m = (e && e.message) || String(e), n = (e && e.name) || '';
  if (n === 'UserError') return m;
  if (n === 'PasswordException') return 'This PDF is password protected. Remove the password with Unlock PDF first.';
  if (/encrypted/i.test(m)) return 'This PDF is encrypted or has restrictions. Use Unlock PDF first, then try again.';
  if (/Invalid PDF|No PDF header|Failed to parse|XRef|bad .*PDF|Missing PDF/i.test(m)) return 'This file could not be read as a PDF. It may be damaged.';
  if (/library/i.test(m) && /load/i.test(m)) return m;
  if (/memory|allocation|array buffer/i.test(m)) return 'This file is too big for your device to process in the browser. Try a smaller file.';
  return m || 'Something went wrong while processing the file.';
}

/* ---------- libraries (loaded on first use) ---------- */
var scripts = {};
function loadScript(url, check) {
  if (scripts[url]) return scripts[url];
  scripts[url] = new Promise(function (resolve, reject) {
    if (check()) return resolve();
    var s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = function () { check() ? resolve() : reject(new Error('A required library did not load correctly. Reload the page and try again.')); };
    s.onerror = function () { delete scripts[url]; reject(new Error('Could not load a required library. Check your internet connection and try again.')); };
    document.head.appendChild(s);
  });
  return scripts[url];
}
var lib = {
  pdflib: function () { return loadScript(URLS.pdflib, function () { return !!window.PDFLib; }).then(function () { return window.PDFLib; }); },
  pdfjs: function () {
    return loadScript(URLS.pdfjs, function () { return !!window.pdfjsLib; }).then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = URLS.pdfjsWorker; return window.pdfjsLib;
    });
  },
  jszip: function () { return loadScript(URLS.jszip, function () { return !!window.JSZip; }).then(function () { return window.JSZip; }); },
  xlsx: function () { return loadScript(URLS.xlsx, function () { return !!window.XLSX; }).then(function () { return window.XLSX; }); },
  tess: function () { return loadScript(URLS.tess, function () { return !!window.Tesseract; }).then(function () { return window.Tesseract; }); },
  qpdf: function () { return loadScript(URLS.qpdf, function () { return typeof window.Module === 'function'; }).then(function () { return window.Module; }); }
};

/* ---------- PDF helpers ---------- */
async function openPdf(buf, password) {
  var pdfjs = await lib.pdfjs();
  return pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false, password: password || undefined }).promise;
}
async function probePdf(buf) {
  try {
    var doc = await openPdf(buf), n = doc.numPages; doc.destroy();
    return { pages: n, locked: false };
  } catch (e) {
    if (e && e.name === 'PasswordException') return { pages: 0, locked: true };
    throw e;
  }
}
async function pdfLibLoad(buf) {
  var L = await lib.pdflib();
  try { return await L.PDFDocument.load(buf); }
  catch (e) { throw UserError(friendly(e)); }
}
function pdfBlob(bytes) { return new Blob([bytes], { type: 'application/pdf' }); }
function parseRanges(str, n) {
  var toks = String(str || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean), groups = [];
  if (!toks.length) throw UserError('Enter at least one page or range, for example 1-3, 5, 8-');
  toks.forEach(function (t) {
    var m = t.match(/^(\d*)\s*-\s*(\d*)$/), a, b, i, g = [];
    if (m) {
      if (!m[1] && !m[2]) throw UserError('"' + t + '" is not a valid page or range.');
      a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n;
    } else if (/^\d+$/.test(t)) { a = b = +t; }
    else throw UserError('"' + t + '" is not a valid page or range.');
    if (a < 1 || b > n || a > b) throw UserError('"' + t + '" is outside this document, which has pages 1 to ' + n + '.');
    for (i = a; i <= b; i++) g.push(i - 1);
    groups.push(g);
  });
  return groups;
}
async function zipFiles(entries, name) {
  var Z = await lib.jszip(), zip = new Z();
  entries.forEach(function (e) { zip.file(e[0], e[1]); });
  var blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return { name: name, blob: blob };
}
async function renderPageCanvas(page, maxDim, scaleWanted) {
  var v1 = page.getViewport({ scale: 1 }), s = Math.min(scaleWanted, maxDim / Math.max(v1.width, v1.height)), vp = page.getViewport({ scale: s });
  var c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas: c, w: v1.width, h: v1.height };
}

/* text with layout: group pdf.js text items into lines */
function groupLines(items) {
  var its = items.filter(function (i) { return typeof i.str === 'string' && i.str.trim() !== ''; }).map(function (i) {
    return { s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.height) || Math.abs(i.transform[3]) || 10 };
  });
  its.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });
  var rows = [];
  its.forEach(function (it) {
    var r = rows[rows.length - 1];
    if (r && Math.abs(r.y - it.y) <= Math.max(2, 0.5 * Math.min(r.h, it.h))) { r.items.push(it); r.h = Math.max(r.h, it.h); }
    else rows.push({ y: it.y, h: it.h, items: [it] });
  });
  rows.forEach(function (r) {
    r.items.sort(function (a, b) { return a.x - b.x; });
    var t = '', prev = null;
    r.items.forEach(function (it) {
      if (prev) {
        var gap = it.x - (prev.x + prev.w);
        if (gap > r.h * 0.18 && !/\s$/.test(t) && !/^\s/.test(it.s)) t += ' ';
      }
      t += it.s; prev = it;
    });
    r.text = t.replace(/\s+$/, '');
    var last = r.items[r.items.length - 1];
    r.left = r.items[0].x; r.right = last.x + last.w;
  });
  return rows;
}
async function extractRows(buf, progress, password) {
  var doc = await openPdf(buf, password), pages = [], p, page, tc;
  for (p = 1; p <= doc.numPages; p++) {
    page = await doc.getPage(p); tc = await page.getTextContent();
    pages.push(groupLines(tc.items)); page.cleanup();
    if (progress) progress(p / doc.numPages);
    await tick();
  }
  doc.destroy();
  return pages;
}
function rowsToText(rows) {
  var out = '', i;
  for (i = 0; i < rows.length; i++) {
    out += rows[i].text;
    if (i < rows.length - 1) out += (rows[i].y - rows[i + 1].y > rows[i].h * 1.7) ? '\n\n' : '\n';
  }
  return out;
}
function rowsToParagraphs(rows) {
  if (!rows.length) return [];
  var minL = Math.min.apply(null, rows.map(function (r) { return r.left; })), maxR = Math.max.apply(null, rows.map(function (r) { return r.right; }));
  var span = Math.max(1, maxR - minL), paras = [], cur = rows[0].text, i, r, next;
  for (i = 0; i < rows.length - 1; i++) {
    r = rows[i]; next = rows[i + 1];
    var close = (r.y - next.y) <= r.h * 1.7, full = (r.right - minL) >= 0.88 * span;
    var bullet = /^([•\-–*▪◦]|\d+[.)])\s/.test(next.text);
    if (close && full && !bullet) cur += ' ' + next.text;
    else { paras.push(cur); cur = next.text; }
  }
  paras.push(cur);
  return paras;
}

/* ---------- Word (.docx) writer ---------- */
async function buildDocx(blocks) {
  var Z = await lib.jszip(), zip = new Z(), body = '';
  blocks.forEach(function (b) {
    if (b.t === 'pb') body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    else if (!b.text) body += '<w:p/>';
    else body += '<w:p><w:r>' + (b.bold ? '<w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>' : '') + '<w:t xml:space="preserve">' + xmlEscape(b.text) + '</w:t></w:r></w:p>';
  });
  var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"', hd = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  zip.file('[Content_Types].xml', hd + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', hd + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', hd + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', hd + '<w:styles ' + W + '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Mangal"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>');
  zip.file('word/document.xml', hd + '<w:document ' + W + '><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>');
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

/* ---------- images ---------- */
async function decodeImage(file, opaque) {
  var bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    try { bmp = await createImageBitmap(file); }
    catch (e2) { throw UserError('"' + file.name + '" could not be opened as an image.'); }
  }
  var w = bmp.width, h2 = bmp.height, s = Math.min(1, 6000 / Math.max(w, h2));
  var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h2 * s));
  var ctx = c.getContext('2d');
  if (opaque) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}

/* ---------- OCR ---------- */
async function makeOcrWorker(progress) {
  var T = await lib.tess();
  return T.createWorker('eng', 1, {
    workerPath: URLS.tessWorker, corePath: URLS.tessCore, langPath: URLS.tessLang,
    logger: function (m) { if (progress && m.status === 'recognizing text') progress(m.progress || 0); }
  });
}

/* ---------- qpdf (protect / unlock) ---------- */
async function runQpdf(args, bytes) {
  var make = await lib.qpdf(), err = [];
  var q = await make({ locateFile: function () { return URLS.qpdfWasm; }, noInitialRun: true, print: function () {}, printErr: function (t) { err.push(String(t)); } });
  q.FS.writeFile('/in.pdf', new Uint8Array(bytes));
  var code;
  try { code = q.callMain(args); }
  catch (e) { code = (e && typeof e.status === 'number') ? e.status : 2; err.push(String(e && e.message || e)); }
  var out = null;
  try { out = q.FS.readFile('/out.pdf'); } catch (e) { out = null; }
  return { code: code, out: out, err: err.join('\n') };
}

/* ---------- summariser (no AI service; picks the most important sentences) ---------- */
var STOP = 'a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours said says also may per via'.split(' ');
var STOPSET = {}; STOP.forEach(function (w) { STOPSET[w] = 1; });
function summarize(text, count) {
  var clean = text.replace(/\s+/g, ' ').trim();
  var sentences = (clean.match(/[^.!?।]+[.!?।]+["')\]]*|[^.!?।]+$/g) || []).map(function (s) { return s.trim(); })
    .filter(function (s) { var n = s.split(' ').length; return n >= 6 && n <= 80; });
  if (sentences.length <= count) return { sentences: sentences, total: sentences.length };
  var tf = {};
  var tokens = sentences.map(function (s) {
    var words = (s.toLowerCase().match(/[a-zऀ-ॿ][a-zऀ-ॿ'-]{2,}/g) || []).filter(function (w) { return !STOPSET[w]; });
    words.forEach(function (w) { tf[w] = (tf[w] || 0) + 1; });
    return words;
  });
  var scored = sentences.map(function (s, i) {
    var seen = {}, sum = 0;
    tokens[i].forEach(function (w) { if (!seen[w]) { seen[w] = 1; sum += tf[w]; } });
    var score = sum / Math.sqrt(Math.max(1, tokens[i].length)) * (i < 3 ? 1.15 : 1);
    return { i: i, s: s, score: score };
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  var top = scored.slice(0, count).sort(function (a, b) { return a.i - b.i; });
  return { sentences: top.map(function (t) { return t.s; }), total: sentences.length };
}

/* ---------- table cells for Excel ---------- */
function rowCells(row) {
  var cells = [], cur = '', prev = null, thr = Math.max(4, row.h * 0.8);
  row.items.forEach(function (it) {
    if (prev && (it.x - (prev.x + prev.w)) > thr) { cells.push(cur.trim()); cur = ''; }
    else if (prev && cur && !/\s$/.test(cur) && !/^\s/.test(it.s) && (it.x - (prev.x + prev.w)) > row.h * 0.18) cur += ' ';
    cur += it.s; prev = it;
  });
  if (cur.trim()) cells.push(cur.trim());
  return cells;
}
function asValue(s) {
  var t = s.replace(/^[₹$€£]\s?/, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) return parseFloat(t);
  return s;
}
function csvLine(cells) {
  return cells.map(function (c) { var v = String(c); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
}

/* =====================================================================
   Tool definitions
   ===================================================================== */
var ACCEPT_PDF = '.pdf,application/pdf';
var ACCEPT_IMG = '.jpg,.jpeg,.png,.webp,.gif,.bmp,image/jpeg,image/png,image/webp,image/gif,image/bmp';
var PAGE_OPT = { key: 'pages', type: 'text', label: 'Pages', placeholder: 'e.g. 1-3, 5, 8-', help: 'Leave empty for all pages. Use commas between ranges. A trailing dash such as 8- means page 8 to the end.' };

var TOOLS = [
  { id: 'image', name: 'Image to text', cats: 'image text', icon: '▧', tone: 'lilac', kind: 'image', multi: false, cta: 'Extract text',
    blurb: 'Turn a clear photo or screenshot into editable text with OCR (English).',
    card: 'Turn a clear photo into editable text with OCR.',
    run: async function (c) {
      c.status('Loading text recognition. The first run downloads about 3 MB.'); c.progress(0.05);
      var worker = await makeOcrWorker(function (p) { c.progress(0.15 + p * 0.8); c.status('Recognising text… ' + Math.round(p * 100) + '%'); });
      try {
        var r = await worker.recognize(c.files[0].file);
        var text = (r.data.text || '').trim();
        return { kind: 'text', text: text || 'No text detected. Try a sharper image or a different file.', name: stem(c.files[0].name) };
      } finally { await worker.terminate(); }
    } },

  { id: 'pdf', name: 'PDF to text', cats: 'pdf text', icon: '▤', tone: 'coral', kind: 'pdf', multi: false, cta: 'Extract text',
    blurb: 'Copy the text out of a PDF that has selectable text.',
    card: 'Extract selectable text from a text-based PDF.',
    run: async function (c) {
      var pages = await extractRows(c.files[0].bytes, c.progress);
      var text = pages.map(function (rows) { return rowsToText(rows); }).join('\n\n').trim();
      if (text.length < 15) {
        return { kind: 'text', text: '', name: stem(c.files[0].name), message: 'No selectable text was found. This looks like a scanned PDF. Use "OCR scanned PDF" to read it.', suggest: 'scan' };
      }
      return { kind: 'text', text: text, name: stem(c.files[0].name), summary: pages.length + (pages.length === 1 ? ' page' : ' pages') + ' read' };
    } },

  { id: 'merge', name: 'Merge PDF', cats: 'pdf', icon: '▣', tone: 'green', kind: 'pdf', multi: true, min: 2, cta: 'Merge files',
    blurb: 'Combine several PDFs into one. Use the arrows to set the order.',
    card: 'Combine multiple PDF files into one document.',
    run: async function (c) {
      var L = await lib.pdflib(), out = await L.PDFDocument.create(), total = 0, i, src, pgs;
      for (i = 0; i < c.files.length; i++) {
        src = await pdfLibLoad(c.files[i].bytes);
        pgs = await out.copyPages(src, src.getPageIndices());
        pgs.forEach(function (p) { out.addPage(p); }); total += pgs.length;
        c.progress((i + 1) / c.files.length); await tick();
      }
      var bytes = await out.save();
      return { kind: 'files', files: [{ name: 'merged.pdf', blob: pdfBlob(bytes) }], summary: total + ' pages from ' + c.files.length + ' files · ' + fmt(bytes.length) };
    } },

  { id: 'compress', name: 'Compress PDF', cats: 'pdf', icon: '⌁', tone: 'sky', kind: 'pdf', multi: false, cta: 'Compress file',
    blurb: 'Make a PDF smaller for email and uploads.',
    card: 'Reduce file size for sharing and storage.',
    defaults: { level: 'balanced' },
    options: [{ key: 'level', type: 'select', label: 'Compression level', choices: [['lossless', 'Lossless: keeps text selectable'], ['balanced', 'Balanced: about 100 dpi page images'], ['smallest', 'Smallest: about 72 dpi page images']],
      help: 'Balanced and Smallest turn each page into an image, so text can no longer be selected or searched. The smaller of the two results is kept.' }],
    run: async function (c) {
      var f = c.files[0], L = await lib.pdflib(), src = await pdfLibLoad(f.bytes), best = await src.save({ useObjectStreams: true }), method = 'lossless re-save';
      c.progress(0.1); await tick();
      if (c.opts.level !== 'lossless') {
        var pre = c.opts.level === 'smallest' ? { s: 1, q: 0.5 } : { s: 1.4, q: 0.65 };
        var pdf = await openPdf(f.bytes), out = await L.PDFDocument.create(), n = pdf.numPages, p, page, r, blob, img, pg;
        for (p = 1; p <= n; p++) {
          page = await pdf.getPage(p); r = await renderPageCanvas(page, 4096, pre.s);
          blob = await canvasBlob(r.canvas, 'image/jpeg', pre.q);
          img = await out.embedJpg(await blob.arrayBuffer());
          pg = out.addPage([r.w, r.h]); pg.drawImage(img, { x: 0, y: 0, width: r.w, height: r.h });
          r.canvas.width = r.canvas.height = 0; page.cleanup(); c.progress(0.1 + 0.85 * p / n); await tick();
        }
        pdf.destroy();
        var raster = await out.save();
        if (raster.length < best.length) { best = raster; method = 'page images'; }
      }
      if (best.length >= f.size) return { kind: 'nochange', summary: 'This file is already well compressed. The best result was ' + fmt(best.length) + ', which is not smaller than the original ' + fmt(f.size) + '.' };
      var saved = Math.round((1 - best.length / f.size) * 100);
      return { kind: 'files', files: [{ name: stem(f.name) + '-compressed.pdf', blob: pdfBlob(best) }], summary: fmt(f.size) + ' to ' + fmt(best.length) + ' (' + saved + '% smaller, ' + method + ')' };
    } },

  { id: 'word', name: 'PDF to Word', cats: 'pdf text', icon: 'W', tone: 'yellow', kind: 'pdf', multi: false, cta: 'Convert to Word',
    blurb: 'Get the text of a PDF into an editable Word file. Text only: layout, tables and images are not kept.',
    card: 'Get PDF text into an editable Word file. Text only, no layout.',
    run: async function (c) {
      var f = c.files[0], pages = await extractRows(f.bytes, function (p) { c.progress(p * 0.85); }), blocks = [], any = false;
      pages.forEach(function (rows, i) {
        var paras = rowsToParagraphs(rows);
        if (paras.length) any = true;
        if (i > 0) blocks.push({ t: 'pb' });
        paras.forEach(function (t) { blocks.push({ t: 'p', text: t }); });
      });
      if (!any) throw UserError('No selectable text was found, so there is nothing to put in Word. If this is a scanned PDF, use "OCR scanned PDF" and copy the result into Word.');
      var blob = await buildDocx(blocks); c.progress(1);
      return { kind: 'files', files: [{ name: stem(f.name) + '.docx', blob: blob }], summary: pages.length + ' pages converted · text only, so check the layout in Word' };
    } },

  { id: 'scan', name: 'OCR scanned PDF', cats: 'pdf text', icon: '⌗', tone: 'lilac', kind: 'pdf', multi: false, cta: 'Read scanned pages',
    blurb: 'Recognise text on scanned PDF pages (English, up to ' + OCR_MAX_PAGES + ' pages at a time).',
    card: 'Recognise text on scanned PDF pages.',
    run: async function (c) {
      var f = c.files[0], pdf = await openPdf(f.bytes), n = Math.min(pdf.numPages, OCR_MAX_PAGES), parts = [], p, page, r;
      c.status('Loading text recognition. The first run downloads about 3 MB.');
      var base = 0;
      var worker = await makeOcrWorker(function (pr) { c.progress(0.05 + ((base + pr) / n) * 0.92); });
      try {
        for (p = 1; p <= n; p++) {
          base = p - 1; c.status('Reading page ' + p + ' of ' + n + '…');
          page = await pdf.getPage(p); r = await renderPageCanvas(page, 2600, 2.2);
          var res = await worker.recognize(r.canvas);
          parts.push((res.data.text || '').trim());
          r.canvas.width = r.canvas.height = 0; page.cleanup(); await tick();
        }
      } finally { await worker.terminate(); pdf.destroy(); }
      var text = parts.map(function (t, i) { return n > 1 ? '--- Page ' + (i + 1) + ' ---\n' + t : t; }).join('\n\n').trim();
      var extra = pdf.numPages > OCR_MAX_PAGES ? ' Only the first ' + OCR_MAX_PAGES + ' pages were read. Split the PDF to read the rest.' : '';
      return { kind: 'text', text: text || 'No text detected on these pages.', name: stem(f.name), summary: n + (n === 1 ? ' page' : ' pages') + ' read.' + extra };
    } },

  { id: 'imagepdf', name: 'Image to PDF', cats: 'image pdf', icon: '▧', tone: 'coral', kind: 'image', multi: true, min: 1, cta: 'Create PDF',
    blurb: 'Put your pictures into one shareable PDF, one image per page.',
    card: 'Put your pictures into a shareable PDF.',
    defaults: { size: 'a4', margin: 'small' },
    options: [
      { key: 'size', type: 'select', label: 'Page size', choices: [['a4', 'A4'], ['letter', 'US Letter'], ['fit', 'Same as the image']], help: 'Landscape images get a landscape page.' },
      { key: 'margin', type: 'select', label: 'Margin', choices: [['none', 'None'], ['small', 'Small'], ['medium', 'Medium']] }
    ],
    run: async function (c) {
      var L = await lib.pdflib(), out = await L.PDFDocument.create(), sizes = { a4: [595.28, 841.89], letter: [612, 792] };
      var margin = { none: 0, small: 24, medium: 48 }[c.opts.margin], i, cv, blob, img, pw, ph, sc, iw, ih, pg, t;
      for (i = 0; i < c.files.length; i++) {
        var f = c.files[i], isJpg = /jpe?g/i.test(f.file.type) || /\.jpe?g$/i.test(f.name);
        cv = await decodeImage(f.file, isJpg);
        blob = await canvasBlob(cv, isJpg ? 'image/jpeg' : 'image/png', 0.92);
        img = isJpg ? await out.embedJpg(await blob.arrayBuffer()) : await out.embedPng(await blob.arrayBuffer());
        if (c.opts.size === 'fit') { pw = cv.width * 0.75 + margin * 2; ph = cv.height * 0.75 + margin * 2; }
        else { pw = sizes[c.opts.size][0]; ph = sizes[c.opts.size][1]; if (cv.width > cv.height) { t = pw; pw = ph; ph = t; } }
        sc = Math.min((pw - 2 * margin) / cv.width, (ph - 2 * margin) / cv.height); iw = cv.width * sc; ih = cv.height * sc;
        pg = out.addPage([pw, ph]); pg.drawImage(img, { x: (pw - iw) / 2, y: (ph - ih) / 2, width: iw, height: ih });
        cv.width = cv.height = 0; c.progress((i + 1) / c.files.length); await tick();
      }
      var bytes = await out.save();
      return { kind: 'files', files: [{ name: c.files.length === 1 ? stem(c.files[0].name) + '.pdf' : 'images.pdf', blob: pdfBlob(bytes) }], summary: c.files.length + (c.files.length === 1 ? ' page' : ' pages') + ' · ' + fmt(bytes.length) };
    } },

  { id: 'office', name: 'Text to Word & PDF', cats: 'text', icon: '▦', tone: 'green', kind: 'none', textInput: 'text', cta: 'Create file',
    blurb: 'Type or paste text and save it as a Word document or a PDF.',
    card: 'Type or paste text and save it as a Word or PDF file.',
    defaults: { format: 'docx', title: '', text: '' },
    options: [
      { key: 'format', type: 'select', label: 'Save as', choices: [['docx', 'Word document (.docx)'], ['pdf', 'PDF (.pdf)']], help: 'PDF output supports English and other Latin letters. Use Word for Hindi and other scripts.' },
      { key: 'title', type: 'text', label: 'Title (optional)', placeholder: 'Document title' }
    ],
    run: async function (c) {
      var text = String(c.opts.text || '').replace(/\r\n?/g, '\n').trim(), title = String(c.opts.title || '').trim();
      if (!text) throw UserError('Type or paste some text first.');
      var base = (title || 'document').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'document';
      if (c.opts.format === 'docx') {
        var blocks = []; if (title) blocks.push({ t: 'p', text: title, bold: true });
        text.split('\n').forEach(function (l) { blocks.push({ t: 'p', text: l }); });
        return { kind: 'files', files: [{ name: base + '.docx', blob: await buildDocx(blocks) }], summary: 'Word document created' };
      }
      var L = await lib.pdflib(), doc = await L.PDFDocument.create(), font = await doc.embedFont(L.StandardFonts.Helvetica), bold = await doc.embedFont(L.StandardFonts.HelveticaBold);
      var lost = false;
      function safe(s) { var o = ''; for (var i = 0; i < s.length; i++) { var ch = s[i]; try { font.widthOfTextAtSize(ch, 10); o += ch; } catch (e) { o += '?'; lost = true; } } return o; }
      var size = 11, lh = 15, mx = 56, my = 60, W = 595.28, Hh = 841.89, maxW = W - 2 * mx, page = doc.addPage([W, Hh]), y = Hh - my;
      function line(t, f, s) { if (y < my) { page = doc.addPage([W, Hh]); y = Hh - my; } page.drawText(t, { x: mx, y: y, size: s, font: f }); y -= (s === size ? lh : s * 1.4); }
      if (title) { safe(title).split('\n').forEach(function (t) { line(t, bold, 18); }); y -= 6; }
      text.split('\n').forEach(function (para) {
        var words = safe(para).split(/\s+/).filter(Boolean), cur = '';
        if (!words.length) { y -= lh * 0.6; return; }
        words.forEach(function (w) {
          var tryLine = cur ? cur + ' ' + w : w;
          if (font.widthOfTextAtSize(tryLine, size) > maxW && cur) { line(cur, font, size); cur = w; } else cur = tryLine;
        });
        if (cur) line(cur, font, size);
      });
      var bytes = await doc.save();
      return { kind: 'files', files: [{ name: base + '.pdf', blob: pdfBlob(bytes) }], summary: doc.getPageCount() + (doc.getPageCount() === 1 ? ' page' : ' pages') + (lost ? ' · some characters are not supported in PDF output and were replaced with ?' : '') };
    } },

  { id: 'split', name: 'Split PDF', cats: 'pdf', icon: '⇲', tone: 'coral', kind: 'pdf', multi: false, cta: 'Split file',
    blurb: 'Cut a PDF into parts, pull out selected pages, or save every page on its own.',
    card: 'Separate pages or ranges into individual PDF files.',
    defaults: { mode: 'ranges', pages: '' },
    options: [
      { key: 'mode', type: 'seg', label: 'Split by', choices: [['ranges', 'Ranges (one file each)'], ['extract', 'Extract pages into one file'], ['each', 'Every page']] },
      { key: 'pages', type: 'text', label: 'Pages', placeholder: 'e.g. 1-3, 5, 8-', help: 'Use commas between ranges. A trailing dash such as 8- means page 8 to the end.', wide: true, show: function (o) { return o.mode !== 'each'; } }
    ],
    run: async function (c) {
      var f = c.files[0], L = await lib.pdflib(), src = await pdfLibLoad(f.bytes), n = src.getPageCount(), groups, outs = [], i, d, ps;
      if (c.opts.mode === 'each') groups = Array.from({ length: n }, function (_, k) { return [k]; });
      else if (c.opts.mode === 'extract') groups = [parseRanges(c.opts.pages, n).reduce(function (a, b) { return a.concat(b); }, [])];
      else groups = parseRanges(c.opts.pages, n);
      for (i = 0; i < groups.length; i++) {
        d = await L.PDFDocument.create(); ps = await d.copyPages(src, groups[i]); ps.forEach(function (p) { d.addPage(p); });
        outs.push(await d.save()); c.progress((i + 1) / groups.length); await tick();
      }
      if (outs.length === 1) return { kind: 'files', files: [{ name: stem(f.name) + (c.opts.mode === 'extract' ? '-extract' : '-part') + '.pdf', blob: pdfBlob(outs[0]) }], summary: groups[0].length + ' pages' };
      var z = await zipFiles(outs.map(function (b, k) { return [stem(f.name) + '-' + pad(k + 1, String(outs.length).length) + '.pdf', pdfBlob(b)]; }), stem(f.name) + '-split.zip');
      return { kind: 'files', files: [z], summary: outs.length + ' PDF files in a zip · ' + fmt(z.blob.size) };
    } },

  { id: 'rotate', name: 'Rotate PDF', cats: 'pdf', icon: '⟳', tone: 'sky', kind: 'pdf', multi: false, cta: 'Rotate pages',
    blurb: 'Turn all pages, or only the pages you choose, to the right orientation.',
    card: 'Rotate PDF pages to the correct orientation.',
    defaults: { angle: '90', pages: '' },
    options: [
      { key: 'angle', type: 'select', label: 'Rotate', choices: [['90', '90° clockwise'], ['180', '180°'], ['270', '90° counter-clockwise']] },
      PAGE_OPT
    ],
    run: async function (c) {
      var f = c.files[0], L = await lib.pdflib(), doc = await pdfLibLoad(f.bytes), pages = doc.getPages(), idx;
      if (String(c.opts.pages || '').trim()) idx = parseRanges(c.opts.pages, pages.length).reduce(function (a, b) { return a.concat(b); }, []);
      else idx = pages.map(function (_, i) { return i; });
      idx.forEach(function (i) { var r = (pages[i].getRotation().angle + (+c.opts.angle)) % 360; pages[i].setRotation(L.degrees(r)); });
      c.progress(1);
      var bytes = await doc.save();
      return { kind: 'files', files: [{ name: stem(f.name) + '-rotated.pdf', blob: pdfBlob(bytes) }], summary: idx.length + (idx.length === 1 ? ' page' : ' pages') + ' rotated' };
    } },

  { id: 'protect', name: 'Protect PDF', cats: 'pdf', icon: '♢', tone: 'lilac', kind: 'pdf', multi: false, cta: 'Protect file',
    blurb: 'Lock a PDF with a password (AES-256). The password is needed to open the file.',
    card: 'Add password protection to a PDF document.',
    defaults: { pw: '', pw2: '' },
    options: [
      { key: 'pw', type: 'password', label: 'Password', autocomplete: 'new-password', help: 'Use at least 8 characters. We cannot recover a forgotten password.' },
      { key: 'pw2', type: 'password', label: 'Repeat password', autocomplete: 'new-password' }
    ],
    run: async function (c) {
      var f = c.files[0], pw = String(c.opts.pw || '');
      if (f.locked) throw UserError('This PDF already has a password. Unlock it first if you want to set a new one.');
      if (pw.length < 4) throw UserError('Choose a password with at least 4 characters. 8 or more is better.');
      if (pw !== c.opts.pw2) throw UserError('The two passwords do not match.');
      c.status('Loading the encryption engine (about 1.3 MB)…'); c.progress(0.2);
      var r = await runQpdf(['/in.pdf', '--encrypt', pw, pw, '256', '--', '/out.pdf'], f.bytes);
      if (!r.out || (r.code !== 0 && r.code !== 3)) throw UserError('The PDF could not be protected. ' + (/damaged|invalid|not a PDF/i.test(r.err) ? 'The file may be damaged.' : 'Try another file.'));
      c.progress(1);
      return { kind: 'files', files: [{ name: stem(f.name) + '-protected.pdf', blob: pdfBlob(r.out) }], summary: 'Password protected with AES-256 · ' + fmt(r.out.length) };
    } },

  { id: 'unlock', name: 'Unlock PDF', cats: 'pdf', icon: '⌑', tone: 'yellow', kind: 'pdf', multi: false, cta: 'Unlock file',
    blurb: 'Remove the password from a PDF that you own or are allowed to open.',
    card: 'Remove the password from a PDF you are allowed to open.',
    defaults: { pw: '', ok: false },
    options: [
      { key: 'pw', type: 'password', label: 'PDF password', autocomplete: 'off', help: 'Leave empty if the PDF opens without a password but has editing or printing limits.' },
      { key: 'ok', type: 'check', label: 'I own this PDF or have permission to remove its protection.', wide: true }
    ],
    run: async function (c) {
      var f = c.files[0];
      if (!c.opts.ok) throw UserError('Please confirm that you own this PDF or have permission to unlock it.');
      c.status('Loading the PDF engine (about 1.3 MB)…'); c.progress(0.2);
      var pwArg = c.opts.pw ? ['--password=' + c.opts.pw] : [];
      // qpdf cannot tell "wrong password" from "not encrypted" by exit code alone, so pdf.js checks the
      // password first. Files that open without a password are tested with qpdf --is-encrypted
      // (exit 0 = encrypted, 2 = not encrypted).
      if (f.locked) {
        try { var test = await openPdf(f.bytes, c.opts.pw); test.destroy(); }
        catch (e) {
          if (e && e.name === 'PasswordException') throw UserError(c.opts.pw ? 'That password is not correct.' : 'This PDF needs a password to open. Enter it above.');
          throw e;
        }
      } else {
        var chk = await runQpdf(['--is-encrypted', '/in.pdf'], f.bytes);
        if (chk.code !== 0) throw UserError('This PDF is not password protected, so there is nothing to unlock.');
      }
      var args = pwArg.slice();
      args.push('--decrypt', '/in.pdf', '/out.pdf');
      var r = await runQpdf(args, f.bytes);
      if (/invalid password/i.test(r.err)) throw UserError(c.opts.pw ? 'That password is not correct.' : 'This PDF needs a password to open. Enter it above.');
      if (!r.out || (r.code !== 0 && r.code !== 3)) throw UserError('The PDF could not be unlocked. The file may be damaged or use an unsupported protection.');
      c.progress(1);
      return { kind: 'files', files: [{ name: stem(f.name) + '-unlocked.pdf', blob: pdfBlob(r.out) }], summary: 'Protection removed · ' + fmt(r.out.length) };
    } },

  { id: 'excel', name: 'PDF to Excel', cats: 'pdf', icon: 'X', tone: 'green', kind: 'pdf', multi: false, cta: 'Extract tables',
    blurb: 'Pull simple tables from a text-based PDF into Excel or CSV. Works best on clean, bordered or evenly spaced tables.',
    card: 'Extract simple tables into Excel or CSV.',
    defaults: { sheets: 'page' },
    options: [{ key: 'sheets', type: 'select', label: 'Excel layout', choices: [['page', 'One sheet per page'], ['one', 'All pages on one sheet']] }],
    run: async function (c) {
      var f = c.files[0], X = await lib.xlsx(), pages = await extractRows(f.bytes, function (p) { c.progress(p * 0.85); }), wb = X.utils.book_new(), csv = [], any = false, all = [];
      var perPage = pages.map(function (rows) { return rows.map(rowCells).filter(function (r) { return r.length; }); });
      perPage.forEach(function (r) { if (r.length) any = true; });
      if (!any) throw UserError('No selectable text was found, so no tables could be extracted. If this is a scanned PDF, use "OCR scanned PDF" first.');
      perPage.forEach(function (rows, i) {
        rows.forEach(function (r) { csv.push(csvLine(r)); all.push(r.map(asValue)); });
        if (c.opts.sheets === 'page' && rows.length) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows.map(function (r) { return r.map(asValue); })), 'Page ' + (i + 1));
      });
      if (c.opts.sheets === 'one') X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(all), 'Tables');
      var xl = X.write(wb, { bookType: 'xlsx', type: 'array' });
      return { kind: 'files', files: [
        { name: stem(f.name) + '.xlsx', blob: new Blob([xl], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) },
        { name: stem(f.name) + '.csv', blob: new Blob(['﻿' + csv.join('\r\n')], { type: 'text/csv;charset=utf-8' }) }
      ], summary: all.length + ' rows found. Check the columns, because table detection is a best guess.' };
    } },

  { id: 'sign', name: 'Sign PDF', cats: 'pdf', icon: '✍', tone: 'coral', kind: 'pdf', multi: false, cta: 'Add signature', custom: 'sign',
    blurb: 'Draw or type your signature, click where it should go, and save the signed PDF.',
    card: 'Add your drawn or typed signature to a PDF page.',
    run: async function (c) {
      var S = c.sign;
      if (!S || !S.sig) throw UserError('Create your signature first: draw it or type it, then press Use signature.');
      if (!S.placed) throw UserError('Click on the page preview where the signature should go.');
      var f = c.files[0], L = await lib.pdflib(), doc = await pdfLibLoad(f.bytes), pages = doc.getPages();
      var img = await doc.embedPng(S.sig.bytes), targets = S.all ? pages.map(function (_, i) { return i; }) : [S.page];
      targets.forEach(function (i) {
        var pg = pages[i], sz = pg.getSize(), w = sz.width * S.widthPct / 100, hh = w * S.sig.h / S.sig.w;
        var x = clamp(S.fx * sz.width - w / 2, 0, sz.width - w), y = clamp(sz.height - S.fy * sz.height - hh / 2, 0, sz.height - hh);
        pg.drawImage(img, { x: x, y: y, width: w, height: hh });
      });
      c.progress(1);
      var bytes = await doc.save();
      return { kind: 'files', files: [{ name: stem(f.name) + '-signed.pdf', blob: pdfBlob(bytes) }], summary: 'Signature added to ' + targets.length + (targets.length === 1 ? ' page' : ' pages') + '. This is an image of your signature, not a certificate-based digital signature.' };
    } },

  { id: 'jpg', name: 'Convert images', cats: 'image', icon: '▧', tone: 'sky', kind: 'image', multi: true, min: 1, cta: 'Convert images',
    blurb: 'Change JPG, PNG and WEBP pictures from one format to another.',
    card: 'Convert JPG, PNG and WEBP images to another format.',
    defaults: { to: 'png', quality: '0.92' },
    options: [
      { key: 'to', type: 'select', label: 'Convert to', choices: [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WEBP']] },
      { key: 'quality', type: 'select', label: 'Quality (JPG and WEBP)', choices: [['0.7', 'Smaller files'], ['0.85', 'Balanced'], ['0.92', 'High'], ['1', 'Best']] }
    ],
    run: async function (c) {
      var map = { png: ['image/png', 'png'], jpg: ['image/jpeg', 'jpg'], webp: ['image/webp', 'webp'] }[c.opts.to], outs = [], i, cv, blob;
      for (i = 0; i < c.files.length; i++) {
        cv = await decodeImage(c.files[i].file, c.opts.to === 'jpg');
        blob = await canvasBlob(cv, map[0], +c.opts.quality);
        if (blob.type !== map[0]) throw UserError('Your browser cannot create ' + map[1].toUpperCase() + ' files. Choose PNG or JPG instead.');
        outs.push({ name: stem(c.files[i].name) + '.' + map[1], blob: blob });
        cv.width = cv.height = 0; c.progress((i + 1) / c.files.length); await tick();
      }
      if (outs.length === 1) return { kind: 'files', files: outs, summary: fmt(outs[0].blob.size) };
      var z = await zipFiles(outs.map(function (o) { return [o.name, o.blob]; }), 'converted-images.zip');
      return { kind: 'files', files: [z], summary: outs.length + ' images in a zip · ' + fmt(z.blob.size) };
    } },

  { id: 'summarize', name: 'Summarise PDF', cats: 'pdf text', icon: '✦', tone: 'lilac', kind: 'pdf', multi: false, min: 0, optionalFile: true, textInput: 'text', cta: 'Summarise',
    blurb: 'Pick out the key sentences from a PDF or from text you paste. Runs on your device and does not use an AI service.',
    card: 'Pick the key sentences from a PDF or pasted text.',
    defaults: { count: '5', text: '' },
    options: [{ key: 'count', type: 'select', label: 'Key points', choices: [['3', '3'], ['5', '5'], ['8', '8'], ['12', '12']] }],
    run: async function (c) {
      var text = String(c.opts.text || '').trim(), name = 'summary';
      if (!text && c.files[0]) {
        var pages = await extractRows(c.files[0].bytes, c.progress);
        text = pages.map(function (r) { return r.map(function (x) { return x.text; }).join(' '); }).join(' ');
        name = stem(c.files[0].name) + '-summary';
        if (text.trim().length < 40) throw UserError('No selectable text was found in this PDF. If it is scanned, use "OCR scanned PDF" first, then paste the text here.');
      }
      if (!text) throw UserError('Choose a PDF or paste some text to summarise.');
      var res = summarize(text, +c.opts.count);
      if (!res.sentences.length) throw UserError('There is not enough text to summarise. Try a longer document.');
      return { kind: 'text', text: res.sentences.map(function (s) { return '• ' + s; }).join('\n\n'), name: name, summary: 'Top ' + res.sentences.length + ' of ' + res.total + ' sentences. These are original sentences from your text, so check them against the source.' };
    } }
];

/* =====================================================================
   Workspace UI
   ===================================================================== */
var state = { tool: null, files: [], opts: {}, result: null, busy: false, uid: 0, sign: null };

function toolById(id) { return TOOLS.filter(function (t) { return t.id === id; })[0] || null; }
function revokeFiles() { state.files.forEach(function (f) { if (f.url) URL.revokeObjectURL(f.url); }); }

function setTool(id, keepFiles) {
  var t = toolById(id); if (!t) return;
  var carry = keepFiles ? state.files : [];
  if (!keepFiles) revokeFiles();
  state.tool = t; state.files = carry; state.result = null; state.busy = false; state.sign = null;
  state.opts = Object.assign({}, t.defaults || {});
  var sel = $('toolSelect'); if (sel) sel.value = id;
  var bl = $('toolBlurb'); if (bl) bl.textContent = t.blurb;
  renderPanelBody();
}
function openTool(id, scroll) {
  setTool(id);
  if (scroll !== false) { var w = $('workspace'); if (w) w.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
  toast(toolById(id).name + ' is ready. Choose your file.');
}

function buildPanel() {
  var panel = $('panel'); if (!panel) return;
  var sel = h('select', { id: 'toolSelect', class: 'wk-select', 'aria-label': 'Choose a tool', onchange: function (e) { setTool(e.target.value); } },
    TOOLS.map(function (t) { return h('option', { value: t.id }, t.name); }));
  panel.replaceChildren(
    h('div', { class: 'wk-head' }, h('b', null, 'Work on your document'), sel),
    h('div', { id: 'wkBody' }));
}

function renderPanelBody() {
  var t = state.tool, body = $('wkBody'); if (!t || !body) return;
  var input = null, drop = null;
  if (t.kind !== 'none') {
    var accept = t.kind === 'pdf' ? ACCEPT_PDF : ACCEPT_IMG;
    input = h('input', { id: 'wkFile', type: 'file', hidden: true, accept: accept, multiple: !!t.multi, onchange: function (e) { addFiles(e.target.files); e.target.value = ''; } });
    var pick = h('button', { class: 'btn softbtn', id: 'pick', type: 'button', onclick: function () { if (window.Luvkaam.requireRegistration()) input.click(); } },
      t.multi ? 'Choose files' : 'Choose file');
    drop = h('div', { class: 'wk-drop', id: 'dropzone' },
      h('div', { class: 'glyph', 'aria-hidden': 'true' }, '⇧'),
      h('b', null, t.multi ? 'Drop your files here' : 'Drop your file here'),
      h('small', null, (t.kind === 'pdf' ? 'PDF' : 'JPG, PNG, WEBP, GIF or BMP') + ' · up to ' + MAX_MB + ' MB each' + (t.optionalFile ? ' · or paste text below' : '')),
      pick, input);
    ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (window.Luvkaam.requireRegistration()) addFiles(e.dataTransfer.files); });
  }
  body.replaceChildren.apply(body, [
    drop,
    h('div', { id: 'wkFiles' }),
    h('div', { id: 'wkText' }),
    h('div', { id: 'wkOpts' }),
    h('div', { id: 'wkCustom' }),
    h('div', { id: 'wkMsg', role: 'status', 'aria-live': 'polite' }),
    h('div', { class: 'wk-actions', id: 'wkActions' }),
    h('div', { id: 'wkStatus', class: 'wk-status', 'aria-live': 'polite' }),
    h('div', { id: 'wkResult' })].filter(Boolean));
  renderFiles(); renderText(); renderOptions(); renderCustom(); renderActions(); renderResult();
}

function showMsg(text, kind) {
  var m = $('wkMsg'); if (!m) return; m.replaceChildren();
  if (text) m.append(h('div', { class: 'wk-msg' + (kind ? ' ' + kind : ''), role: kind === 'err' ? 'alert' : null }, text));
}
function setProgress(v) { var b = $('wkBar'); if (b) { b.parentNode.hidden = (v == null); b.style.width = Math.round((v || 0) * 100) + '%'; } }
function setStatus(t) { var s = $('wkStatus'); if (s) s.textContent = t || ''; }

async function addFiles(list) {
  var t = state.tool, arr = Array.prototype.slice.call(list || []), errs = [], i, f, item, buf, info;
  if (!t || state.busy) return;
  if (!t.multi) arr = arr.slice(0, 1);
  for (i = 0; i < arr.length; i++) {
    f = arr[i];
    try {
      if (f.size > MAX_BYTES) throw UserError(f.name + ' is larger than ' + MAX_MB + ' MB.');
      if (f.size === 0) throw UserError(f.name + ' is empty.');
      if (t.kind === 'pdf') {
        if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) throw UserError(f.name + ' is not a PDF file.');
        buf = await f.arrayBuffer(); info = { pages: 0, locked: false };
        try { info = await probePdf(buf); }
        catch (e) { throw UserError(f.name + ' could not be read as a PDF. It may be damaged.'); }
        if (info.locked && t.id !== 'unlock') throw UserError(f.name + ' is password protected. Use Unlock PDF first.');
        item = { id: ++state.uid, name: f.name, size: f.size, bytes: buf, pages: info.pages, locked: info.locked };
      } else {
        if (!/^image\/(jpeg|png|webp|gif|bmp)$/.test(f.type) && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)) throw UserError(f.name + ' is not a supported image. Use JPG, PNG, WEBP, GIF or BMP.');
        item = { id: ++state.uid, name: f.name, size: f.size, file: f, url: URL.createObjectURL(f) };
      }
      if (!t.multi) { revokeFiles(); state.files = [item]; } else state.files.push(item);
    } catch (e) { errs.push(friendly(e)); }
  }
  state.result = null; state.sign = null;
  renderFiles(); renderOptions(); renderCustom(); renderActions(); renderResult();
  showMsg(errs.join(' '), errs.length ? 'err' : '');
}
function moveFile(i, d) { var j = i + d; if (j < 0 || j >= state.files.length) return; var x = state.files[i]; state.files[i] = state.files[j]; state.files[j] = x; state.result = null; renderFiles(); renderResult(); }
function removeFile(i) {
  var f = state.files.splice(i, 1)[0]; if (f && f.url) URL.revokeObjectURL(f.url);
  state.result = null; state.sign = null; showMsg('');
  renderFiles(); renderOptions(); renderCustom(); renderActions(); renderResult();
}

function renderFiles() {
  var box = $('wkFiles'); if (!box) return; box.replaceChildren();
  var t = state.tool; if (!state.files.length) return;
  box.append(h('ul', { class: 'wk-files' }, state.files.map(function (f, i) {
    var icon = f.url ? h('div', { class: 'fileicon', style: 'background:#eee;overflow:hidden;padding:0' }, h('img', { src: f.url, alt: '', style: 'width:100%;height:100%;object-fit:cover' })) : h('div', { class: 'fileicon' }, 'PDF');
    return h('li', { class: 'wk-file' }, icon,
      h('div', { class: 'filemeta' }, h('b', null, f.name), h('small', null, fmt(f.size) + (f.pages ? ' · ' + f.pages + (f.pages === 1 ? ' page' : ' pages') : '') + (f.locked ? ' · password protected' : ''))),
      h('div', { class: 'row-acts' },
        t.multi && state.files.length > 1 ? h('button', { class: 'mini', type: 'button', 'aria-label': 'Move ' + f.name + ' up', disabled: i === 0, onclick: function () { moveFile(i, -1); } }, '↑') : null,
        t.multi && state.files.length > 1 ? h('button', { class: 'mini', type: 'button', 'aria-label': 'Move ' + f.name + ' down', disabled: i === state.files.length - 1, onclick: function () { moveFile(i, 1); } }, '↓') : null,
        h('button', { class: 'mini', type: 'button', 'aria-label': 'Remove ' + f.name, onclick: function () { removeFile(i); } }, 'Remove')));
  })));
  if (t.min > 1 && state.files.length < t.min) box.append(h('p', { class: 'wk-note' }, 'Add at least ' + t.min + ' files.'));
}

function renderText() {
  var box = $('wkText'); if (!box) return; box.replaceChildren();
  var t = state.tool; if (!t.textInput) return;
  var key = t.textInput;
  box.append(h('div', { class: 'wk-field', style: 'margin-top:14px' },
    h('label', { for: 'wkTextArea' }, t.id === 'summarize' ? 'Or paste text to summarise' : 'Your text'),
    h('textarea', { id: 'wkTextArea', rows: t.id === 'summarize' ? 6 : 8, placeholder: t.id === 'summarize' ? 'Paste an article, report or any long text here' : 'Type or paste your text here', oninput: function (e) { state.opts[key] = e.target.value; renderActions(); } }, state.opts[key] || '')));
}

function renderOptions() {
  var box = $('wkOpts'); if (!box) return; box.replaceChildren();
  var t = state.tool, list = (t.options || []).filter(function (o) { return !o.show || o.show(state.opts); });
  var needsFile = t.kind !== 'none' && !t.optionalFile;
  if (!list.length || (needsFile && !state.files.length)) return;
  box.append(h('div', { class: 'wk-opts' }, list.map(optField)));
}
function optField(o) {
  var id = 'opt-' + o.key, ctrl, wide = o.wide || o.type === 'seg';
  if (o.type === 'select') {
    ctrl = h('select', { id: id, onchange: function (e) { state.opts[o.key] = e.target.value; renderOptions(); } },
      o.choices.map(function (c) { return h('option', { value: c[0], selected: state.opts[o.key] === c[0] }, c[1]); }));
  } else if (o.type === 'seg') {
    ctrl = h('div', { class: 'seg', role: 'group', 'aria-label': o.label, style: 'display:flex;flex-wrap:wrap;gap:6px' }, o.choices.map(function (c) {
      var on = state.opts[o.key] === c[0];
      return h('button', { type: 'button', class: 'mini', 'aria-pressed': String(on), style: on ? 'border-color:#6e55e8;background:#f0ebff;color:#3f2fb0' : '', onclick: function () { state.opts[o.key] = c[0]; renderOptions(); } }, c[1]);
    }));
  } else if (o.type === 'check') {
    return h('div', { class: 'wk-field wide' }, h('label', { class: 'wk-check', for: id },
      h('input', { id: id, type: 'checkbox', checked: !!state.opts[o.key], onchange: function (e) { state.opts[o.key] = e.target.checked; } }), h('span', null, o.label)));
  } else {
    ctrl = h('input', { id: id, type: o.type === 'password' ? 'password' : 'text', placeholder: o.placeholder, value: state.opts[o.key] || '', autocomplete: o.autocomplete || 'off', oninput: function (e) { state.opts[o.key] = e.target.value; } });
  }
  return h('div', { class: 'wk-field' + (wide ? ' wide' : '') },
    o.type === 'seg' ? h('div', { class: 'lab' }, o.label) : h('label', { for: id }, o.label), ctrl, o.help ? h('p', { class: 'help' }, o.help) : null);
}

function canRun() {
  var t = state.tool;
  if (state.busy) return false;
  if (t.kind === 'none') return String(state.opts[t.textInput] || '').trim().length > 0;
  if (t.optionalFile) return state.files.length > 0 || String(state.opts[t.textInput] || '').trim().length > 0;
  return state.files.length >= (t.min || 1);
}
function renderActions() {
  var box = $('wkActions'); if (!box) return; box.replaceChildren();
  box.append(
    h('button', { class: 'btn primary', id: 'wkRun', type: 'button', disabled: !canRun(), onclick: run }, state.busy ? 'Working…' : state.tool.cta),
    h('div', { class: 'wk-bar', hidden: true, role: 'progressbar', 'aria-label': 'Progress' }, h('i', { id: 'wkBar' })));
  if (state.busy) setProgress(0.03);
}
async function run() {
  if (state.busy || !canRun()) return;
  if (!window.Luvkaam.requireRegistration()) return;
  var t = state.tool;
  showMsg(''); setStatus(''); state.busy = true; state.result = null; renderActions(); renderResult();
  try {
    state.result = await t.run({ files: state.files.slice(), opts: Object.assign({}, state.opts), progress: setProgress, status: setStatus, sign: state.sign });
  } catch (e) {
    if (!(e && e.name === 'UserError')) console.error(e);
    showMsg(friendly(e), 'err');
  }
  state.busy = false; setStatus(''); setProgress(null); renderActions(); renderResult();
  var r = $('wkResult'); if (r && state.result) r.scrollIntoView({ block: 'nearest' });
}

function renderResult() {
  var box = $('wkResult'); if (!box) return; box.replaceChildren();
  var r = state.result; if (!r) return;
  if (r.kind === 'nochange') { box.append(h('div', { class: 'wk-result' }, h('div', { class: 'wk-msg' }, r.summary))); return; }
  if (r.kind === 'files') {
    box.append(h('div', { class: 'wk-result' },
      h('p', { class: 'sum' }, 'Done. ' + (r.summary || '')),
      h('div', { class: 'wk-dl' }, r.files.map(function (f) {
        return h('button', { class: 'btn primary', type: 'button', onclick: function () { download(f.blob, f.name); } }, 'Download ' + f.name.replace(/^.*\./, '.').toUpperCase().replace('.', '') + ' · ' + (f.name.length > 28 ? f.name.slice(0, 25) + '…' : f.name));
      }), h('button', { class: 'btn', type: 'button', onclick: function () { resetFiles(); } }, 'Start over'))));
    return;
  }
  if (r.kind === 'text') {
    var ta = h('textarea', { id: 'wkOut', rows: 8, 'aria-label': 'Result text' }, r.text);
    var kids = [];
    if (r.message) kids.push(h('div', { class: 'wk-msg' }, r.message));
    if (r.summary) kids.push(h('p', { class: 'sum' }, r.summary));
    if (r.text) kids.push(ta);
    var acts = [];
    if (r.text) {
      acts.push(h('button', { class: 'btn primary', type: 'button', onclick: function () { download(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }), (r.name || 'text') + '.txt'); } }, 'Download .txt'));
      acts.push(h('button', { class: 'btn', type: 'button', onclick: async function () { try { await navigator.clipboard.writeText(ta.value); toast('Text copied.'); } catch (e) { ta.select(); toast('Text selected. Copy it from your device menu.'); } } }, 'Copy text'));
    }
    if (r.suggest) acts.push(h('button', { class: 'btn primary', type: 'button', onclick: function () { setTool(r.suggest, true); } }, 'Open OCR scanned PDF with this file'));
    acts.push(h('button', { class: 'btn', type: 'button', onclick: function () { resetFiles(); } }, 'Start over'));
    kids.push(h('div', { class: 'wk-dl' }, acts));
    box.append(h('div', { class: 'wk-result' }, kids));
  }
}
function resetFiles() { revokeFiles(); state.files = []; state.result = null; state.sign = null; showMsg(''); renderFiles(); renderText(); renderOptions(); renderCustom(); renderActions(); renderResult(); }

/* ---------- sign tool UI ---------- */
function renderCustom() {
  var box = $('wkCustom'); if (!box) return; box.replaceChildren();
  var t = state.tool; if (t.custom !== 'sign' || !state.files.length) return;
  var file = state.files[0];
  var S = state.sign = state.sign || { sig: null, page: 0, fx: 0.7, fy: 0.85, placed: false, all: false, widthPct: 28, doc: null, mode: 'draw' };
  var pad = h('canvas', { class: 'sig-pad', id: 'sigPad', width: 840, height: 300, 'aria-label': 'Signature drawing area' });
  var typed = h('input', { id: 'sigText', type: 'text', maxlength: '40', placeholder: 'Type your name', style: 'display:none;max-width:420px;border:1px solid #cfc8de;border-radius:10px;padding:10px 11px;font-size:16px' });
  var stage = h('div', { class: 'sig-stage', id: 'sigStage', role: 'button', tabindex: '0', 'aria-label': 'PDF page preview. Click to place the signature.' });
  var info = h('div', { class: 'wk-note', id: 'sigInfo' }, '');
  var pageLabel = h('span', { id: 'sigPageLabel', class: 'wk-note', style: 'margin:0' }, '');
  var ctx = pad.getContext('2d'), drawing = false, last = null, hasInk = false;
  ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  function pos(e) { var r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height }; }
  pad.addEventListener('pointerdown', function (e) { drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x + 0.1, last.y + 0.1); ctx.stroke(); hasInk = true; e.preventDefault(); });
  pad.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; });
  ['pointerup', 'pointercancel'].forEach(function (n) { pad.addEventListener(n, function () { drawing = false; }); });

  function trimmed(src) {
    var w = src.width, hh = src.height, d = src.getContext('2d').getImageData(0, 0, w, hh).data, x0 = w, y0 = hh, x1 = 0, y1 = 0, x, y;
    for (y = 0; y < hh; y++) for (x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0 || y1 <= y0) return null;
    var m = 8, c = document.createElement('canvas'); c.width = x1 - x0 + 1 + m * 2; c.height = y1 - y0 + 1 + m * 2;
    c.getContext('2d').drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, m, m, x1 - x0 + 1, y1 - y0 + 1);
    return c;
  }
  async function useSignature() {
    var src = pad;
    if (S.mode === 'type') {
      var txt = typed.value.trim(); if (!txt) { showMsg('Type your name first.', 'err'); return; }
      src = document.createElement('canvas'); src.width = 1000; src.height = 260;
      var c2 = src.getContext('2d'); c2.fillStyle = '#111'; c2.textBaseline = 'middle';
      var size = 120; c2.font = 'italic ' + size + 'px "Segoe Script","Brush Script MT","Snell Roundhand","Lucida Handwriting",cursive';
      while (c2.measureText(txt).width > 940 && size > 30) { size -= 6; c2.font = 'italic ' + size + 'px "Segoe Script","Brush Script MT","Snell Roundhand","Lucida Handwriting",cursive'; }
      c2.fillText(txt, 30, 130);
    } else if (!hasInk) { showMsg('Draw your signature in the box first.', 'err'); return; }
    var tr = trimmed(src); if (!tr) { showMsg('The signature is empty.', 'err'); return; }
    var blob = await canvasBlob(tr, 'image/png');
    S.sig = { bytes: await blob.arrayBuffer(), w: tr.width, h: tr.height, url: URL.createObjectURL(blob) };
    showMsg('Signature ready. Click on the page preview to place it.', 'ok');
    updateMark();
  }
  var tabs = h('div', { class: 'wk-pages', role: 'group', 'aria-label': 'Signature type' },
    ['draw', 'type'].map(function (m) {
      return h('button', { type: 'button', class: 'mini', 'aria-pressed': String(S.mode === m), style: S.mode === m ? 'border-color:#6e55e8;background:#f0ebff;color:#3f2fb0' : '', onclick: function () { S.mode = m; renderCustom(); } }, m === 'draw' ? 'Draw' : 'Type');
    }));
  pad.style.display = S.mode === 'draw' ? 'block' : 'none'; typed.style.display = S.mode === 'type' ? 'block' : 'none';
  var clear = h('button', { type: 'button', class: 'mini', onclick: function () { ctx.clearRect(0, 0, pad.width, pad.height); hasInk = false; S.sig = null; updateMark(); } }, 'Clear');
  var use = h('button', { type: 'button', class: 'btn softbtn', onclick: useSignature }, 'Use signature');
  var size = h('input', { id: 'sigSize', type: 'range', min: '10', max: '60', value: String(S.widthPct), 'aria-label': 'Signature size', oninput: function (e) { S.widthPct = +e.target.value; updateMark(); } });
  var allPages = h('input', { id: 'sigAll', type: 'checkbox', checked: !!S.all, onchange: function (e) { S.all = e.target.checked; } });
  var prev = h('button', { type: 'button', class: 'mini', 'aria-label': 'Previous page', onclick: function () { if (S.page > 0) { S.page--; drawPage(); } } }, '←');
  var next = h('button', { type: 'button', class: 'mini', 'aria-label': 'Next page', onclick: function () { if (S.page < file.pages - 1) { S.page++; drawPage(); } } }, '→');
  box.append(h('div', { class: 'sig-box' },
    h('div', { class: 'wk-note', style: 'margin:0;font-weight:700' }, '1. Create your signature'), tabs, pad, typed, h('div', { class: 'wk-pages' }, use, clear),
    h('div', { class: 'wk-note', style: 'margin:6px 0 0;font-weight:700' }, '2. Click the page where it should go'),
    h('div', { class: 'wk-pages' }, prev, pageLabel, next),
    stage, info,
    h('div', { class: 'wk-field', style: 'max-width:320px' }, h('label', { for: 'sigSize' }, 'Signature size'), size),
    h('label', { class: 'wk-check', for: 'sigAll' }, allPages, h('span', null, 'Put the signature on every page'))));

  function placeMark(ev) {
    var r = stage.getBoundingClientRect(); S.fx = clamp((ev.clientX - r.left) / r.width, 0, 1); S.fy = clamp((ev.clientY - r.top) / r.height, 0, 1); S.placed = true; updateMark();
  }
  stage.addEventListener('click', placeMark);
  stage.addEventListener('keydown', function (e) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return; e.preventDefault(); S.placed = true;
    S.fx = clamp(S.fx + (e.key === 'ArrowRight' ? 0.03 : e.key === 'ArrowLeft' ? -0.03 : 0), 0, 1); S.fy = clamp(S.fy + (e.key === 'ArrowDown' ? 0.03 : e.key === 'ArrowUp' ? -0.03 : 0), 0, 1); updateMark();
  });
  function updateMark() {
    var old = stage.querySelector('.sig-mark'); if (old) old.remove();
    if (!S.sig || !S.placed) { info.textContent = S.sig ? 'Click on the page to place your signature. You can also use the arrow keys.' : ''; return; }
    var cv = stage.querySelector('canvas'); if (!cv) return;
    var wPct = S.widthPct, hPct = (cv.clientWidth * wPct / 100 * S.sig.h / S.sig.w) / cv.clientHeight * 100;
    var m = h('div', { class: 'sig-mark', style: 'width:' + wPct + '%;height:' + hPct + '%;left:' + (S.fx * 100 - wPct / 2) + '%;top:' + (S.fy * 100 - hPct / 2) + '%' }, h('img', { src: S.sig.url, alt: '' }));
    stage.append(m); info.textContent = 'Placed on page ' + (S.page + 1) + '. Click elsewhere to move it.';
  }
  async function drawPage() {
    pageLabel.textContent = 'Page ' + (S.page + 1) + ' of ' + file.pages;
    try {
      if (!S.doc) S.doc = await openPdf(file.bytes);
      var page = await S.doc.getPage(S.page + 1), r = await renderPageCanvas(page, 1400, 1.5);
      r.canvas.style.width = '100%'; r.canvas.style.maxWidth = '440px';
      var old = stage.querySelector('canvas'); if (old) old.remove(); stage.prepend(r.canvas); page.cleanup();
      if (page.rotate) info.textContent = 'This page is rotated. The signature may land in a different spot than the preview.';
      updateMark();
    } catch (e) { info.textContent = 'The page preview could not be drawn.'; }
  }
  drawPage();
}

/* ---------- boot ---------- */
function init() {
  if (!$('panel')) return;
  buildPanel();
  document.querySelectorAll('[data-tool]').forEach(function (b) { b.addEventListener('click', function () { openTool(b.getAttribute('data-tool')); }); });
  document.querySelectorAll('[data-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      var f = b.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach(function (x) { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      document.querySelectorAll('.tool').forEach(function (c) { c.style.display = (f === 'all' || c.getAttribute('data-cats').split(' ').indexOf(f) >= 0) ? 'flex' : 'none'; });
    });
  });
  setTool('image');
}
window.LuvkaamTools = { openTool: openTool, list: TOOLS, _lib: lib, _internals: { summarize: summarize, rowsToParagraphs: rowsToParagraphs, groupLines: groupLines, rowCells: rowCells } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
