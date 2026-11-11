const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---- Config (all via environment variables) --------------------------------
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 100;   // per file
const EXPIRE_DAYS = Number(process.env.EXPIRE_DAYS) || 0;     // 0 = never expire
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || '';    // empty = anyone can upload

const FILES_DIR = path.join(DATA_DIR, 'files');
const META_FILE = path.join(DATA_DIR, 'meta.json');
fs.mkdirSync(FILES_DIR, { recursive: true });

// ---- Tiny metadata store (JSON file) ---------------------------------------
let meta = {};
try { meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { meta = {}; }
function saveMeta() {
  const tmp = META_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(meta));
  fs.renameSync(tmp, META_FILE);
}
const ID_RE = /^[A-Za-z0-9_-]{6,16}$/;
const newId = () => crypto.randomBytes(6).toString('base64url');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function getFile(id) {
  if (!ID_RE.test(id)) return null;
  const f = meta[id];
  if (!f) return null;
  if (f.expiresAt && Date.now() > f.expiresAt) { removeFile(id); return null; }
  return f;
}
function removeFile(id) {
  delete meta[id];
  saveMeta();
  fs.unlink(path.join(FILES_DIR, id), () => {});
}
function cleanExpired() {
  const now = Date.now();
  for (const id of Object.keys(meta)) {
    if (meta[id].expiresAt && now > meta[id].expiresAt) removeFile(id);
  }
}
setInterval(cleanExpired, 60 * 60 * 1000).unref();
cleanExpired();

// Browsers send UTF-8 names that busboy may hand over as latin1; repair if needed.
function fixName(name) {
  if ([...name].every(c => c.charCodeAt(0) <= 255)) {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (!fixed.includes('\uFFFD')) name = fixed;
  }
  return name.replace(/[\\/\0-\x1f]/g, '_').slice(0, 200) || 'file';
}

// ---- App -------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
  next();
});

const storage = multer.diskStorage({
  destination: FILES_DIR,
  filename: (req, file, cb) => cb(null, newId()),
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 10 } });
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many uploads. Try again later.' },
});

const origin = req => `${req.protocol}://${req.get('host')}`;

app.get('/api/config', (req, res) => {
  res.json({ requiresPassword: !!UPLOAD_PASSWORD, maxMb: MAX_FILE_MB, expireDays: EXPIRE_DAYS });
});

function checkPassword(req, res, next) {
  if (UPLOAD_PASSWORD && !safeEqual(req.get('x-upload-password') || '', UPLOAD_PASSWORD)) {
    return res.status(401).json({ error: 'Wrong or missing upload password.' });
  }
  next();
}

app.post('/api/upload', uploadLimiter, checkPassword, upload.array('files', 10), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No file received.' });
  const out = req.files.map(f => {
    const id = f.filename;
    const deleteToken = crypto.randomBytes(16).toString('hex');
    meta[id] = {
      name: fixName(f.originalname), size: f.size, uploadedAt: Date.now(),
      expiresAt: EXPIRE_DAYS ? Date.now() + EXPIRE_DAYS * 864e5 : null,
      deleteToken,
    };
    return { id, name: meta[id].name, size: f.size, expiresAt: meta[id].expiresAt,
             url: `${origin(req)}/f/${id}`, deleteToken };
  });
  saveMeta();
  res.json({ files: out });
});

app.get('/api/file/:id', (req, res) => {
  const f = getFile(req.params.id);
  if (!f) return res.status(404).json({ error: 'File not found or expired.' });
  res.json({ id: req.params.id, name: f.name, size: f.size, uploadedAt: f.uploadedAt, expiresAt: f.expiresAt });
});

app.delete('/api/file/:id', (req, res) => {
  const f = getFile(req.params.id);
  if (!f) return res.status(404).json({ error: 'File not found.' });
  if (!safeEqual(req.get('x-delete-token') || '', f.deleteToken)) {
    return res.status(403).json({ error: 'Not allowed.' });
  }
  removeFile(req.params.id);
  res.json({ ok: true });
});

app.get('/api/qr/:id.png', async (req, res) => {
  if (!getFile(req.params.id)) return res.status(404).end();
  const png = await QRCode.toBuffer(`${origin(req)}/f/${req.params.id}`, { width: 240, margin: 1 });
  res.type('png').send(png);
});

// Direct download (always forced as an attachment, never rendered in the browser)
app.get('/d/:id', (req, res) => {
  const f = getFile(req.params.id);
  if (!f) return res.status(404).send('File not found or expired.');
  res.download(path.join(FILES_DIR, req.params.id), f.name);
});

// Landing page for a shared link
app.get('/f/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'file.html')));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is over ${MAX_FILE_MB} MB.` : err.message;
    return res.status(413).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

app.listen(PORT, () => console.log(`FileDrop running on port ${PORT}`));
