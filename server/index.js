'use strict';
const fs = require('fs');
const path = require('path');
const { Readable, Writable } = require('stream');
const express = require('express');
const multer = require('multer');

const { db, save, encrypt, id, DATA_DIR } = require('./store');
const events = require('./events');
const ftpm = require('./ftpManager');
const gitSync = require('./gitSync');
const terminal = require('./terminal');
const { isSftp, resolveRemotePath, normalizeConfiguredPath } = require('./remote');

const PORT = Number(process.env.PORT) || 4280;
const HOST = process.env.HOST || '127.0.0.1';
const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
for (const f of fs.readdirSync(TMP_DIR)) fs.rmSync(path.join(TMP_DIR, f), { force: true, recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));
app.use(express.text({ limit: '25mb', type: 'text/plain' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
// xterm.js for the SSH terminal, served locally (works offline).
app.use('/vendor/xterm', express.static(path.join(path.dirname(require.resolve('@xterm/xterm/package.json')))));
app.use('/vendor/xterm-fit', express.static(path.join(path.dirname(require.resolve('@xterm/addon-fit/package.json')))));

// Only accept requests addressed to this machine (blocks DNS-rebinding from web pages).
app.use('/api', (req, res, next) => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && HOST === '127.0.0.1') {
    return res.status(403).json({ error: 'Forbidden host' });
  }
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message) => Object.assign(new Error(message), { status });

function remotePath(p, base = '/') {
  let r = String(p ?? '').replace(/\\/g, '/').trim();
  if (!r) r = base;
  if (!r.startsWith('/')) r = path.posix.join(base, r);
  r = path.posix.normalize(r);
  return r.length > 1 ? r.replace(/\/+$/, '') : r;
}

// ------------------------------------------------------------ public views

function publicConnection(c) {
  const { passwordEnc, privateKeyEnc, passphraseEnc, ...rest } = c;
  return { ...rest, protocol: c.protocol || 'ftp', hasPassword: !!passwordEnc, hasPrivateKey: !!privateKeyEnc, hasPassphrase: !!passphraseEnc };
}

function connectionFromBody(body, existing = {}) {
  // "ssh" is accepted as an alias: SSH connections use SFTP for files and SSH for the terminal.
  const asked = body.protocol === 'ssh' ? 'sftp' : body.protocol;
  const protocol = asked === 'sftp' || (asked === undefined && existing.protocol === 'sftp') ? 'sftp' : 'ftp';
  const host = String(body.host ?? existing.host ?? '').trim().replace(/^(s?ftps?|ssh):\/\//i, '').replace(/\/.*$/, '');
  if (!host) throw httpError(400, 'Host is required');
  const secure = protocol === 'sftp' ? 'none' : ['none', 'explicit', 'implicit'].includes(body.secure) ? body.secure : existing.secure || 'none';
  const out = {
    ...existing,
    protocol,
    name: String(body.name ?? existing.name ?? '').trim() || host,
    host,
    port: Number(body.port ?? existing.port) || (protocol === 'sftp' ? 22 : secure === 'implicit' ? 990 : 21),
    user: String(body.user ?? existing.user ?? '').trim(),
    secure,
    allowSelfSigned: protocol === 'ftp' && !!(body.allowSelfSigned ?? existing.allowSelfSigned),
    remoteRoot: normalizeConfiguredPath(body.remoteRoot ?? existing.remoteRoot, protocol === 'sftp' ? '~' : '/'),
    color: body.color ?? existing.color ?? null,
  };
  if (protocol === 'sftp' && !out.user) throw httpError(400, 'Username is required for SSH');
  if (protocol === 'sftp') out.homeStart = true; // start folder chosen with "~" support: never migrate it
  if (typeof body.password === 'string' && (body.password !== '' || body.clearPassword)) out.passwordEnc = body.password ? encrypt(body.password) : null;
  if (protocol === 'sftp') {
    if (body.keyPath !== undefined) out.keyPath = String(body.keyPath || '').trim() || null;
    if (typeof body.privateKey === 'string' && body.privateKey.trim()) out.privateKeyEnc = encrypt(body.privateKey.trim() + '\n');
    if (body.clearPrivateKey) out.privateKeyEnc = null;
    if (typeof body.passphrase === 'string' && (body.passphrase !== '' || body.clearPassphrase)) out.passphraseEnc = body.passphrase ? encrypt(body.passphrase) : null;
    if (body.useAgent !== undefined) out.useAgent = !!body.useAgent;
    if (body.trustNewHostKey) delete out.hostKey;
    if (existing.host && (existing.host !== host || Number(existing.port) !== out.port)) delete out.hostKey; // new server: re-learn its key
  } else {
    delete out.hostKey;
  }
  return out;
}

// ------------------------------------------------------------ state & events

app.get('/api/events', (req, res) => events.attach(req, res));

app.get('/api/state', (req, res) => {
  res.json({
    settings: db.settings,
    connections: db.connections.map(publicConnection),
    sessions: ftpm.allStatuses(),
    repos: db.repos.map(gitSync.publicRepo),
    deployments: db.deployments.slice(-60).reverse().map((d) => gitSync.publicDeployment(d)),
    activity: db.activity.slice(-200).reverse(),
    port: PORT,
    dataDir: DATA_DIR,
  });
});

app.put('/api/settings', (req, res) => {
  const b = req.body || {};
  if (b.idleTimeoutMin !== undefined) db.settings.idleTimeoutMin = Math.min(1440, Math.max(1, Number(b.idleTimeoutMin) || 10));
  if (b.keepAliveSec !== undefined) db.settings.keepAliveSec = Math.min(600, Math.max(10, Number(b.keepAliveSec) || 60));
  if (b.defaultPollSec !== undefined) db.settings.defaultPollSec = Math.min(86400, Math.max(10, Number(b.defaultPollSec) || 60));
  if (b.theme) db.settings.theme = b.theme === 'light' ? 'light' : 'dark';
  save();
  events.broadcast('settings', db.settings);
  res.json(db.settings);
});

// Connections saved before SSH support had no protocol field. Port 22 is SSH in practice,
// so upgrade those instead of letting FTP hang on an SSH port.
for (const c of db.connections) {
  if (!c.protocol) {
    c.protocol = Number(c.port) === 22 ? 'sftp' : 'ftp';
    if (c.protocol === 'sftp') {
      c.secure = 'none';
      events.activity('info', 'app', `Connection "${c.name}" uses port 22, so it was switched to SSH`);
    }
    save();
  }
  // SSH connections created before "~" support defaulted to "/", the filesystem root. Shared
  // hosts (OVH, o2switch, …) don't let you read it, so start in the home folder instead.
  if (c.protocol === 'sftp' && !c.homeStart) {
    if (!c.remoteRoot || c.remoteRoot === '/') c.remoteRoot = '~';
    c.homeStart = true;
    save();
  }
}

// Mappings saved before local-folder support: a Windows path like D:\project\dist can only be a
// folder on this computer (it never matched anything in git), so mark those as local.
for (const r of db.repos) {
  for (const m of r.mappings || []) {
    if (m.source) continue;
    m.source = gitSync.looksAbsoluteLocal(m.local) ? 'local' : 'git';
    if (m.source === 'local') events.activity('info', 'git', `${r.name}: mapping ${m.local} now uploads from that folder on this computer`, { repoId: r.id });
    save();
  }
}

// Detects "code updated on disk but the running server is still the old one".
const crypto = require('crypto');
function codeHash() {
  const h = crypto.createHash('sha1');
  const dir = __dirname;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) h.update(f).update(fs.readFileSync(path.join(dir, f)));
  h.update(fs.readFileSync(path.join(dir, '..', 'package.json')));
  return h.digest('hex');
}
const STARTED_HASH = codeHash();
const STARTED_AT = new Date().toISOString();
app.get('/api/version', (req, res) => {
  let restartNeeded = false;
  try { restartNeeded = codeHash() !== STARTED_HASH; } catch {}
  res.json({ version: require('../package.json').version, startedAt: STARTED_AT, restartNeeded });
});

app.get('/api/activity', (req, res) => res.json(db.activity.slice(-500).reverse()));
app.delete('/api/activity', (req, res) => {
  db.activity.length = 0;
  save();
  events.broadcast('activity-cleared', {});
  res.json({ ok: true });
});

// ------------------------------------------------------------ connections

app.post('/api/connections', (req, res) => {
  const conn = { id: id('con'), createdAt: new Date().toISOString(), ...connectionFromBody(req.body || {}) };
  db.connections.push(conn);
  save();
  events.activity('info', 'app', `Connection "${conn.name}" created`);
  events.broadcast('connections', db.connections.map(publicConnection));
  res.json(publicConnection(conn));
});

app.put('/api/connections/:id', (req, res) => {
  const i = db.connections.findIndex((c) => c.id === req.params.id);
  if (i < 0) throw httpError(404, 'Connection not found');
  db.connections[i] = connectionFromBody(req.body || {}, db.connections[i]);
  save();
  ftpm.dropSession(req.params.id); // reconnect with new settings on next use
  events.broadcast('connections', db.connections.map(publicConnection));
  res.json(publicConnection(db.connections[i]));
});

app.delete('/api/connections/:id', (req, res) => {
  const i = db.connections.findIndex((c) => c.id === req.params.id);
  if (i < 0) throw httpError(404, 'Connection not found');
  const used = db.repos.filter((r) => r.connectionId === req.params.id);
  if (used.length) throw httpError(409, `Used by repo sync: ${used.map((r) => r.name).join(', ')}. Remove or re-assign those first.`);
  ftpm.dropSession(req.params.id);
  const [c] = db.connections.splice(i, 1);
  save();
  events.activity('info', 'app', `Connection "${c.name}" deleted`);
  events.broadcast('connections', db.connections.map(publicConnection));
  res.json({ ok: true });
});

app.post('/api/connections/test', wrap(async (req, res) => {
  const b = req.body || {};
  const existing = b.id ? db.connections.find((c) => c.id === b.id) : undefined;
  const conn = connectionFromBody(b, existing ? { ...existing } : {});
  const t0 = Date.now();
  const client = await ftpm.openClient(conn, 15000);
  try {
    const pwd = await client.pwd();
    const features = await client.features();
    res.json({ ok: true, pwd, ms: Date.now() - t0, protocol: conn.protocol, secure: conn.secure, features, hostKey: client.hostKey || null, hostKeyKnown: !!conn.hostKey });
  } finally {
    client.close();
  }
}));

app.post('/api/connections/:id/connect', wrap(async (req, res) => {
  const s = ftpm.session(req.params.id);
  await s.run((c) => c.pwd());
  res.json(s.status());
}));

// Run one SSH command (SFTP connections only). Used by "Run command" and handy for scripts.
app.post('/api/connections/:id/exec', wrap(async (req, res) => {
  const conn = ftpm.getConnection(req.params.id);
  if (!isSftp(conn)) throw httpError(400, 'Commands need an SSH connection.');
  const command = String(req.body?.command || '').trim();
  if (!command) throw httpError(400, 'Command is required');
  ftpm.session(conn.id).touch();
  const result = await ftpm.withClient(conn.id, (client) => {
    const cwd = req.body?.cwd ? resolveRemotePath(client.home, req.body.cwd) : null;
    return client.exec(command, { cwd, timeoutMs: 5 * 60 * 1000 });
  });
  events.activity(result.code === 0 ? 'success' : 'warn', 'ssh', `$ ${command.length > 80 ? command.slice(0, 80) + '…' : command} → exit ${result.code}`, { connectionId: conn.id });
  res.json(result);
}));

app.post('/api/connections/:id/disconnect', (req, res) => {
  const s = ftpm.session(req.params.id);
  s.close('manual');
  res.json(s.status());
});

// ------------------------------------------------------------ remote file operations (FTP, FTPS, SFTP)

app.get('/api/ftp/:id/list', wrap(async (req, res) => {
  const conn = ftpm.getConnection(req.params.id);
  const s = ftpm.session(req.params.id);
  const wanted = req.query.path || conn.remoteRoot || (isSftp(conn) ? '~' : '/');
  const { dir, list } = await s.run(async (c) => {
    const d = resolveRemotePath(c.home, wanted);
    return { dir: d, list: await c.list(d) };
  });
  const entries = list
    .map((f) => ({ ...f, path: path.posix.join(dir, f.name) }))
    .sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1);
  res.json({ path: dir, entries });
}));

app.post('/api/ftp/:id/mkdir', wrap(async (req, res) => {
  const p = remotePath(req.body.path);
  if (p === '/') throw httpError(400, 'Invalid folder name');
  const s = ftpm.session(req.params.id);
  await s.run((c) => c.mkdir(p));
  events.activity('success', 'ftp', `Created folder ${p}`, { connectionId: req.params.id });
  res.json({ ok: true });
}));

app.post('/api/ftp/:id/rename', wrap(async (req, res) => {
  const from = remotePath(req.body.from);
  const to = remotePath(req.body.to);
  if (from === '/' || to === '/') throw httpError(400, 'Invalid path');
  const s = ftpm.session(req.params.id);
  await s.run((c) => c.rename(from, to));
  events.activity('success', 'ftp', `Renamed ${from} → ${to}`, { connectionId: req.params.id });
  res.json({ ok: true });
}));

app.post('/api/ftp/:id/delete', wrap(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw httpError(400, 'Nothing to delete');
  const s = ftpm.session(req.params.id);
  const results = [];
  for (const it of items) {
    const p = remotePath(it.path);
    if (p === '/') { results.push({ path: p, ok: false, error: 'Refusing to delete root' }); continue; }
    try {
      if (it.type === 'dir') await s.run((c) => c.removeDir(p));
      else await s.run((c) => c.remove(p));
      results.push({ path: p, ok: true });
    } catch (e) {
      results.push({ path: p, ok: false, error: e.message });
    }
  }
  const ok = results.filter((r) => r.ok).length;
  events.activity(ok === results.length ? 'success' : 'warn', 'ftp', `Deleted ${ok}/${results.length} item(s)`, { connectionId: req.params.id });
  res.json({ results });
}));

app.post('/api/ftp/:id/chmod', wrap(async (req, res) => {
  const p = remotePath(req.body.path);
  const mode = String(req.body.mode || '').trim();
  if (!/^[0-7]{3,4}$/.test(mode)) throw httpError(400, 'Mode must be octal, e.g. 644 or 755');
  const s = ftpm.session(req.params.id);
  await s.run((c) => c.chmod(p, mode));
  events.activity('success', 'ftp', `chmod ${mode} ${p}`, { connectionId: req.params.id });
  res.json({ ok: true });
}));

app.get('/api/ftp/:id/content', wrap(async (req, res) => {
  const p = remotePath(req.query.path);
  const s = ftpm.session(req.params.id);
  const chunks = [];
  let size = 0;
  const LIMIT = 5 * 1024 * 1024;
  const sink = new Writable({
    write(chunk, _enc, cb) {
      size += chunk.length;
      if (size > LIMIT) return cb(new Error('File is larger than 5 MB; download it instead.'));
      chunks.push(chunk);
      cb();
    },
  });
  await s.run((c) => c.downloadTo(sink, p), { retry: false });
  const buf = Buffer.concat(chunks);
  if (buf.subarray(0, 8000).includes(0)) throw httpError(415, 'This looks like a binary file; download it instead.');
  res.json({ path: p, content: buf.toString('utf8'), size: buf.length });
}));

app.put('/api/ftp/:id/content', wrap(async (req, res) => {
  const p = remotePath(req.query.path);
  const content = typeof req.body === 'string' ? req.body : String(req.body?.content ?? '');
  const s = ftpm.session(req.params.id);
  await s.run((c) => c.uploadFrom(Readable.from([Buffer.from(content, 'utf8')]), p), { retry: false });
  events.activity('success', 'ftp', `Saved ${p} (${Buffer.byteLength(content)} bytes)`, { connectionId: req.params.id });
  res.json({ ok: true });
}));

app.get('/api/ftp/:id/download', wrap(async (req, res) => {
  const p = remotePath(req.query.path);
  const name = path.posix.basename(p);
  const s = ftpm.session(req.params.id);
  s.touch();
  let size = null;
  await ftpm.withClient(req.params.id, async (client) => {
    try { size = await client.size(p); } catch {}
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    if (size !== null) res.setHeader('Content-Length', size);
    await client.downloadTo(res, p);
  });
  s.touch();
  events.activity('success', 'ftp', `Downloaded ${p}`, { connectionId: req.params.id });
}));

const upload = multer({ dest: TMP_DIR, limits: { fieldSize: 10 * 1024 * 1024 } });

app.post('/api/ftp/:id/upload', upload.array('files'), wrap(async (req, res) => {
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
  try {
    const conn = ftpm.getConnection(req.params.id);
    const wanted = req.query.path || conn.remoteRoot || (isSftp(conn) ? '~' : '/');
    let dir = wanted;
    const tid = String(req.query.tid || id('tr'));
    let rel = req.body.relpath ?? [];
    if (!Array.isArray(rel)) rel = [rel];
    const s = ftpm.session(req.params.id);
    const results = [];
    const total = files.reduce((n, f) => n + f.size, 0);
    let doneBytes = 0;
    s.touch();
    await ftpm.withClient(req.params.id, async (client) => {
      dir = resolveRemotePath(client.home, wanted);
      const madeDirs = new Set();
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const relName = String(rel[i] || f.originalname).replace(/\\/g, '/').split('/').filter((x) => x && x !== '..' && x !== '.').join('/');
        const target = path.posix.join(dir, relName);
        try {
          const parent = path.posix.dirname(target);
          if (!madeDirs.has(parent)) {
            await client.ensureDir(parent);
            madeDirs.add(parent);
          }
          let last = 0;
          await client.uploadFrom(f.path, target, (bytes) => {
            const now = Date.now();
            if (now - last < 150) return;
            last = now;
            events.broadcast('transfer', { tid, phase: 'ftp', name: relName, index: i, count: files.length, bytes: doneBytes + bytes, total });
          });
          doneBytes += f.size;
          s.touch();
          results.push({ path: target, ok: true, size: f.size });
        } catch (e) {
          results.push({ path: target, ok: false, error: e.message });
          if (client.closed) {
            for (let j = i + 1; j < files.length; j++) results.push({ path: path.posix.join(dir, rel[j] || files[j].originalname), ok: false, error: 'Connection lost' });
            break;
          }
        }
        events.broadcast('transfer', { tid, phase: 'ftp', name: relName, index: i + 1, count: files.length, bytes: doneBytes, total });
      }
    });
    const ok = results.filter((r) => r.ok).length;
    events.activity(ok === results.length ? 'success' : 'warn', 'ftp', `Uploaded ${ok}/${results.length} file(s) to ${dir}`, { connectionId: req.params.id });
    events.broadcast('transfer', { tid, phase: 'done', count: files.length, ok, total });
    res.json({ results });
  } finally {
    cleanup();
  }
}));

// ------------------------------------------------------------ git repos

function repoFromBody(b, existing = {}) {
  const name = String(b.name ?? existing.name ?? '').trim();
  const url = String(b.url ?? existing.url ?? '').trim();
  if (!url) throw httpError(400, 'Repository URL / path is required');
  const connectionId = b.connectionId ?? existing.connectionId;
  if (!db.connections.some((c) => c.id === connectionId)) throw httpError(400, 'Choose an FTP connection');
  const mappings = (Array.isArray(b.mappings) ? b.mappings : existing.mappings || [])
    .map((m) => {
      const raw = String(m.local ?? '').trim();
      // "git" = files from the pushed commit; "local" = a folder on this computer (e.g. a build output).
      // A Windows absolute path can only be a local folder, whatever was selected.
      const source = gitSync.looksAbsoluteLocal(raw) || m.source === 'local' ? 'local' : 'git';
      return {
        id: m.id || id('map'),
        source,
        local: source === 'local' ? raw.replace(/[\\/]+$/, '') : gitSync.normLocal(raw),
        remote: gitSync.normRemote(m.remote),
        deleteRemoved: m.deleteRemoved !== false,
        autoDeploy: m.autoDeploy !== false,
      };
    })
    .filter((m) => m.remote);
  if (!mappings.length) throw httpError(400, 'Add at least one folder mapping');
  const excludes = Array.isArray(b.excludes)
    ? b.excludes
    : typeof b.excludes === 'string'
      ? b.excludes.split(/\r?\n|,/)
      : existing.excludes || ['.github/', '.gitignore', '.gitattributes'];
  const out = {
    ...existing,
    name: name || path.basename(url).replace(/\.git$/, '') || 'repo',
    url,
    localPath: String(b.localPath ?? existing.localPath ?? '').trim() || null,
    branch: String(b.branch ?? existing.branch ?? 'main').trim() || 'main',
    connectionId,
    mappings,
    excludes: excludes.map((x) => String(x).trim()).filter(Boolean),
    pollSec: Math.max(10, Number(b.pollSec ?? existing.pollSec ?? db.settings.defaultPollSec) || 60),
    enabled: b.enabled ?? existing.enabled ?? true,
    initialDeploy: !!(b.initialDeploy ?? existing.initialDeploy),
    gitUser: String(b.gitUser ?? existing.gitUser ?? '').trim() || null,
    postDeployCommand: String(b.postDeployCommand ?? existing.postDeployCommand ?? '').trim() || null,
    postDeployCwd: String(b.postDeployCwd ?? existing.postDeployCwd ?? '').trim() || null,
  };
  if (typeof b.token === 'string' && (b.token !== '' || b.clearToken)) out.tokenEnc = b.token ? encrypt(b.token) : null;
  for (const m of out.mappings.filter((x) => x.source === 'local')) {
    try { gitSync.localMappingDir(out, m); } catch (e) { throw httpError(400, `Mapping "${m.local}": ${e.message}`); }
  }
  return out;
}

function findRepo(rid) {
  const r = db.repos.find((x) => x.id === rid);
  if (!r) throw httpError(404, 'Repo not found');
  return r;
}

app.post('/api/git/inspect', wrap(async (req, res) => {
  const info = await gitSync.inspectSource(req.body.source, req.body.token, req.body.gitUser);
  res.json(info);
}));

app.get('/api/repos', (req, res) => res.json(db.repos.map(gitSync.publicRepo)));

app.get('/api/repos/:id', wrap(async (req, res) => {
  const r = findRepo(req.params.id);
  res.json({ ...gitSync.publicRepo(r), hookInstalled: await gitSync.hookInstalled(r) });
}));

app.post('/api/repos', wrap(async (req, res) => {
  const repo = { id: id('repo'), createdAt: new Date().toISOString(), status: 'idle', lastDeployedSha: null, ...repoFromBody(req.body || {}) };
  db.repos.push(repo);
  save();
  events.activity('info', 'git', `Repo sync "${repo.name}" added (${repo.branch} → FTP)`, { repoId: repo.id });
  let hook = null;
  if (req.body.installHook && repo.localPath) {
    try { hook = await gitSync.installHook(repo, PORT); } catch (e) { hook = { error: e.message }; }
  }
  if (repo.enabled) gitSync.check(repo, { trigger: 'initial' });
  res.json({ ...gitSync.publicRepo(repo), hook });
}));

app.put('/api/repos/:id', wrap(async (req, res) => {
  const i = db.repos.findIndex((x) => x.id === req.params.id);
  if (i < 0) throw httpError(404, 'Repo not found');
  const prev = db.repos[i];
  const next = repoFromBody(req.body || {}, prev);
  if (next.url !== prev.url) gitSync.removeRepoData(prev);
  db.repos[i] = next;
  save();
  events.broadcast('repo', gitSync.publicRepo(next));
  res.json(gitSync.publicRepo(next));
}));

app.delete('/api/repos/:id', wrap(async (req, res) => {
  const i = db.repos.findIndex((x) => x.id === req.params.id);
  if (i < 0) throw httpError(404, 'Repo not found');
  const [r] = db.repos.splice(i, 1);
  try { await gitSync.uninstallHook(r); } catch {}
  gitSync.removeRepoData(r);
  save();
  events.activity('info', 'git', `Repo sync "${r.name}" removed`);
  events.broadcast('repo-removed', { id: r.id });
  res.json({ ok: true });
}));

app.post('/api/repos/:id/sync', wrap(async (req, res) => {
  const r = findRepo(req.params.id);
  const full = !!req.body?.full;
  const p = gitSync.check(r, { full, trigger: full ? 'manual-full' : 'manual' });
  if (req.body?.wait) return res.json(await p);
  res.json({ started: true });
}));

// Sync one mapping, a sub-folder of it, or all mappings — uploading every file of the branch head
// (not just the changes). dryRun:true returns the plan without touching the server.
app.post('/api/repos/:id/sync-scope', wrap(async (req, res) => {
  const r = findRepo(req.params.id);
  const b = req.body || {};
  const scope = { mappingIds: b.mappingIds, mappingId: b.mappingId, subPath: b.subPath, mirror: b.mirror, runCommand: b.runCommand };
  if (b.dryRun) return res.json(await gitSync.previewScoped(r, scope));
  const { deploymentId, promise } = gitSync.syncScoped(r, scope);
  if (b.wait) {
    const dep = await promise;
    return res.json({ deploymentId, deployment: gitSync.publicDeployment(dep, true) });
  }
  promise.catch(() => {});
  res.json({ deploymentId });
}));

// Sub-folders of the repository at the branch head (sub-folder picker).
app.get('/api/repos/:id/tree', wrap(async (req, res) => {
  const r = findRepo(req.params.id);
  res.json(await gitSync.repoTree(r, req.query.path || '', { refresh: req.query.refresh === '1', mappingId: req.query.mappingId || null }));
}));

app.post('/api/repos/:id/trigger', (req, res) => {
  const r = findRepo(req.params.id);
  gitSync.triggerAfterPush(r);
  res.json({ ok: true });
});

app.post('/api/repos/:id/baseline', wrap(async (req, res) => {
  const r = findRepo(req.params.id);
  const sha = req.body?.sha || r.lastRemoteSha;
  if (!sha) throw httpError(400, 'Unknown remote commit; run a check first');
  r.lastDeployedSha = sha;
  r.failedSha = null;
  r.status = 'idle';
  r.lastError = null;
  save();
  events.activity('info', 'git', `${r.name}: marked ${sha.slice(0, 7)} as deployed (no upload)`, { repoId: r.id });
  events.broadcast('repo', gitSync.publicRepo(r));
  res.json(gitSync.publicRepo(r));
}));

app.post('/api/repos/:id/hook', wrap(async (req, res) => {
  const r = findRepo(req.params.id);
  const file = await gitSync.installHook(r, PORT);
  events.activity('success', 'git', `${r.name}: pre-push hook installed in ${file}`, { repoId: r.id });
  res.json({ ok: true, file });
}));

app.delete('/api/repos/:id/hook', wrap(async (req, res) => {
  const r = findRepo(req.params.id);
  res.json({ ok: await gitSync.uninstallHook(r) });
}));

app.post('/api/repos/:id/preview', wrap(async (req, res) => {
  const r = findRepo(req.params.id);
  const sample = (req.body?.paths || []).map((p) => ({ status: 'A', path: String(p) }));
  res.json({ ops: gitSync.plan(r, sample) });
}));

app.get('/api/deployments', (req, res) => {
  let list = db.deployments;
  if (req.query.repoId) list = list.filter((d) => d.repoId === req.query.repoId);
  res.json(list.slice(-100).reverse().map((d) => gitSync.publicDeployment(d)));
});

app.get('/api/deployments/:id', (req, res) => {
  const d = db.deployments.find((x) => x.id === req.params.id);
  if (!d) throw httpError(404, 'Deployment not found');
  res.json(gitSync.publicDeployment(d, true));
});

// ------------------------------------------------------------ errors

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, _next) => {
  const c = err.code;
  const status = err.status
    || (c === 530 || c === 'AUTH' ? 401
      : err.notFound || c === 550 ? 404
        : c === 3 ? 403
          : c === 'HOSTKEY_MISMATCH' ? 409
            : c === 'WRONG_PROTOCOL' ? 400
            : typeof c === 'number' ? 400
              : /^E[A-Z]+/.test(String(c || '')) ? 502 : 500);
  if (status >= 500) console.error('[http]', req.method, req.url, err.message);
  if (res.headersSent) return res.destroy();
  res.removeHeader('Content-Disposition');
  res.removeHeader('Content-Length');
  res.status(status).json({ error: err.message || 'Error', code: c, hostKey: err.hostKey });
});

// ------------------------------------------------------------ start

function start(port = PORT, host = HOST) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      server.terminals = terminal.attach(server, { bindHost: host });
      gitSync.startWatcher();
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}`;
      console.log(`\n  FTPGit Studio running at ${url}\n  Data folder: ${DATA_DIR}\n`);
      if (process.argv.includes('--open')) {
        const { exec } = require('child_process');
        const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
        exec(cmd);
      }
      resolve(server);
    });
    // Longer than clients' idle-socket reuse window, so a reused keep-alive socket is never
    // closed under an in-flight request ("fetch failed" / ECONNRESET races).
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.on('error', reject);
  });
}

if (require.main === module) {
  start().catch((e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Set PORT=xxxx to use another port.` : e);
    process.exit(1);
  });
}

module.exports = { app, start };
