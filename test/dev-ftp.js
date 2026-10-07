'use strict';
// Local FTP server for trying the app without a real host.
//   node test/dev-ftp.js [rootFolder]
// Login: demo / demo  on 127.0.0.1:2121
const fs = require('fs');
const path = require('path');
const FtpSrv = require('ftp-srv');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'dev-ftp-root'));
fs.mkdirSync(root, { recursive: true });
const quiet = { child: () => quiet, info() {}, debug() {}, trace() {}, warn() {}, error() {}, fatal() {} };

const srv = new FtpSrv({ url: 'ftp://127.0.0.1:2121', pasv_url: '127.0.0.1', pasv_min: 2130, pasv_max: 2160, anonymous: false, log: quiet });
srv.on('login', ({ username, password }, resolve, reject) => {
  if (username === 'demo' && password === 'demo') resolve({ root });
  else reject(new Error('Invalid username or password'));
});
srv.on('client-error', () => {});
srv.listen().then(() => console.log(`Dev FTP server on ftp://127.0.0.1:2121  (user: demo / pass: demo)\nRoot: ${root}`));
