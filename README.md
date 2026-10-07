# FTPGit Studio

FTPGit Studio is a local **FTP / FTPS / SFTP** client with an **SSH terminal** and **Git push-to-deploy**.
When you push to `main`, the app uploads the changed files of the folders you map to your server. It can then run a command over SSH, if you set one.

## Features

**File explorer (FTP, FTPS, SFTP)**
- Browse files with breadcrumbs, back/forward, sortable columns, a filter, and file-type icons.
- Upload by drag and drop: whole folders, or files dropped onto a sub-folder row. You can also pick files or a folder. Live progress shows in the Transfers panel.
- Download, rename or move, delete (recursive), create a new folder or a new file, chmod, and copy a path.
- Edit text files in place: `Ctrl+S` saves, `Tab` indents.
- Drag rows onto a folder to move them.
- Keyboard: `Del`, `F2`, `Enter`, `Backspace`, `Ctrl+A`, `F5`, `Alt+←/→`, arrow keys.
- Right-click context menus. Dark and light themes.

**SSH**
- SFTP authentication by password, pasted private key, or key file path (`~/.ssh/id_ed25519`), with an optional passphrase. The SSH agent is also supported.
- Host keys are checked with **trust on first use**: the SHA256 fingerprint is saved on the first connection. If the server key changes, the connection is blocked with a warning until you choose to trust the new key.
- **Built-in terminal** (xterm.js), docked under the explorer. It has tabs, can be resized and maximized, and offers *Open terminal here* on any folder.
- **Post-deploy command** per repository, for example `composer install`, `npm ci`, or clearing a cache. It runs over SSH after each Git deploy, and its output goes into the deploy log.

**Session that never asks for your password again**
- Credentials and keys are encrypted with AES-256-GCM under `data/`.
- After **10 minutes of inactivity** the connection closes. You can change this time in Settings. The next action reconnects silently, and a live countdown shows in the header. An idle terminal reconnects when you press a key.
- A keep-alive runs while you are active. If the server drops the connection, the app reconnects automatically.
- When you reload the page, you return to the same server and folder.

**Git → server deploy**
- Add a repository from its local folder or its remote URL. Choose the branch (default `main`) and the connection (FTP, FTPS or SFTP).
- **Folder mappings**: `dist → /public_html`, `api → /public_html/api`, and so on, plus exclude patterns.
- Only changed files are uploaded (`git diff`). Files deleted in git are deleted on the server. You can turn this off per mapping.
- The app detects pushes by `git ls-remote` polling. An optional **pre-push hook** makes a deploy start seconds after `git push`.
- The app shows a live progress bar, the deployment history, and full logs. *Sync now*, *Redeploy all* and *Mark as deployed* are available.
- Deploys come from a private clone, so uncommitted work is never uploaded and line endings are kept byte for byte.

**Activity log**: shows every connection, transfer, SSH command, and deploy, with filters and search.

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

1. Click **+** next to *Connections* and pick the connection type. **SSH** is the default. If you only have a host, a user and a password, fill in those three fields. You can also paste `user@host:port` into *Host*, and the app splits it into the right fields for you. Click **Test connection**, then **Save**. An SSH key is optional; it is under *Use an SSH key instead of a password*.
2. Browse and manage files in **File Explorer**. Drag files from your desktop into the window to upload them. For SFTP, click **Terminal** in the header to open a shell.
3. Open **Git Deploy** and click **Add repository**:
   - Enter your project folder, for example `D:\Projects\my-site`. You can also enter a remote URL. Click **Inspect**.
   - Select the connection and add mappings. Each mapping goes from a repository folder to a server folder; click the folder icon to browse the server.
   - Optionally, set an **After deploy (SSH)** command.
   - Keep **Install git pre-push hook** checked for instant deploys.
4. Run `git push origin main`. The changed files appear on the server, and the deploy shows in *Deployment history*.

## Try it without a real server

```bash
node test/dev-sftp.js
```

This starts a local SFTP + SSH server on `127.0.0.1:2222`. The user is `demo` and the password is `demo`.

```bash
node test/dev-ftp.js
```

This starts a local FTP server on `127.0.0.1:2121`, with the same user and password.

## Tests

```bash
npm test
```

The end-to-end test starts a real FTP server, a real SFTP/SSH server, and a bare Git remote. It checks 40 scenarios through the HTTP API and the terminal WebSocket:
- **File operations, FTP and SFTP:** upload, edit, download, rename (including overwrite), chmod, and recursive delete.
- **Sessions:** idle disconnect followed by a silent reconnect, and recovery after a dropped socket.
- **SSH:** password, pasted-key, and key-file authentication; rejection of a wrong key; host-key change detection; exec; and the terminal round-trip and its origin check.
- **Git deploy:** baseline, full deploy, a deploy triggered by the pre-push hook, polling, branch filtering, excludes, deploy over SFTP, and the post-deploy command, both success and failure.

## Data and security

- All data is stored in `data/`: `db.json`, `secret.key` (encryption key), the private repository clones, and temporary upload files. Keep this folder private and do not commit it. It is in `.gitignore`.
- The server listens on `127.0.0.1` only. It rejects requests whose `Host` header is foreign, and terminal WebSockets that come from another origin. There is no login, because the app is meant for one user on a local machine.
- Passwords, keys and tokens are never sent back to the browser.
- See [QUESTIONS.md](QUESTIONS.md) for the design decisions and their reasons.

## Project layout

```
server/index.js        HTTP API + static UI
server/remote.js       protocol adapters: FTP/FTPS (basic-ftp) and SFTP/SSH (ssh2)
server/ftpManager.js   sessions: queue, idle disconnect, keep-alive, auto-reconnect, host-key trust
server/terminal.js     WebSocket <-> SSH shell bridge for the web terminal
server/gitSync.js      git polling, diff, mapping/exclude planner, deploy, push hook, post-deploy command
server/store.js        JSON store + AES-256-GCM secrets
server/events.js       Server-Sent Events + activity log
public/                UI (vanilla JS, no build step; xterm.js served from node_modules)
test/e2e.js            end-to-end test
test/dev-sftp.js       local SFTP/SSH server for trying the app
test/dev-ftp.js        local FTP server for trying the app
```
