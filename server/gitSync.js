'use strict';
// Git -> FTP sync engine.
// Watches the configured branch of each repo (git ls-remote polling + optional pre-push hook trigger).
// When the branch moves, fetches into a private clone, diffs against the last deployed commit,
// and uploads / deletes the changed files through each folder mapping (repo folder -> FTP folder).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { db, save, id, trim, decrypt, DATA_DIR } = require('./store');
const { broadcast, activity } = require('./events');
const { withClient, getConnection } = require('./ftpManager');
const { isNotFound, isSftp, resolveRemotePath, normalizeConfiguredPath } = require('./remote');

const REPOS_DIR = path.join(DATA_DIR, 'repos');
fs.mkdirSync(REPOS_DIR, { recursive: true });

const HOOK_MARKER = '# ftpgit-studio-hook';
const running = new Map(); // repoId -> Promise

// ---------------------------------------------------------------- git helpers

function authArgs(repo) {
  if (!repo || !repo.tokenEnc) return [];
  const token = decrypt(repo.tokenEnc);
  const user = repo.gitUser || 'x-access-token';
  const basic = Buffer.from(`${user}:${token}`).toString('base64');
  return ['-c', `http.extraHeader=Authorization: Basic ${basic}`];
}

function maskSecrets(text, repo) {
  let out = String(text || '');
  if (repo && repo.tokenEnc) {
    try {
      const token = decrypt(repo.tokenEnc);
      if (token) out = out.split(token).join('***');
    } catch {}
  }
  return out.replace(/Authorization: Basic [A-Za-z0-9+/=]+/g, 'Authorization: Basic ***');
}

function git(args, { cwd, repo, timeout = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      // Deploy files byte-for-byte as committed: never let a global autocrlf rewrite line endings.
      ['-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', ...authArgs(repo), ...args],
      {
        cwd,
        timeout,
        maxBuffer: 512 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', LC_ALL: 'C' },
      },
      (err, stdout, stderr) => {
        if (err) {
          const msg = maskSecrets((stderr || '').trim() || err.message, repo);
          const e = new Error(msg.split('\n').slice(-3).join(' ').trim() || 'git failed');
          e.stderr = msg;
          return reject(e);
        }
        resolve(stdout);
      }
    );
  });
}

function repoDir(repo) {
  return path.join(REPOS_DIR, repo.id);
}

async function lsRemote(repo, branch = repo.branch) {
  const out = await git(['ls-remote', repo.url, `refs/heads/${branch}`], { repo, timeout: 60000 });
  const line = out.split('\n').find((l) => l.trim());
  if (!line) {
    const e = new Error(`Branch "${branch}" not found on ${repo.url}`);
    e.code = 'NO_BRANCH';
    throw e;
  }
  return line.split(/\s+/)[0];
}

async function listBranches(url, token, gitUser) {
  const fake = token ? { tokenEnc: require('./store').encrypt(token), gitUser } : null;
  const out = await git(['ls-remote', '--heads', url], { repo: fake, timeout: 60000 });
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[1].replace('refs/heads/', ''));
}

/** Inspect a local folder or a URL: returns remote URL, branches, etc. */
async function inspectSource(source, token, gitUser) {
  source = String(source || '').trim();
  if (!source) throw new Error('Repository source is required');
  const result = { source, localPath: null, url: source, branches: [], remotes: {} };
  if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
    result.localPath = path.resolve(source);
    const top = (await git(['rev-parse', '--show-toplevel'], { cwd: source })).trim();
    result.localPath = path.resolve(top);
    const remotes = (await git(['remote', '-v'], { cwd: top })).split('\n').filter(Boolean);
    for (const r of remotes) {
      const [name, url] = r.split(/\s+/);
      result.remotes[name] = url;
    }
    result.url = result.remotes.origin || Object.values(result.remotes)[0] || result.localPath;
    try { result.currentBranch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: top })).trim(); } catch {}
  }
  result.branches = await listBranches(result.url, token, gitUser);
  return result;
}

// ---------------------------------------------------------------- path helpers

function normLocal(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/?/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function normRemote(p) {
  return normalizeConfiguredPath(p, '/'); // keeps "~/folder" (home-relative) notation
}

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function compileExcludes(patterns) {
  return (patterns || [])
    .map((p) => String(p).trim().replace(/\\/g, '/'))
    .filter((p) => p && !p.startsWith('#'))
    .map((p) => {
      const dirOnly = p.endsWith('/');
      const pat = p.replace(/^\/+/, '').replace(/\/+$/, '');
      const anchored = pat.includes('/');
      const rx = globToRegex(pat);
      return (file) => {
        const segs = file.split('/');
        if (anchored) {
          // match the full path or any parent directory path
          for (let i = segs.length; i >= 1; i--) {
            if (dirOnly && i === segs.length) continue;
            if (rx.test(segs.slice(0, i).join('/'))) return true;
          }
          return false;
        }
        const pool = dirOnly ? segs.slice(0, -1) : segs;
        return pool.some((s) => rx.test(s));
      };
    });
}

/** Build the list of FTP operations for a set of git changes. */
function plan(repo, changes) {
  const excluded = compileExcludes(repo.excludes);
  const ops = [];
  for (const m of (repo.mappings || []).filter((x) => x.source !== 'local')) {
    const local = normLocal(m.local);
    const remote = normRemote(m.remote);
    for (const ch of changes) {
      if (excluded.some((fn) => fn(ch.path))) continue;
      let rel;
      if (!local) rel = ch.path;
      else if (ch.path.startsWith(local + '/')) rel = ch.path.slice(local.length + 1);
      else continue;
      const target = path.posix.join(remote, rel);
      if (ch.status === 'D') {
        if (m.deleteRemoved !== false) ops.push({ type: 'delete', path: ch.path, remote: target, mappingId: m.id });
      } else ops.push({ type: 'upload', path: ch.path, remote: target, mappingId: m.id, size: ch.size });
    }
  }
  return ops;
}

// ---------------------------------------------------------------- deployment

function publicRepo(repo) {
  const { tokenEnc, ...rest } = repo;
  return { ...rest, hasToken: !!tokenEnc, running: running.has(repo.id) };
}

function emitRepo(repo) {
  broadcast('repo', publicRepo(repo));
}

function publicDeployment(d, withLog = false) {
  const { log, ...rest } = d;
  return withLog ? d : { ...rest, logSize: (log || []).length };
}

async function ensureClone(repo, dep) {
  const dir = repoDir(repo);
  const branch = repo.branch;
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    dep && logDep(dep, 'info', `Cloning ${repo.url} ...`);
    await git(['clone', '--no-checkout', '--single-branch', '--branch', branch, repo.url, dir], { repo });
  } else {
    await git(['remote', 'set-url', 'origin', repo.url], { cwd: dir });
  }
  dep && logDep(dep, 'info', `Fetching ${branch} ...`);
  await git(['fetch', '--force', '--prune', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: dir, repo });
  return dir;
}

function logDep(dep, level, message) {
  const entry = { ts: new Date().toISOString(), level, message };
  dep.log.push(entry);
  if (dep.log.length > 5000) dep.log.splice(0, dep.log.length - 5000);
  broadcast('deploy-log', { deploymentId: dep.id, repoId: dep.repoId, entry });
}

async function computeChanges(repo, dir, fromSha, toSha, dep) {
  let base = fromSha;
  if (base) {
    try {
      await git(['cat-file', '-e', `${base}^{commit}`], { cwd: dir });
    } catch {
      logDep(dep, 'warn', `Previous commit ${base.slice(0, 7)} is no longer in history (force-push?). Doing a full deploy.`);
      base = null;
    }
  }
  if (base) {
    const out = await git(['diff', '--name-status', '--no-renames', '-z', base, toSha], { cwd: dir });
    const parts = out.split('\0').filter((x) => x !== '');
    const changes = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const status = parts[i][0];
      changes.push({ status: status === 'D' ? 'D' : status === 'A' ? 'A' : 'M', path: parts[i + 1] });
    }
    return { full: false, changes };
  }
  const out = await git(['ls-tree', '-r', '-z', '--name-only', toSha], { cwd: dir });
  return { full: true, changes: out.split('\0').filter(Boolean).map((p) => ({ status: 'A', path: p })) };
}

// ---------------------------------------------------------------- scoped sync (one mapping, a sub-folder, or all)

/** All files of a commit with their sizes: [{ path, size, status: 'A' }]. */
async function listTree(dir, sha) {
  const out = await git(['ls-tree', '-r', '-l', '-z', sha], { cwd: dir });
  const files = [];
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const meta = rec.slice(0, tab).trim().split(/\s+/);
    if (meta[1] !== 'blob') continue; // skip submodules
    files.push({ path: rec.slice(tab + 1), size: Number(meta[3]) || 0, status: 'A' });
  }
  return files;
}

function normSub(p) {
  return normLocal(p).split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
}

/** Cleans a list of sub-folders: no duplicates, and none inside another selected one. */
function normSubPaths(list) {
  const subs = [...new Set((list || []).map(normSub).filter(Boolean))].sort();
  return subs.filter((p) => !subs.some((o) => o !== p && p.startsWith(o + '/')));
}

// ---------------------------------------------------------------- local-folder mappings
// A mapping can take its files from git (the pushed commit) or from a folder on this computer,
// e.g. a build output like frontend/dist that is not committed.

const looksAbsoluteLocal = (p) => /^[A-Za-z]:[\\/]/.test(String(p || '')) || /^\\\\/.test(String(p || ''));
const isLocalMapping = (m) => m && m.source === 'local';

/** Absolute folder on this computer for a local mapping. */
function localMappingDir(repo, m) {
  const raw = String(m.local || '').trim();
  if (!raw) throw Object.assign(new Error('The local folder of this mapping is empty.'), { status: 400 });
  if (path.isAbsolute(raw) || looksAbsoluteLocal(raw)) return path.resolve(raw);
  if (!repo.localPath) throw Object.assign(new Error(`"${raw}" is relative: set the repository's local folder, or use an absolute path like D:\\project\\dist.`), { status: 400 });
  return path.resolve(repo.localPath, raw);
}

/** Path used to match exclude patterns for a file of a mapping. */
function excludePathFor(m, rel) {
  if (isLocalMapping(m)) {
    const raw = String(m.local || '').replace(/\\/g, '/');
    return path.isAbsolute(raw) || looksAbsoluteLocal(raw) ? rel : `${normLocal(raw)}/${rel}`;
  }
  const local = normLocal(m.local);
  return local ? `${local}/${rel}` : rel;
}

/** All files under a local folder: [{ rel, abs, size, mtimeMs }]. */
function scanLocalDir(root) {
  if (!fs.existsSync(root)) throw Object.assign(new Error(`Local folder not found: ${root}. Build the project first (e.g. npm run build).`), { status: 400 });
  if (!fs.statSync(root).isDirectory()) throw Object.assign(new Error(`Not a folder: ${root}`), { status: 400 });
  const out = [];
  const walk = (dir, prefix) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git') continue;
      const abs = path.join(dir, ent.name);
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(abs, rel);
      else if (ent.isFile()) {
        const st = fs.statSync(abs);
        out.push({ rel, abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      }
    }
  };
  walk(root, '');
  return out;
}

const manifestFile = (repo) => path.join(REPOS_DIR, `${repo.id}.local-manifests.json`);
function loadManifests(repo) {
  try { return JSON.parse(fs.readFileSync(manifestFile(repo), 'utf8')); } catch { return {}; }
}
function saveManifests(repo, all) {
  fs.writeFileSync(manifestFile(repo), JSON.stringify(all));
}

function fileHash(abs, size) {
  if (size > 64 * 1024 * 1024) return null; // huge file: size + mtime is enough
  return require('crypto').createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
}

/**
 * Operations for local mappings.
 * mode 'all' uploads every file; mode 'changed' compares with what was uploaded last time
 * (size, mtime, content hash) and also deletes files that disappeared, if the mapping allows it.
 * Returns { ops, manifests: { mappingId: newManifest } } — manifests are saved only after success.
 */
function planLocal(repo, mappings, { mode = 'all', subPaths = [] } = {}) {
  const excluded = compileExcludes(repo.excludes);
  const old = loadManifests(repo);
  const ops = [];
  const manifests = {};
  for (const m of mappings.filter(isLocalMapping)) {
    const root = localMappingDir(repo, m);
    const remote = normRemote(m.remote);
    const prev = old[m.id] || {};
    const next = {};
    const inSub = (rel) => !subPaths.length || subPaths.some((sp) => rel === sp || rel.startsWith(sp + '/'));
    const scanned = subPaths.length
      ? subPaths.flatMap((sp) => scanLocalDir(path.join(root, ...sp.split('/'))).map((x) => ({ ...x, rel: `${sp}/${x.rel}` })))
      : scanLocalDir(root);
    for (const f of scanned) {
      if (excluded.some((fn) => fn(excludePathFor(m, f.rel)))) continue;
      const before = prev[f.rel];
      let hash = before && before.size === f.size && before.mtimeMs === f.mtimeMs ? before.hash : undefined;
      if (mode === 'changed' && hash === undefined) hash = fileHash(f.abs, f.size);
      next[f.rel] = { size: f.size, mtimeMs: f.mtimeMs, hash: hash === undefined ? fileHash(f.abs, f.size) : hash };
      const unchanged = before && before.size === f.size && (next[f.rel].hash ? before.hash === next[f.rel].hash : before.mtimeMs === f.mtimeMs);
      if (mode === 'all' || !unchanged) {
        ops.push({ type: 'upload', local: true, abs: f.abs, path: `${m.local.replace(/\\/g, '/').replace(/\/+$/, '')}/${f.rel}`, remote: path.posix.join(remote, f.rel), mappingId: m.id, size: f.size });
      }
    }
    if (mode === 'changed' && m.deleteRemoved !== false) {
      for (const rel of Object.keys(prev)) {
        if (!next[rel] && inSub(rel)) ops.push({ type: 'delete', local: true, path: rel, remote: path.posix.join(remote, rel), mappingId: m.id });
      }
    }
    // Keep entries outside the synced sub-folders; replace the ones inside them.
    const merged = subPaths.length ? Object.fromEntries(Object.entries(prev).filter(([rel]) => !inSub(rel))) : {};
    manifests[m.id] = { ...merged, ...next };
  }
  return { ops, manifests };
}

/** Normalizes a scope request: { mappingIds: [] (empty = all), subPaths: [] (or subPath), mirror, runCommand }. */
function normScope(repo, scope = {}) {
  const ids = (Array.isArray(scope.mappingIds) ? scope.mappingIds : scope.mappingId ? [scope.mappingId] : [])
    .filter((x) => (repo.mappings || []).some((m) => m.id === x));
  const mappings = ids.length ? repo.mappings.filter((m) => ids.includes(m.id)) : repo.mappings || [];
  const subPaths = normSubPaths(Array.isArray(scope.subPaths) ? scope.subPaths : scope.subPath ? [scope.subPath] : []);
  if (subPaths.length && mappings.length !== 1) throw Object.assign(new Error('Choose one mapping to sync sub-folders.'), { status: 400 });
  const everything = mappings.length === (repo.mappings || []).length && !subPaths.length;
  const src = (m) => (isLocalMapping(m) ? `${String(m.local).replace(/\\/g, '/').replace(/\/+$/, '')}` : normLocal(m.local) || '(repo root)');
  const label = everything && !ids.length
    ? 'all mappings'
    : mappings.map((m) => {
      const sub = subPaths.length === 1 ? `/${subPaths[0]}` : subPaths.length ? `/{${subPaths.join(', ')}}` : '';
      return `${src(m)}${sub} → ${normRemote(m.remote).replace(/\/+$/, '')}${sub}`;
    }).join(', ');
  return {
    ids, mappings, subPaths, everything, mirror: !!scope.mirror, runCommand: !!scope.runCommand, label,
    needsGit: mappings.some((m) => !isLocalMapping(m)),
  };
}

/** Upload operations of the git mappings in a scope (remote paths may still use "~"). */
function planScoped(repo, files, s) {
  const ops = plan({ ...repo, mappings: s.mappings }, files);
  if (!s.subPaths.length) return ops;
  const local = normLocal(s.mappings[0].local);
  const prefixes = s.subPaths.map((sp) => `${local ? local + '/' : ''}${sp}/`);
  return ops.filter((op) => prefixes.some((p) => op.path.startsWith(p)));
}

/** Every file below a remote folder (absolute paths). Symlinks are left alone. */
async function listRemoteFiles(client, dir, skipRoots) {
  const out = [];
  const walk = async (d) => {
    if (skipRoots.some((r) => d === r)) return;
    let entries;
    try {
      entries = await client.list(d);
    } catch (e) {
      if (isNotFound(e)) return;
      throw e;
    }
    for (const e of entries) {
      const p = path.posix.join(d, e.name);
      if (e.type === 'dir') await walk(p);
      else if (e.type === 'file') out.push(p);
    }
  };
  await walk(dir);
  return out;
}

/**
 * Mirror mode: server files inside the synced folder(s) that are not in the source (git or the
 * local folder) get deleted. Never touches files matching the exclude patterns, nor folders that
 * belong to another mapping, and refuses to mirror a whole home folder or "/".
 */
async function mirrorDeletes(repo, client, s, uploadOps) {
  const excluded = compileExcludes(repo.excludes);
  const planned = new Set(uploadOps.map((o) => o.remote));
  const roots = (repo.mappings || []).map((m) => ({ id: m.id, root: resolveRemotePath(client.home, normRemote(m.remote)) }));
  const deletes = [];
  for (const m of s.mappings) {
    const mRoot = resolveRemotePath(client.home, normRemote(m.remote));
    const starts = s.subPaths.length ? s.subPaths.map((sp) => path.posix.join(mRoot, sp)) : [mRoot];
    for (const start of starts) {
      if (start === '/' || start === resolveRemotePath(client.home, '~')) {
        throw Object.assign(new Error(`Refusing to mirror ${start}: it is the server root or your home folder. Map the repository to a dedicated sub-folder first.`), { status: 400 });
      }
    }
    const nested = roots.filter((r) => r.id !== m.id && r.root !== mRoot && r.root.startsWith(mRoot + '/')).map((r) => r.root);
    const remoteFiles = [];
    for (const start of starts) remoteFiles.push(...(await listRemoteFiles(client, start, nested)));
    for (const f of remoteFiles) {
      if (planned.has(f) || nested.some((r) => f.startsWith(r + '/'))) continue;
      const rel = f.slice(mRoot.length + 1);
      const repoPath = excludePathFor(m, rel);
      if (excluded.some((fn) => fn(repoPath))) continue;
      deletes.push({ type: 'delete', path: repoPath, remote: f, mappingId: m.id, mirror: true });
    }
  }
  return deletes;
}

/** Everything a scoped sync will upload: git files from the commit + local folder files. */
async function planScopeAll(repo, s, dir, sha) {
  let ops = [];
  if (s.needsGit) ops = planScoped(repo, await listTree(dir, sha), s);
  const local = planLocal(repo, s.mappings, { mode: 'all', subPaths: s.subPaths });
  return { ops: [...ops, ...local.ops], manifests: local.manifests };
}

/** Dry run: what a scoped sync would upload / delete, without changing anything. */
async function previewScoped(repo, scope) {
  if (running.has(repo.id)) throw Object.assign(new Error('A deployment is running for this repository. Try again when it finishes.'), { status: 409 });
  const s = normScope(repo, scope);
  const p = (async () => {
    let dir = null;
    let sha = null;
    let subject = '';
    if (s.needsGit) {
      dir = await ensureClone(repo);
      sha = (await git(['rev-parse', `refs/remotes/origin/${repo.branch}`], { cwd: dir })).trim();
      subject = (await git(['log', '-1', '--format=%s', sha], { cwd: dir })).trim();
    }
    const { ops: uploads } = await planScopeAll(repo, s, dir, sha);
    let deletes = [];
    if (s.mirror) {
      await withClient(repo.connectionId, async (client) => {
        for (const op of uploads) op.remote = resolveRemotePath(client.home, op.remote);
        deletes = await mirrorDeletes(repo, client, s, uploads);
      });
    }
    const cap = (a) => a.slice(0, 1000).map((o) => ({ remote: o.remote, path: o.path, size: o.size, local: !!o.local }));
    const localDirs = s.mappings.filter(isLocalMapping).map((m) => localMappingDir(repo, m));
    return {
      sha, subject, scope: s.label, branch: repo.branch, localDirs, usesGit: s.needsGit,
      uploadCount: uploads.length, uploadBytes: uploads.reduce((n, o) => n + (o.size || 0), 0), deleteCount: deletes.length,
      uploads: cap(uploads), deletes: cap(deletes), truncated: uploads.length > 1000 || deletes.length > 1000,
    };
  })();
  running.set(repo.id, p);
  try {
    return await p;
  } finally {
    running.delete(repo.id);
    emitRepo(repo);
  }
}

/** Starts a scoped sync. Returns the deployment id right away. */
function syncScoped(repo, scope) {
  if (running.has(repo.id)) throw Object.assign(new Error('A deployment is already running for this repository.'), { status: 409 });
  const s = normScope(repo, scope);
  const depId = id('dep');
  const p = (async () => {
    try {
      return await deploy(repo, null, { trigger: s.everything ? 'manual-full' : 'manual-scoped', scope: s, depId, full: true });
    } finally {
      running.delete(repo.id);
      save();
      emitRepo(repo);
    }
  })();
  running.set(repo.id, p);
  return { deploymentId: depId, promise: p };
}

/** Sub-folders for the sub-folder picker: from git (branch head) or from disk for local mappings. */
async function repoTree(repo, rel, { refresh = false, mappingId = null } = {}) {
  const m = mappingId ? (repo.mappings || []).find((x) => x.id === mappingId) : null;
  if (m && isLocalMapping(m)) {
    const root = localMappingDir(repo, m);
    const base = normSub(rel);
    const dirPath = base ? path.join(root, ...base.split('/')) : root;
    if (!fs.existsSync(dirPath)) throw Object.assign(new Error(`Local folder not found: ${dirPath}`), { status: 404 });
    const dirs = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== '.git')
      .map((d) => ({ name: d.name, path: base ? `${base}/${d.name}` : d.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { path: base, dirs, local: true, root };
  }
  const dir = repoDir(repo);
  if (refresh && !running.has(repo.id)) await ensureClone(repo);
  else if (!fs.existsSync(path.join(dir, '.git'))) await ensureClone(repo);
  const sha = (await git(['rev-parse', `refs/remotes/origin/${repo.branch}`], { cwd: dir })).trim();
  const base = normSub(rel);
  const args = ['ls-tree', '-d', '-z', '--name-only', sha];
  if (base) args.push(`${base}/`);
  const out = await git(args, { cwd: dir });
  const dirs = out.split('\0').filter(Boolean).map((p) => ({ name: p.split('/').pop(), path: p }));
  return { path: base, sha, dirs };
}

/** Runs the repo's post-deploy shell command over SSH and streams its output into the deploy log. */
async function runPostCommand(repo, dep, client, command) {
  const wanted = repo.postDeployCwd || (repo.mappings && repo.mappings[0] && normRemote(repo.mappings[0].remote)) || '~';
  const cwd = resolveRemotePath(client.home, wanted);
  logDep(dep, 'info', `$ ${command}${cwd ? `   (in ${cwd})` : ''}`);
  const pending = { stdout: '', stderr: '' };
  const flush = (kind, final) => {
    const lines = pending[kind].split(/\r?\n/);
    pending[kind] = final ? '' : lines.pop();
    for (const l of lines) if (l.trim()) logDep(dep, kind === 'stderr' ? 'warn' : 'info', `  ${l}`);
  };
  try {
    const r = await client.exec(command, {
      cwd,
      timeoutMs: 15 * 60 * 1000,
      onData: (kind, text) => { pending[kind] += text; flush(kind, false); },
    });
    flush('stdout', true);
    flush('stderr', true);
    dep.commandExit = r.code;
    if (r.code === 0) logDep(dep, 'success', 'Post-deploy command finished (exit 0)');
    else {
      dep.commandFailed = true;
      logDep(dep, 'error', `Post-deploy command failed (exit ${r.code}${r.signal ? ', ' + r.signal : ''})`);
    }
  } catch (e) {
    dep.commandFailed = true;
    dep.commandExit = null;
    logDep(dep, 'error', `Post-deploy command error: ${e.message}`);
  }
}

async function deploy(repo, sha, { full = false, trigger = 'manual', scope = null, depId = null } = {}) {
  const dep = {
    id: depId || id('dep'),
    scope: scope ? scope.label : null,
    repoId: repo.id,
    repoName: repo.name,
    connectionId: repo.connectionId,
    trigger,
    from: full ? null : repo.lastDeployedSha || null,
    to: sha,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    done: 0,
    uploaded: 0,
    deleted: 0,
    failed: 0,
    bytes: 0,
    commit: null,
    full: false,
    log: [],
  };
  db.deployments.push(dep);
  trim();
  repo.status = 'deploying';
  repo.lastError = null;
  emitRepo(repo);
  broadcast('deploy', publicDeployment(dep));

  try {
    // A sync of local folders only (e.g. a build output) does not need git at all.
    const usesGit = !scope || scope.needsGit;
    let dir = null;
    if (usesGit) {
      dir = await ensureClone(repo, dep);
      if (!sha) sha = (await git(['rev-parse', `refs/remotes/origin/${repo.branch}`], { cwd: dir })).trim();
      dep.to = sha;
      await git(['checkout', '-f', '--detach', sha], { cwd: dir });
      await git(['clean', '-ffdx'], { cwd: dir }).catch(() => {});
      const info = (await git(['log', '-1', '--format=%H%x00%an%x00%ad%x00%s', '--date=iso-strict', sha], { cwd: dir })).trim().split('\0');
      dep.commit = { sha: info[0], author: info[1], date: info[2], message: info[3] };
      logDep(dep, 'info', `Commit ${sha.slice(0, 7)} by ${info[1]}: ${info[3]}`);
    }

    let ops;
    let manifests = {};
    if (scope) {
      dep.full = true;
      ({ ops, manifests } = await planScopeAll(repo, scope, dir, sha));
      for (const m of scope.mappings.filter(isLocalMapping)) logDep(dep, 'info', `Local folder: ${localMappingDir(repo, m)}`);
      logDep(dep, 'info', `Sync ${scope.label}: ${ops.length} file(s) to upload${scope.mirror ? ' (mirror: server files not in the source will be deleted)' : ''}.`);
    } else {
      const { full: isFull, changes } = await computeChanges(repo, dir, dep.from, sha, dep);
      dep.full = isFull;
      ops = plan(repo, changes);
      logDep(dep, 'info', `${isFull ? 'Full deploy' : `Diff ${dep.from.slice(0, 7)}..${sha.slice(0, 7)}`}: ${changes.length} changed file(s) in repo, ${ops.length} operation(s) after mappings/excludes.`);
      // Local folders (build outputs) ride along with automatic deploys: only what changed since the last upload.
      const autoLocal = (repo.mappings || []).filter((m) => isLocalMapping(m) && m.autoDeploy !== false);
      if (autoLocal.length) {
        try {
          const loc = planLocal(repo, autoLocal, { mode: isFull ? 'all' : 'changed' });
          ops.push(...loc.ops);
          manifests = loc.manifests;
          for (const m of autoLocal) logDep(dep, 'info', `Local folder ${localMappingDir(repo, m)}: ${loc.ops.filter((o) => o.mappingId === m.id).length} change(s) to send.`);
        } catch (e) {
          // Don't fail the git part because a build folder is missing; say so and carry on.
          logDep(dep, 'warn', `Local folder skipped: ${e.message}`);
        }
      }
    }
    dep.total = ops.length;
    broadcast('deploy', publicDeployment(dep));

    const command = String(repo.postDeployCommand || '').trim();
    const canExec = isSftp(getConnection(repo.connectionId));
    const wantCommand = !!command && (!scope || scope.runCommand);
    if (command && scope && !scope.runCommand) logDep(dep, 'info', 'Post-deploy command not run for this sync (not requested).');
    if (wantCommand && !canExec) logDep(dep, 'warn', 'Post-deploy command skipped: the connection is FTP, which cannot run commands (use an SSH connection).');
    const failedMappings = new Set();
    if (ops.length || (wantCommand && canExec) || (scope && scope.mirror)) {
      await withClient(repo.connectionId, async (client) => {
        // "~/x" or "x" targets are inside the login (home) folder: make them absolute now.
        for (const op of ops) op.remote = resolveRemotePath(client.home, op.remote);
        if (scope && scope.mirror) {
          const extra = await mirrorDeletes(repo, client, scope, ops);
          if (extra.length) logDep(dep, 'info', `Mirror: ${extra.length} server file(s) not in the source will be deleted.`);
          ops.push(...extra);
          dep.total = ops.length;
        }
        const madeDirs = new Set();
        let lastEmit = 0;
        for (const op of ops) {
          try {
            if (op.type === 'upload') {
              const localFile = op.abs || path.join(dir, ...op.path.split('/'));
              const st = fs.lstatSync(localFile);
              if (!st.isFile()) {
                logDep(dep, 'warn', `Skipped (not a regular file): ${op.path}`);
              } else {
                const parent = path.posix.dirname(op.remote);
                if (!madeDirs.has(parent)) {
                  await client.ensureDir(parent);
                  madeDirs.add(parent);
                }
                await client.uploadFrom(localFile, op.remote);
                dep.uploaded++;
                dep.bytes += st.size;
                logDep(dep, 'success', `Uploaded ${op.remote}`);
              }
            } else {
              try {
                await client.remove(op.remote);
                dep.deleted++;
                logDep(dep, 'success', `Deleted ${op.remote}`);
              } catch (e) {
                if (isNotFound(e)) logDep(dep, 'warn', `Already absent: ${op.remote}`);
                else throw e;
              }
            }
          } catch (e) {
            dep.failed++;
            if (op.mappingId) failedMappings.add(op.mappingId);
            logDep(dep, 'error', `${op.type === 'upload' ? 'Upload' : 'Delete'} failed for ${op.remote}: ${e.message}`);
            if (client.closed) throw new Error(`Connection lost: ${e.message}`);
          }
          dep.done++;
          const now = Date.now();
          if (now - lastEmit > 250) {
            lastEmit = now;
            broadcast('deploy', publicDeployment(dep));
          }
        }
        if (wantCommand && canExec && !dep.failed) await runPostCommand(repo, dep, client, command);
      });
    }

    // Remember what was uploaded from local folders, so the next deploy only sends changes.
    if (Object.keys(manifests).length) {
      const all = loadManifests(repo);
      for (const [mid, man] of Object.entries(manifests)) if (!failedMappings.has(mid)) all[mid] = man;
      saveManifests(repo, all);
    }
    dep.status = dep.failed ? 'failed' : dep.commandFailed ? 'warning' : 'success';
    if (scope && !scope.everything) {
      // Partial sync: the rest of the repository was not deployed, so the deployed commit stays as is.
      repo.status = dep.failed ? 'error' : dep.commandFailed ? 'warning' : repo.failedSha ? 'error' : 'idle';
      if (dep.failed) repo.lastError = `${dep.failed} file(s) failed in sync of ${scope.label}`;
    } else if (!dep.failed) {
      // Files are on the server even if the post-deploy command failed: don't upload them again.
      repo.lastDeployedSha = sha;
      repo.lastDeployedAt = new Date().toISOString();
      repo.failedSha = null;
      repo.status = dep.commandFailed ? 'warning' : 'idle';
      repo.lastError = dep.commandFailed ? `Post-deploy command exited with code ${dep.commandExit}` : null;
    } else {
      repo.failedSha = sha;
      repo.status = 'error';
      repo.lastError = `${dep.failed} file(s) failed`;
    }
  } catch (e) {
    dep.status = 'failed';
    repo.status = 'error';
    if (!scope || scope.everything) repo.failedSha = sha || null;
    repo.lastError = e.message;
    logDep(dep, 'error', e.message);
  }
  dep.finishedAt = new Date().toISOString();
  const secs = ((Date.parse(dep.finishedAt) - Date.parse(dep.startedAt)) / 1000).toFixed(1);
  const what = dep.scope && dep.trigger === 'manual-scoped' ? ` [${dep.scope}]` : '';
  const summary = `${repo.name}${what}: ${dep.status === 'success' ? 'deployed' : dep.status === 'warning' ? 'deployed (post-deploy command failed)' : 'deploy FAILED'} ${dep.to ? dep.to.slice(0, 7) : ''} — ${dep.uploaded} uploaded, ${dep.deleted} deleted, ${dep.failed} failed (${secs}s)`;
  const lvl = dep.status === 'success' ? 'success' : dep.status === 'warning' ? 'warn' : 'error';
  logDep(dep, lvl === 'warn' ? 'warn' : lvl, summary);
  activity(lvl, 'git', summary, { repoId: repo.id, deploymentId: dep.id });
  save();
  emitRepo(repo);
  broadcast('deploy', publicDeployment(dep));
  return dep;
}

/**
 * Check a repo's branch; deploy if it moved.
 * opts.force: deploy even if already deployed. opts.full: ignore diff, upload everything.
 */
function check(repo, opts = {}) {
  if (running.has(repo.id)) return running.get(repo.id);
  const p = (async () => {
    const { force = false, full = false, trigger = 'poll' } = opts;
    repo.status = 'checking';
    emitRepo(repo);
    let result = { deployed: false };
    try {
      const sha = await lsRemote(repo);
      repo.lastRemoteSha = sha;
      repo.lastCheckedAt = new Date().toISOString();
      if (repo.status === 'checking') repo.status = 'idle';
      if (!repo.failedSha) repo.lastError = null;

      if (!repo.lastDeployedSha && !repo.baselineDone && !force && !full) {
        repo.baselineDone = true;
        if (repo.initialDeploy) {
          result.deployment = await deploy(repo, sha, { full: true, trigger: 'initial' });
          result.deployed = true;
        } else {
          await ensureClone(repo).catch((e) => activity('warn', 'git', `${repo.name}: clone failed: ${e.message}`));
          repo.lastDeployedSha = sha;
          repo.lastDeployedAt = null;
          activity('info', 'git', `${repo.name}: baseline set at ${sha.slice(0, 7)} — future pushes to ${repo.branch} will be synced`, { repoId: repo.id });
        }
      } else if (force || full || sha !== repo.lastDeployedSha) {
        if (!force && !full && trigger === 'poll' && sha === repo.failedSha) {
          repo.status = 'error'; // already failed for this commit; wait for a manual retry or a new push
        } else {
          if (!force && !full) activity('info', 'git', `${repo.name}: new commit ${sha.slice(0, 7)} on ${repo.branch} detected (${trigger})`, { repoId: repo.id });
          result.deployment = await deploy(repo, sha, { full, trigger });
          result.deployed = true;
        }
      }
      result.sha = sha;
    } catch (e) {
      const repeated = repo.lastError === e.message;
      repo.status = 'error';
      repo.lastError = e.message;
      repo.lastCheckedAt = new Date().toISOString();
      // Don't flood the activity log when the same error repeats on every poll.
      if (!repeated || trigger !== 'poll') activity('error', 'git', `${repo.name}: ${e.message}`, { repoId: repo.id });
      result.error = e.message;
    } finally {
      running.delete(repo.id);
      save();
      emitRepo(repo);
    }
    return result;
  })();
  running.set(repo.id, p);
  return p;
}

/** Called by the pre-push hook: the push isn't on the remote yet, so poll briefly until it lands. */
async function triggerAfterPush(repo) {
  const deadline = Date.now() + 120000;
  activity('info', 'git', `${repo.name}: push hook received, waiting for ${repo.branch} to update on remote...`, { repoId: repo.id });
  while (Date.now() < deadline) {
    if (running.has(repo.id)) await running.get(repo.id);
    try {
      const sha = await lsRemote(repo);
      if (sha !== repo.lastDeployedSha) return check(repo, { trigger: 'push-hook' });
    } catch {}
    await new Promise((r) => setTimeout(r, 2500));
  }
  return { deployed: false };
}

// ---------------------------------------------------------------- hook install

async function hooksDir(localPath) {
  const p = (await git(['rev-parse', '--git-path', 'hooks'], { cwd: localPath })).trim();
  return path.resolve(localPath, p);
}

function hookScript(repo, port) {
  return `#!/bin/sh
${HOOK_MARKER} (repo ${repo.id})
# Notifies FTPGit Studio when ${repo.branch} is pushed so it deploys right away.
input=$(cat)
if [ -x "$(dirname "$0")/pre-push.ftpgit-orig" ]; then
  printf '%s\\n' "$input" | "$(dirname "$0")/pre-push.ftpgit-orig" "$@" || exit $?
fi
echo "$input" | while read local_ref local_sha remote_ref remote_sha; do
  if [ "$remote_ref" = "refs/heads/${repo.branch}" ]; then
    (curl -s -m 5 -X POST "http://127.0.0.1:${port}/api/repos/${repo.id}/trigger" >/dev/null 2>&1 &)
    echo "[ftpgit] ${repo.branch} push detected - FTP deploy will start once the push lands."
  fi
done
exit 0
`;
}

async function installHook(repo, port) {
  if (!repo.localPath) throw new Error('This repo has no local folder configured. Set "Local folder" to install the push hook.');
  const dir = await hooksDir(repo.localPath);
  fs.mkdirSync(dir, { recursive: true });
  const hook = path.join(dir, 'pre-push');
  if (fs.existsSync(hook)) {
    const cur = fs.readFileSync(hook, 'utf8');
    if (!cur.includes(HOOK_MARKER)) fs.renameSync(hook, path.join(dir, 'pre-push.ftpgit-orig'));
  }
  fs.writeFileSync(hook, hookScript(repo, port), { mode: 0o755 });
  try { fs.chmodSync(hook, 0o755); } catch {}
  return hook;
}

async function uninstallHook(repo) {
  if (!repo.localPath) return false;
  const dir = await hooksDir(repo.localPath);
  const hook = path.join(dir, 'pre-push');
  if (fs.existsSync(hook) && fs.readFileSync(hook, 'utf8').includes(HOOK_MARKER)) {
    fs.unlinkSync(hook);
    const orig = path.join(dir, 'pre-push.ftpgit-orig');
    if (fs.existsSync(orig)) fs.renameSync(orig, hook);
    return true;
  }
  return false;
}

async function hookInstalled(repo) {
  if (!repo.localPath || !fs.existsSync(repo.localPath)) return false;
  try {
    const hook = path.join(await hooksDir(repo.localPath), 'pre-push');
    return fs.existsSync(hook) && fs.readFileSync(hook, 'utf8').includes(HOOK_MARKER);
  } catch {
    return false;
  }
}

function removeRepoData(repo) {
  fs.rmSync(repoDir(repo), { recursive: true, force: true });
  fs.rmSync(manifestFile(repo), { force: true });
}

// ---------------------------------------------------------------- watcher

function startWatcher() {
  // reset stale states from a previous run
  for (const r of db.repos) if (r.status === 'checking' || r.status === 'deploying') r.status = 'idle';
  for (const d of db.deployments) if (d.status === 'running') { d.status = 'failed'; d.finishedAt = d.finishedAt || new Date().toISOString(); }
  const t = setInterval(() => {
    const now = Date.now();
    for (const repo of db.repos) {
      if (!repo.enabled || running.has(repo.id)) continue;
      const every = Math.max(10, Number(repo.pollSec) || Number(db.settings.defaultPollSec) || 60) * 1000;
      const last = repo.lastCheckedAt ? Date.parse(repo.lastCheckedAt) : 0;
      if (now - last >= every) check(repo, { trigger: 'poll' });
    }
  }, 3000);
  t.unref();
}

module.exports = {
  check, deploy, triggerAfterPush, inspectSource, listBranches, installHook, uninstallHook, hookInstalled,
  removeRepoData, startWatcher, publicRepo, publicDeployment, plan, compileExcludes, normLocal, normRemote, running,
  looksAbsoluteLocal, localMappingDir, isLocalMapping,
  previewScoped, syncScoped, repoTree, normScope,
};
