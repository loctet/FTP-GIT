'use strict';
// FTP session manager.
//  - One persistent session per saved connection, used by the file explorer.
//  - Operations are serialized through a queue (FTP control connections are single-threaded).
//  - After N minutes without user activity the socket is closed ("idle"), but the stored
//    credentials are kept, so the next operation silently reconnects. No re-login needed.
//  - While active, a NOOP keep-alive prevents the server from dropping us earlier.
const ftp = require('basic-ftp');
const { db, decrypt } = require('./store');
const { broadcast, activity } = require('./events');

function getConnection(connectionId) {
  const conn = db.connections.find((c) => c.id === connectionId);
  if (!conn) {
    const e = new Error('Connection not found');
    e.status = 404;
    throw e;
  }
  return conn;
}

function accessOptions(conn) {
  const secure = conn.secure === 'explicit' ? true : conn.secure === 'implicit' ? 'implicit' : false;
  return {
    host: conn.host,
    port: Number(conn.port) || (conn.secure === 'implicit' ? 990 : 21),
    user: conn.user || 'anonymous',
    password: conn.passwordEnc ? decrypt(conn.passwordEnc) : (conn.user ? '' : 'guest'),
    secure,
    secureOptions: secure ? { rejectUnauthorized: !conn.allowSelfSigned } : undefined,
  };
}

async function openClient(conn, timeout = 30000) {
  const client = new ftp.Client(timeout);
  client.ftp.verbose = false;
  if (conn.encoding) client.ftp.encoding = conn.encoding;
  try {
    await client.access(accessOptions(conn));
  } catch (e) {
    client.close();
    throw friendlyError(e, conn);
  }
  return client;
}

function friendlyError(e, conn) {
  if (!e || e.__friendly) return e;
  let msg = e.message || String(e);
  if (e.code === 'ECONNREFUSED') msg = `Connection refused by ${conn.host}:${conn.port || 21}`;
  else if (e.code === 'ENOTFOUND') msg = `Host not found: ${conn.host}`;
  else if (e.code === 'ETIMEDOUT' || /timeout/i.test(msg)) msg = `Timed out talking to ${conn.host}`;
  else if (e.code === 530) msg = 'Login incorrect (530). Check the username and password.';
  const err = new Error(msg);
  err.code = e.code;
  err.__friendly = true;
  return err;
}

function isConnectionError(err, client) {
  if (client && client.closed) return true;
  if (!err) return false;
  if (err.code === 421) return true;
  return /ECONNRESET|EPIPE|closed|timeout|not connected|socket/i.test(`${err.code || ''} ${err.message || ''}`);
}

/** Opens a dedicated short-lived client (used by deployments so they don't block browsing). */
async function withClient(connectionId, fn) {
  const conn = getConnection(connectionId);
  const client = await openClient(conn, 60000);
  try {
    return await fn(client, conn);
  } finally {
    client.close();
  }
}

class Session {
  constructor(connectionId) {
    this.connectionId = connectionId;
    this.client = null;
    this.state = 'disconnected';
    this.error = null;
    this.queue = Promise.resolve();
    this.busy = 0;
    this.lastActivity = 0;
    this.lastNoop = 0;
    this.connectedAt = 0;
  }

  status() {
    return {
      connectionId: this.connectionId,
      state: this.state,
      error: this.error,
      busy: this.busy,
      lastActivity: this.lastActivity || null,
      connectedAt: this.connectedAt || null,
      idleTimeoutMs: idleTimeoutMs(),
    };
  }

  setState(state, error = null) {
    const changed = state !== this.state || error !== this.error;
    this.state = state;
    this.error = error;
    if (changed) broadcast('session', this.status());
  }

  async ensureConnected() {
    if (this.client && !this.client.closed) return this.client;
    const conn = getConnection(this.connectionId);
    const wasIdle = this.state === 'idle';
    this.setState('connecting');
    try {
      this.client = await openClient(conn);
      this.connectedAt = Date.now();
      this.lastNoop = Date.now();
      this.setState('connected');
      activity('info', 'ftp', `${wasIdle ? 'Reconnected' : 'Connected'} to ${conn.name || conn.host}`, { connectionId: conn.id });
      return this.client;
    } catch (e) {
      this.client = null;
      this.setState('error', e.message);
      throw e;
    }
  }

  /**
   * Queue an operation. fn(client) runs with a live connection.
   * opts.activity=false -> does not count as user activity (keep-alive).
   * opts.retry=false    -> do not transparently retry after a dropped connection.
   */
  run(fn, opts = {}) {
    const { activity: isActivity = true, retry = true } = opts;
    if (isActivity) this.touch();
    const task = this.queue.then(async () => {
      this.busy++;
      broadcast('session', this.status());
      try {
        for (let attempt = 0; ; attempt++) {
          const client = await this.ensureConnected();
          try {
            return await fn(client);
          } catch (e) {
            if (attempt === 0 && retry && isConnectionError(e, client)) {
              try { client.close(); } catch {}
              this.client = null;
              continue; // reconnect once and retry
            }
            if (isConnectionError(e, client)) {
              this.client = null;
              this.setState('disconnected');
            }
            throw friendlyError(e, getConnection(this.connectionId));
          }
        }
      } finally {
        this.busy--;
        if (isActivity) this.touch();
        broadcast('session', this.status());
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  close(reason = 'manual') {
    if (this.client) {
      try { this.client.close(); } catch {}
      this.client = null;
    }
    this.connectedAt = 0;
    this.setState(reason === 'idle' ? 'idle' : 'disconnected');
    if (reason === 'idle') {
      const conn = db.connections.find((c) => c.id === this.connectionId);
      activity('info', 'ftp', `Disconnected from ${conn ? conn.name || conn.host : this.connectionId} after ${db.settings.idleTimeoutMin} min of inactivity (will reconnect automatically)`, { connectionId: this.connectionId });
    }
  }

  tick(now) {
    const live = this.client && !this.client.closed;
    if (!live) {
      if (this.state === 'connected') this.setState('disconnected');
      return;
    }
    if (this.busy > 0) return;
    if (now - this.lastActivity >= idleTimeoutMs()) {
      this.close('idle');
      return;
    }
    const keepAliveMs = (Number(db.settings.keepAliveSec) || 60) * 1000;
    if (now - this.lastNoop >= keepAliveMs) {
      this.lastNoop = now;
      this.run((c) => c.send('NOOP'), { activity: false, retry: false }).catch(() => {});
    }
  }
}

function idleTimeoutMs() {
  return Math.max(0.05, Number(db.settings.idleTimeoutMin) || 10) * 60 * 1000;
}

const sessions = new Map();

function session(connectionId) {
  getConnection(connectionId); // validates
  let s = sessions.get(connectionId);
  if (!s) {
    s = new Session(connectionId);
    sessions.set(connectionId, s);
  }
  return s;
}

function dropSession(connectionId) {
  const s = sessions.get(connectionId);
  if (s) {
    s.close('manual');
    sessions.delete(connectionId);
  }
}

function allStatuses() {
  return db.connections.map((c) => (sessions.get(c.id) || new Session(c.id)).status());
}

const ticker = setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) s.tick(now);
}, 2000);
ticker.unref();

module.exports = { session, dropSession, allStatuses, withClient, openClient, getConnection, accessOptions, friendlyError };
