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
  const { start } = require('../server/index');
  const server = await start(Number(process.env.PORT), '127.0.0.1');
  const { db } = require('../server/store');

  let cid;
  const ftpConf = { name: 'Local test FTP', host: '127.0.0.1', port: FTP_PORT, user: 'tester', password: 's3cret!', secure: 'none', remoteRoot: '/' };

  console.log('FTP connections');
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
    s.client.ftp.socket.destroy(); // simulate server-side disconnect
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
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
