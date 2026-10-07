'use strict';
// End-to-end test: spins up a real FTP server (ftp-srv), a bare git "remote", and the app,
// then exercises the HTTP API exactly as the UI does.
//   node test/e2e.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ftpgit-e2e-'));
const FTP_ROOT = path.join(TMP, 'ftp-root');
const BARE = path.join(TMP, 'remote.git');
const WORK = path.join(TMP, 'work');
fs.mkdirSync(FTP_ROOT, { recursive: true });
process.env.FTPGIT_DATA = path.join(TMP, 'data');
process.env.PORT = '4399';

const FTP_PORT = 2221;
const SFTP_PORT = 2322;
const SFTP_ROOT = path.join(TMP, 'sftp-root');
const APP = `http://127.0.0.1:${process.env.PORT}`;

let passed = 0;
let failed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✔\x1b[0m ${name} \x1b[90m(${Date.now() - t0}ms)\x1b[0m`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✘ ${name}\x1b[0m\n      ${e.stack || e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(`Assertion failed: ${msg}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, every = 250, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function api(method, url, body) {
  const init = { method, headers: {} };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await fetch(APP + url, init);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status}: ${data.error || data}`);
  return data;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
}
function write(rel, content) {
  const f = path.join(WORK, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

async function startFtp() {
  const FtpSrv = require('ftp-srv');
  const bunyan = { child: () => bunyan, info() {}, debug() {}, trace() {}, warn() {}, error() {}, fatal() {} };
  const srv = new FtpSrv({
    url: `ftp://127.0.0.1:${FTP_PORT}`,
    pasv_url: '127.0.0.1',
    pasv_min: 2230,
    pasv_max: 2260,
    anonymous: false,
    greeting: 'ftpgit test server',
    log: bunyan,
  });
  srv.on('login', ({ username, password }, resolve, reject) => {
    if (username === 'tester' && password === 's3cret!') resolve({ root: FTP_ROOT });
    else reject(new Error('Bad credentials'));
  });
  srv.on('client-error', () => {});
  await srv.listen();
  return srv;
}

(async () => {
  console.log(`\nFTPGit Studio e2e — temp: ${TMP}\n`);
  const ftpSrv = await startFtp();
  // A connection saved by the pre-SSH version (no protocol field) on port 22.
  fs.mkdirSync(process.env.FTPGIT_DATA, { recursive: true });
  fs.writeFileSync(path.join(process.env.FTPGIT_DATA, 'db.json'), JSON.stringify({ connections: [{ id: 'con_legacy', name: 'Legacy', host: '127.0.0.1', port: 22, user: 'x', secure: 'none', remoteRoot: '/' }, { id: 'con_legacy_ssh', name: 'Old SSH', protocol: 'sftp', host: '127.0.0.1', port: 2200, user: 'x', secure: 'none', remoteRoot: '/' }] }));
  const { start } = require('../server/index');
  const server = await start(Number(process.env.PORT), '127.0.0.1');
  const { db } = require('../server/store');

  let cid;
  const ftpConf = { name: 'Local test FTP', host: '127.0.0.1', port: FTP_PORT, user: 'tester', password: 's3cret!', secure: 'none', remoteRoot: '/' };

  console.log('FTP connections');
  await step('legacy port-22 connection is migrated to SSH on startup', async () => {
    const c = db.connections.find((x) => x.id === 'con_legacy');
    assert(c && c.protocol === 'sftp', JSON.stringify(c));
    db.connections.splice(db.connections.indexOf(c), 1);
  });
  await step('rejects wrong password with friendly error', async () => {
    let msg = '';
    try { await api('POST', '/api/connections/test', { ...ftpConf, password: 'nope' }); } catch (e) { msg = e.message; }
    assert(/530|Login|credentials|incorrect/i.test(msg), `got: ${msg}`);
  });
  await step('test connection succeeds', async () => {
    const r = await api('POST', '/api/connections/test', ftpConf);
    assert(r.ok && r.pwd, 'test ok');
  });
  await step('create connection (password stored encrypted, never returned)', async () => {
    const c = await api('POST', '/api/connections', ftpConf);
    cid = c.id;
    assert(c.hasPassword && !c.passwordEnc && !c.password, 'password hidden');
    await sleep(400);
    const raw = fs.readFileSync(path.join(process.env.FTPGIT_DATA, 'db.json'), 'utf8');
    const raw2 = fs.readFileSync(path.join(process.env.FTPGIT_DATA, 'db.json'), 'utf8');
    assert(!raw.includes('s3cret!') && !raw2.includes('s3cret!'), 'plaintext password not on disk');
  });

  console.log('File operations');
  await step('list root', async () => {
    const r = await api('GET', `/api/ftp/${cid}/list?path=/`);
    assert(r.path === '/' && Array.isArray(r.entries), 'list');
  });
  await step('mkdir /uploads', async () => {
    await api('POST', `/api/ftp/${cid}/mkdir`, { path: '/uploads' });
    assert(fs.existsSync(path.join(FTP_ROOT, 'uploads')), 'dir exists');
  });
  await step('multipart upload: 2 files incl. nested folder + unicode name', async () => {
    const fd = new FormData();
    fd.append('relpath', 'hello.txt');
    fd.append('relpath', 'nested/deep/données-é.txt');
    fd.append('files', new Blob(['hello world']), 'hello.txt');
    fd.append('files', new Blob(['x'.repeat(200000)]), 'donnees.txt');
    const r = await fetch(`${APP}/api/ftp/${cid}/upload?path=/uploads&tid=t1`, { method: 'POST', body: fd }).then((x) => x.json());
    assert(r.results.length === 2 && r.results.every((x) => x.ok), JSON.stringify(r));
    assert(fs.readFileSync(path.join(FTP_ROOT, 'uploads', 'hello.txt'), 'utf8') === 'hello world', 'content');
    assert(fs.statSync(path.join(FTP_ROOT, 'uploads', 'nested', 'deep', 'données-é.txt')).size === 200000, 'nested size');
  });
  await step('list shows uploaded entries with sizes', async () => {
    const r = await api('GET', `/api/ftp/${cid}/list?path=/uploads`);
    const names = r.entries.map((e) => `${e.type}:${e.name}`);
    assert(names[0] === 'dir:nested' && names.includes('file:hello.txt'), names.join(','));
    assert(r.entries.find((e) => e.name === 'hello.txt').size === 11, 'size');
  });
  await step('read + edit text content', async () => {
    const r = await api('GET', `/api/ftp/${cid}/content?path=/uploads/hello.txt`);
    assert(r.content === 'hello world', 'read');
    const w = await fetch(`${APP}/api/ftp/${cid}/content?path=/uploads/hello.txt`, { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'edited ✓' });
    assert(w.ok, 'put');
    assert(fs.readFileSync(path.join(FTP_ROOT, 'uploads', 'hello.txt'), 'utf8') === 'edited ✓', 'written');
  });
  await step('download streams file with attachment header', async () => {
    const r = await fetch(`${APP}/api/ftp/${cid}/download?path=/uploads/hello.txt`);
    assert(r.ok && /attachment/.test(r.headers.get('content-disposition')), 'headers');
    assert((await r.text()) === 'edited ✓', 'body');
  });
  await step('rename / move', async () => {
    await api('POST', `/api/ftp/${cid}/rename`, { from: '/uploads/hello.txt', to: '/uploads/nested/hi.txt' });
    assert(fs.existsSync(path.join(FTP_ROOT, 'uploads', 'nested', 'hi.txt')), 'moved');
  });
  await step('delete file + recursive folder', async () => {
    const r = await api('POST', `/api/ftp/${cid}/delete`, { items: [{ path: '/uploads/nested/hi.txt', type: 'file' }, { path: '/uploads', type: 'dir' }] });
    assert(r.results.every((x) => x.ok), JSON.stringify(r.results));
    assert(!fs.existsSync(path.join(FTP_ROOT, 'uploads')), 'gone');
  });
  await step('refuses to delete root', async () => {
    const r = await api('POST', `/api/ftp/${cid}/delete`, { items: [{ path: '/', type: 'dir' }] });
    assert(!r.results[0].ok, 'refused');
  });

  console.log('Idle disconnect + silent reconnect');
  await step('session goes idle after inactivity, next action reconnects without credentials', async () => {
    db.settings.idleTimeoutMin = 0.05; // 3 seconds for the test
    await api('GET', `/api/ftp/${cid}/list?path=/`);
    let st = (await api('GET', '/api/state')).sessions.find((s) => s.connectionId === cid);
    assert(st.state === 'connected', `expected connected, got ${st.state}`);
    await waitFor(async () => (await api('GET', '/api/state')).sessions.find((s) => s.connectionId === cid).state === 'idle', 15000, 500, 'idle');
    const r = await api('GET', `/api/ftp/${cid}/list?path=/`); // no password sent
    assert(Array.isArray(r.entries), 'listing after idle');
    st = (await api('GET', '/api/state')).sessions.find((s) => s.connectionId === cid);
    assert(st.state === 'connected', `reconnected, got ${st.state}`);
    db.settings.idleTimeoutMin = 10;
  });
  await step('recovers when the server drops the socket', async () => {
    const { session } = require('../server/ftpManager');
    const s = session(cid);
    s.client.client.ftp.socket.destroy(); // simulate server-side disconnect
    await sleep(100);
    const r = await api('GET', `/api/ftp/${cid}/list?path=/`);
    assert(Array.isArray(r.entries), 'listing after drop');
  });

  console.log('Git → FTP sync');
  let rid;
  await step('prepare bare remote + working clone with main branch', async () => {
    git(['init', '--bare', '--initial-branch=main', BARE], TMP);
    git(['clone', BARE, WORK], TMP);
    git(['config', 'user.email', 'test@example.com'], WORK);
    git(['config', 'user.name', 'E2E Tester'], WORK);
    git(['checkout', '-b', 'main'], WORK);
    write('dist/index.html', '<h1>v1</h1>');
    write('dist/old.txt', 'to be deleted');
    write('dist/app.js.map', 'excluded');
    write('dist/assets/logo.svg', '<svg/>');
    write('api/handler.php', '<?php echo 1;');
    write('README.md', 'readme');
    git(['add', '-A'], WORK);
    git(['commit', '-m', 'initial'], WORK);
    git(['push', '-u', 'origin', 'main'], WORK);
  });
  await step('inspect local folder finds origin + branches', async () => {
    const r = await api('POST', '/api/git/inspect', { source: WORK });
    assert(path.resolve(r.localPath) === path.resolve(WORK), `localPath ${r.localPath}`);
    assert(r.branches.includes('main'), 'branches');
  });
  await step('add repo with 2 mappings (baseline mode + push hook)', async () => {
    const info = await api('POST', '/api/git/inspect', { source: WORK });
    const r = await api('POST', '/api/repos', {
      name: 'site', url: info.url, localPath: WORK, branch: 'main', connectionId: cid,
      mappings: [{ local: 'dist', remote: '/public_html', deleteRemoved: true }, { local: 'api', remote: '/public_html/api' }],
      excludes: '*.map\n.github/', pollSec: 3600, installHook: true,
    });
    rid = r.id;
    assert(r.hook && !r.hook.error, `hook: ${JSON.stringify(r.hook)}`);
    const repo = await waitFor(async () => { const x = await api('GET', `/api/repos/${rid}`); return x.lastDeployedSha ? x : null; }, 30000, 300, 'baseline');
    assert(repo.lastDeployedSha === git(['rev-parse', 'HEAD'], WORK), 'baseline = HEAD');
    assert(repo.hookInstalled, 'hook installed');
    assert(!fs.existsSync(path.join(FTP_ROOT, 'public_html')), 'nothing uploaded in baseline mode');
  });
  await step('full redeploy uploads mapped folders, respects excludes', async () => {
    const r = await api('POST', `/api/repos/${rid}/sync`, { full: true, wait: true });
    assert(r.deployed && r.deployment.status === 'success', JSON.stringify(r.deployment && r.deployment.log.slice(-3)));
    const pub = path.join(FTP_ROOT, 'public_html');
    assert(fs.readFileSync(path.join(pub, 'index.html'), 'utf8') === '<h1>v1</h1>', 'index');
    assert(fs.existsSync(path.join(pub, 'assets', 'logo.svg')), 'nested asset');
    assert(fs.existsSync(path.join(pub, 'api', 'handler.php')), 'second mapping');
    assert(!fs.existsSync(path.join(pub, 'app.js.map')), 'excluded *.map');
    assert(!fs.existsSync(path.join(pub, 'README.md')), 'unmapped file not uploaded');
  });
  await step('git push to main triggers incremental deploy via pre-push hook', async () => {
    const before = db.deployments.length;
    write('dist/index.html', '<h1>v2</h1>');
    write('dist/css/site.css', 'body{}');
    fs.unlinkSync(path.join(WORK, 'dist', 'old.txt'));
    write('README.md', 'changed but unmapped');
    git(['add', '-A'], WORK);
    git(['commit', '-m', 'v2: new css, drop old.txt'], WORK);
    const out = execFileSync('git', ['push', 'origin', 'main'], { cwd: WORK, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    void out;
    const head = git(['rev-parse', 'HEAD'], WORK);
    const dep = await waitFor(() => db.deployments.slice(before).find((d) => d.to === head && d.status !== 'running'), 60000, 300, 'hook deploy');
    assert(dep.status === 'success', dep.log.map((l) => l.message).join('\n'));
    assert(dep.trigger === 'push-hook', `trigger ${dep.trigger}`);
    assert(dep.uploaded === 2 && dep.deleted === 1, `uploaded ${dep.uploaded} deleted ${dep.deleted}`);
    const pub = path.join(FTP_ROOT, 'public_html');
    assert(fs.readFileSync(path.join(pub, 'index.html'), 'utf8') === '<h1>v2</h1>', 'updated');
    assert(fs.existsSync(path.join(pub, 'css', 'site.css')), 'new file');
    assert(!fs.existsSync(path.join(pub, 'old.txt')), 'deleted file removed');
  });
  await step('push without hook is picked up by polling ("Sync now")', async () => {
    await api('DELETE', `/api/repos/${rid}/hook`);
    write('dist/index.html', '<h1>v3</h1>');
    git(['commit', '-am', 'v3'], WORK);
    git(['push', 'origin', 'main'], WORK);
    await sleep(500);
    assert(fs.readFileSync(path.join(FTP_ROOT, 'public_html', 'index.html'), 'utf8') === '<h1>v2</h1>', 'not deployed without trigger');
    const r = await api('POST', `/api/repos/${rid}/sync`, { wait: true });
    assert(r.deployed && r.deployment.status === 'success' && r.deployment.uploaded === 1, JSON.stringify(r).slice(0, 300));
    assert(fs.readFileSync(path.join(FTP_ROOT, 'public_html', 'index.html'), 'utf8') === '<h1>v3</h1>', 'v3');
  });
  await step('no-op sync when already up to date', async () => {
    const r = await api('POST', `/api/repos/${rid}/sync`, { wait: true });
    assert(!r.deployed, 'nothing to deploy');
  });
  await step('push to another branch is ignored', async () => {
    git(['checkout', '-b', 'feature'], WORK);
    write('dist/index.html', '<h1>feature</h1>');
    git(['commit', '-am', 'feature'], WORK);
    git(['push', 'origin', 'feature'], WORK);
    const r = await api('POST', `/api/repos/${rid}/sync`, { wait: true });
    assert(!r.deployed, 'feature branch not deployed');
    assert(fs.readFileSync(path.join(FTP_ROOT, 'public_html', 'index.html'), 'utf8') === '<h1>v3</h1>', 'unchanged');
    git(['checkout', 'main'], WORK);
  });
  await step('deployment log is retrievable', async () => {
    const list = await api('GET', `/api/deployments?repoId=${rid}`);
    assert(list.length >= 3, 'history');
    const d = await api('GET', `/api/deployments/${list[0].id}`);
    assert(d.log.length > 2 && d.commit && d.commit.message === 'v3', 'log + commit');
  });
  await step('exclude/mapping planner unit checks', async () => {
    const { plan } = require('../server/gitSync');
    const ops = plan({ mappings: [{ local: 'dist', remote: '/www', deleteRemoved: false }, { local: '', remote: '/all' }], excludes: ['node_modules/', '*.map', 'dist/private/**'] }, [
      { status: 'A', path: 'dist/a.js' }, { status: 'A', path: 'dist/a.js.map' }, { status: 'D', path: 'dist/b.js' },
      { status: 'A', path: 'node_modules/x/index.js' }, { status: 'A', path: 'dist/private/key.txt' }, { status: 'M', path: 'distillery/x' },
    ]);
    const s = ops.map((o) => `${o.type}:${o.remote}`).sort().join(' ');
    assert(s === 'delete:/all/dist/b.js upload:/all/dist/a.js upload:/all/distillery/x upload:/www/a.js', s);
  });
  await step('remove repo cleans hook + cache', async () => {
    await api('POST', `/api/repos/${rid}/hook`);
    await api('DELETE', `/api/repos/${rid}`);
    const hook = path.join(WORK, '.git', 'hooks', 'pre-push');
    assert(!fs.existsSync(hook), 'hook removed');
    assert(!fs.existsSync(path.join(process.env.FTPGIT_DATA, 'repos', rid)), 'cache removed');
  });
  // ================================================================ SFTP / SSH
  console.log('SFTP / SSH');
  const { utils: sshUtils } = require('ssh2');
  const clientKeys = sshUtils.generateKeyPairSync('ed25519');
  const otherKeys = sshUtils.generateKeyPairSync('ed25519');
  const KEY_FILE = path.join(TMP, 'id_ed25519');
  fs.writeFileSync(KEY_FILE, clientKeys.private);
  const { startSftpServer } = require('./dev-sftp');
  const sftpSrv = await startSftpServer({ port: SFTP_PORT, root: SFTP_ROOT, user: 'deploy', password: 'ssh-pass!', publicKey: clientKeys.public });
  const sftpConf = { name: 'Local SFTP', protocol: 'sftp', host: '127.0.0.1', port: SFTP_PORT, user: 'deploy', password: 'ssh-pass!', remoteRoot: '/' };
  let sid;

  await step('SFTP test connection returns host key fingerprint', async () => {
    const r = await api('POST', '/api/connections/test', sftpConf);
    assert(r.ok && r.protocol === 'sftp' && /^SHA256:/.test(r.hostKey), JSON.stringify(r));
  });
  await step('SFTP wrong password gives auth error (401)', async () => {
    let msg = '';
    try { await api('POST', '/api/connections/test', { ...sftpConf, password: 'nope' }); } catch (e) { msg = e.message; }
    assert(/-> 401: SSH authentication failed/.test(msg), msg);
  });
  await step('create SFTP connection; host key trusted on first use', async () => {
    const c = await api('POST', '/api/connections', sftpConf);
    sid = c.id;
    assert(c.protocol === 'sftp' && c.port === SFTP_PORT && c.hasPassword, JSON.stringify(c));
    await api('GET', `/api/ftp/${sid}/list?path=/`);
    const saved = db.connections.find((x) => x.id === sid);
    assert(/^SHA256:/.test(saved.hostKey), 'hostKey stored');
  });
  await step('wrong protocol for the port is detected fast with a clear message', async () => {
    const t0 = Date.now();
    let msg = '';
    try { await api('POST', '/api/connections/test', { protocol: 'ftp', host: '127.0.0.1', port: SFTP_PORT, user: 'deploy', password: 'x' }); } catch (e) { msg = e.message; }
    assert(/-> 400: .*is an SSH server.*choose the SSH connection type/.test(msg), msg);
    assert(Date.now() - t0 < 9000, `took ${Date.now() - t0}ms`);
    msg = '';
    try { await api('POST', '/api/connections/test', { protocol: 'ssh', host: '127.0.0.1', port: FTP_PORT, user: 'tester', password: 'x' }); } catch (e) { msg = e.message; }
    assert(/-> 400: .*is an FTP server/.test(msg), msg);
  });
  await step('"ssh" connection type with just host, user and password', async () => {
    const c = await api('POST', '/api/connections', { protocol: 'ssh', host: '127.0.0.1', port: SFTP_PORT, user: 'deploy', password: 'ssh-pass!' });
    assert(c.protocol === 'sftp' && c.name === '127.0.0.1' && c.port === SFTP_PORT, JSON.stringify(c));
    const l = await api('GET', `/api/ftp/${c.id}/list?path=/`);
    assert(Array.isArray(l.entries), 'list');
    await api('DELETE', `/api/connections/${c.id}`);
  });
  await step('SFTP: mkdir, upload (nested), list, edit, download', async () => {
    await api('POST', `/api/ftp/${sid}/mkdir`, { path: '/site' });
    const fd = new FormData();
    fd.append('relpath', 'a.txt');
    fd.append('relpath', 'deep/er/b.bin');
    fd.append('files', new Blob(['alpha']), 'a.txt');
    fd.append('files', new Blob([new Uint8Array(300000).fill(9)]), 'b.bin');
    const up = await fetch(`${APP}/api/ftp/${sid}/upload?path=/site&tid=s1`, { method: 'POST', body: fd }).then((x) => x.json());
    assert(up.results.every((x) => x.ok), JSON.stringify(up));
    assert(fs.statSync(path.join(SFTP_ROOT, 'site', 'deep', 'er', 'b.bin')).size === 300000, 'nested upload');
    const l = await api('GET', `/api/ftp/${sid}/list?path=/site`);
    const names = l.entries.map((e) => `${e.type}:${e.name}`).join(',');
    assert(names === 'dir:deep,file:a.txt', names);
    await fetch(`${APP}/api/ftp/${sid}/content?path=/site/a.txt`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'beta ✓' });
    assert((await api('GET', `/api/ftp/${sid}/content?path=/site/a.txt`)).content === 'beta ✓', 'edit');
    const dl = await fetch(`${APP}/api/ftp/${sid}/download?path=/site/a.txt`);
    assert(dl.ok && (await dl.text()) === 'beta ✓', 'download');
    const missing = await fetch(`${APP}/api/ftp/${sid}/download?path=/site/missing.txt`);
    assert(missing.status === 404 && !missing.headers.get('content-disposition'), `missing -> ${missing.status}`);
  });
  await step('SFTP: rename over an existing file, chmod, recursive delete', async () => {
    await fetch(`${APP}/api/ftp/${sid}/content?path=/site/c.txt`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'gamma' });
    await api('POST', `/api/ftp/${sid}/rename`, { from: '/site/c.txt', to: '/site/a.txt' });
    assert(fs.readFileSync(path.join(SFTP_ROOT, 'site', 'a.txt'), 'utf8') === 'gamma', 'overwrite rename');
    await api('POST', `/api/ftp/${sid}/chmod`, { path: '/site/a.txt', mode: '644' });
    const r = await api('POST', `/api/ftp/${sid}/delete`, { items: [{ path: '/site', type: 'dir' }] });
    assert(r.results[0].ok && !fs.existsSync(path.join(SFTP_ROOT, 'site')), JSON.stringify(r));
  });
  await step('SSH key auth: pasted private key, key file path, wrong key rejected', async () => {
    const base = { ...sftpConf, password: '' };
    const r1 = await api('POST', '/api/connections/test', { ...base, privateKey: clientKeys.private });
    assert(r1.ok, 'pasted key');
    const r2 = await api('POST', '/api/connections/test', { ...base, keyPath: KEY_FILE });
    assert(r2.ok, 'key file');
    let msg = '';
    try { await api('POST', '/api/connections/test', { ...base, privateKey: otherKeys.private }); } catch (e) { msg = e.message; }
    assert(/401/.test(msg), `wrong key: ${msg}`);
    const k = await api('POST', '/api/connections', { ...base, name: 'Key only', privateKey: clientKeys.private });
    assert(k.hasPrivateKey && !k.privateKeyEnc && !k.hasPassword, 'key stored, not returned');
    await sleep(300);
    assert(!fs.readFileSync(path.join(process.env.FTPGIT_DATA, 'db.json'), 'utf8').includes('PRIVATE KEY'), 'private key encrypted at rest');
    const l = await api('GET', `/api/ftp/${k.id}/list?path=/`);
    assert(Array.isArray(l.entries), 'list with key auth');
    await api('DELETE', `/api/connections/${k.id}`);
  });
  await step('changed host key is refused until trusted again', async () => {
    const { dropSession } = require('../server/ftpManager');
    const saved = db.connections.find((x) => x.id === sid);
    const good = saved.hostKey;
    saved.hostKey = 'SHA256:not-the-real-key';
    dropSession(sid);
    const r = await fetch(`${APP}/api/ftp/${sid}/list?path=/`);
    const body = await r.json();
    assert(r.status === 409 && body.code === 'HOSTKEY_MISMATCH' && body.hostKey === good, `${r.status} ${JSON.stringify(body)}`);
    await api('PUT', `/api/connections/${sid}`, { trustNewHostKey: true });
    await api('GET', `/api/ftp/${sid}/list?path=/`);
    assert(db.connections.find((x) => x.id === sid).hostKey === good, 're-trusted');
  });
  await step('SFTP session idles out and reconnects silently', async () => {
    db.settings.idleTimeoutMin = 0.05;
    await api('GET', `/api/ftp/${sid}/list?path=/`);
    await waitFor(async () => (await api('GET', '/api/state')).sessions.find((s) => s.connectionId === sid).state === 'idle', 15000, 500, 'sftp idle');
    const r = await api('GET', `/api/ftp/${sid}/list?path=/`);
    assert(Array.isArray(r.entries), 'reconnected');
    db.settings.idleTimeoutMin = 10;
  });
  await step('SSH exec endpoint runs a command (and is refused for FTP)', async () => {
    fs.mkdirSync(path.join(SFTP_ROOT, 'work'), { recursive: true });
    const r = await api('POST', `/api/connections/${sid}/exec`, { command: 'echo exec-ok', cwd: '/work' });
    assert(r.code === 0 && r.stdout.includes('exec-ok'), JSON.stringify(r));
    let msg = '';
    try { await api('POST', `/api/connections/${cid}/exec`, { command: 'ls' }); } catch (e) { msg = e.message; }
    assert(/400/.test(msg), msg);
  });
  await step('web terminal: WebSocket SSH shell round-trip', async () => {
    const WebSocket = require('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT}/api/ssh/${sid}/shell?cols=100&rows=30&cwd=/work`, { origin: `http://127.0.0.1:${process.env.PORT}` });
    let out = '';
    let ready = false;
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'ready') ready = true;
      if (m.t === 'd') out += m.d;
      if (m.t === 'err') out += `ERR:${m.msg}`;
    });
    await waitFor(() => ready || out.includes('ERR:'), 10000, 50, 'terminal ready');
    assert(ready, out);
    ws.send(JSON.stringify({ t: 'r', cols: 80, rows: 20 }));
    ws.send(JSON.stringify({ t: 'd', d: 'echo term-e2e-ok\r' }));
    await waitFor(() => /term-e2e-ok[\s\S]*term-e2e-ok/.test(out), 10000, 50, 'command output');
    assert(out.includes(':/work$'), 'started in requested folder');
    ws.close();
  });
  await step('web terminal refuses foreign origins and FTP connections', async () => {
    const WebSocket = require('ws');
    const status = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT}/api/ssh/${sid}/shell`, { origin: 'https://evil.example.com' });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('open', () => resolve('opened'));
      ws.on('error', () => {});
    });
    assert(status === 403, `foreign origin -> ${status}`);
    const msg = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT}/api/ssh/${cid}/shell`);
      ws.on('message', (raw) => resolve(JSON.parse(raw.toString())));
      ws.on('error', () => resolve(null));
    });
    assert(msg && msg.t === 'err' && /SSH connection/.test(msg.msg), JSON.stringify(msg));
  });
  let srid;
  await step('git deploy over SFTP + post-deploy SSH command', async () => {
    const info = await api('POST', '/api/git/inspect', { source: WORK });
    const r = await api('POST', '/api/repos', {
      name: 'site-sftp', url: info.url, branch: 'main', connectionId: sid,
      mappings: [{ local: 'dist', remote: '/www' }], excludes: '*.map', pollSec: 3600, initialDeploy: true,
      postDeployCommand: 'echo deployed-ok> marker.txt', postDeployCwd: '/www',
    });
    srid = r.id;
    const dep = await waitFor(() => db.deployments.find((d) => d.repoId === srid && d.status !== 'running'), 30000, 200, 'sftp deploy');
    assert(dep.status === 'success', dep.log.map((l) => l.message).join('\n'));
    assert(fs.readFileSync(path.join(SFTP_ROOT, 'www', 'index.html'), 'utf8') === '<h1>v3</h1>', 'index deployed');
    assert(fs.existsSync(path.join(SFTP_ROOT, 'www', 'css', 'site.css')), 'nested deployed');
    assert(fs.readFileSync(path.join(SFTP_ROOT, 'www', 'marker.txt'), 'utf8').trim() === 'deployed-ok', 'post command ran in /www');
    assert(dep.log.some((l) => /Post-deploy command finished/.test(l.message)), 'logged');
  });
  await step('failing post-deploy command marks deploy "warning" but keeps files', async () => {
    await api('PUT', `/api/repos/${srid}`, { postDeployCommand: 'echo boom 1>&2 && exit 3' });
    write('dist/index.html', '<h1>v4</h1>');
    git(['commit', '-am', 'v4'], WORK);
    git(['push', 'origin', 'main'], WORK);
    const r = await api('POST', `/api/repos/${srid}/sync`, { wait: true });
    assert(r.deployment.status === 'warning', r.deployment.status);
    assert(r.deployment.log.some((l) => l.level === 'warn' && /boom/.test(l.message)), 'stderr captured');
    assert(fs.readFileSync(path.join(SFTP_ROOT, 'www', 'index.html'), 'utf8') === '<h1>v4</h1>', 'files still deployed');
    const repo = await api('GET', `/api/repos/${srid}`);
    assert(repo.lastDeployedSha === git(['rev-parse', 'HEAD'], WORK) && repo.status === 'warning', `${repo.status}`);
    await api('DELETE', `/api/repos/${srid}`);
  });

  // ================================================================ SSH home folder (shared hosting layout)
  console.log('SSH home folder (shared-hosting layout: unreadable "/")');
  const HOME_PORT = SFTP_PORT + 1;
  const HOME_ROOT = path.join(TMP, 'sftp-home-root');
  const homeSrv = await startSftpServer({ port: HOME_PORT, root: HOME_ROOT, user: 'ovh', password: 'ovh-pass', home: '/homez.42/ovh', lockRoot: true });
  let hid;
  await step('new SSH connection starts in the home folder, not "/"', async () => {
    const c = await api('POST', '/api/connections', { protocol: 'ssh', host: '127.0.0.1', port: HOME_PORT, user: 'ovh', password: 'ovh-pass' });
    hid = c.id;
    assert(c.remoteRoot === '~', `remoteRoot ${c.remoteRoot}`);
    fs.mkdirSync(path.join(HOME_ROOT, 'homez.42', 'ovh', 'erp-api'), { recursive: true });
    const l = await api('GET', `/api/ftp/${hid}/list`);
    assert(l.path === '/homez.42/ovh' && l.entries.some((e) => e.name === 'erp-api' && e.path === '/homez.42/ovh/erp-api'), JSON.stringify(l));
  });
  await step('"~/x" paths resolve to the home folder; "/" is refused like on OVH', async () => {
    const l = await api('GET', `/api/ftp/${hid}/list?path=${encodeURIComponent('~/erp-api')}`);
    assert(l.path === '/homez.42/ovh/erp-api', l.path);
    const r = await fetch(`${APP}/api/ftp/${hid}/list?path=/`);
    assert(r.status === 403, `root -> ${r.status}`);
  });
  await step('upload into "~/erp-api" lands in the home folder', async () => {
    const fd = new FormData();
    fd.append('relpath', 'index.php');
    fd.append('files', new Blob(['<?php echo 1;']), 'index.php');
    const up = await fetch(`${APP}/api/ftp/${hid}/upload?path=${encodeURIComponent('~/erp-api')}&tid=h1`, { method: 'POST', body: fd }).then((x) => x.json());
    assert(up.results[0].ok && up.results[0].path === '/homez.42/ovh/erp-api/index.php', JSON.stringify(up));
    assert(fs.existsSync(path.join(HOME_ROOT, 'homez.42', 'ovh', 'erp-api', 'index.php')), 'on disk');
  });
  await step('git deploy to "~/erp-frontend" + post-deploy command in that folder', async () => {
    const info = await api('POST', '/api/git/inspect', { source: WORK });
    const r = await api('POST', '/api/repos', {
      name: 'erp-frontend', url: info.url, branch: 'main', connectionId: hid,
      mappings: [{ local: 'dist', remote: '~/erp-frontend' }], pollSec: 3600, initialDeploy: true,
      postDeployCommand: 'echo built> built.txt',
    });
    assert(r.mappings[0].remote === '~/erp-frontend', r.mappings[0].remote);
    const dep = await waitFor(() => db.deployments.find((d) => d.repoId === r.id && d.status !== 'running'), 30000, 200, 'home deploy');
    assert(dep.status === 'success', dep.log.map((l) => l.message).join('\n'));
    const target = path.join(HOME_ROOT, 'homez.42', 'ovh', 'erp-frontend');
    assert(fs.existsSync(path.join(target, 'index.html')), 'deployed into home');
    assert(fs.readFileSync(path.join(target, 'built.txt'), 'utf8').trim() === 'built', 'command ran in ~/erp-frontend');
    await api('DELETE', `/api/repos/${r.id}`);
  });
  await step('relative and "~" paths are normalized consistently', async () => {
    const { resolveRemotePath, normalizeConfiguredPath } = require('../server/remote');
    const cases = [
      [resolveRemotePath('/h/u', '~'), '/h/u'], [resolveRemotePath('/h/u', ''), '/h/u'], [resolveRemotePath('/h/u', '~/a/'), '/h/u/a'],
      [resolveRemotePath('/h/u', 'a/b'), '/h/u/a/b'], [resolveRemotePath('/h/u', '/x/../y'), '/y'], [resolveRemotePath('/', '~/a'), '/a'],
      [normalizeConfiguredPath('erp-api'), '~/erp-api'], [normalizeConfiguredPath('~/a//b/'), '~/a/b'], [normalizeConfiguredPath('~'), '~'],
      [normalizeConfiguredPath(''), '/'], [normalizeConfiguredPath('', '~'), '~'], [normalizeConfiguredPath('/www/'), '/www'],
    ];
    for (const [got, want] of cases) assert(got === want, `got ${got}, want ${want}`);
  });
  await step('existing SSH connection saved with "/" is migrated to start at "~"', async () => {
    const c = db.connections.find((x) => x.id === 'con_legacy_ssh');
    assert(c && c.remoteRoot === '~' && c.homeStart, JSON.stringify(c));
  });
  homeSrv.close();

  await step('version endpoint reports whether a restart is needed', async () => {
    const v = await api('GET', '/api/version');
    assert(v.restartNeeded === false && v.startedAt, JSON.stringify(v));
  });
  await step('UI is served', async () => {
    const html = await fetch(APP + '/').then((r) => r.text());
    assert(html.includes('FTPGit Studio') && html.includes('/js/app.js'), 'index.html');
    const js = await fetch(APP + '/js/app.js');
    assert(js.ok, 'app.js');
  });
  await step('rejects foreign Host header (DNS rebinding guard)', async () => {
    const r = await new Promise((resolve) => {
      require('http').get({ host: '127.0.0.1', port: Number(process.env.PORT), path: '/api/state', headers: { Host: 'evil.example.com' } }, (res) => resolve(res.statusCode));
    });
    assert(r === 403, `status ${r}`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  require('../server/store').saveNow();
  server.close();
  server.closeAllConnections && server.closeAllConnections();
  await ftpSrv.close().catch(() => {});
  sftpSrv.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
