const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', process.env.APP_MCP_UI_PROFILE);
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace('</head>', `<style>${css}</style></head>`);
  const window = new BrowserWindow({ width: 1000, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
});
app.on('window-all-closed', () => app.quit());
