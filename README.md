# FTPGit Studio

FTPGit Studio is a local FTP client with a clean, professional interface and **Git push-to-deploy**.
When you push to `main`, the app uploads the changed files of the folders you map to your FTP server.

## Features

**File explorer (FTP / FTPS)**
- Browse files with breadcrumbs, back/forward, sortable columns, a filter, and file-type icons.
- Upload by drag and drop: whole folders, or files dropped onto a sub-folder row. You can also pick files or a folder. Live progress shows in the Transfers panel.
- Download, rename or move, delete (recursive), create a new folder or a new file, chmod, and copy a path.
- Edit text files in place: `Ctrl+S` saves, `Tab` indents.
- Drag rows onto a folder to move them.
- Keyboard: `Del`, `F2`, `Enter`, `Backspace`, `Ctrl+A`, `F5`, `Alt+←/→`, arrow keys.
- Right-click context menus. Dark and light themes.

**Session that never asks for your password again**
- Credentials are encrypted with AES-256-GCM under `data/`.
- After **10 minutes of inactivity** the FTP socket closes. You can change this time in Settings. The next action reconnects silently, and a live countdown shows in the header.
- A keep-alive NOOP runs while you are active. If the server drops the connection, the app reconnects automatically.
- When you reload the page, you return to the same server and folder.

**Git → FTP deploy**
- Add a repository from its local folder or its remote URL. Choose the branch (default `main`) and the FTP connection.
- **Folder mappings**: `dist → /public_html`, `api → /public_html/api`, and so on, plus exclude patterns.
- Only changed files are uploaded (`git diff`). Files deleted in git are deleted on FTP. You can turn this off per mapping.
- The app detects pushes by `git ls-remote` polling. An optional **pre-push hook** makes a deploy start seconds after `git push`.
- The app shows a live progress bar, the deployment history, and full logs. *Sync now*, *Redeploy all* and *Mark as deployed* are available.
- Deploys come from a private clone, so uncommitted work is never uploaded and line endings are kept byte for byte.

**Activity log**: shows every connection, transfer, and deploy, with filters and search.

## Requirements

- Node.js 18 or later
- Git, on your PATH

## Run

```bash
npm install
npm start
```

`npm start` opens <http://127.0.0.1:4280>. On Windows, you can also double-click `start.bat`.
To start without opening a browser, run `npm run serve`. To use another port, set `PORT=5000`.

## Use

1. Click **+** next to *Connections*. Enter the host, port, protocol, user and password. Click **Test connection**, then **Save**.
2. Browse and manage files in **File Explorer**. Drag files from your desktop into the window to upload them.
3. Open **Git Deploy** and click **Add repository**:
   - Enter your project folder, for example `D:\Projects\my-site`. You can also enter a remote URL. Click **Inspect**.
   - Select the FTP connection and add mappings. Each mapping goes from a repository folder to an FTP folder; click the folder icon to browse the FTP server.
   - Keep **Install git pre-push hook** checked for instant deploys.
4. Run `git push origin main`. The changed files appear on the FTP server, and the deploy shows in *Deployment history*.

## Try it without a real server

```bash
node test/dev-ftp.js
```

This starts a local FTP server on `127.0.0.1:2121`. The user is `demo` and the password is `demo`.

## Tests

```bash
npm test
```

The end-to-end test starts a real FTP server and a bare Git remote, then checks the following through the HTTP API:
- connect, upload, list, edit, download, rename, and delete;
- idle disconnect followed by a silent reconnect, and recovery after a dropped socket;
- baseline, full deploy, an incremental deploy triggered by the pre-push hook, polling, branch filtering, excludes, and cleanup.

## Data and security

- All data is stored in `data/`: `db.json`, `secret.key` (encryption key), the private repository clones, and temporary upload files. Keep this folder private and do not commit it. It is in `.gitignore`.
- The server listens on `127.0.0.1` only and rejects requests whose `Host` header is foreign. There is no login, because the app is meant for one user on a local machine.
- See [QUESTIONS.md](QUESTIONS.md) for the design decisions and their reasons.

## Project layout

```
server/index.js        HTTP API + static UI
server/ftpManager.js   FTP sessions: queue, idle disconnect, keep-alive, auto-reconnect
server/gitSync.js      git polling, diff, mapping/exclude planner, deploy, push hook
server/store.js        JSON store + AES-256-GCM secrets
server/events.js       Server-Sent Events + activity log
public/                UI (vanilla JS, no build step)
test/e2e.js            end-to-end test
test/dev-ftp.js        local FTP server for trying the app
```
