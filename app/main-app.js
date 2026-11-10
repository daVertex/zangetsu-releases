// Zangetsu app code. Loaded by ../main.js (the launcher) with the folder it lives in.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const FEED = process.env.ZG_FEED || 'https://raw.githubusercontent.com/daVertex/zangetsu-releases/main/';

module.exports = function start(ctx) {
  const { appDir, version, shellVersion, cmp } = ctx;
  const updatesRoot = path.join(app.getPath('userData'), 'updates');
  let win;

  const send = (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };

  function create() {
    win = new BrowserWindow({
      width: 1400, height: 880, minWidth: 1100, minHeight: 700,
      frame: false, backgroundColor: '#000000', show: false,
      title: 'Zangetsu',
      icon: path.join(appDir, 'icon.png'),
      webPreferences: { preload: path.join(appDir, 'preload.js'), contextIsolation: true }
    });
    win.setMenu(null);
    win.loadFile(path.join(appDir, 'web', 'index.html'));
    win.once('ready-to-show', () => win.show());
    win.on('maximize', () => send('max', true));
    win.on('unmaximize', () => send('max', false));
  }

  /* ---------- window + background ---------- */
  ipcMain.on('win', (_e, a) => {
    if (!win) return;
    if (a === 'min') win.minimize();
    else if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (a === 'close') win.close();
  });
  ipcMain.handle('pick-bg', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose background', properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const ud = app.getPath('userData');
    const src = r.filePaths[0];
    const dest = path.join(ud, 'background' + path.extname(src).toLowerCase());
    for (const f of fs.readdirSync(ud)) if (f.startsWith('background.')) try { fs.unlinkSync(path.join(ud, f)); } catch {}
    fs.copyFileSync(src, dest);
    return pathToFileURL(dest).href;
  });

  /* ---------- updater: reads latest.json from the releases repo ---------- */
  let busy = false;
  async function check() {
    if (busy) return; busy = true;
    try {
      send('upd', { s: 'checking' });
      const res = await fetch(FEED + 'latest.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('feed ' + res.status);
      const m = await res.json();
      if (cmp(m.version, version) <= 0) { send('upd', { s: 'none' }); return; }
      if (m.minShell && cmp(m.minShell, shellVersion) > 0) { send('upd', { s: 'shell', v: m.version }); return; }
      const dest = path.join(updatesRoot, m.version);
      if (fs.existsSync(path.join(dest, '.complete'))) { send('upd', { s: 'ready', v: m.version }); return; }

      send('upd', { s: 'available', v: m.version });
      const tmp = dest + '.part';
      fs.rmSync(tmp, { recursive: true, force: true });
      const total = m.files.reduce((a, f) => a + f.size, 0) || 1;
      let done = 0;
      for (const f of m.files) {
        if (f.path.includes('..')) throw new Error('bad path');
        const r = await fetch(FEED + 'app/' + f.path.split('/').map(encodeURIComponent).join('/') + '?v=' + m.version, { cache: 'no-store' });
        if (!r.ok) throw new Error(f.path + ' ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        if (crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new Error('checksum failed: ' + f.path);
        const out = path.join(tmp, f.path);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, buf);
        done += f.size;
        send('upd', { s: 'downloading', p: Math.round(done / total * 100) });
      }
      fs.writeFileSync(path.join(tmp, '.complete'), m.version);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(tmp, dest);
      send('upd', { s: 'ready', v: m.version });
    } catch (e) {
      send('upd', { s: 'error', m: String(e && e.message || e).slice(0, 200) });
    } finally { busy = false; }
  }

  function cleanup() {
    try {
      for (const v of fs.readdirSync(updatesRoot)) {
        const d = path.join(updatesRoot, v);
        if (v.endsWith('.part') || (/^\d+\.\d+\.\d+$/.test(v) && cmp(v, version) < 0)) fs.rmSync(d, { recursive: true, force: true });
      }
    } catch {}
  }

  ipcMain.handle('version', () => version);
  ipcMain.on('upd-check', () => check());
  ipcMain.on('upd-install', () => { app.relaunch(); app.exit(0); });

  /* ---------- lifecycle ---------- */
  app.setAppUserModelId('com.davertex.zangetsu');
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    create();
    cleanup();
    if (app.isPackaged) {
      setTimeout(check, 6000);            // after the intro
      setInterval(check, 30 * 60 * 1000); // then every 30 minutes
    }
  });
  app.on('window-all-closed', () => app.quit());
};
