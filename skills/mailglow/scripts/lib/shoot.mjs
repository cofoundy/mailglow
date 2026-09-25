// Screenshots every message × variant × view × scheme through a headless Chrome driven over the
// DevTools Protocol with Node's built-in WebSocket (Node >= 22). No Puppeteer, no Playwright.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadMailbox, materialize } from './mailbox.mjs';
import { lint, summarize } from './lint.mjs';
import { startServer } from './server.mjs';

const VIEWS = { desktop: { width: 800, mobile: false }, mobile: { width: 390, mobile: false } };

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ...['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap((b) =>
      (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, b)),
    ),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c));
}

async function launch() {
  const bin = findChrome();
  if (!bin) throw new Error('No Chrome/Chromium/Edge found. Install one or set CHROME_PATH.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mailglow-chrome-'));
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('Chrome did not expose DevTools in 20s')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.once('exit', (c) => reject(new Error(`Chrome exited (${c}) before DevTools was ready`)));
  });
  const cdp = await CDP.connect(wsUrl);
  return {
    cdp,
    close: async () => {
      try { await cdp.send('Browser.close'); } catch { proc.kill(); }
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}

class CDP {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = (e) => reject(new Error('CDP websocket error: ' + (e.message || 'unknown')));
    });
  }
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.listeners = this.listeners.filter((l) => !(l.method === msg.method && l.sessionId === msg.sessionId && (l.fn(msg.params), true)));
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method, sessionId, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), timeoutMs);
      this.listeners.push({ method, sessionId, fn: (p) => { clearTimeout(t); resolve(p); } });
    });
  }
}

async function newPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  return {
    s: sessionId,
    async goto(url, { width, height = 900, mobile = false, dark = false, full = true }) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile }, sessionId);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }, sessionId);
      const loaded = cdp.once('Page.loadEventFired', sessionId);
      await cdp.send('Page.navigate', { url }, sessionId);
      await loaded;
      // Wait until images settle (or the inbox UI says it's ready).
      await this.eval(`new Promise(r=>{const done=()=>r(1);const imgs=[...document.images].filter(i=>!i.complete);
        Promise.all(imgs.map(i=>new Promise(k=>{i.onload=i.onerror=k}))).then(()=>{
          const t0=Date.now();(function w(){if(!('ready' in document.body.dataset)||document.body.dataset.ready==='1'||Date.now()-t0>8000)return setTimeout(done,120);setTimeout(w,60)})()});
        setTimeout(done,10000)})`);
      if (!full) return { width, height };
      // Measure with a tiny viewport: scrollHeight never reports less than the viewport height.
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 100, deviceScaleFactor: 2, mobile }, sessionId);
      const h = await this.eval('Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: Math.max(200, Math.min(h, 16000)), deviceScaleFactor: 2, mobile }, sessionId);
      return { width, height: Math.max(200, Math.min(h, 16000)) };
    },
    async eval(expression) {
      const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      return r.result?.value;
    },
    async shot(file, { width, height }) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } }, sessionId);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return fs.statSync(file).size;
    },
  };
}

export async function shoot({ dir, out, views = ['desktop', 'mobile'], schemes = ['light', 'dark'], inbox = true, only = null, log = console.log }) {
  const box = loadMailbox(dir);
  const messages = box.messages.filter((m) => !only || only.includes(m.slug));
  if (!messages.length) throw new Error(`No emails found in ${box.root}`);
  fs.mkdirSync(out, { recursive: true });
  const { server, url: base } = await startServer({ dir, port: 0, watch: false });
  const { cdp, close } = await launch();
  const page = await newPage(cdp);
  const shots = [];
  try {
    for (const m of messages) {
      for (const v of m.variants) {
        const tag = (m.variants.length > 1 ? `${m.slug}--${v.key}` : m.slug).replaceAll('/', '__');
        const html = materialize(v.file, { caseName: m.cases?.[0] });
        const lintSummary = summarize(lint(html));
        for (const view of views) {
          for (const scheme of schemes) {
            const url = `${base}/raw/${encodeURIComponent(m.slug)}/${encodeURIComponent(v.key)}?scheme=${scheme}`;
            const size = await page.goto(url, { ...VIEWS[view], dark: scheme !== 'light' });
            const file = path.join(out, `${tag}--${view}-${scheme}.png`);
            const bytes = await page.shot(file, size);
            if (bytes < 1500) throw new Error(`Suspiciously small screenshot (${bytes} B): ${file}`);
            shots.push({ slug: m.slug, variant: v.key, view, scheme, file: path.basename(file), lint: lintSummary, subject: m.subject });
            log(`  ✓ ${path.basename(file)}`);
          }
        }
        if (inbox) {
          const url = `${base}/?m=${encodeURIComponent(m.slug)}&v=${encodeURIComponent(v.key)}&view=desktop&scheme=light&img=1&tab=preview`;
          const size = await page.goto(url, { width: 1440, height: 900, full: false });
          const file = path.join(out, `${tag}--inbox.png`);
          await page.shot(file, size);
          shots.push({ slug: m.slug, variant: v.key, view: 'inbox', scheme: 'light', file: path.basename(file), lint: lintSummary, subject: m.subject });
          log(`  ✓ ${path.basename(file)}`);
        }
      }
    }
  } finally {
    await close();
    server.close();
  }
  fs.writeFileSync(path.join(out, 'shots.json'), JSON.stringify(shots, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'index.html'), contactSheet(shots, box.root));
  return shots;
}

function contactSheet(shots, root) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const groups = {};
  for (const s of shots) (groups[`${s.slug}::${s.variant}`] ||= []).push(s);
  return `<!doctype html><meta charset="utf-8"><title>Email contact sheet</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:32px;background:#f4f3f0;color:#1c1b19}h1{font-size:20px}h2{font-size:15px;margin:32px 0 4px}.s{color:#8d8980;font-size:12px;margin-bottom:10px}
.g{display:flex;gap:16px;align-items:flex-start;overflow-x:auto;padding-bottom:8px}figure{margin:0;flex:none}figure img{display:block;border:1px solid #e3e0da;border-radius:8px;background:#fff;max-height:560px}figcaption{font-size:12px;color:#5b5852;margin-top:4px}</style>
<h1>Email contact sheet</h1><div class="s">${esc(root)} · ${shots.length} screenshots</div>
${Object.values(groups).map((g) => `<h2>${esc(g[0].subject)} <span class="s">${esc(g[0].slug)}${g[0].variant !== 'default' ? ' / ' + esc(g[0].variant) : ''} · lint ${g[0].lint.error} err · ${g[0].lint.warn} warn</span></h2>
<div class="g">${g.map((s) => `<figure><a href="${esc(s.file)}"><img src="${esc(s.file)}" width="${s.view === 'mobile' ? 195 : s.view === 'inbox' ? 720 : 400}"></a><figcaption>${s.view} · ${s.scheme}</figcaption></figure>`).join('')}</div>`).join('\n')}`;
}

// Screenshot any URL (e.g. the inbox with ?huecos=1) — same headless Chrome, waits for body[data-ready="1"].
export async function snap(url, file, { width = 1440, height = 900, full = false, dark = false } = {}) {
  const { cdp, close } = await launch();
  try {
    const page = await newPage(cdp);
    const size = await page.goto(url, { width, height, full, dark });
    return await page.shot(file, size);
  } finally {
    await close();
  }
}
