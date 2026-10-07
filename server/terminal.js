'use strict';
// Web SSH terminal: browser (xterm.js) <-> WebSocket <-> SSH shell channel.
// Protocol (JSON text frames):
//   client -> server  {t:'d', d:'keys'} | {t:'r', cols, rows}
//   server -> client  {t:'ready', hostKey} | {t:'d', d:'output'} | {t:'exit', code} | {t:'idle'} | {t:'err', msg}
const { WebSocketServer } = require('ws');
const { StringDecoder } = require('string_decoder');
const { db } = require('./store');
const { activity } = require('./events');
const ftpm = require('./ftpManager');
const { isSftp, shellQuote } = require('./remote');

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const hostOnly = (h) => String(h || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');

function originAllowed(req, bindHost) {
  if (bindHost !== '127.0.0.1') return true;
  if (!LOCAL_HOSTS.includes(hostOnly(req.headers.host))) return false;
  // Browsers don't apply CORS to WebSockets: refuse pages from other origins.
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client (CLI / tests)
  try {
    const u = new URL(origin);
    return LOCAL_HOSTS.includes(hostOnly(u.host)) && u.host === req.headers.host;
  } catch {
    return false;
  }
}

function attach(server, { bindHost }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const live = new Set();

  server.on('upgrade', (req, socket, head) => {
    const m = /^\/api\/ssh\/([\w-]+)\/shell(?:\?|$)/.exec(req.url || '');
    if (!m || !originAllowed(req, bindHost)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handle(ws, req, m[1]));
  });

  async function handle(ws, req, connectionId) {
    const url = new URL(req.url, 'http://localhost');
    const cols = Math.min(500, Math.max(20, Number(url.searchParams.get('cols')) || 120));
    const rows = Math.min(200, Math.max(5, Number(url.searchParams.get('rows')) || 30));
    const cwd = url.searchParams.get('cwd');
    const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
    let client = null;
    let stream = null;
    let lastActivity = Date.now();
    const entry = { ws };
    live.add(entry);

    const idleTimer = setInterval(() => {
      const idleMs = Math.max(0.05, Number(db.settings.idleTimeoutMin) || 10) * 60000;
      if (Date.now() - lastActivity >= idleMs) {
        send({ t: 'idle' });
        cleanup();
      }
    }, 2000);

    function cleanup() {
      clearInterval(idleTimer);
      live.delete(entry);
      try { stream && stream.close(); } catch {}
      try { client && client.close(); } catch {}
      try { ws.close(); } catch {}
    }

    ws.on('close', cleanup);
    ws.on('error', cleanup);

    let conn;
    try {
      conn = ftpm.getConnection(connectionId);
      if (!isSftp(conn)) throw new Error('The terminal needs an SSH connection. FTP servers cannot run commands.');
      client = await ftpm.openClient(conn, 20000, { sftp: false });
      stream = await client.shell({ cols, rows });
    } catch (e) {
      send({ t: 'err', msg: e.message, code: e.code });
      return cleanup();
    }
    if (ws.readyState !== 1) return cleanup();

    activity('info', 'ssh', `Terminal opened on ${conn.name || conn.host}`, { connectionId });
    send({ t: 'ready', hostKey: client.hostKey });
    const dec = new StringDecoder('utf8');
    const decErr = new StringDecoder('utf8');
    stream.on('data', (d) => { lastActivity = Date.now(); send({ t: 'd', d: dec.write(d) }); });
    stream.stderr.on('data', (d) => send({ t: 'd', d: decErr.write(d) }));
    stream.on('close', (code) => { send({ t: 'exit', code: code ?? null }); cleanup(); });
    if (cwd) stream.write(`cd ${shellQuote(cwd)} 2>/dev/null; clear\n`);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.t === 'd' && typeof msg.d === 'string') {
        lastActivity = Date.now();
        stream.write(msg.d);
      } else if (msg.t === 'r') {
        const c = Math.min(500, Math.max(20, Number(msg.cols) || cols));
        const r = Math.min(200, Math.max(5, Number(msg.rows) || rows));
        try { stream.setWindow(r, c, 0, 0); } catch {}
      }
    });
  }

  return {
    closeAll() { for (const e of live) try { e.ws.close(); } catch {} },
  };
}

module.exports = { attach, originAllowed };
