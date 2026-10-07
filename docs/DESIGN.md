# Design notes

This document explains how FTPGit Studio behaves, and why. Most of these choices can be changed in the UI.

## Architecture

| Decision | Choice and reason |
|---|---|
| Desktop app or local web app? | **Local web app.** A Node.js server listens on `127.0.0.1:4280` and the UI opens in your browser. There is no native build step, it starts in under a second, and it works the same on Windows, macOS and Linux. |
| Protocols | **FTP, FTPS (explicit and implicit TLS), and SSH.** SSH connections use SFTP for files and a shell channel for the terminal. All protocols share one adapter interface (`server/remote.js`), so the explorer, uploads and deploys work the same everywhere. |
| SSH library | **ssh2**, which is pure JavaScript and needs no native build on Windows. It provides SFTP, `exec` and interactive shells. xterm.js is served from `node_modules`, so the terminal also works offline. |
| Storage | A JSON file (`data/db.json`) with atomic writes. Secrets are encrypted with AES-256-GCM, using a random key stored in `data/secret.key`. |

## Sessions

| Decision | Choice and reason |
|---|---|
| What does "never log in again" mean? | The app has no login screen and no session expiry. Connections are saved with their password or key encrypted. When you reload the page, it reopens the same server and folder. |
| Idle disconnect | After **10 minutes without user action** (configurable), the connection is closed and the status shows *Sleeping (idle)*. The next action reconnects silently with the stored credentials. While you are active, a keep-alive stops servers from dropping you earlier. If a server drops the socket anyway, the app reconnects and retries once. Idle terminals behave the same way: press a key to reconnect. |
| Separate transfer connections | Uploads, downloads and deployments use their own short-lived connection, so browsing stays responsive during long transfers. |
| Updated code, old server | Node keeps running the code it started with. The UI checks `/api/version` and shows a *restart* banner when the files on disk are newer than the running server. |

## SSH specifics

| Decision | Choice and reason |
|---|---|
| Host key verification | **Trust on first use**, like OpenSSH. The SHA256 fingerprint is saved on the first successful connection. If it changes later, the connection is refused and you see a warning and an explicit *Trust new host key* action. If you change the host or port, the app learns the key again. |
| Authentication | The app first asks the server which methods it accepts. It then tries, in order: SSH agent, private key, password, then keyboard-interactive, which it answers with the password. When login fails, it reports the accepted methods, what was tried, any prompts (such as a one-time code), and the most likely cause. |
| `/` versus home folder | Over SFTP, `/` is the real filesystem root, which shared hosting often does not let you read. **`~` means your home folder everywhere**: start folder, explorer, mapping targets, post-deploy folder and terminal. Paths without a leading `/` are also relative to the home folder. SSH connections start in `~` by default. |
| Wrong protocol for a port | FTP pointed at an SSH port, or the reverse, would wait until the timeout. When login is slow, the app reads the server banner and fails within about 3 seconds with a clear message. |

## Git deploy

| Decision | Choice and reason |
|---|---|
| Detecting a push | Two mechanisms are used together, and neither needs a public URL. **Polling**: `git ls-remote` runs every *N* seconds (default 60); it is cheap and also catches pushes from CI or other machines. **Optional pre-push hook**: installed in your local clone, it notifies the app, so the deploy starts within seconds. An existing `pre-push` hook is kept and chained. |
| Branch | `main` by default, configurable per repository. Pushes to other branches are ignored. |
| What is uploaded | **Only what changed**: `git diff` between the last deployed commit and the new one. Deleted files are removed on the server (this can be turned off per mapping). If history was rewritten, the app does a full deploy instead. |
| First sync | **Safe by default**: the current commit becomes the *baseline* and only later pushes are uploaded. One checkbox enables a full first deploy instead. |
| Source of git files | A private clone under `data/repos/`, so uncommitted local edits are never deployed. Files are deployed byte for byte (`core.autocrlf` is forced off). |
| Failures | A failed deploy keeps its log, and the "deployed" commit does not advance. The same failed commit is not retried in a loop: the next push, or *Sync changes*, retries it. |
| Post-deploy command | Optional, SSH only. It runs after the files are uploaded, by default in the first mapping's folder. A non-zero exit marks the deploy *Cmd failed* but keeps the files, which are not uploaded again. |

## Mappings and manual sync

| Decision | Choice and reason |
|---|---|
| Mapping sources | **Git**: files of the pushed commit. **Local folder**: a folder on this computer, typically a build output such as `frontend/dist` that is not committed. A local folder is either absolute, or relative to the repository's local folder. Windows paths such as `D:\…` are detected automatically. |
| Local folders in automatic deploys | Only files that changed since the last upload are sent, judged by size and content hash. Files that disappeared are removed. If the build folder is missing, the git part still deploys and the log shows a warning. |
| Manual sync scope | Each mapping has a **Sync** button. The *Sync files…* dialog syncs all mappings, one mapping, or **one or several sub-folders** of a mapping, which you can tick in a folder browser or type in. A partial sync does not change the recorded deployed commit; syncing all mappings counts as a full deploy. |
| Preview | Every manual sync can be previewed (a dry run) first, which shows each file and the bytes to transfer. |
| Mirror mode | Optional. It deletes server files in the synced folders that are not in the source, after you confirm a list. It never deletes files that match the exclude patterns or folders that belong to another mapping, and it refuses to mirror `/` or the home folder. It is preselected for local folders, which usually means "replace the build on the server". |

## Security

| Decision | Choice and reason |
|---|---|
| Network exposure | The app listens on **127.0.0.1 only**. It rejects requests whose `Host` header is foreign (DNS-rebinding protection), and terminal WebSockets that come from another origin. There is no authentication, because it is a single-user local tool. Exposing it on a network (`HOST=0.0.0.0`) is not recommended. |
| Secrets | Passwords, private keys, passphrases and Git tokens are encrypted at rest and never sent back to the browser. A Git token is sent as an HTTP header, never written into a remote URL. |

## Known limitations

- You cannot download a whole folder as a zip; you can download several files at once.
- The terminal follows the server's shell. Some very minimal shells may not support resizing.
- There is one user per installation: the app is meant to run on your own machine.
