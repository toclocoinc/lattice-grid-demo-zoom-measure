/** Minimal headless-Chrome-over-DevTools helper (Node 22+, no dependencies): serves the demo directory and drives one page. */
import { spawn } from 'node:child_process';
import { createServer as netServer } from 'node:net';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, extname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.csv': 'text/csv', '.md': 'text/markdown' };

/** Starts the static server and Chrome; returns the page driver and a close() that ends both. */
export async function launch() {
  const server = createServer(async (req, res) => {
    try {
      const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
      if (!p.startsWith(root)) throw new Error('out');
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'text/plain' }); res.end(await readFile(p));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const port = await new Promise((ok) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => ok(p)); }); });
  const profile = await mkdtemp(join(tmpdir(), 'zoom-demo-'));
  const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/snap/bin/chromium'].find((c) => true);
  await access(exe);
  const chrome = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore', detached: true });
  let ws; for (let i = 0; i < 150 && !ws; i++) { try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(200); } }
  const sock = new WebSocket(ws); await new Promise((ok) => { sock.onopen = ok; });
  let id = 0; const pend = new Map(); const page = { bad: [] }; let sessionId;
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.ok(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') page.bad.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) page.bad.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) page.bad.push(m.params.entry.text);
  };
  const send = (method, params = {}, sid) => new Promise((ok, rej) => { const i = ++id; pend.set(i, { ok, rej }); sock.send(JSON.stringify({ id: i, method, params, sessionId: sid })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const call = (m, p) => send(m, p, sessionId);
  await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  page.origin = origin; page.call = call;
  page.eval = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + JSON.stringify(r.exceptionDetails.exception?.description)); return r.result.value; };
  page.open = async (theme) => {
    page.bad.length = 0;
    await call('Page.navigate', { url: `${origin}/index.html${theme === 'dark' ? '?theme=dark' : ''}` });
    for (let i = 0; i < 100; i++) { if (await page.eval('!!(window.demo && document.querySelector("#line svg") && document.querySelector("#scatter svg") && document.querySelector("#bar svg"))').catch(() => false)) break; await sleep(200); }
    await sleep(800);
  };
  /** Real mouse events at page coordinates. */
  page.wheel = (x, y, deltaY) => call('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  page.drag = async (x1, y1, x2, y2, steps = 12) => {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps, button: 'left', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
  };
  page.click = async (x, y) => { await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); };
  page.key = async (key, code, text) => { await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code }); };
  page.shot = async (path) => { const { writeFile } = await import('node:fs/promises'); const png = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(path, Buffer.from(png.data, 'base64')); };
  page.close = async () => { try { process.kill(-chrome.pid, 'SIGTERM'); } catch {} server.close(); await rm(profile, { recursive: true, force: true }).catch(() => {}); };
  return page;
}
