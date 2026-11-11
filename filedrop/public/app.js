const $ = s => document.querySelector(s);
const KEY = 'filedrop:mine';
const mine = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const store = l => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {} };
const fmt = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const showErr = t => { $('#err').textContent = t || ''; };
let cfg = { requiresPassword: false, maxMb: 100, expireDays: 0 };

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  kids.forEach(k => e.append(k));
  return e;
}

function renderItem(f, bar) {
  const box = el('div', { className: 'item' });
  box.append(el('b', { textContent: f.name }));
  const exp = f.expiresAt ? ' · expires ' + new Date(f.expiresAt).toLocaleDateString() : '';
  box.append(el('small', { textContent: fmt(f.size) + exp }));
  if (bar) { box.append(bar); return box; }
  const input = el('input', { type: 'text', readOnly: true, value: f.url });
  input.addEventListener('focus', () => input.select());
  const copy = el('button', { textContent: 'Copy link' });
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(f.url); } catch { input.select(); document.execCommand('copy'); }
    copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy link', 1500);
  };
  box.append(el('div', { className: 'linkrow' }, input, copy));
  const qrBox = el('div', { className: 'qr', hidden: true });
  const qrBtn = el('button', { className: 'ghost', textContent: 'Show QR code' });
  qrBtn.onclick = () => {
    if (!qrBox.firstChild) qrBox.append(el('img', { src: `/api/qr/${f.id}.png`, alt: 'QR code for the link' }));
    qrBox.hidden = !qrBox.hidden;
    qrBtn.textContent = qrBox.hidden ? 'Show QR code' : 'Hide QR code';
  };
  const del = el('button', { className: 'danger', textContent: 'Delete' });
  del.onclick = async () => {
    if (!confirm('Delete ' + f.name + '? The link will stop working.')) return;
    const r = await fetch('/api/file/' + f.id, { method: 'DELETE', headers: { 'x-delete-token': f.deleteToken } });
    if (r.ok || r.status === 404) { store(mine().filter(x => x.id !== f.id)); box.remove(); }
    else showErr('Could not delete the file.');
  };
  box.append(el('div', { className: 'actions' }, qrBtn, del), qrBox);
  return box;
}

function uploadOne(file) {
  if (file.size > cfg.maxMb * 1048576) { showErr(`${file.name} is over ${cfg.maxMb} MB.`); return; }
  const fill = el('i');
  const box = renderItem({ name: file.name, size: file.size }, el('div', { className: 'bar' }, fill));
  $('#list').prepend(box);
  const fd = new FormData(); fd.append('files', file);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  if (cfg.requiresPassword) xhr.setRequestHeader('x-upload-password', $('#pw').value);
  xhr.upload.onprogress = e => { if (e.lengthComputable) fill.style.width = (e.loaded / e.total * 100) + '%'; };
  xhr.onload = () => {
    let data = {}; try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status === 200 && data.files) {
      const f = data.files[0];
      store([f, ...mine()]);
      box.replaceWith(renderItem(f));
    } else { box.remove(); showErr(data.error || 'Upload failed.'); }
  };
  xhr.onerror = () => { box.remove(); showErr('Network error. Try again.'); };
  xhr.send(fd);
}

function handle(files) {
  showErr('');
  if (cfg.requiresPassword && !$('#pw').value) { showErr('Enter the upload password first.'); return; }
  [...files].forEach(uploadOne);
}

(async function init() {
  try { cfg = await (await fetch('/api/config')).json(); } catch {}
  $('#hint').textContent = `Up to ${cfg.maxMb} MB per file` + (cfg.expireDays ? ` · links last ${cfg.expireDays} days` : '');
  $('#pwbox').hidden = !cfg.requiresPassword;
  const drop = $('#drop'), inp = $('#inp');
  inp.onchange = () => { handle(inp.files); inp.value = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files); };
  // Show earlier uploads from this browser, dropping any that no longer exist
  const alive = [];
  for (const f of mine()) {
    try { if ((await fetch('/api/file/' + f.id)).ok) alive.push(f); } catch { alive.push(f); }
  }
  store(alive);
  if (alive.length) {
    $('#list').append(el('h2', { textContent: 'Your uploads' }));
    alive.forEach(f => $('#list').append(renderItem(f)));
  }
})();
