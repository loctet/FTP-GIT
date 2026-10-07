'use strict';
// Protocol adapters. Both expose the same interface so the explorer, uploads and git deploys
// don't care whether a connection is FTP/FTPS or SFTP (SSH).
//
//   connect()                      pwd()                       list(dir) -> normalized entries
//   mkdir(p)  ensureDir(p)         rename(a, b)                remove(p)  removeDir(p)
//   chmod(p, octalString)          size(p)                     noop()     features()
//   uploadFrom(localPath|Readable, remote, onProgress?)        downloadTo(Writable, remote)
//   exec(command, opts)  (SFTP only)                           close()    closed
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const ftp = require('basic-ftp');
const { Client: SSHClient } = require('ssh2');
const { decrypt } = require('./store');

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

function permString(user, group, world) {
  const tri = (n) => `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
  return `${tri(user)}${tri(group)}${tri(world)}`;
}

function notFound(message) {
  const e = new Error(message || 'No such file or directory');
  e.notFound = true;
  return e;
}

function isNotFound(e) {
  return !!e && (e.notFound || e.code === 550 || e.code === 2 || e.code === 'ENOENT');
}

function isSftp(conn) {
  return conn && conn.protocol === 'sftp';
}

function defaultPort(conn) {
  if (isSftp(conn)) return 22;
  return conn.secure === 'implicit' ? 990 : 21;
}

// ================================================================ FTP / FTPS

class FtpRemote {
  constructor(conn, timeout = 30000) {
    this.conn = conn;
    this.timeout = timeout;
    this.client = null;
    this.protocol = 'ftp';
  }

  get closed() {
    return !this.client || this.client.closed;
  }

  async connect() {
    const conn = this.conn;
    const secure = conn.secure === 'explicit' ? true : conn.secure === 'implicit' ? 'implicit' : false;
    this.client = new ftp.Client(this.timeout);
    this.client.ftp.verbose = false;
    if (conn.encoding) this.client.ftp.encoding = conn.encoding;
    await this.client.access({
      host: conn.host,
      port: Number(conn.port) || defaultPort(conn),
      user: conn.user || 'anonymous',
      password: conn.passwordEnc ? decrypt(conn.passwordEnc) : conn.user ? '' : 'guest',
      secure,
      secureOptions: secure ? { rejectUnauthorized: !conn.allowSelfSigned } : undefined,
    });
  }

  close() {
    if (this.client) this.client.close();
  }

  pwd() {
    return this.client.pwd();
  }

  async features() {
    try { return [...(await this.client.features()).keys()]; } catch { return []; }
  }

  async list(dir) {
    const list = await this.client.list(dir);
    return list
      .filter((f) => f.name !== '.' && f.name !== '..')
      .map((f) => {
        const p = f.permissions;
        return {
          name: f.name,
          type: f.isDirectory ? 'dir' : f.isSymbolicLink ? 'link' : 'file',
          size: f.size,
          modifiedAt: f.modifiedAt ? f.modifiedAt.toISOString() : null,
          rawModifiedAt: f.rawModifiedAt || '',
          permissions: p ? permString(p.user, p.group, p.world) : '',
          mode: p ? `${p.user}${p.group}${p.world}` : '',
          link: f.link || '',
        };
      });
  }

  mkdir(p) {
    return this.client.send(`MKD ${p}`);
  }

  ensureDir(p) {
    return this.client.ensureDir(p);
  }

  rename(from, to) {
    return this.client.rename(from, to);
  }

  async remove(p) {
    try {
      await this.client.remove(p);
    } catch (e) {
      if (e.code === 550) throw Object.assign(notFound(e.message), { code: 550 });
      throw e;
    }
  }

  removeDir(p) {
    return this.client.removeDir(p);
  }

  chmod(p, mode) {
    return this.client.send(`SITE CHMOD ${mode} ${p}`);
  }

  size(p) {
    return this.client.size(p);
  }

  noop() {
    return this.client.send('NOOP');
  }

  async uploadFrom(source, remote, onProgress) {
    if (onProgress) this.client.trackProgress((info) => onProgress(info.bytes));
    try {
      await this.client.uploadFrom(source, remote);
    } finally {
      if (onProgress) this.client.trackProgress();
    }
  }

  async downloadTo(writable, remote) {
    await this.client.downloadTo(writable, remote);
  }

  async exec() {
    throw new Error('Commands need an SSH connection; FTP cannot run commands.');
  }
}

// ================================================================ SFTP (SSH)

function sshConfig(conn, timeout) {
  const cfg = {
    host: conn.host,
    port: Number(conn.port) || 22,
    username: conn.user,
    readyTimeout: timeout,
    keepaliveInterval: 20000,
    keepaliveCountMax: 4,
    tryKeyboard: true,
  };
  const password = conn.passwordEnc ? decrypt(conn.passwordEnc) : '';
  if (password) cfg.password = password;
  let key = conn.privateKeyEnc ? decrypt(conn.privateKeyEnc) : '';
  if (!key && conn.keyPath) {
    const p = conn.keyPath.replace(/^~(?=$|[\\/])/, require('os').homedir());
    try {
      key = fs.readFileSync(p, 'utf8');
    } catch (e) {
      throw new Error(`Cannot read private key file ${conn.keyPath}: ${e.code || e.message}`);
    }
  }
  if (key) {
    cfg.privateKey = key;
    const pass = conn.passphraseEnc ? decrypt(conn.passphraseEnc) : '';
    if (pass) cfg.passphrase = pass;
  }
  if (conn.useAgent) {
    cfg.agent = process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK;
  }
  return { cfg, password };
}

function fingerprint(keyBuf) {
  return `SHA256:${crypto.createHash('sha256').update(keyBuf).digest('base64').replace(/=+$/, '')}`;
}

function sftpError(e, p) {
  if (!e) return e;
  if (e.code === 2) return Object.assign(notFound(`No such file or directory: ${p}`), { code: 2 });
  if (e.code === 3) return Object.assign(new Error(`Permission denied: ${p}`), { code: 3 });
  if (e.code === 4 && p) e.message = `${e.message || 'Failure'} (${p})`;
  return e;
}

class SftpRemote {
  constructor(conn, timeout = 30000) {
    this.conn = conn;
    this.timeout = timeout;
    this.ssh = null;
    this.sftp = null;
    this.isClosed = true;
    this.hostKey = null; // fingerprint seen during this connection
    this.protocol = 'sftp';
  }

  get closed() {
    return this.isClosed;
  }

  /** Opens the SSH connection (verifying the host key) and, unless sftp=false, the SFTP channel. */
  connect({ sftp = true } = {}) {
    const conn = this.conn;
    const { cfg, password } = sshConfig(conn, this.timeout);
    if (!cfg.password && !cfg.privateKey && !cfg.agent) {
      return Promise.reject(new Error('No credentials: enter a password or a private key.'));
    }
    let mismatch = null;
    cfg.hostVerifier = (key) => {
      const fp = fingerprint(key);
      this.hostKey = fp;
      if (conn.hostKey && conn.hostKey !== fp) {
        mismatch = fp;
        return false;
      }
      return true;
    };
    return new Promise((resolve, reject) => {
      const ssh = new SSHClient();
      this.ssh = ssh;
      let settled = false;
      const fail = (e) => {
        this.isClosed = true;
        if (!settled) {
          settled = true;
          try { ssh.end(); } catch {}
          reject(e);
        }
      };
      ssh.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
        finish(prompts.map(() => password || ''));
      });
      ssh.on('ready', () => {
        this.isClosed = false;
        if (!sftp) {
          settled = true;
          return resolve();
        }
        ssh.sftp((err, s) => {
          if (err) return fail(new Error(`SSH login worked but the SFTP subsystem is not available: ${err.message}`));
          this.sftp = s;
          s.on('close', () => { this.isClosed = true; });
          settled = true;
          resolve();
        });
      });
      ssh.on('error', (e) => {
        if (mismatch) {
          const err = new Error(`HOST KEY CHANGED for ${conn.host}. Expected ${conn.hostKey} but the server presented ${mismatch}. This can mean the server was reinstalled, or that someone is intercepting the connection. If you trust the change, choose "Trust new host key".`);
          err.code = 'HOSTKEY_MISMATCH';
          err.hostKey = mismatch;
          return fail(err);
        }
        if (e.level === 'client-authentication') {
          const err = new Error('SSH authentication failed. Check the username, password or private key.');
          err.code = 'AUTH';
          return fail(err);
        }
        if (/passphrase/i.test(e.message || '') || /Cannot parse privateKey/i.test(e.message || '')) {
          return fail(new Error(`Private key problem: ${e.message}`));
        }
        fail(e);
      });
      ssh.on('close', () => { this.isClosed = true; });
      ssh.on('end', () => { this.isClosed = true; });
      try {
        ssh.connect(cfg);
      } catch (e) {
        fail(/privateKey/i.test(e.message) ? new Error(`Private key problem: ${e.message}`) : e);
      }
    });
  }

  close() {
    this.isClosed = true;
    try { this.ssh && this.ssh.end(); } catch {}
  }

  _call(method, args, p) {
    return new Promise((resolve, reject) => {
      if (!this.sftp || this.isClosed) return reject(Object.assign(new Error('SFTP connection closed'), { code: 'ECONNRESET' }));
      this.sftp[method](...args, (err, res) => (err ? reject(sftpError(err, p)) : resolve(res)));
    });
  }

  pwd() {
    return this._call('realpath', ['.'], '.');
  }

  async features() {
    return ['SFTP', 'SSH exec', 'SSH shell'];
  }

  async list(dir) {
    const items = await this._call('readdir', [dir], dir);
    const out = [];
    for (const it of items) {
      if (it.filename === '.' || it.filename === '..') continue;
      const a = it.attrs || {};
      const fmt = (a.mode || 0) & S_IFMT;
      let type = fmt === S_IFDIR ? 'dir' : fmt === S_IFLNK ? 'link' : 'file';
      let link = '';
      if (type === 'link') {
        // Follow symlinks so linked folders can be opened like normal folders.
        try {
          const st = await this._call('stat', [path.posix.join(dir, it.filename)]);
          if (((st.mode || 0) & S_IFMT) === S_IFDIR) type = 'dir';
          link = await this._call('readlink', [path.posix.join(dir, it.filename)]).catch(() => '');
        } catch {}
      }
      const perm = (a.mode || 0) & 0o777;
      out.push({
        name: it.filename,
        type,
        size: a.size || 0,
        modifiedAt: a.mtime ? new Date(a.mtime * 1000).toISOString() : null,
        rawModifiedAt: '',
        permissions: a.mode !== undefined ? permString(perm >> 6, (perm >> 3) & 7, perm & 7) : '',
        mode: a.mode !== undefined ? perm.toString(8).padStart(3, '0') : '',
        link,
      });
    }
    return out;
  }

  mkdir(p) {
    return this._call('mkdir', [p], p);
  }

  async ensureDir(p) {
    const parts = p.split('/').filter(Boolean);
    let cur = p.startsWith('/') ? '' : '.';
    for (const part of parts) {
      cur = `${cur}/${part}`;
      try {
        const st = await this._call('stat', [cur], cur);
        if (((st.mode || 0) & S_IFMT) !== S_IFDIR) throw new Error(`${cur} exists and is not a folder`);
      } catch (e) {
        if (!isNotFound(e)) throw e;
        try {
          await this._call('mkdir', [cur], cur);
        } catch (e2) {
          // created concurrently? fine if it now exists
          await this._call('stat', [cur], cur).catch(() => { throw e2; });
        }
      }
    }
  }

  async rename(from, to) {
    // Prefer the OpenSSH extension: atomic and overwrites like a normal "mv".
    try {
      await this._call('ext_openssh_rename', [from, to], from);
      return;
    } catch (e) {
      if (e.notFound) throw e;
    }
    try {
      await this._call('rename', [from, to], from);
    } catch (e) {
      if (isNotFound(e)) throw e;
      // Plain SFTP rename refuses to overwrite: if the target exists, remove it and retry.
      const exists = await this._call('stat', [to], to).then(() => true, () => false);
      if (!exists) throw e;
      await this._call('unlink', [to], to);
      await this._call('rename', [from, to], from);
    }
  }

  remove(p) {
    return this._call('unlink', [p], p);
  }

  async removeDir(p) {
    const items = await this._call('readdir', [p], p);
    for (const it of items) {
      if (it.filename === '.' || it.filename === '..') continue;
      const child = path.posix.join(p, it.filename);
      if ((((it.attrs && it.attrs.mode) || 0) & S_IFMT) === S_IFDIR) await this.removeDir(child);
      else await this._call('unlink', [child], child);
    }
    await this._call('rmdir', [p], p);
  }

  chmod(p, mode) {
    return this._call('chmod', [p, parseInt(mode, 8)], p);
  }

  async size(p) {
    return (await this._call('stat', [p], p)).size;
  }

  noop() {
    return this._call('realpath', ['.'], '.');
  }

  async uploadFrom(source, remote, onProgress) {
    if (typeof source === 'string') {
      await this._call('fastPut', [source, remote, { step: (done) => onProgress && onProgress(done) }], remote);
      return;
    }
    const ws = this.sftp.createWriteStream(remote);
    let bytes = 0;
    if (onProgress) source.on('data', (c) => { bytes += c.length; onProgress(bytes); });
    try {
      await pipeline(source, ws);
    } catch (e) {
      throw sftpError(e, remote);
    }
  }

  async downloadTo(writable, remote) {
    await this._call('stat', [remote], remote); // fail cleanly before anything is written
    try {
      await pipeline(this.sftp.createReadStream(remote), writable);
    } catch (e) {
      throw sftpError(e, remote);
    }
  }

  /** Runs a command over SSH. Returns { code, signal, stdout, stderr }. */
  exec(command, { cwd, onData, timeoutMs = 10 * 60 * 1000 } = {}) {
    const full = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
    return new Promise((resolve, reject) => {
      if (!this.ssh || this.isClosed) return reject(new Error('SSH connection closed'));
      this.ssh.exec(full, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { try { stream.close(); } catch {} reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
        stream.on('data', (d) => { stdout += d; onData && onData('stdout', d.toString()); });
        stream.stderr.on('data', (d) => { stderr += d; onData && onData('stderr', d.toString()); });
        stream.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
      });
    });
  }

  /** Opens an interactive shell channel (used by the web terminal). */
  shell({ cols = 120, rows = 30 } = {}) {
    return new Promise((resolve, reject) => {
      this.ssh.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => (err ? reject(err) : resolve(stream)));
    });
  }
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function createRemote(conn, timeout) {
  return isSftp(conn) ? new SftpRemote(conn, timeout) : new FtpRemote(conn, timeout);
}

module.exports = { createRemote, FtpRemote, SftpRemote, isNotFound, isSftp, defaultPort, shellQuote, fingerprint };
