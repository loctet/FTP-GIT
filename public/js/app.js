/* FTPGit Studio — front-end (vanilla JS, no build step) */
'use strict';
(() => {
  // ================================================================ helpers
  const $ = (s, el = document) => el.querySelector(s);

  const P = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'folder-plus': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
    'folder-up': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 16v-6M9 13l3-3 3 3"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    'file-code': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m10 12-2 2.5 2 2.5M14 12l2 2.5-2 2.5"/>',
    'file-text': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
    'file-plus': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
    film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    'upload-cloud': '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M12 12v9M16 16l-4-4-4 4"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
    'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
    server: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
    git: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="7" r="2.5"/><path d="M6 7.5v9M18 9.5c0 3.5-2.5 6-6 6H8.5"/>',
    commit: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
    unplug: '<path d="m19 5 3-3M2 22l3-3"/><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4z"/><path d="m7.5 13.5 2.5-2.5M10.5 16.5 13 14"/><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    'x-circle': '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    more: '<circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    play: '<path d="m7 4 13 8-13 8z"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  };

  function icon(name, cls = '') {
    const s = document.createElement('span');
    s.className = `icon ${cls}`;
    s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.file}</svg>`;
    return s;
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (['value', 'checked', 'disabled', 'selected', 'indeterminate', 'readOnly', 'multiple'].includes(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function setKids(el, ...children) {
    el.textContent = '';
    return append(el, children);
  }
  const btn = (label, iconName, onClick, cls = '', attrs = {}) =>
    h('button', { class: `btn ${cls}`, onclick: onClick, type: 'button', ...attrs }, iconName && icon(iconName), label);
  const ibtn = (iconName, title, onClick, cls = '', attrs = {}) =>
    h('button', { class: `icon-btn ${cls}`, title, 'aria-label': title, onclick: onClick, type: 'button', ...attrs }, icon(iconName));

  const LS = {
    get(k, d = null) { try { const v = localStorage.getItem(`ftpgit.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`ftpgit.${k}`, JSON.stringify(v)); } catch {} },
  };

  async function api(method, url, body, opts = {}) {
    const init = { method, headers: {} };
    if (body !== undefined) {
      if (opts.text) { init.headers['Content-Type'] = 'text/plain; charset=utf-8'; init.body = body; }
      else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    }
    const r = await fetch(url, init);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) {
      const e = new Error((data && data.error) || r.statusText || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return data;
  }
  const q = (o) => new URLSearchParams(o).toString();

  function fmtSize(n) {
    if (n === null || n === undefined || isNaN(n)) return '';
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `Today ${time}`;
    return `${d.toLocaleDateString([], { year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', month: 'short', day: 'numeric' })} ${time}`;
  }
  function timeAgo(iso) {
    if (!iso) return 'never';
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  function fmtDuration(a, b) {
    if (!a) return '';
    const ms = (b ? Date.parse(b) : Date.now()) - Date.parse(a);
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }
  const short = (sha) => (sha ? sha.slice(0, 7) : '—');
  const joinPath = (dir, name) => (dir.endsWith('/') ? dir : dir + '/') + name;
  const parentPath = (p) => { const i = p.replace(/\/+$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
  const baseName = (p) => p.replace(/\/+$/, '').split('/').pop();
  const uid = () => Math.random().toString(36).slice(2, 10);

  const EXT = {
    code: 'js mjs cjs ts tsx jsx php py rb go rs java kt c cc cpp h hpp cs json yml yaml xml sh bash bat cmd ps1 sql vue svelte ini env toml lock conf config twig blade',
    web: 'html htm css scss sass less svg',
    img: 'png jpg jpeg gif webp bmp ico avif tif tiff heic',
    zip: 'zip rar 7z tar gz tgz bz2 xz',
    doc: 'txt md markdown pdf doc docx xls xlsx ppt pptx csv log rtf odt',
    media: 'mp4 mov avi mkv webm mp3 wav ogg flac m4a',
  };
  const EXT_MAP = {};
  for (const [k, v] of Object.entries(EXT)) for (const e of v.split(' ')) EXT_MAP[e] = k;
  const TEXT_EXT = new Set([...EXT.code.split(' '), ...EXT.web.split(' '), 'txt', 'md', 'markdown', 'csv', 'log', 'htaccess', 'htpasswd', 'gitignore', 'editorconfig', 'map', 'tsv', 'properties', 'cfg']);
  const extOf = (n) => { const m = /\.([^.\/]+)$/.exec(n); return m ? m[1].toLowerCase() : ''; };
  function fileKind(e) {
    if (e.type === 'dir') return { cls: 'dir', ic: 'folder' };
    if (e.type === 'link') return { cls: 'link', ic: 'link' };
    const k = EXT_MAP[extOf(e.name)];
    return { cls: k || 'file', ic: { code: 'file-code', web: 'globe', img: 'image', zip: 'archive', doc: 'file-text', media: 'film' }[k] || 'file' };
  }
  const isTextFile = (name) => TEXT_EXT.has(extOf(name)) || (name.startsWith('.') && !name.slice(1).includes('.')) || !extOf(name);

  // ================================================================ state
  const S = {
    settings: {},
    connections: [],
    sessions: {},
    repos: [],
    deployments: [],
    activity: [],
    port: 4280,
    dataDir: '',
    view: LS.get('view', 'explorer'),
    activeConn: LS.get('activeConn', null),
    live: false,
    ex: { path: null, entries: [], loading: false, error: null, selected: new Set(), anchor: null, filter: '', sort: LS.get('sort', { key: 'name', dir: 1 }), back: [], fwd: [], reqId: 0 },
    transfers: [],
    transferByTid: {},
    actFilter: 'all',
    actSearch: '',
    logSubs: new Map(),
  };
  const conn = (cid = S.activeConn) => S.connections.find((c) => c.id === cid);

  // ================================================================ toasts, modals, menus
  function toast(type, title, msg, ms = 4200) {
    const ic = { success: 'check-circle', error: 'x-circle', warn: 'alert', info: 'info' }[type] || 'info';
    const el = h('div', { class: `toast ${type}` }, icon(ic), h('div', { class: 'grow' }, h('div', { class: 'tt' }, title), msg && h('div', { class: 'tm' }, msg)));
    $('#toasts').append(el);
    const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    el.addEventListener('click', kill);
    setTimeout(kill, type === 'error' ? Math.max(ms, 7000) : ms);
  }

  const modalStack = [];
  function modal({ title, iconName, body, foot, size = '', onClose, closeOnBackdrop = true }) {
    const box = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true' });
    const bd = h('div', { class: 'backdrop' }, box);
    const m = {
      el: box,
      close(result) {
        const i = modalStack.indexOf(m);
        if (i >= 0) modalStack.splice(i, 1);
        bd.remove();
        onClose && onClose(result);
      },
    };
    append(box, [
      h('div', { class: 'modal-head' }, iconName && h('div', { class: 'mi' }, icon(iconName)), h('h2', null, title), ibtn('x', 'Close', () => m.close())),
      h('div', { class: 'modal-body' }, body),
      foot && h('div', { class: 'modal-foot' }, foot),
    ]);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd && closeOnBackdrop) m.close(); });
    $('#modalRoot').append(bd);
    modalStack.push(m);
    setTimeout(() => { const f = box.querySelector('[autofocus]') || box.querySelector('.modal-body input:not([type=checkbox]):not([disabled]), .modal-body textarea'); f && f.focus(); }, 30);
    return m;
  }

  function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, iconName = 'alert' }) {
    return new Promise((resolve) => {
      let done = false;
      const m = modal({
        title, iconName,
        body: h('div', { style: { color: 'var(--text-2)' } }, message),
        foot: [btn('Cancel', null, () => m.close(false)), btn(confirmText, danger ? 'trash' : 'check', () => { done = true; m.close(true); }, danger ? 'danger solid' : 'primary', { autofocus: true })],
        onClose: (r) => resolve(done ? true : !!r && r === true),
      });
    });
  }

  function promptDialog({ title, label, value = '', placeholder = '', hint, iconName = 'edit', confirmText = 'Save', selectBase = false }) {
    return new Promise((resolve) => {
      const input = h('input', { class: 'input', value, placeholder, spellcheck: 'false' });
      let result = null;
      const submit = () => { result = input.value; m.close(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      const m = modal({
        title, iconName,
        body: h('div', { class: 'field' }, label && h('label', null, label), input, hint && h('div', { class: 'hint' }, hint)),
        foot: [btn('Cancel', null, () => m.close()), btn(confirmText, 'check', submit, 'primary')],
        onClose: () => resolve(result),
      });
      setTimeout(() => {
        input.focus();
        if (selectBase && value.lastIndexOf('.') > 0) input.setSelectionRange(0, value.lastIndexOf('.'));
        else input.select();
      }, 40);
    });
  }

  let openMenuEl = null;
  function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
  function showMenu(x, y, items) {
    closeMenu();
    const m = h('div', { class: 'menu' });
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { m.append(h('hr')); continue; }
      m.append(h('button', { class: it.danger ? 'danger' : '', disabled: it.disabled, onclick: () => { closeMenu(); it.action(); } }, icon(it.icon || 'chevron-right'), it.label, it.kbd && h('span', { class: 'kbd' }, it.kbd)));
    }
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
    m.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
    openMenuEl = m;
  }
  document.addEventListener('mousedown', (e) => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); });
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);

  // ================================================================ shell
  const VIEWS = [
    { id: 'explorer', label: 'File Explorer', icon: 'folder' },
    { id: 'deploy', label: 'Git Deploy', icon: 'git' },
    { id: 'activity', label: 'Activity', icon: 'activity' },
    { id: 'settings', label: 'Settings', icon: 'sliders' },
  ];

  function setView(v) {
    S.view = v;
    LS.set('view', v);
    renderAll();
  }

  function renderNav() {
    const nav = $('#nav');
    setKids(nav, 
      ...VIEWS.map((v) => {
        let count = null;
        if (v.id === 'deploy' && S.repos.length) count = S.repos.length;
        if (v.id === 'activity') {
          const errs = S.activity.filter((a) => a.level === 'error' && Date.now() - Date.parse(a.ts) < 86400000).length;
          if (errs) count = errs;
        }
        return h('button', { class: `nav-item ${S.view === v.id ? 'active' : ''}`, onclick: () => setView(v.id) }, icon(v.icon), v.label, count !== null && h('span', { class: 'count' }, count));
      })
    );
  }

  function sessionOf(cid) { return S.sessions[cid] || { state: 'disconnected' }; }

  function renderConnList() {
    const list = $('#connList');
    if (!S.connections.length) {
      setKids(list, h('div', { class: 'hint', style: { padding: '8px 12px' } }, 'No servers yet. Click + to add one.'));
      return;
    }
    setKids(list, 
      ...S.connections.map((c) => {
        const st = sessionOf(c.id).state;
        const item = h('div', { class: `conn-item ${c.id === S.activeConn && S.view === 'explorer' ? 'active' : ''}`, onclick: () => openConnection(c.id), title: `${c.user || 'anonymous'}@${c.host}:${c.port}` },
          h('div', { class: 'conn-avatar' }, icon(c.secure !== 'none' ? 'shield' : 'server'), h('span', { class: `dot ${st}` })),
          h('div', { class: 'conn-meta' }, h('div', { class: 'conn-name' }, c.name), h('div', { class: 'conn-host' }, `${c.user ? c.user + '@' : ''}${c.host}`)),
          ibtn('more', 'Options', (e) => { e.stopPropagation(); connMenu(c, e.clientX, e.clientY); }, 'sm')
        );
        item.addEventListener('contextmenu', (e) => { e.preventDefault(); connMenu(c, e.clientX, e.clientY); });
        return item;
      })
    );
  }

  function connMenu(c, x, y) {
    const st = sessionOf(c.id).state;
    showMenu(x, y, [
      { label: 'Open', icon: 'folder', action: () => openConnection(c.id) },
      st === 'connected' ? { label: 'Disconnect', icon: 'unplug', action: () => disconnect(c.id) } : { label: 'Connect', icon: 'plug', action: () => connectNow(c.id) },
      { label: 'Edit…', icon: 'edit', action: () => openConnectionForm(c) },
      { label: 'Duplicate', icon: 'copy', action: () => openConnectionForm({ ...c, id: null, name: `${c.name} (copy)` }) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, action: () => deleteConnection(c) },
    ]);
  }

  function renderSideFooter() {
    const theme = document.documentElement.dataset.theme;
    setKids($('#sideFooter'), 
      h('span', { class: `dot ${S.live ? 'live' : 'offline'}` }),
      h('span', { class: 'grow' }, S.live ? 'Live · local server' : 'Offline · reconnecting…'),
      ibtn(theme === 'light' ? 'moon' : 'sun', 'Toggle theme', () => setTheme(theme === 'light' ? 'dark' : 'light'), 'sm')
    );
  }

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    LS.set('theme', t);
    try { localStorage.setItem('ftpgit.theme', t); } catch {}
    renderSideFooter();
    if (S.view === 'settings') renderContent();
  }

  function renderTopbar() {
    const tb = $('#topbar');
    const c = conn();
    if (S.view === 'explorer') {
      if (!c) {
        setKids(tb, h('div', null, h('h1', null, 'File Explorer'), h('div', { class: 'sub' }, 'Browse, upload and manage files on your FTP servers')), h('div', { class: 'spacer' }), btn('New connection', 'plus', () => openConnectionForm(), 'primary'));
        return;
      }
      const st = sessionOf(c.id).state;
      S._tbState = st;
      setKids(tb, 
        h('div', { style: { minWidth: 0 } }, h('h1', null, c.name), h('div', { class: 'sub mono' }, `${c.user || 'anonymous'}@${c.host}:${c.port} · ${c.secure === 'none' ? 'FTP' : c.secure === 'implicit' ? 'FTPS (implicit)' : 'FTPS (TLS)'}`)),
        h('div', { class: 'spacer' }),
        h('div', { class: 'pill', id: 'sessionPill' }),
        st === 'connected' || st === 'connecting'
          ? btn('Disconnect', 'unplug', () => disconnect(c.id))
          : btn('Connect', 'plug', () => connectNow(c.id)),
        ibtn('edit', 'Edit connection', () => openConnectionForm(c))
      );
      updateSessionPill();
    } else if (S.view === 'deploy') {
      setKids(tb, 
        h('div', null, h('h1', null, 'Git Deploy'), h('div', { class: 'sub' }, 'Push to your branch — mapped folders are uploaded to FTP automatically')),
        h('div', { class: 'spacer' }),
        btn('Check all now', 'refresh', checkAll),
        btn('Add repository', 'plus', () => openRepoForm(), 'primary')
      );
    } else if (S.view === 'activity') {
      setKids(tb, 
        h('div', null, h('h1', null, 'Activity'), h('div', { class: 'sub' }, 'Everything the app did: transfers, connections, deployments')),
        h('div', { class: 'spacer' }),
        btn('Clear log', 'trash', async () => {
          if (await confirmDialog({ title: 'Clear activity log?', message: 'This removes all activity entries. Deployment history is kept.', confirmText: 'Clear', danger: true })) {
            await api('DELETE', '/api/activity');
          }
        })
      );
    } else {
      setKids(tb, h('div', null, h('h1', null, 'Settings'), h('div', { class: 'sub' }, 'Session behaviour, git polling and appearance')));
    }
  }

  function updateSessionPill() {
    const pill = $('#sessionPill');
    const c = conn();
    if (!pill || !c) return;
    const s = sessionOf(c.id);
    let dot = s.state;
    let text;
    switch (s.state) {
      case 'connected': {
        if (s.busy > 0) { text = 'Connected · working…'; break; }
        const left = Math.max(0, (s.lastActivity || Date.now()) + (s.idleTimeoutMs || 600000) - Date.now());
        const m = Math.floor(left / 60000);
        const sec = Math.floor((left % 60000) / 1000);
        text = `Connected · idle disconnect in ${m}:${String(sec).padStart(2, '0')}`;
        break;
      }
      case 'connecting': text = 'Connecting…'; break;
      case 'idle': text = 'Sleeping (idle) · reconnects on demand'; break;
      case 'error': text = `Error · ${s.error || 'connection failed'}`; break;
      default: text = 'Not connected · connects on demand'; dot = 'disconnected';
    }
    setKids(pill, h('span', { class: `dot ${dot}` }), text);
    pill.title = s.state === 'connected' ? 'The FTP socket is closed after the idle timeout. Your saved credentials are reused automatically — no need to log in again.' : '';
  }

  function renderContent() {
    const ct = $('#content');
    ct.className = 'content';
    if (S.view === 'explorer') return renderExplorer(ct);
    if (S.view === 'deploy') return renderDeploy(ct);
    if (S.view === 'activity') return renderActivity(ct);
    return renderSettings(ct);
  }

  function renderAll() {
    renderNav();
    renderConnList();
    renderSideFooter();
    renderTopbar();
    renderContent();
  }

  // ================================================================ connections
  function openConnection(cid) {
    if (S.activeConn !== cid) {
      S.activeConn = cid;
      LS.set('activeConn', cid);
      Object.assign(S.ex, { path: null, entries: [], selected: new Set(), back: [], fwd: [], error: null, filter: '' });
    }
    if (S.view !== 'explorer') { S.view = 'explorer'; LS.set('view', 'explorer'); }
    renderAll();
  }

  async function connectNow(cid) {
    try {
      await api('POST', `/api/connections/${cid}/connect`);
      if (cid === S.activeConn && S.view === 'explorer') loadDir(S.ex.path);
    } catch (e) {
      toast('error', 'Connection failed', e.message);
    }
  }

  async function disconnect(cid) {
    try { await api('POST', `/api/connections/${cid}/disconnect`); } catch (e) { toast('error', 'Disconnect failed', e.message); }
  }

  async function deleteConnection(c) {
    if (!(await confirmDialog({ title: `Delete "${c.name}"?`, message: 'The saved connection and its stored password will be removed from this computer. Files on the server are not touched.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api('DELETE', `/api/connections/${c.id}`);
      if (S.activeConn === c.id) { S.activeConn = null; LS.set('activeConn', null); }
      toast('success', 'Connection deleted');
    } catch (e) {
      toast('error', 'Cannot delete', e.message);
    }
  }

  function openConnectionForm(existing) {
    const isEdit = !!(existing && existing.id);
    const e = existing || {};
    const f = {
      name: h('input', { class: 'input', value: e.name || '', placeholder: 'My website' }),
      host: h('input', { class: 'input mono', value: e.host || '', placeholder: 'ftp.example.com', spellcheck: 'false' }),
      port: h('input', { class: 'input mono', type: 'number', value: e.port || 21, min: 1, max: 65535 }),
      secure: h('select', { class: 'select' },
        h('option', { value: 'none' }, 'FTP (plain)'),
        h('option', { value: 'explicit' }, 'FTPS — explicit TLS'),
        h('option', { value: 'implicit' }, 'FTPS — implicit TLS')),
      user: h('input', { class: 'input mono', value: e.user || '', placeholder: 'username', autocomplete: 'off', spellcheck: 'false' }),
      password: h('input', { class: 'input mono', type: 'password', placeholder: isEdit && e.hasPassword ? '•••••••• (saved — leave empty to keep)' : 'password', autocomplete: 'new-password' }),
      remoteRoot: h('input', { class: 'input mono', value: e.remoteRoot || '/', placeholder: '/' }),
      allowSelfSigned: h('input', { type: 'checkbox', checked: !!e.allowSelfSigned }),
    };
    f.secure.value = e.secure || 'none';
    f.secure.addEventListener('change', () => {
      if (f.secure.value === 'implicit' && f.port.value === '21') f.port.value = 990;
      if (f.secure.value !== 'implicit' && f.port.value === '990') f.port.value = 21;
    });
    const result = h('div');
    const data = () => ({
      id: isEdit ? e.id : undefined,
      name: f.name.value, host: f.host.value, port: f.port.value, secure: f.secure.value, user: f.user.value,
      password: f.password.value || (isEdit ? undefined : ''), remoteRoot: f.remoteRoot.value, allowSelfSigned: f.allowSelfSigned.checked,
    });
    const testBtn = btn('Test connection', 'zap', async () => {
      testBtn.disabled = true;
      setKids(result, h('div', { class: 'callout' }, icon('loader', 'spin'), 'Connecting…'));
      try {
        const r = await api('POST', '/api/connections/test', data());
        setKids(result, h('div', { class: 'callout ok' }, icon('check-circle'), h('div', null, h('b', null, `Connected in ${r.ms} ms. `), `Home folder: `, h('code', null, r.pwd), r.features.length ? h('div', { class: 'hint' }, `Server features: ${r.features.slice(0, 12).join(', ')}`) : null)));
      } catch (err) {
        setKids(result, h('div', { class: 'callout err' }, icon('x-circle'), err.message));
      } finally { testBtn.disabled = false; }
    });
    const saveBtn = btn(isEdit ? 'Save changes' : 'Save connection', 'check', async () => {
      saveBtn.disabled = true;
      try {
        const body = data();
        const r = isEdit ? await api('PUT', `/api/connections/${e.id}`, body) : await api('POST', '/api/connections', body);
        m.close();
        toast('success', isEdit ? 'Connection updated' : 'Connection saved', 'Credentials are stored encrypted on this computer.');
        if (!isEdit) { if (!S.connections.some((x) => x.id === r.id)) S.connections.push(r); openConnection(r.id); }
        else if (r.id === S.activeConn) { S.ex.path = null; renderAll(); }
      } catch (err) {
        toast('error', 'Could not save', err.message);
      } finally { saveBtn.disabled = false; }
    }, 'primary');
    const m = modal({
      title: isEdit ? `Edit ${e.name}` : 'New FTP connection',
      iconName: 'server',
      size: 'wide',
      body: h('form', { class: 'stack', onsubmit: (ev) => { ev.preventDefault(); saveBtn.click(); } },
        h('div', { class: 'field' }, h('label', null, 'Display name'), f.name),
        h('div', { class: 'grid-3' },
          h('div', { class: 'field' }, h('label', null, 'Host'), f.host),
          h('div', { class: 'field' }, h('label', null, 'Port'), f.port),
          h('div', { class: 'field' }, h('label', null, 'Protocol'), f.secure)),
        h('div', { class: 'grid-2' },
          h('div', { class: 'field' }, h('label', null, 'Username'), f.user),
          h('div', { class: 'field' }, h('label', null, 'Password'), f.password)),
        h('div', { class: 'field' }, h('label', null, 'Start folder'), f.remoteRoot, h('div', { class: 'hint' }, 'Folder opened when you connect, e.g. /public_html')),
        h('label', { class: 'check' }, f.allowSelfSigned, h('span', null, 'Accept self-signed / invalid TLS certificates', h('div', { class: 'hint' }, 'Only for FTPS servers using their own certificate.'))),
        h('div', { class: 'callout' }, icon('lock'), h('div', null, 'Your password is encrypted (AES-256-GCM) and stored only on this computer. The app reconnects with it automatically, so you never have to log in again after an idle disconnect.')),
        result,
        h('button', { type: 'submit', hidden: true })
      ),
      foot: [h('div', { class: 'left' }, testBtn), btn('Cancel', null, () => m.close()), saveBtn],
    });
  }

  // ================================================================ explorer
  function renderExplorer(ct) {
    const c = conn();
    if (!c) {
      if (S.connections.length) { openConnection(S.connections[0].id); return; }
      setKids(ct, h('div', { class: 'empty' }, h('div', null,
        h('div', { class: 'big' }, icon('server')),
        h('h3', null, 'Connect your first FTP server'),
        h('p', null, 'Add an FTP or FTPS server to browse files, drag & drop uploads and set up automatic deploys from Git.'),
        btn('New connection', 'plus', () => openConnectionForm(), 'primary'))));
      return;
    }
    ct.className = 'content flush';
    const ex = S.ex;
    const search = h('input', { class: 'input', placeholder: 'Filter this folder…', value: ex.filter, oninput: (e) => { ex.filter = e.target.value; renderFileTable(); } });
    const toolbar = h('div', { class: 'toolbar' },
      h('div', { class: 'btn-group' },
        ibtn('chevron-left', 'Back (Alt+←)', goBack, '', { id: 'btnBack', disabled: !ex.back.length }),
        ibtn('chevron-right', 'Forward (Alt+→)', goFwd, '', { id: 'btnFwd', disabled: !ex.fwd.length }),
        ibtn('arrow-up', 'Parent folder (Backspace)', () => ex.path && ex.path !== '/' && navigate(parentPath(ex.path))),
        ibtn('refresh', 'Refresh (F5)', () => loadDir(ex.path))),
      h('div', { class: 'crumbs', id: 'crumbs' }),
      h('div', { class: 'search' }, icon('search'), search),
      h('div', { class: 'sep' }),
      h('div', { class: 'btn-group' },
        ibtn('folder-plus', 'New folder', newFolder),
        ibtn('file-plus', 'New file', newFile),
        btn('Upload', 'upload', (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          showMenu(r.left, r.bottom + 6, [
            { label: 'Upload files…', icon: 'file', action: () => $('#filePicker').click() },
            { label: 'Upload folder…', icon: 'folder-up', action: () => $('#folderPicker').click() },
          ]);
        }, 'primary'))
    );
    const wrap = h('div', { class: 'table-wrap', id: 'tableWrap' },
      h('div', { class: 'loading-bar', id: 'loadingBar', style: { display: 'none' } }),
      h('div', { class: 'dropzone', id: 'dropzone' }, h('div', { class: 'inner' }, icon('upload-cloud'), h('div', null, 'Drop to upload'), h('span', { class: 'hint', id: 'dropHint' }, ''))),
      h('div', { id: 'tableHost' })
    );
    const status = h('div', { class: 'statusbar', id: 'statusbar' });
    setKids(ct, toolbar, wrap, status);
    bindDrop(wrap);
    wrap.addEventListener('contextmenu', (e) => {
      if (e.target.closest('tr.file-row')) return;
      e.preventDefault();
      ex.selected.clear();
      renderFileTable();
      showMenu(e.clientX, e.clientY, [
        { label: 'Upload files…', icon: 'upload', action: () => $('#filePicker').click() },
        { label: 'Upload folder…', icon: 'folder-up', action: () => $('#folderPicker').click() },
        '-',
        { label: 'New folder', icon: 'folder-plus', action: newFolder },
        { label: 'New file', icon: 'file-plus', action: newFile },
        { label: 'Refresh', icon: 'refresh', kbd: 'F5', action: () => loadDir(ex.path) },
        { label: 'Copy current path', icon: 'copy', action: () => copyText(ex.path) },
      ]);
    });
    wrap.addEventListener('mousedown', (e) => {
      if (!e.target.closest('tr') && e.button === 0) { ex.selected.clear(); renderFileTable(); }
    });
    renderCrumbs();
    if (ex.path === null) {
      const saved = LS.get(`path.${c.id}`, null);
      loadDir(saved || c.remoteRoot || '/', { fallback: c.remoteRoot || '/' });
    } else renderFileTable();
  }

  function renderCrumbs(editing = false) {
    const el = $('#crumbs');
    if (!el) return;
    const p = S.ex.path || '';
    if (editing) {
      const input = h('input', { value: p, spellcheck: 'false' });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') navigate(input.value.trim() || '/');
        if (e.key === 'Escape') renderCrumbs();
      });
      input.addEventListener('blur', () => setTimeout(() => renderCrumbs(), 100));
      setKids(el, input);
      input.focus();
      input.select();
      return;
    }
    const parts = p.split('/').filter(Boolean);
    const items = [h('button', { onclick: (e) => { e.stopPropagation(); navigate('/'); }, title: '/' }, icon('home'))];
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      const target = acc;
      items.push(icon('chevron-right', 'chev'), h('button', { onclick: (e) => { e.stopPropagation(); navigate(target); } }, part));
    }
    setKids(el, ...items);
    el.onclick = (e) => { if (e.target === el) renderCrumbs(true); };
    el.title = 'Click empty space to type a path';
  }

  function navigate(p) {
    const ex = S.ex;
    if (ex.path && p !== ex.path) { ex.back.push(ex.path); ex.fwd = []; }
    loadDir(p);
  }
  function goBack() { const ex = S.ex; if (!ex.back.length) return; ex.fwd.push(ex.path); loadDir(ex.back.pop()); }
  function goFwd() { const ex = S.ex; if (!ex.fwd.length) return; ex.back.push(ex.path); loadDir(ex.fwd.pop()); }

  async function loadDir(p, opts = {}) {
    const c = conn();
    if (!c) return;
    const ex = S.ex;
    const req = ++ex.reqId;
    ex.loading = true;
    const bar = $('#loadingBar');
    if (bar) bar.style.display = '';
    try {
      const r = await api('GET', `/api/ftp/${c.id}/list?${q({ path: p || c.remoteRoot || '/' })}`);
      if (req !== ex.reqId || conn() !== c) return;
      const changed = r.path !== ex.path;
      ex.path = r.path;
      ex.entries = r.entries;
      ex.error = null;
      if (changed) { ex.selected.clear(); ex.anchor = null; }
      else { const names = new Set(r.entries.map((x) => x.path)); for (const s of [...ex.selected]) if (!names.has(s)) ex.selected.delete(s); }
      LS.set(`path.${c.id}`, ex.path);
    } catch (e) {
      if (req !== ex.reqId) return;
      if (opts.fallback && opts.fallback !== p) return loadDir(opts.fallback);
      ex.error = e.message;
      if (ex.path === null) ex.path = p || '/';
      toast('error', 'Could not open folder', e.message);
    } finally {
      if (req === ex.reqId) {
        ex.loading = false;
        const b = $('#loadingBar');
        if (b) b.style.display = 'none';
        if (S.view === 'explorer') { renderCrumbs(); renderFileTable(); updateNavButtons(); }
      }
    }
  }

  function updateNavButtons() {
    const b = $('#btnBack'), f = $('#btnFwd');
    if (b) b.disabled = !S.ex.back.length;
    if (f) f.disabled = !S.ex.fwd.length;
  }

  function visibleEntries() {
    const ex = S.ex;
    const f = ex.filter.trim().toLowerCase();
    let list = f ? ex.entries.filter((e) => e.name.toLowerCase().includes(f)) : ex.entries.slice();
    const { key, dir } = ex.sort;
    list.sort((a, b) => {
      if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
      let r = 0;
      if (key === 'size') r = (a.size || 0) - (b.size || 0);
      else if (key === 'modified') r = String(a.modifiedAt || a.rawModifiedAt).localeCompare(String(b.modifiedAt || b.rawModifiedAt));
      else r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return r * dir;
    });
    return list;
  }

  function sortBy(key) {
    const s = S.ex.sort;
    if (s.key === key) s.dir *= -1; else { s.key = key; s.dir = 1; }
    LS.set('sort', s);
    renderFileTable();
  }

  function renderFileTable() {
    const host = $('#tableHost');
    if (!host) return;
    const ex = S.ex;
    const list = visibleEntries();
    renderStatusbar(list);
    if (ex.error && !ex.entries.length) {
      setKids(host, h('div', { class: 'empty' }, h('div', null, h('div', { class: 'big', style: { background: 'var(--danger-soft)', color: 'var(--danger)' } }, icon('alert')), h('h3', null, 'Could not load this folder'), h('p', null, ex.error), btn('Try again', 'refresh', () => loadDir(ex.path), 'primary'))));
      return;
    }
    if (ex.path === null) { setKids(host, h('div', { class: 'empty' }, h('div', null, icon('loader', 'spin'), h('p', null, 'Connecting…')))); return; }
    const sortIc = (k) => (ex.sort.key === k ? icon(ex.sort.dir > 0 ? 'chevron-up' : 'chevron-down') : null);
    const allSel = list.length > 0 && list.every((e) => ex.selected.has(e.path));
    const someSel = !allSel && list.some((e) => ex.selected.has(e.path));
    const head = h('thead', null, h('tr', null,
      h('th', { class: 'cb nosort' }, h('input', { type: 'checkbox', checked: allSel, indeterminate: someSel, onclick: (e) => { e.stopPropagation(); if (allSel) ex.selected.clear(); else list.forEach((x) => ex.selected.add(x.path)); renderFileTable(); } })),
      h('th', { onclick: () => sortBy('name') }, 'Name ', sortIc('name')),
      h('th', { onclick: () => sortBy('size'), style: { textAlign: 'right' } }, 'Size ', sortIc('size')),
      h('th', { onclick: () => sortBy('modified'), class: 'date' }, 'Modified ', sortIc('modified')),
      h('th', { class: 'nosort perm' }, 'Perms'),
      h('th', { class: 'nosort' }, '')
    ));
    const body = h('tbody');
    if (!list.length) {
      body.append(h('tr', null, h('td', { colspan: 6 }, h('div', { class: 'empty', style: { padding: '50px 20px' } }, h('div', null,
        h('div', { class: 'big' }, icon(ex.filter ? 'search' : 'upload-cloud')),
        h('h3', null, ex.filter ? 'No matches' : 'This folder is empty'),
        h('p', null, ex.filter ? `Nothing matches "${ex.filter}".` : 'Drag & drop files or folders here, or use the Upload button.'))))));
    }
    for (const e of list) {
      const k = fileKind(e);
      const sel = ex.selected.has(e.path);
      const tr = h('tr', { class: `file-row ${sel ? 'selected' : ''}`, draggable: 'true', dataset: { path: e.path } },
        h('td', { class: 'cb' }, h('input', { type: 'checkbox', checked: sel, onclick: (ev) => { ev.stopPropagation(); toggleSel(e.path); } })),
        h('td', { class: 'name', title: e.link ? `${e.name} → ${e.link}` : e.name }, h('span', { class: 'fname' }, h('span', { class: `ficon ${k.cls}` }, icon(k.ic)), h('span', { class: 'n' }, e.name))),
        h('td', { class: 'num', style: { textAlign: 'right' } }, e.type === 'dir' ? '—' : fmtSize(e.size)),
        h('td', { class: 'date', title: e.rawModifiedAt }, e.modifiedAt ? fmtDate(e.modifiedAt) : e.rawModifiedAt),
        h('td', { class: 'perm', title: e.mode }, e.permissions),
        h('td', { style: { textAlign: 'right' } }, h('span', { class: 'row-actions' },
          e.type !== 'dir' && ibtn('download', 'Download', (ev) => { ev.stopPropagation(); download([e]); }, 'sm'),
          ibtn('more', 'More', (ev) => { ev.stopPropagation(); if (!ex.selected.has(e.path)) { ex.selected = new Set([e.path]); renderFileTable(); } rowMenu(ev.clientX, ev.clientY); }, 'sm')))
      );
      tr.addEventListener('click', (ev) => rowClick(ev, e, list));
      tr.addEventListener('dblclick', () => openEntry(e));
      tr.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        if (!ex.selected.has(e.path)) { ex.selected = new Set([e.path]); ex.anchor = e.path; renderFileTable(); }
        rowMenu(ev.clientX, ev.clientY);
      });
      tr.addEventListener('dragstart', (ev) => {
        if (!ex.selected.has(e.path)) { ex.selected = new Set([e.path]); renderFileTable(); }
        ev.dataTransfer.setData('application/x-ftpgit', JSON.stringify([...ex.selected]));
        ev.dataTransfer.effectAllowed = 'move';
      });
      if (e.type === 'dir') {
        tr.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.stopPropagation(); tr.classList.add('drop-target'); $('#dropzone').classList.remove('show'); });
        tr.addEventListener('dragleave', () => tr.classList.remove('drop-target'));
        tr.addEventListener('drop', (ev) => { ev.preventDefault(); ev.stopPropagation(); tr.classList.remove('drop-target'); dragDepth = 0; $('#dropzone').classList.remove('show'); handleDrop(ev.dataTransfer, e.path); });
      }
      body.append(tr);
    }
    setKids(host, h('table', { class: 'files' }, head, body));
  }

  function renderStatusbar(list) {
    const sb = $('#statusbar');
    if (!sb) return;
    const ex = S.ex;
    const sel = ex.entries.filter((e) => ex.selected.has(e.path));
    const files = (list || ex.entries).filter((e) => e.type !== 'dir');
    const dirs = (list || ex.entries).length - files.length;
    setKids(sb, 
      h('span', null, `${dirs} folder${dirs === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'} · ${fmtSize(files.reduce((n, f) => n + (f.size || 0), 0))}`),
      sel.length ? h('span', { style: { color: 'var(--text)' } }, `${sel.length} selected${sel.some((s) => s.type !== 'dir') ? ` · ${fmtSize(sel.filter((s) => s.type !== 'dir').reduce((n, f) => n + (f.size || 0), 0))}` : ''}`) : null,
      sel.length ? h('span', { class: 'btn-group' },
        sel.some((s) => s.type !== 'dir') && btn('Download', 'download', () => download(sel), 'sm ghost'),
        btn('Delete', 'trash', () => deleteEntries(sel), 'sm ghost danger')) : null,
      h('span', { class: 'spacer' }),
      h('span', { class: 'kbd-hint' }, h('kbd', null, 'Del'), 'delete', h('kbd', null, 'F2'), 'rename', h('kbd', null, 'Ctrl+A'), 'select all')
    );
  }

  function toggleSel(p) {
    const ex = S.ex;
    if (ex.selected.has(p)) ex.selected.delete(p); else ex.selected.add(p);
    ex.anchor = p;
    renderFileTable();
  }

  function rowClick(ev, e, list) {
    const ex = S.ex;
    if (ev.shiftKey && ex.anchor) {
      const a = list.findIndex((x) => x.path === ex.anchor);
      const b = list.findIndex((x) => x.path === e.path);
      if (a >= 0 && b >= 0) {
        if (!(ev.ctrlKey || ev.metaKey)) ex.selected.clear();
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) ex.selected.add(list[i].path);
      }
    } else if (ev.ctrlKey || ev.metaKey) {
      toggleSel(e.path);
      return;
    } else {
      ex.selected = new Set([e.path]);
      ex.anchor = e.path;
    }
    renderFileTable();
  }

  function selectedEntries() { return S.ex.entries.filter((e) => S.ex.selected.has(e.path)); }

  function rowMenu(x, y) {
    const sel = selectedEntries();
    if (!sel.length) return;
    const one = sel.length === 1 ? sel[0] : null;
    showMenu(x, y, [
      one && one.type === 'dir' && { label: 'Open', icon: 'folder', kbd: 'Enter', action: () => openEntry(one) },
      one && one.type !== 'dir' && isTextFile(one.name) && { label: 'Edit', icon: 'edit', kbd: 'Enter', action: () => openEditor(one) },
      sel.some((s) => s.type !== 'dir') && { label: sel.length > 1 ? `Download ${sel.filter((s) => s.type !== 'dir').length} files` : 'Download', icon: 'download', action: () => download(sel) },
      '-',
      one && { label: 'Rename / move…', icon: 'edit', kbd: 'F2', action: () => renameEntry(one) },
      one && { label: 'Permissions…', icon: 'lock', action: () => chmodEntry(one) },
      { label: 'Copy path', icon: 'copy', action: () => copyText(sel.map((s) => s.path).join('\n')) },
      '-',
      { label: sel.length > 1 ? `Delete ${sel.length} items` : 'Delete', icon: 'trash', kbd: 'Del', danger: true, action: () => deleteEntries(sel) },
    ]);
  }

  function openEntry(e) {
    if (e.type === 'dir') navigate(e.path);
    else if (e.type === 'link') navigate(e.path);
    else if (isTextFile(e.name) && (e.size || 0) < 5 * 1024 * 1024) openEditor(e);
    else download([e]);
  }

  function copyText(t) {
    navigator.clipboard.writeText(t).then(() => toast('success', 'Copied to clipboard', t.length > 80 ? t.slice(0, 80) + '…' : t), () => toast('error', 'Clipboard unavailable'));
  }

  function download(entries) {
    const c = conn();
    const files = entries.filter((e) => e.type !== 'dir');
    if (entries.some((e) => e.type === 'dir')) toast('info', 'Folders are skipped', 'Download downloads files only. Open the folder to download its contents.');
    files.forEach((f, i) => setTimeout(() => {
      const a = h('a', { href: `/api/ftp/${c.id}/download?${q({ path: f.path })}`, download: f.name });
      document.body.append(a);
      a.click();
      a.remove();
    }, i * 350));
    if (files.length) toast('info', `Downloading ${files.length} file${files.length > 1 ? 's' : ''}`, files.length === 1 ? files[0].name : null);
  }

  async function newFolder() {
    const name = await promptDialog({ title: 'New folder', label: 'Folder name', placeholder: 'assets', iconName: 'folder-plus', confirmText: 'Create' });
    if (!name || !name.trim()) return;
    try {
      await api('POST', `/api/ftp/${S.activeConn}/mkdir`, { path: joinPath(S.ex.path, name.trim()) });
      await loadDir(S.ex.path);
      S.ex.selected = new Set([joinPath(S.ex.path, name.trim())]);
      renderFileTable();
    } catch (e) { toast('error', 'Could not create folder', e.message); }
  }

  async function newFile() {
    const name = await promptDialog({ title: 'New file', label: 'File name', placeholder: 'index.html', iconName: 'file-plus', confirmText: 'Create' });
    if (!name || !name.trim()) return;
    const p = joinPath(S.ex.path, name.trim());
    if (S.ex.entries.some((e) => e.path === p) && !(await confirmDialog({ title: 'File exists', message: `${name} already exists. Overwrite it with an empty file?`, confirmText: 'Overwrite', danger: true }))) return;
    try {
      await api('PUT', `/api/ftp/${S.activeConn}/content?${q({ path: p })}`, '', { text: true });
      await loadDir(S.ex.path);
      openEditor({ name: name.trim(), path: p, size: 0 });
    } catch (e) { toast('error', 'Could not create file', e.message); }
  }

  async function renameEntry(e) {
    const val = await promptDialog({ title: `Rename ${e.type === 'dir' ? 'folder' : 'file'}`, label: 'New name (or a full path to move it)', value: e.name, iconName: 'edit', confirmText: 'Rename', selectBase: e.type !== 'dir', hint: 'Tip: type /other/folder/name to move it.' });
    if (!val || !val.trim() || val.trim() === e.name) return;
    const to = val.trim().startsWith('/') ? val.trim() : joinPath(parentPath(e.path), val.trim());
    try {
      await api('POST', `/api/ftp/${S.activeConn}/rename`, { from: e.path, to });
      await loadDir(S.ex.path);
      toast('success', 'Renamed', `${e.name} → ${baseName(to)}`);
    } catch (err) { toast('error', 'Rename failed', err.message); }
  }

  async function moveEntries(paths, destDir) {
    const moves = paths.filter((p) => p !== destDir && parentPath(p) !== destDir && !destDir.startsWith(p + '/'));
    if (!moves.length) return;
    let ok = 0;
    for (const p of moves) {
      try { await api('POST', `/api/ftp/${S.activeConn}/rename`, { from: p, to: joinPath(destDir, baseName(p)) }); ok++; }
      catch (e) { toast('error', `Could not move ${baseName(p)}`, e.message); }
    }
    if (ok) toast('success', `Moved ${ok} item${ok > 1 ? 's' : ''}`, `to ${destDir}`);
    loadDir(S.ex.path);
  }

  async function chmodEntry(e) {
    const val = await promptDialog({ title: 'Change permissions', label: `Octal mode for ${e.name}`, value: e.mode || (e.type === 'dir' ? '755' : '644'), iconName: 'lock', confirmText: 'Apply', hint: 'Common: 644 files, 755 folders/scripts. Requires server support for SITE CHMOD.' });
    if (!val) return;
    try {
      await api('POST', `/api/ftp/${S.activeConn}/chmod`, { path: e.path, mode: val.trim() });
      await loadDir(S.ex.path);
      toast('success', 'Permissions updated', `${e.name} → ${val.trim()}`);
    } catch (err) { toast('error', 'chmod failed', err.message); }
  }

  async function deleteEntries(entries) {
    if (!entries.length) return;
    const dirs = entries.filter((e) => e.type === 'dir').length;
    const msg = h('div', null,
      h('p', { style: { marginTop: 0 } }, entries.length === 1 ? `"${entries[0].name}" will be permanently deleted from the server.` : `${entries.length} items will be permanently deleted from the server.`),
      dirs ? h('div', { class: 'callout err' }, icon('alert'), `${dirs} folder${dirs > 1 ? 's' : ''} will be deleted with everything inside.`) : null,
      entries.length > 1 ? h('div', { class: 'hint', style: { marginTop: '10px', maxHeight: '120px', overflow: 'auto' } }, entries.slice(0, 50).map((e) => h('div', { class: 'mono' }, e.path))) : null);
    if (!(await confirmDialog({ title: 'Delete from server?', message: msg, confirmText: 'Delete', danger: true }))) return;
    try {
      const r = await api('POST', `/api/ftp/${S.activeConn}/delete`, { items: entries.map((e) => ({ path: e.path, type: e.type })) });
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) toast('error', `${failed.length} item(s) could not be deleted`, failed[0].error);
      else toast('success', `Deleted ${r.results.length} item${r.results.length > 1 ? 's' : ''}`);
      S.ex.selected.clear();
      loadDir(S.ex.path);
    } catch (e) { toast('error', 'Delete failed', e.message); }
  }

  async function openEditor(e) {
    const cid = S.activeConn;
    const ta = h('textarea', { class: 'editor', spellcheck: 'false', disabled: true, value: 'Loading…' });
    const info = h('span', { class: 'hint' }, '');
    let original = '';
    let dirty = false;
    const save = async () => {
      saveBtn.disabled = true;
      try {
        await api('PUT', `/api/ftp/${cid}/content?${q({ path: e.path })}`, ta.value, { text: true });
        original = ta.value;
        dirty = false;
        info.textContent = `Saved ${new Date().toLocaleTimeString()}`;
        toast('success', 'File saved', e.path);
        if (S.ex.path === parentPath(e.path)) loadDir(S.ex.path);
      } catch (err) { toast('error', 'Save failed', err.message); }
      finally { saveBtn.disabled = false; }
    };
    const saveBtn = btn('Save', 'save', save, 'primary');
    ta.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); }
      if (ev.key === 'Tab') { ev.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
    });
    ta.addEventListener('input', () => { dirty = ta.value !== original; info.textContent = dirty ? 'Unsaved changes · Ctrl+S to save' : ''; });
    const m = modal({
      title: e.name, iconName: 'file-code', size: 'xwide', closeOnBackdrop: false,
      body: h('div', { class: 'stack' }, h('div', { class: 'hint mono' }, e.path), ta),
      foot: [h('div', { class: 'left' }, info), btn('Download', 'download', () => download([{ ...e, type: 'file' }])), btn('Close', null, async () => { if (!dirty || (await confirmDialog({ title: 'Discard changes?', message: 'Your edits have not been saved.', confirmText: 'Discard', danger: true }))) m.close(); }), saveBtn],
    });
    try {
      const r = await api('GET', `/api/ftp/${cid}/content?${q({ path: e.path })}`);
      original = r.content;
      ta.value = r.content;
      ta.disabled = false;
      info.textContent = `${fmtSize(r.size)} · ${r.content.split('\n').length} lines`;
      ta.focus();
    } catch (err) {
      m.close();
      toast('error', 'Cannot open file', err.message);
    }
  }

  // ---------------------------------------------------------------- drag & drop upload
  let dragDepth = 0;
  function bindDrop(wrap) {
    const dz = () => $('#dropzone');
    wrap.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      $('#dropHint').textContent = `into ${S.ex.path}`;
      dz().classList.add('show');
    });
    wrap.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!e.target.closest('tr.file-row')) dz().classList.add('show'); } });
    wrap.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dz().classList.remove('show'); });
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      dz().classList.remove('show');
      handleDrop(e.dataTransfer, S.ex.path);
    });
  }

  function handleDrop(dt, destDir) {
    const internal = dt.getData('application/x-ftpgit');
    if (internal) { moveEntries(JSON.parse(internal), destDir); return; }
    const entries = [...(dt.items || [])].filter((i) => i.kind === 'file').map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
    const plainFiles = [...dt.files];
    (async () => {
      let items = [];
      if (entries.length && entries.every(Boolean)) {
        const walk = async (entry, prefix) => {
          if (entry.isFile) {
            const file = await new Promise((res, rej) => entry.file(res, rej));
            items.push({ file, rel: prefix + file.name });
          } else if (entry.isDirectory) {
            const reader = entry.createReader();
            let batch;
            do {
              batch = await new Promise((res, rej) => reader.readEntries(res, rej));
              for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
            } while (batch.length);
          }
        };
        for (const en of entries) await walk(en, '');
      } else items = plainFiles.map((f) => ({ file: f, rel: f.name }));
      uploadItems(items, destDir);
    })().catch((e) => toast('error', 'Could not read dropped items', e.message));
  }

  $('#filePicker').addEventListener('change', (e) => {
    uploadItems([...e.target.files].map((f) => ({ file: f, rel: f.name })), S.ex.path);
    e.target.value = '';
  });
  $('#folderPicker').addEventListener('change', (e) => {
    uploadItems([...e.target.files].map((f) => ({ file: f, rel: f.webkitRelativePath || f.name })), S.ex.path);
    e.target.value = '';
  });

  // ---------------------------------------------------------------- transfers
  function xhrUpload(cid, batch, dest, tid, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      for (const it of batch) fd.append('relpath', it.rel);
      for (const it of batch) fd.append('files', it.file, it.file.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/ftp/${cid}/upload?${q({ path: dest, tid })}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error((data && data.error) || `Upload failed (HTTP ${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Network error while sending files to the app'));
      xhr.send(fd);
    });
  }

  async function uploadItems(items, destDir) {
    const cid = S.activeConn;
    if (!items.length || !cid) return;
    const total = items.reduce((n, i) => n + i.file.size, 0);
    const label = items.length === 1 ? items[0].rel : `${items.length} files`;
    const job = { id: uid(), label, dest: destDir, cid, count: items.length, total, sent: 0, ftp: 0, phase: 'sending', status: 'running', ok: 0, failures: [], current: '' };
    S.transfers.unshift(job);
    renderTransfers();
    const batches = [];
    let cur = [], curSize = 0;
    for (const it of items) {
      if (cur.length && (cur.length >= 100 || curSize + it.file.size > 256 * 1024 * 1024)) { batches.push(cur); cur = []; curSize = 0; }
      cur.push(it);
      curSize += it.file.size;
    }
    if (cur.length) batches.push(cur);
    let base = 0;
    try {
      for (const b of batches) {
        const tid = uid();
        const bSize = b.reduce((n, i) => n + i.file.size, 0);
        S.transferByTid[tid] = { job, base };
        job.phase = 'sending';
        const r = await xhrUpload(cid, b, destDir, tid, (loaded) => { job.sent = base + Math.min(loaded, bSize); scheduleTransfers(); });
        delete S.transferByTid[tid];
        for (const x of r.results) { if (x.ok) job.ok++; else job.failures.push(x); }
        base += bSize;
        job.sent = job.ftp = base;
        scheduleTransfers();
      }
      job.status = job.failures.length ? 'error' : 'done';
    } catch (e) {
      job.status = 'error';
      job.failures.push({ path: '(batch)', error: e.message });
    }
    job.phase = 'done';
    renderTransfers();
    if (job.status === 'done') toast('success', `Uploaded ${job.ok} file${job.ok > 1 ? 's' : ''}`, `to ${destDir}`);
    else toast('error', `Upload finished with ${job.failures.length} error(s)`, job.failures[0] && job.failures[0].error);
    if (S.view === 'explorer' && S.activeConn === cid && S.ex.path && (S.ex.path === destDir || destDir.startsWith(S.ex.path === '/' ? '/' : S.ex.path + '/'))) loadDir(S.ex.path);
  }

  let trRaf = 0;
  function scheduleTransfers() { if (!trRaf) trRaf = requestAnimationFrame(() => { trRaf = 0; renderTransfers(); }); }

  let trCollapsed = false;
  function renderTransfers() {
    const el = $('#transfers');
    const list = S.transfers.slice(0, 30);
    if (!list.length) { el.classList.remove('show'); return; }
    el.classList.add('show');
    el.classList.toggle('collapsed', trCollapsed);
    const active = list.filter((j) => j.status === 'running').length;
    const items = list.map((j) => {
      const pct = j.total ? (j.phase === 'sending' ? j.sent / j.total : j.ftp / j.total) * 100 : j.status === 'running' ? 0 : 100;
      let sub;
      if (j.status === 'running') sub = j.phase === 'sending' ? `Sending to app · ${Math.round(pct)}%` : `Uploading to FTP · ${Math.round(pct)}% ${j.current ? '· ' + j.current : ''}`;
      else if (j.status === 'done') sub = `Done · ${j.ok} file${j.ok > 1 ? 's' : ''} · ${fmtSize(j.total)}`;
      else sub = `${j.failures.length} failed · ${j.ok} uploaded`;
      return h('div', { class: 'tr-item' },
        h('div', { class: 'tr-top' },
          j.status === 'running' ? icon('loader', 'spin') : j.status === 'done' ? h('span', { style: { color: 'var(--success)' } }, icon('check-circle')) : h('span', { style: { color: 'var(--danger)' } }, icon('x-circle')),
          h('span', { class: 'n', title: j.label }, j.label),
          j.status === 'error' && h('button', { class: 'btn sm ghost', onclick: () => showFailures(j) }, 'Details')),
        j.status === 'running' && h('div', { class: 'progress' }, h('div', { style: { width: `${Math.max(2, pct)}%` } })),
        h('div', { class: 'tr-sub' }, h('span', null, sub), h('span', { class: 'mono' }, `→ ${j.dest}`)));
    });
    setKids(el, 
      h('div', { class: 'transfers-head' }, icon('upload-cloud'), h('span', { class: 'grow' }, active ? `Uploading (${active})` : 'Transfers'),
        ibtn(trCollapsed ? 'chevron-up' : 'chevron-down', trCollapsed ? 'Expand' : 'Collapse', () => { trCollapsed = !trCollapsed; renderTransfers(); }, 'sm'),
        ibtn('x', 'Clear finished', () => { S.transfers = S.transfers.filter((j) => j.status === 'running'); renderTransfers(); }, 'sm')),
      h('div', { class: 'transfers-body' }, items));
  }

  function showFailures(j) {
    const m = modal({ title: 'Upload errors', iconName: 'alert', size: 'wide', body: h('div', { class: 'console' }, j.failures.map((f) => h('div', { class: 'l' }, h('span', { class: 'error' }, '✕ '), f.path, ' — ', f.error))), foot: [btn('Close', null, () => m.close())] });
  }

  // ================================================================ deploy view
  function connName(cid) { const c = conn(cid); return c ? c.name : '(missing connection)'; }

  function repoStatusBadge(r) {
    if (!r.enabled) return h('span', { class: 'badge' }, icon('pause'), 'Paused');
    switch (r.status) {
      case 'checking': return h('span', { class: 'badge info' }, icon('loader', 'spin'), 'Checking');
      case 'deploying': return h('span', { class: 'badge accent' }, icon('loader', 'spin'), 'Deploying');
      case 'error': return h('span', { class: 'badge danger' }, icon('alert'), 'Error');
      default: return r.lastRemoteSha && r.lastRemoteSha !== r.lastDeployedSha ? h('span', { class: 'badge warn' }, icon('clock'), 'Pending') : h('span', { class: 'badge success' }, icon('check'), 'Up to date');
    }
  }

  function depStatusBadge(d) {
    if (d.status === 'running') return h('span', { class: 'badge accent' }, icon('loader', 'spin'), 'Running');
    if (d.status === 'success') return h('span', { class: 'badge success' }, icon('check'), 'Success');
    return h('span', { class: 'badge danger' }, icon('x'), 'Failed');
  }

  function triggerLabel(t) {
    return { poll: 'Auto (poll)', 'push-hook': 'Push hook', manual: 'Manual', 'manual-full': 'Full redeploy', initial: 'Initial' }[t] || t;
  }

  function renderDeploy(ct) {
    const day = Date.now() - 86400000;
    const recent = S.deployments.filter((d) => Date.parse(d.startedAt) > day);
    const lastOk = S.deployments.find((d) => d.status === 'success');
    const stats = h('div', { class: 'stats' },
      h('div', { class: 'card stat' }, h('div', { class: 'k' }, icon('git'), 'Watched repositories'), h('div', { class: 'v' }, S.repos.length)),
      h('div', { class: 'card stat' }, h('div', { class: 'k' }, icon('rocket'), 'Deploys (24h)'), h('div', { class: 'v' }, recent.length)),
      h('div', { class: 'card stat' }, h('div', { class: 'k' }, icon('x-circle'), 'Failures (24h)'), h('div', { class: 'v', style: { color: recent.some((d) => d.status === 'failed') ? 'var(--danger)' : '' } }, recent.filter((d) => d.status === 'failed').length)),
      h('div', { class: 'card stat' }, h('div', { class: 'k' }, icon('clock'), 'Last successful deploy'), h('div', { class: 'v', style: { fontSize: '17px', marginTop: '8px' } }, lastOk ? timeAgo(lastOk.finishedAt) : '—')));

    if (!S.repos.length) {
      setKids(ct, stats, h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', null,
        h('div', { class: 'big' }, icon('git')),
        h('h3', null, 'Deploy to FTP on every push'),
        h('p', null, 'Link a Git repository, choose which folders go to which FTP folders, and every push to your branch (main by default) is uploaded automatically — only the changed files.'),
        S.connections.length ? btn('Add repository', 'plus', () => openRepoForm(), 'primary') : btn('First, add an FTP connection', 'server', () => openConnectionForm(), 'primary')))));
      return;
    }

    const cards = h('div', { class: 'repos' }, S.repos.map(repoCard));
    const hist = S.deployments.slice(0, 40);
    const table = h('div', { class: 'card', style: { overflow: 'hidden' } }, hist.length
      ? h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['Status', 'Repository', 'Commit', 'Trigger', 'Changes', 'Duration', 'When'].map((t) => h('th', null, t)))),
        h('tbody', null, hist.map((d) => h('tr', { class: 'click', onclick: () => openDeployLog(d.id) },
          h('td', null, depStatusBadge(d)),
          h('td', null, h('b', null, d.repoName)),
          h('td', null, h('div', { class: 'row' }, h('span', { class: 'chip' }, icon('commit'), short(d.to)), h('span', { class: 'commit-msg', title: d.commit ? d.commit.message : '' }, d.commit ? d.commit.message : ''))),
          h('td', null, h('span', { class: 'hint' }, triggerLabel(d.trigger), d.full ? ' · full' : '')),
          h('td', null, d.status === 'running' ? `${d.done}/${d.total}` : h('span', null, h('span', { style: { color: 'var(--success)' } }, `↑${d.uploaded}`), ' ', h('span', { style: { color: 'var(--warn)' } }, `✕${d.deleted}`), d.failed ? h('span', { style: { color: 'var(--danger)' } }, ` ⚠${d.failed}`) : null)),
          h('td', { class: 'hint' }, fmtDuration(d.startedAt, d.finishedAt)),
          h('td', { class: 'hint', title: new Date(d.startedAt).toLocaleString() }, timeAgo(d.startedAt))))))
      : h('div', { class: 'empty', style: { padding: '30px' } }, h('div', null, h('p', null, 'No deployments yet. Push to your branch or click "Sync now".'))));

    setKids(ct, stats, cards, h('div', { class: 'section-title' }, icon('history'), h('h2', null, 'Deployment history'), h('span', { class: 'hint' }, 'Click a row to see the full log')), table);
  }

  function repoCard(r) {
    const running = S.deployments.find((d) => d.repoId === r.id && d.status === 'running');
    const pending = r.lastRemoteSha && r.lastDeployedSha && r.lastRemoteSha !== r.lastDeployedSha;
    const enabledSwitch = h('label', { class: 'switch', title: r.enabled ? 'Auto-deploy on' : 'Auto-deploy paused' },
      h('input', { type: 'checkbox', checked: r.enabled, onchange: async (e) => { try { await api('PUT', `/api/repos/${r.id}`, { enabled: e.target.checked }); } catch (err) { toast('error', 'Update failed', err.message); } } }), h('span'));
    return h('div', { class: 'card repo-card' },
      h('div', { class: 'card-head' },
        h('div', { class: 'repo-icon' }, icon('git')),
        h('div', { class: 'repo-title' }, h('h3', null, r.name), h('div', { class: 'src', title: r.url }, r.url)),
        repoStatusBadge(r),
        enabledSwitch),
      h('div', { class: 'kv' },
        h('div', { class: 'k' }, 'Branch'), h('div', { class: 'v' }, h('span', { class: 'chip' }, icon('git'), r.branch)),
        h('div', { class: 'k' }, 'FTP server'), h('div', { class: 'v' }, connName(r.connectionId)),
        h('div', { class: 'k' }, 'Deployed'), h('div', { class: 'v' }, h('span', { class: 'chip' }, short(r.lastDeployedSha)), ' ', h('span', { class: 'hint' }, r.lastDeployedAt ? timeAgo(r.lastDeployedAt) : r.lastDeployedSha ? 'baseline' : 'not yet')),
        pending ? [h('div', { class: 'k' }, 'Remote head'), h('div', { class: 'v' }, h('span', { class: 'chip' }, short(r.lastRemoteSha)), ' ', h('span', { class: 'hint' }, 'not deployed yet'))] : null,
        h('div', { class: 'k' }, 'Last check'), h('div', { class: 'v hint' }, `${timeAgo(r.lastCheckedAt)} · every ${r.pollSec}s${r.localPath ? ' + push hook' : ''}`)),
      h('div', { class: 'mappings' }, r.mappings.map((m) => h('div', { class: 'mapping', title: m.deleteRemoved ? 'Files deleted in git are deleted on FTP' : 'Deletions are not synced' },
        icon('folder'), h('span', null, m.local ? `${m.local}/` : '(repo root)/'), icon('arrow-right'), h('span', null, m.remote), !m.deleteRemoved ? h('span', { class: 'badge', style: { marginLeft: 'auto' } }, 'keep deleted') : null))),
      running ? h('div', { style: { padding: '6px 18px 4px' } },
        h('div', { class: `progress ${running.total ? '' : 'indet'}` }, h('div', { style: { width: `${running.total ? (running.done / running.total) * 100 : 0}%` } })),
        h('div', { class: 'hint', style: { marginTop: '6px' } }, running.total ? `${running.done} / ${running.total} files` : 'Preparing…')) : null,
      r.lastError && r.status === 'error' ? h('div', { class: 'repo-error' }, icon('alert'), h('div', null, r.lastError)) : null,
      h('div', { class: 'repo-foot' },
        btn('Sync now', 'play', () => syncRepo(r, false), 'sm primary', { disabled: !!running }),
        btn('Redeploy all', 'rocket', () => syncRepo(r, true), 'sm', { disabled: !!running }),
        btn('History', 'history', () => { const d = S.deployments.find((x) => x.repoId === r.id); d ? openDeployLog(d.id) : toast('info', 'No deployments yet'); }, 'sm ghost'),
        h('span', { class: 'grow' }),
        ibtn('edit', 'Edit', () => openRepoForm(r), 'sm'),
        ibtn('more', 'More', (e) => repoMenu(r, e.clientX, e.clientY), 'sm')));
  }

  function repoMenu(r, x, y) {
    showMenu(x, y, [
      { label: 'Sync now', icon: 'play', action: () => syncRepo(r, false) },
      { label: 'Redeploy all files', icon: 'rocket', action: () => syncRepo(r, true) },
      { label: 'Mark remote head as deployed', icon: 'check', action: () => markDeployed(r) },
      '-',
      { label: 'Install push hook', icon: 'zap', disabled: !r.localPath, action: () => installHook(r) },
      { label: 'Remove push hook', icon: 'x', disabled: !r.localPath, action: () => removeHook(r) },
      '-',
      { label: 'Edit…', icon: 'edit', action: () => openRepoForm(r) },
      { label: 'Remove', icon: 'trash', danger: true, action: () => deleteRepo(r) },
    ]);
  }

  async function syncRepo(r, full) {
    if (full && !(await confirmDialog({ title: 'Redeploy all files?', message: `Every file in the mapped folders of ${r.name} (${r.branch}) will be uploaded to FTP again, overwriting the remote copies.`, confirmText: 'Redeploy', iconName: 'rocket' }))) return;
    try {
      await api('POST', `/api/repos/${r.id}/sync`, { full });
      toast('info', full ? 'Full redeploy started' : 'Checking for new commits…', r.name);
    } catch (e) { toast('error', 'Sync failed', e.message); }
  }

  function checkAll() { S.repos.forEach((r) => api('POST', `/api/repos/${r.id}/sync`, {}).catch(() => {})); toast('info', 'Checking all repositories…'); }

  async function markDeployed(r) {
    if (!(await confirmDialog({ title: 'Mark as deployed?', message: 'The current remote head will be recorded as deployed without uploading anything. Only later pushes will be synced.', confirmText: 'Mark deployed' }))) return;
    try { await api('POST', `/api/repos/${r.id}/baseline`, {}); toast('success', 'Baseline updated'); } catch (e) { toast('error', 'Failed', e.message); }
  }

  async function installHook(r) {
    try { const x = await api('POST', `/api/repos/${r.id}/hook`); toast('success', 'Push hook installed', x.file); } catch (e) { toast('error', 'Hook install failed', e.message); }
  }
  async function removeHook(r) {
    try { const x = await api('DELETE', `/api/repos/${r.id}/hook`); toast(x.ok ? 'success' : 'info', x.ok ? 'Push hook removed' : 'No hook installed'); } catch (e) { toast('error', 'Failed', e.message); }
  }

  async function deleteRepo(r) {
    if (!(await confirmDialog({ title: `Remove ${r.name}?`, message: 'Stops syncing this repository and removes its local cache and push hook. Files on FTP and your repository are not touched.', confirmText: 'Remove', danger: true }))) return;
    try { await api('DELETE', `/api/repos/${r.id}`); toast('success', 'Repository removed'); } catch (e) { toast('error', 'Failed', e.message); }
  }

  async function openDeployLog(depId) {
    const con = h('div', { class: 'console' }, h('div', { class: 'l' }, 'Loading…'));
    const headInfo = h('div');
    const line = (en) => h('div', { class: 'l' }, h('span', { class: 't' }, new Date(en.ts).toLocaleTimeString()), h('span', { class: en.level }, en.message));
    const m = modal({
      title: 'Deployment log', iconName: 'terminal', size: 'xwide',
      body: h('div', { class: 'stack' }, headInfo, con),
      foot: [btn('Copy log', 'copy', () => copyText(con.innerText)), btn('Close', null, () => m.close())],
      onClose: () => S.logSubs.delete(depId),
    });
    try {
      const d = await api('GET', `/api/deployments/${depId}`);
      const renderHead = (dd) => setKids(headInfo, h('div', { class: 'row wrap' }, depStatusBadge(dd), h('b', null, dd.repoName), h('span', { class: 'chip' }, short(dd.to)), dd.commit ? h('span', { class: 'hint' }, `${dd.commit.message} — ${dd.commit.author}`) : null, h('span', { class: 'grow' }), h('span', { class: 'hint' }, `${triggerLabel(dd.trigger)} · ${new Date(dd.startedAt).toLocaleString()}`)));
      renderHead(d);
      setKids(con, ...d.log.map(line));
      con.scrollTop = con.scrollHeight;
      S.logSubs.set(depId, {
        line: (en) => { const stick = con.scrollTop + con.clientHeight >= con.scrollHeight - 30; con.append(line(en)); if (stick) con.scrollTop = con.scrollHeight; },
        head: renderHead,
      });
    } catch (e) { setKids(con, h('div', { class: 'l error' }, e.message)); }
  }

  // ---------------------------------------------------------------- repo form
  function openRepoForm(existing) {
    if (!S.connections.length) { toast('warn', 'Add an FTP connection first'); openConnectionForm(); return; }
    const isEdit = !!existing;
    const e = existing || { branch: 'main', pollSec: S.settings.defaultPollSec || 60, enabled: true, mappings: [{ local: '', remote: (S.connections[0].remoteRoot || '/'), deleteRemoved: true }], excludes: ['.github/', '.gitignore', '.gitattributes'] };
    const branchList = h('datalist', { id: `br_${uid()}` });
    const f = {
      source: h('input', { class: 'input mono', value: isEdit ? e.localPath || e.url : '', placeholder: 'D:\\Projects\\my-site   or   https://github.com/me/my-site.git', spellcheck: 'false' }),
      name: h('input', { class: 'input', value: e.name || '', placeholder: 'my-site' }),
      branch: h('input', { class: 'input mono', value: e.branch || 'main', list: branchList.id }),
      url: h('input', { class: 'input mono', value: e.url || '', placeholder: 'https://github.com/me/my-site.git', spellcheck: 'false' }),
      localPath: h('input', { class: 'input mono', value: e.localPath || '', placeholder: '(optional) D:\\Projects\\my-site', spellcheck: 'false' }),
      gitUser: h('input', { class: 'input mono', value: e.gitUser || '', placeholder: 'x-access-token', autocomplete: 'off' }),
      token: h('input', { class: 'input mono', type: 'password', placeholder: e.hasToken ? '•••••••• (saved — leave empty to keep)' : 'ghp_… (only for private HTTPS repos)', autocomplete: 'new-password' }),
      connectionId: h('select', { class: 'select' }, S.connections.map((c) => h('option', { value: c.id }, `${c.name} — ${c.host}`))),
      excludes: h('textarea', { class: 'textarea', rows: 3, value: (e.excludes || []).join('\n'), placeholder: 'node_modules/\n*.map\n.env' }),
      pollSec: h('input', { class: 'input', type: 'number', min: 10, value: e.pollSec || 60 }),
      enabled: h('input', { type: 'checkbox', checked: e.enabled !== false }),
      initialDeploy: h('input', { type: 'checkbox', checked: !!e.initialDeploy }),
      installHook: h('input', { type: 'checkbox', checked: true }),
    };
    f.connectionId.value = e.connectionId || S.activeConn || S.connections[0].id;
    const inspectOut = h('div');
    let mappings = (e.mappings || []).map((m) => ({ ...m }));
    const mapHost = h('div', { class: 'stack', style: { gap: '8px' } });
    const renderMaps = () => {
      setKids(mapHost, 
        ...mappings.map((m, i) => {
          const local = h('input', { class: 'input mono', value: m.local, placeholder: 'dist  (empty = whole repo)', oninput: (ev) => (m.local = ev.target.value) });
          const remote = h('input', { class: 'input mono', value: m.remote, placeholder: '/public_html', oninput: (ev) => (m.remote = ev.target.value) });
          const del = h('label', { class: 'switch', title: 'Delete files on FTP when they are deleted in git' }, h('input', { type: 'checkbox', checked: m.deleteRemoved !== false, onchange: (ev) => (m.deleteRemoved = ev.target.checked) }), h('span'));
          return h('div', { class: 'map-row' },
            local,
            h('span', { class: 'arrow' }, icon('arrow-right')),
            h('div', { class: 'row' }, remote, ibtn('folder', 'Browse FTP folders', async () => {
              const p = await pickRemoteFolder(f.connectionId.value, remote.value || '/');
              if (p) { remote.value = p; m.remote = p; }
            })),
            del,
            ibtn('trash', 'Remove mapping', () => { mappings.splice(i, 1); renderMaps(); }, '', { disabled: mappings.length === 1 }));
        }),
        h('div', { class: 'row' }, btn('Add mapping', 'plus', () => { mappings.push({ local: '', remote: '/', deleteRemoved: true }); renderMaps(); }, 'sm'), h('span', { class: 'hint' }, 'Toggle = also delete on FTP when deleted in git.'))
      );
    };
    renderMaps();

    const inspect = async () => {
      const src = f.source.value.trim();
      if (!src) return;
      inspectBtn.disabled = true;
      setKids(inspectOut, h('div', { class: 'callout' }, icon('loader', 'spin'), 'Inspecting repository…'));
      try {
        const info = await api('POST', '/api/git/inspect', { source: src, token: f.token.value || undefined, gitUser: f.gitUser.value || undefined });
        f.url.value = info.url;
        if (info.localPath) f.localPath.value = info.localPath;
        if (!f.name.value) f.name.value = (info.localPath || info.url).replace(/[\\/]+$/, '').split(/[\\/]/).pop().replace(/\.git$/, '');
        setKids(branchList, ...info.branches.map((b) => h('option', { value: b })));
        if (!info.branches.includes(f.branch.value)) f.branch.value = info.branches.includes('main') ? 'main' : info.branches.includes('master') ? 'master' : info.branches[0] || 'main';
        setKids(inspectOut, h('div', { class: 'callout ok' }, icon('check-circle'), h('div', null,
          h('div', null, 'Watching ', h('code', null, info.url)),
          info.localPath ? h('div', { class: 'hint' }, 'Local clone found — a pre-push hook can trigger deploys instantly.') : null,
          h('div', { class: 'hint' }, `Branches: ${info.branches.slice(0, 15).join(', ') || '(none)'}`))));
      } catch (err) {
        setKids(inspectOut, h('div', { class: 'callout err' }, icon('x-circle'), err.message));
      } finally { inspectBtn.disabled = false; }
    };
    const inspectBtn = btn('Inspect', 'search', inspect);
    f.source.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); inspect(); } });

    const saveBtn = btn(isEdit ? 'Save changes' : 'Add repository', 'check', async () => {
      if (!f.url.value.trim() && f.source.value.trim()) await inspect();
      const body = {
        name: f.name.value, url: f.url.value.trim() || f.source.value.trim(), localPath: f.localPath.value.trim(), branch: f.branch.value.trim(),
        connectionId: f.connectionId.value, mappings, excludes: f.excludes.value, pollSec: f.pollSec.value, enabled: f.enabled.checked,
        initialDeploy: f.initialDeploy.checked, gitUser: f.gitUser.value, installHook: f.installHook.checked,
      };
      if (f.token.value) body.token = f.token.value;
      saveBtn.disabled = true;
      try {
        if (isEdit) {
          await api('PUT', `/api/repos/${e.id}`, body);
          if (body.installHook && body.localPath) await api('POST', `/api/repos/${e.id}/hook`).catch((er) => toast('warn', 'Hook not installed', er.message));
          toast('success', 'Repository updated');
        } else {
          const r = await api('POST', '/api/repos', body);
          if (r.hook && r.hook.error) toast('warn', 'Push hook not installed', r.hook.error);
          toast('success', 'Repository added', body.initialDeploy ? 'Running the first full deploy…' : `Watching ${body.branch}. The current commit is the baseline — your next push will deploy.`);
          if (!S.repos.some((x) => x.id === r.id)) S.repos.push(r);
        }
        m.close();
        if (S.view !== 'deploy') setView('deploy'); else renderAll();
      } catch (err) {
        toast('error', 'Could not save', err.message);
      } finally { saveBtn.disabled = false; }
    }, 'primary');

    const details = h('details', { open: !!e.hasToken || undefined },
      h('summary', { style: { cursor: 'pointer', color: 'var(--text-2)', fontSize: '13px', fontWeight: 600 } }, 'Private repository over HTTPS (access token)'),
      h('div', { class: 'grid-2', style: { marginTop: '10px' } },
        h('div', { class: 'field' }, h('label', null, 'Username'), f.gitUser),
        h('div', { class: 'field' }, h('label', null, 'Access token'), f.token)),
      h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Not needed for SSH remotes or if Git already has your credentials (Git Credential Manager). The token is stored encrypted.'));

    const m = modal({
      title: isEdit ? `Edit ${e.name}` : 'Add repository', iconName: 'git', size: 'xwide', closeOnBackdrop: false,
      body: h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', null, 'Repository — local folder or remote URL'), h('div', { class: 'row' }, f.source, inspectBtn), h('div', { class: 'hint' }, 'Point to your local project folder (recommended: enables the instant push hook) or paste the remote URL.')),
        inspectOut,
        h('div', { class: 'grid-2' },
          h('div', { class: 'field' }, h('label', null, 'Name'), f.name),
          h('div', { class: 'field' }, h('label', null, 'Branch to deploy'), f.branch, branchList)),
        h('div', { class: 'grid-2' },
          h('div', { class: 'field' }, h('label', null, 'Remote watched (where you push)'), f.url),
          h('div', { class: 'field' }, h('label', null, 'Local folder (for push hook)'), f.localPath)),
        details,
        h('div', { class: 'field' }, h('label', null, 'Deploy to FTP connection'), f.connectionId),
        h('div', { class: 'field' }, h('label', null, 'Folder mappings — repository folder → FTP folder'), mapHost),
        h('div', { class: 'grid-2' },
          h('div', { class: 'field' }, h('label', null, 'Exclude (one pattern per line)'), f.excludes, h('div', { class: 'hint' }, 'Glob patterns: node_modules/, *.map, src/**/*.test.js')),
          h('div', { class: 'stack' },
            h('div', { class: 'field' }, h('label', null, 'Check remote every (seconds)'), f.pollSec),
            h('label', { class: 'check' }, f.enabled, h('span', null, 'Auto-deploy enabled')),
            !isEdit && h('label', { class: 'check' }, f.initialDeploy, h('span', null, 'Upload all current files now', h('div', { class: 'hint' }, 'Otherwise the current commit is the baseline and only future pushes are uploaded.'))),
            h('label', { class: 'check' }, f.installHook, h('span', null, 'Install git pre-push hook', h('div', { class: 'hint' }, 'Deploys seconds after "git push" (needs local folder).')))))),
      foot: [btn('Cancel', null, () => m.close()), saveBtn],
    });
    if (isEdit) setKids(branchList, h('option', { value: e.branch }));
  }

  function pickRemoteFolder(cid, start) {
    return new Promise((resolve) => {
      let cur = start || '/';
      let picked = null;
      const listEl = h('div', { class: 'picker-list' });
      const pathEl = h('input', { class: 'input mono', value: cur, onkeydown: (e) => { if (e.key === 'Enter') load(e.target.value); } });
      const load = async (p) => {
        setKids(listEl, h('div', { class: 'picker-item hint' }, icon('loader', 'spin'), 'Loading…'));
        try {
          const r = await api('GET', `/api/ftp/${cid}/list?${q({ path: p })}`);
          cur = r.path;
          pathEl.value = cur;
          const dirs = r.entries.filter((x) => x.type === 'dir' || x.type === 'link');
          setKids(listEl, 
            cur !== '/' ? h('div', { class: 'picker-item', onclick: () => load(parentPath(cur)) }, icon('arrow-up'), '..') : null,
            ...dirs.map((d) => h('div', { class: 'picker-item', onclick: () => load(d.path) }, h('span', { class: 'ficon dir' }, icon('folder')), d.name)),
            !dirs.length ? h('div', { class: 'picker-item hint' }, 'No sub-folders') : null);
        } catch (e) {
          setKids(listEl, h('div', { class: 'picker-item', style: { color: 'var(--danger)' } }, icon('alert'), e.message));
        }
      };
      const m = modal({
        title: 'Choose FTP folder', iconName: 'folder',
        body: h('div', { class: 'stack' }, pathEl, listEl),
        foot: [
          h('div', { class: 'left' }, btn('New folder', 'folder-plus', async () => {
            const n = await promptDialog({ title: 'New folder', label: `Create inside ${cur}`, iconName: 'folder-plus', confirmText: 'Create' });
            if (!n) return;
            try { await api('POST', `/api/ftp/${cid}/mkdir`, { path: joinPath(cur, n.trim()) }); load(joinPath(cur, n.trim())); } catch (e) { toast('error', 'Failed', e.message); }
          }, 'sm')),
          btn('Cancel', null, () => m.close()),
          btn('Select this folder', 'check', () => { picked = cur; m.close(); }, 'primary')],
        onClose: () => resolve(picked),
      });
      load(cur);
    });
  }

  // ================================================================ activity view
  function renderActivity(ct) {
    const filters = [['all', 'All'], ['ftp', 'FTP'], ['git', 'Git'], ['app', 'App'], ['error', 'Errors']];
    const seg = h('div', { class: 'seg' }, filters.map(([k, l]) => h('button', { class: S.actFilter === k ? 'active' : '', onclick: () => { S.actFilter = k; renderActivity(ct); } }, l)));
    const search = h('input', { class: 'input', placeholder: 'Search activity…', value: S.actSearch, oninput: (e) => { S.actSearch = e.target.value; renderList(); } });
    const listHost = h('div', { class: 'card log' });
    const renderList = () => {
      const s = S.actSearch.toLowerCase();
      const items = S.activity.filter((a) => (S.actFilter === 'all' || (S.actFilter === 'error' ? a.level === 'error' || a.level === 'warn' : a.scope === S.actFilter)) && (!s || a.message.toLowerCase().includes(s))).slice(0, 400);
      const ic = { info: 'info', success: 'check', warn: 'alert', error: 'x' };
      setKids(listHost, ...(items.length ? items.map((a) => h('div', { class: 'log-item' },
        h('span', { class: `lvl ${a.level}` }, icon(ic[a.level] || 'info')),
        h('span', { class: 'time', title: new Date(a.ts).toLocaleString() }, fmtDate(a.ts)),
        h('span', { class: 'badge' }, a.scope.toUpperCase()),
        h('span', { style: { minWidth: 0, wordBreak: 'break-word' } }, a.message, a.deploymentId ? h('a', { href: '#', style: { marginLeft: '8px', fontSize: '12px' }, onclick: (e) => { e.preventDefault(); openDeployLog(a.deploymentId); } }, 'view log') : null)))
        : [h('div', { class: 'empty', style: { padding: '40px' } }, h('div', null, h('p', null, 'No activity to show.')))]));
    };
    setKids(ct, h('div', { class: 'row', style: { marginBottom: '14px' } }, seg, h('div', { class: 'search', style: { width: '300px' } }, icon('search'), search)), listHost);
    renderList();
    ct._renderList = renderList;
  }

  // ================================================================ settings view
  function renderSettings(ct) {
    const st = S.settings;
    const idle = h('input', { class: 'input', type: 'number', min: 1, max: 1440, value: st.idleTimeoutMin });
    const keep = h('input', { class: 'input', type: 'number', min: 10, max: 600, value: st.keepAliveSec });
    const poll = h('input', { class: 'input', type: 'number', min: 10, value: st.defaultPollSec });
    const theme = document.documentElement.dataset.theme;
    const save = async () => {
      try {
        S.settings = await api('PUT', '/api/settings', { idleTimeoutMin: idle.value, keepAliveSec: keep.value, defaultPollSec: poll.value });
        toast('success', 'Settings saved');
      } catch (e) { toast('error', 'Save failed', e.message); }
    };
    setKids(ct, h('div', { class: 'stack', style: { maxWidth: '760px' } },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, icon('clock'), h('h3', null, 'FTP session')),
        h('div', { class: 'card-body stack' },
          h('div', { class: 'grid-2' },
            h('div', { class: 'field' }, h('label', null, 'Disconnect after inactivity (minutes)'), idle),
            h('div', { class: 'field' }, h('label', null, 'Keep-alive NOOP while active (seconds)'), keep)),
          h('div', { class: 'callout' }, icon('info'), h('div', null, 'The app session never expires and you never re-enter credentials. After the idle time the FTP socket is closed to free the server; the next action reconnects silently with the saved, encrypted credentials.')))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, icon('git'), h('h3', null, 'Git deploy')),
        h('div', { class: 'card-body stack' },
          h('div', { class: 'field' }, h('label', null, 'Default polling interval for new repositories (seconds)'), poll),
          h('div', { class: 'hint' }, 'Polling uses "git ls-remote", which is very light. With the pre-push hook installed, deploys start within seconds of a push.'))),
      h('div', { class: 'row' }, btn('Save settings', 'check', save, 'primary')),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, icon('sun'), h('h3', null, 'Appearance')),
        h('div', { class: 'card-body' }, h('div', { class: 'seg' },
          h('button', { class: theme !== 'light' ? 'active' : '', onclick: () => setTheme('dark') }, 'Dark'),
          h('button', { class: theme === 'light' ? 'active' : '', onclick: () => setTheme('light') }, 'Light')))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, icon('database'), h('h3', null, 'About')),
        h('div', { class: 'kv', style: { padding: '14px 18px', gridTemplateColumns: '150px 1fr' } },
          h('div', { class: 'k' }, 'Local address'), h('div', { class: 'v mono' }, location.origin),
          h('div', { class: 'k' }, 'Data folder'), h('div', { class: 'v mono', title: S.dataDir }, S.dataDir),
          h('div', { class: 'k' }, 'Connections'), h('div', { class: 'v' }, S.connections.length),
          h('div', { class: 'k' }, 'Repositories'), h('div', { class: 'v' }, S.repos.length)))));
  }

  // ================================================================ live events
  let rerenderTimer = 0;
  function scheduleViewRender(view) {
    if (S.view !== view) return;
    if (rerenderTimer) return;
    rerenderTimer = setTimeout(() => { rerenderTimer = 0; if (S.view === view) renderContent(); }, 120);
  }

  function connectEvents() {
    const es = new EventSource('/api/events');
    es.onopen = async () => {
      const wasOffline = !S.live;
      S.live = true;
      renderSideFooter();
      if (wasOffline && booted) { await loadState(); renderAll(); }
    };
    es.onerror = () => { S.live = false; renderSideFooter(); };
    const on = (t, fn) => es.addEventListener(t, (e) => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(t, err); } });
    on('session', (s) => {
      S.sessions[s.connectionId] = s;
      renderConnList();
      if (s.connectionId === S.activeConn && S.view === 'explorer') {
        if (S._tbState !== s.state) renderTopbar(); else updateSessionPill();
      }
    });
    on('connections', (list) => {
      S.connections = list;
      if (S.activeConn && !conn()) { S.activeConn = null; S.ex.path = null; }
      renderAll();
    });
    on('activity', (a) => {
      S.activity.unshift(a);
      if (S.activity.length > 500) S.activity.length = 500;
      if (S.view === 'activity') { const ct = $('#content'); ct._renderList ? ct._renderList() : renderContent(); }
      if (a.level === 'error') renderNav();
      if (a.scope === 'git' && (a.level === 'success' || a.level === 'error') && a.deploymentId) toast(a.level, a.level === 'success' ? 'Deployed to FTP' : 'Deployment failed', a.message);
    });
    on('activity-cleared', () => { S.activity = []; if (S.view === 'activity') renderContent(); renderNav(); });
    on('repo', (r) => {
      const i = S.repos.findIndex((x) => x.id === r.id);
      if (i >= 0) S.repos[i] = r; else S.repos.push(r);
      renderNav();
      scheduleViewRender('deploy');
    });
    on('repo-removed', ({ id }) => { S.repos = S.repos.filter((r) => r.id !== id); renderNav(); scheduleViewRender('deploy'); });
    on('deploy', (d) => {
      const i = S.deployments.findIndex((x) => x.id === d.id);
      if (i >= 0) S.deployments[i] = d; else S.deployments.unshift(d);
      const sub = S.logSubs.get(d.id);
      if (sub) sub.head(d);
      scheduleViewRender('deploy');
      // A deploy just changed files on the server we're browsing: refresh the listing.
      if (d.status === 'success' && (d.uploaded || d.deleted) && d.connectionId === S.activeConn && S.view === 'explorer' && S.ex.path) loadDir(S.ex.path);
    });
    on('deploy-log', ({ deploymentId, entry }) => { const sub = S.logSubs.get(deploymentId); if (sub) sub.line(entry); });
    on('transfer', (t) => {
      const ref = S.transferByTid[t.tid];
      if (!ref) return;
      if (t.phase === 'ftp') { ref.job.phase = 'ftp'; ref.job.ftp = ref.base + (t.bytes || 0); ref.job.current = t.name || ''; scheduleTransfers(); }
    });
    on('settings', (s) => { S.settings = s; });
  }

  // ================================================================ keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (openMenuEl) { closeMenu(); return; }
      const top = modalStack[modalStack.length - 1];
      if (top) { top.close(); return; }
    }
    if (modalStack.length || S.view !== 'explorer' || !conn()) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const sel = selectedEntries();
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) { e.preventDefault(); loadDir(S.ex.path); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); visibleEntries().forEach((x) => S.ex.selected.add(x.path)); renderFileTable(); }
    else if (e.key === 'Delete' && sel.length) { e.preventDefault(); deleteEntries(sel); }
    else if (e.key === 'F2' && sel.length === 1) { e.preventDefault(); renameEntry(sel[0]); }
    else if (e.key === 'Enter' && sel.length === 1) { e.preventDefault(); openEntry(sel[0]); }
    else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) { e.preventDefault(); if (S.ex.path && S.ex.path !== '/') navigate(parentPath(S.ex.path)); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goFwd(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
      e.preventDefault();
      const list = visibleEntries();
      if (!list.length) return;
      let i = list.findIndex((x) => x.path === S.ex.anchor);
      i = e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
      S.ex.selected = new Set([list[i].path]);
      S.ex.anchor = list[i].path;
      renderFileTable();
      const row = document.querySelector(`tr.file-row.selected`);
      row && row.scrollIntoView({ block: 'nearest' });
    }
  });
  // Prevent the browser from opening files dropped outside the drop zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // ================================================================ boot
  let booted = false;
  async function loadState() {
    const st = await api('GET', '/api/state');
    S.settings = st.settings;
    S.connections = st.connections;
    S.sessions = Object.fromEntries(st.sessions.map((s) => [s.connectionId, s]));
    S.repos = st.repos;
    S.deployments = st.deployments;
    S.activity = st.activity;
    S.port = st.port;
    S.dataDir = st.dataDir;
    if (S.activeConn && !conn()) S.activeConn = null;
  }

  async function boot() {
    $('#brandLogo').append(icon('upload-cloud'));
    $('#addConnBtn').append(icon('plus'));
    $('#addConnBtn').addEventListener('click', () => openConnectionForm());
    try {
      await loadState();
    } catch (e) {
      setKids($('#content'), h('div', { class: 'empty' }, h('div', null, h('h3', null, 'Cannot reach the local server'), h('p', null, e.message), btn('Retry', 'refresh', () => location.reload(), 'primary'))));
      return;
    }
    if (!S.activeConn && S.connections.length) S.activeConn = S.connections[0].id;
    renderAll();
    connectEvents();
    booted = true;
    setInterval(updateSessionPill, 1000);
    setInterval(() => { if (!modalStack.length && (S.view === 'deploy')) renderContent(); }, 30000);
  }

  boot();
})();
