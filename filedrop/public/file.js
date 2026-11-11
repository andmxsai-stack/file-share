const id = location.pathname.split('/').pop();
const fmt = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
fetch('/api/file/' + encodeURIComponent(id)).then(async r => {
  if (!r.ok) throw 0;
  const f = await r.json();
  document.title = f.name;
  document.getElementById('name').textContent = f.name;
  document.getElementById('info').textContent = fmt(f.size) +
    (f.expiresAt ? ' · available until ' + new Date(f.expiresAt).toLocaleDateString() : '');
  const a = document.getElementById('dl');
  a.href = '/d/' + encodeURIComponent(id); a.hidden = false;
}).catch(() => {
  document.getElementById('name').textContent = 'File not found';
  document.getElementById('err').textContent = 'This link is wrong, or the file was deleted or has expired.';
});
