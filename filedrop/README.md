# FileDrop

Upload a file, get a link, open it on any device and download it.

- Upload by click or drag and drop, with a progress bar
- Short share link (`/f/abc123`), a download page, and a QR code for phones
- Any file type, always forced as a download (never rendered in the browser)
- Optional upload password, file size limit, and auto-expiry
- No database: files and a small `meta.json` live in one data folder

## Run locally
```bash
npm install
npm start          # http://localhost:3000
```

## Settings (environment variables)
| Name | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `DATA_DIR` | ./data | Where files are stored (must be persistent) |
| `MAX_FILE_MB` | 100 | Max size per file |
| `EXPIRE_DAYS` | 0 | Delete files after N days (0 = keep forever) |
| `UPLOAD_PASSWORD` | empty | If set, uploading needs this password. Downloading never does. |

## Deploy from GitHub
GitHub Pages cannot run this: it only hosts static pages and has nowhere to store uploads. Push the code to GitHub, then connect the repo to a host that runs Node/Docker.

```bash
git init && git add . && git commit -m "FileDrop"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/filedrop.git
git push -u origin main
```

**Render:** New > Blueprint > select the repo. `render.yaml` sets up a 5 GB persistent disk (needs a paid instance). Add `UPLOAD_PASSWORD` when asked.

**Railway / Fly.io:** deploy the repo (the Dockerfile is detected), attach a volume mounted at `/data`, and set `DATA_DIR=/data`.

Important: on free plans without a volume, the disk is wiped on every restart or redeploy and your links will break. Always mount a persistent volume.

## Security notes
Set `UPLOAD_PASSWORD` on a public deployment, otherwise anyone can fill your disk. Anyone with a link can download that file, so treat links like secrets. Only the browser that uploaded a file can delete it.
