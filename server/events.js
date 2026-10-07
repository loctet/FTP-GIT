'use strict';
// Server-Sent Events hub + activity log.
const { db, save, id, trim } = require('./store');

const clients = new Set();

function broadcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { clients.delete(res); }
  }
}

function attach(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

/** level: info | success | warn | error ; scope: ftp | git | app */
function activity(level, scope, message, extra = {}) {
  const entry = { id: id('act'), ts: new Date().toISOString(), level, scope, message, ...extra };
  db.activity.push(entry);
  trim();
  save();
  broadcast('activity', entry);
  const tag = `[${scope}]`.padEnd(6);
  (level === 'error' ? console.error : console.log)(`${entry.ts} ${tag} ${message}`);
  return entry;
}

module.exports = { broadcast, attach, activity };
