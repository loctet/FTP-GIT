'use strict';
// Small SFTP + SSH server for trying the app and for the e2e tests (built on ssh2's Server).
//   node test/dev-sftp.js [rootFolder]
// Login: demo / demo on 127.0.0.1:2222  (public-key auth also accepted when configured)
// Supports SFTP file operations, "exec" commands and a minimal interactive shell.
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { Server, utils } = require('ssh2');

const { STATUS_CODE, flagsToString } = utils.sftp;

function startSftpServer({ port = 2222, host = '127.0.0.1', root, user = 'demo', password = 'demo', publicKey = null, hostKey = null } = {}) {
  root = path.resolve(root);
  fs.mkdirSync(root, { recursive: true });
  const hostKeyPem = hostKey || utils.generateKeyPairSync('ed25519').private;
  const allowedKey = publicKey ? utils.parseKey(publicKey) : null;

  // Map an SFTP path ("/a/b" or relative to "/") to a real path inside root.
  const real = (p) => {
    const v = path.posix.resolve('/', String(p || '.').replace(/\\/g, '/'));
    const r = path.join(root, ...v.split('/').filter(Boolean));
    if (r !== root && !r.startsWith(root + path.sep)) throw new Error('outside root');
    return r;
  };
  const virt = (p) => path.posix.resolve('/', String(p || '.').replace(/\\/g, '/'));
  const attrsOf = (st) => ({
    mode: st.mode,
    uid: 0,
    gid: 0,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000),
  });
  const longname = (name, st) => `${st.isDirectory() ? 'd' : '-'}rw-r--r-- 1 demo demo ${st.size} Jan 1 00:00 ${name}`;
  const statusOf = (err) => (err && err.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : err && (err.code === 'EACCES' || err.code === 'EPERM') ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE);

  const server = new Server({ hostKeys: [hostKeyPem] }, (client) => {
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      if (ctx.username !== user) return ctx.reject();
      if (ctx.method === 'password' && ctx.password === password) return ctx.accept();
      if (ctx.method === 'publickey' && allowedKey) {
        if (ctx.key.algo !== allowedKey.type || !allowedKey.getPublicSSH().equals(ctx.key.data)) return ctx.reject();
        if (ctx.signature && allowedKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true) return ctx.reject();
        return ctx.accept();
      }
      ctx.reject(allowedKey ? ['password', 'publickey'] : ['password']);
    });

    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('pty', (accept) => accept && accept());
        session.on('window-change', (accept) => accept && accept());
        session.on('env', (accept) => accept && accept());

        session.on('exec', (accept, _reject, info) => {
          const stream = accept();
          let cmd = info.command;
          let cwd = root;
          // The app sends: cd '<dir>' && <command>. Emulate the cd part portably.
          const m = /^cd '((?:[^']|'\\'')*)' && ([\s\S]*)$/.exec(cmd);
          if (m) {
            try { cwd = real(m[1].replace(/'\\''/g, "'")); } catch { cwd = root; }
            if (!fs.existsSync(cwd)) {
              stream.stderr.write(`cd: ${m[1]}: No such file or directory\n`);
              stream.exit(1);
              return stream.end();
            }
            cmd = m[2];
          }
          const child = spawn(cmd, { shell: true, cwd, windowsHide: true });
          child.stdout.on('data', (d) => stream.write(d));
          child.stderr.on('data', (d) => stream.stderr.write(d));
          child.on('close', (code) => { stream.exit(code ?? 1); stream.end(); });
          child.on('error', (e) => { stream.stderr.write(e.message); stream.exit(127); stream.end(); });
        });

        session.on('shell', (accept) => {
          const stream = accept();
          let vcwd = '/';
          let line = '';
          const prompt = () => stream.write(`demo@dev-sftp:${vcwd}$ `);
          stream.write('Welcome to the FTPGit dev SSH server (minimal shell).\r\n');
          prompt();
          stream.on('data', (data) => {
            for (const ch of data.toString()) {
              if (ch === '\r' || ch === '\n') {
                stream.write('\r\n');
                const cmd = line.trim();
                line = '';
                if (!cmd) { prompt(); continue; }
                if (cmd === 'exit') { stream.exit(0); stream.end(); return; }
                if (cmd === 'clear') { stream.write('\x1b[2J\x1b[H'); prompt(); continue; }
                const cd = /^cd\s+(.+?)(?:\s+2>\/dev\/null)?(?:;\s*clear)?$/.exec(cmd);
                if (cd) {
                  const target = virt(path.posix.resolve(vcwd, cd[1].replace(/^'|'$/g, '')));
                  try {
                    if (fs.statSync(real(target)).isDirectory()) vcwd = target;
                    else stream.write(`cd: not a directory: ${cd[1]}\r\n`);
                  } catch { stream.write(`cd: no such file or directory: ${cd[1]}\r\n`); }
                  if (/;\s*clear$/.test(cmd)) stream.write('\x1b[2J\x1b[H');
                  prompt();
                  continue;
                }
                exec(cmd, { cwd: real(vcwd), windowsHide: true }, (err, out, errOut) => {
                  stream.write(String(out || '').replace(/\r?\n/g, '\r\n'));
                  stream.write(String(errOut || '').replace(/\r?\n/g, '\r\n'));
                  prompt();
                });
              } else if (ch === '\x7f' || ch === '\b') {
                if (line) { line = line.slice(0, -1); stream.write('\b \b'); }
              } else if (ch === '\x03') {
                line = '';
                stream.write('^C\r\n');
                prompt();
              } else if (ch >= ' ') {
                line += ch;
                stream.write(ch);
              }
            }
          });
        });

        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map();
          let next = 0;
          const newHandle = (v) => {
            const h = Buffer.alloc(4);
            h.writeUInt32BE(next++);
            handles.set(h.toString('hex'), v);
            return h;
          };
          const get = (h) => handles.get(h.toString('hex'));
          const guard = (reqid, fn) => { try { fn(); } catch (e) { sftp.status(reqid, statusOf(e)); } };

          sftp.on('OPEN', (reqid, filename, flags) => guard(reqid, () => {
            const mode = flagsToString(flags);
            if (!mode) return sftp.status(reqid, STATUS_CODE.FAILURE);
            fs.open(real(filename), mode, (err, fd) => (err ? sftp.status(reqid, statusOf(err)) : sftp.handle(reqid, newHandle({ fd }))));
          }));
          sftp.on('READ', (reqid, handle, offset, length) => {
            const h = get(handle);
            if (!h || h.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
            const buf = Buffer.alloc(length);
            fs.read(h.fd, buf, 0, length, offset, (err, n) => {
              if (err) return sftp.status(reqid, statusOf(err));
              if (!n) return sftp.status(reqid, STATUS_CODE.EOF);
              sftp.data(reqid, buf.subarray(0, n));
            });
          });
          sftp.on('WRITE', (reqid, handle, offset, data) => {
            const h = get(handle);
            if (!h || h.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
            fs.write(h.fd, data, 0, data.length, offset, (err) => sftp.status(reqid, err ? statusOf(err) : STATUS_CODE.OK));
          });
          sftp.on('CLOSE', (reqid, handle) => {
            const h = get(handle);
            if (!h) return sftp.status(reqid, STATUS_CODE.FAILURE);
            handles.delete(handle.toString('hex'));
            if (h.fd !== undefined) fs.close(h.fd, (err) => sftp.status(reqid, err ? statusOf(err) : STATUS_CODE.OK));
            else sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on('FSTAT', (reqid, handle) => {
            const h = get(handle);
            if (!h || h.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
            fs.fstat(h.fd, (err, st) => (err ? sftp.status(reqid, statusOf(err)) : sftp.attrs(reqid, attrsOf(st))));
          });
          const statHandler = (fn) => (reqid, p) => guard(reqid, () => fn(real(p), (err, st) => (err ? sftp.status(reqid, statusOf(err)) : sftp.attrs(reqid, attrsOf(st)))));
          sftp.on('STAT', statHandler(fs.stat));
          sftp.on('LSTAT', statHandler(fs.lstat));
          sftp.on('OPENDIR', (reqid, p) => guard(reqid, () => {
            const dir = real(p);
            fs.readdir(dir, (err, names) => {
              if (err) return sftp.status(reqid, statusOf(err));
              sftp.handle(reqid, newHandle({ dir, names, sent: false }));
            });
          }));
          sftp.on('READDIR', (reqid, handle) => {
            const h = get(handle);
            if (!h || !h.names) return sftp.status(reqid, STATUS_CODE.FAILURE);
            if (h.sent) return sftp.status(reqid, STATUS_CODE.EOF);
            h.sent = true;
            const list = [];
            for (const name of h.names) {
              try {
                const st = fs.lstatSync(path.join(h.dir, name));
                list.push({ filename: name, longname: longname(name, st), attrs: attrsOf(st) });
              } catch {}
            }
            if (!list.length) return sftp.status(reqid, STATUS_CODE.EOF);
            sftp.name(reqid, list);
          });
          sftp.on('MKDIR', (reqid, p) => guard(reqid, () => fs.mkdir(real(p), (err) => sftp.status(reqid, err ? statusOf(err) : STATUS_CODE.OK))));
          sftp.on('RMDIR', (reqid, p) => guard(reqid, () => fs.rmdir(real(p), (err) => sftp.status(reqid, err ? statusOf(err) : STATUS_CODE.OK))));
          sftp.on('REMOVE', (reqid, p) => guard(reqid, () => fs.unlink(real(p), (err) => sftp.status(reqid, err ? statusOf(err) : STATUS_CODE.OK))));
          sftp.on('RENAME', (reqid, a, b) => guard(reqid, () => {
            const to = real(b);
            if (fs.existsSync(to)) return sftp.status(reqid, STATUS_CODE.FAILURE); // like real SFTP v3 servers
            fs.rename(real(a), to, (err) => sftp.status(reqid, err ? statusOf(err) : STATUS_CODE.OK));
          }));
          sftp.on('SETSTAT', (reqid, p, attrs) => guard(reqid, () => {
            if (attrs && attrs.mode !== undefined) fs.chmodSync(real(p), attrs.mode & 0o777);
            sftp.status(reqid, STATUS_CODE.OK);
          }));
          sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
          sftp.on('REALPATH', (reqid, p) => guard(reqid, () => {
            const v = virt(p);
            sftp.name(reqid, [{ filename: v, longname: v, attrs: {} }]);
          }));
          sftp.on('READLINK', (reqid) => sftp.status(reqid, STATUS_CODE.OP_UNSUPPORTED));
        });
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

module.exports = { startSftpServer };

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'dev-sftp-root'));
  // Keep the same host key across restarts, like a real server (otherwise the app warns that the key changed).
  const keyFile = path.join(__dirname, '..', 'data', 'dev-sftp-hostkey');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, utils.generateKeyPairSync('ed25519').private, { mode: 0o600 });
  startSftpServer({ root, hostKey: fs.readFileSync(keyFile, 'utf8') }).then(() => console.log(`Dev SFTP/SSH server on sftp://127.0.0.1:2222  (user: demo / pass: demo)\nRoot: ${root}`));
}
