'use strict';
// Simple JSON-file database with atomic writes and AES-256-GCM secret encryption.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.FTPGIT_DATA || path.join(__dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const KEY_FILE = path.join(DATA_DIR, 'secret.key');

fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
  settings: {
    idleTimeoutMin: 10,
    keepAliveSec: 60,
    defaultPollSec: 60,
    theme: 'dark',
  },
  connections: [],
  repos: [],
  deployments: [],
  activity: [],
};

const MAX_DEPLOYMENTS = 300;
const MAX_ACTIVITY = 1000;

function loadKey() {
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
}
const KEY = loadKey();

function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(blob) {
  if (!blob) return '';
  const [v, iv, tag, data] = blob.split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      ...structuredClone(DEFAULTS),
      ...raw,
      settings: { ...DEFAULTS.settings, ...(raw.settings || {}) },
    };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[store] could not read db.json, starting fresh:', e.message);
    return structuredClone(DEFAULTS);
  }
}

const db = load();
let saveTimer = null;

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, 150);
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function trim() {
  if (db.deployments.length > MAX_DEPLOYMENTS) db.deployments.splice(0, db.deployments.length - MAX_DEPLOYMENTS);
  if (db.activity.length > MAX_ACTIVITY) db.activity.splice(0, db.activity.length - MAX_ACTIVITY);
}

process.on('exit', () => { if (saveTimer) { try { saveNow(); } catch {} } });

module.exports = { db, save, saveNow, encrypt, decrypt, id, trim, DATA_DIR };
