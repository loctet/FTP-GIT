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
  for (const m of repo.mappings || []) {
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
        if (m.deleteRemoved !== false) ops.push({ type: 'delete', path: ch.path, remote: target });
      } else ops.push({ type: 'upload', path: ch.path, remote: target });
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

async function deploy(repo, sha, { full = false, trigger = 'manual' } = {}) {
  const dep = {
    id: id('dep'),
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
    const dir = await ensureClone(repo, dep);
    if (!sha) sha = (await git(['rev-parse', `refs/remotes/origin/${repo.branch}`], { cwd: dir })).trim();
    dep.to = sha;
    await git(['checkout', '-f', '--detach', sha], { cwd: dir });
    await git(['clean', '-ffdx'], { cwd: dir }).catch(() => {});
    const info = (await git(['log', '-1', '--format=%H%x00%an%x00%ad%x00%s', '--date=iso-strict', sha], { cwd: dir })).trim().split('\0');
    dep.commit = { sha: info[0], author: info[1], date: info[2], message: info[3] };
    logDep(dep, 'info', `Commit ${sha.slice(0, 7)} by ${info[1]}: ${info[3]}`);

    const { full: isFull, changes } = await computeChanges(repo, dir, dep.from, sha, dep);
    dep.full = isFull;
    const ops = plan(repo, changes);
    dep.total = ops.length;
    logDep(dep, 'info', `${isFull ? 'Full deploy' : `Diff ${dep.from.slice(0, 7)}..${sha.slice(0, 7)}`}: ${changes.length} changed file(s) in repo, ${ops.length} FTP operation(s) after mappings/excludes.`);
    broadcast('deploy', publicDeployment(dep));

    const command = String(repo.postDeployCommand || '').trim();
    const canExec = isSftp(getConnection(repo.connectionId));
    if (command && !canExec) logDep(dep, 'warn', 'Post-deploy command skipped: the connection is FTP, which cannot run commands (use an SSH connection).');
    if (ops.length || (command && canExec)) {
      await withClient(repo.connectionId, async (client) => {
        // "~/x" or "x" targets are inside the login (home) folder: make them absolute now.
        for (const op of ops) op.remote = resolveRemotePath(client.home, op.remote);
        const madeDirs = new Set();
        let lastEmit = 0;
        for (const op of ops) {
          try {
            if (op.type === 'upload') {
              const localFile = path.join(dir, ...op.path.split('/'));
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
        if (command && canExec && !dep.failed) await runPostCommand(repo, dep, client, command);
      });
    }

    dep.status = dep.failed ? 'failed' : dep.commandFailed ? 'warning' : 'success';
    if (!dep.failed) {
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
    repo.failedSha = sha || null;
    repo.lastError = e.message;
    logDep(dep, 'error', e.message);
  }
  dep.finishedAt = new Date().toISOString();
  const secs = ((Date.parse(dep.finishedAt) - Date.parse(dep.startedAt)) / 1000).toFixed(1);
  const summary = `${repo.name}: ${dep.status === 'success' ? 'deployed' : dep.status === 'warning' ? 'deployed (post-deploy command failed)' : 'deploy FAILED'} ${dep.to ? dep.to.slice(0, 7) : ''} — ${dep.uploaded} uploaded, ${dep.deleted} deleted, ${dep.failed} failed (${secs}s)`;
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
};
