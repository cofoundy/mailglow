// The mini inbox: list on the left, opened message on the right, live-reloading as files change.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadMailbox, writePick, toText, materialize } from './mailbox.mjs';
import { readContract, renderTemplate, caseData, contractReport, isTemplate } from './template.mjs';
import { checkStress } from './stress.mjs';
import { lint, summarize, checkRemoteAssets } from './lint.mjs';
import { renderForClient } from './render.mjs';

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'inbox.html');

export function startServer({ dir, port = 4555, host = '127.0.0.1', watch = true } = {}) {
  const clients = new Set();
  const findVariant = (slug, key) => {
    const box = loadMailbox(dir);
    const msg = box.messages.find((m) => m.slug === slug);
    const v = msg && (msg.variants.find((x) => x.key === key) || msg.variants[0]);
    return v ? { box, msg, v } : null;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      if (url.pathname === '/') return send(200, fs.readFileSync(UI), 'text/html; charset=utf-8');

      if (url.pathname === '/api/messages') {
        const box = loadMailbox(dir);
        const messages = box.messages.map((m) => ({
          ...m,
          contract: m.template ? contractFor(m) : null,
          variants: m.variants.map((v) => {
            const html = materialize(v.file, { caseName: m.cases[0] });
            return { ...v, lint: summarize(lint(html)), file: path.relative(box.root, v.file) };
          }),
        }));
        const rel = path.relative(process.cwd(), box.root);
        const shown = !rel ? '.' : rel.startsWith('..') ? box.root.replace(os.homedir(), '~') : rel;
        return send(200, { root: shown, messages, picks: box.picks });
      }

      let m = url.pathname.match(/^\/raw\/(.+)\/([^/]+)$/);
      if (m) {
        const hit = findVariant(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
        if (!hit) return send(404, 'not found', 'text/plain');
        const html = materialize(hit.v.file, { caseName: url.searchParams.get('case') || hit.msg.cases[0], annotate: url.searchParams.get('huecos') === '1' });
        const out = renderForClient(html, { scheme: url.searchParams.get('scheme') || 'light', images: url.searchParams.get('images') !== '0' });
        return send(200, out, 'text/html; charset=utf-8');
      }

      m = url.pathname.match(/^\/api\/(lint|source|text)\/(.+)\/([^/]+)$/);
      if (m) {
        const hit = findVariant(decodeURIComponent(m[2]), decodeURIComponent(m[3]));
        if (!hit) return send(404, { error: 'not found' });
        const caseName = url.searchParams.get('case') || hit.msg.cases[0];
        const html = materialize(hit.v.file, { caseName });
        if (m[1] === 'source') return send(200, url.searchParams.get('rendered') === '1' ? html : fs.readFileSync(hit.v.file, 'utf8'), 'text/plain; charset=utf-8');
        if (m[1] === 'text') return send(200, toText(html), 'text/plain; charset=utf-8');
        const findings = [...lint(html), ...contractFindings(hit.msg, hit.v)];
        if (url.searchParams.get('net') === '1') findings.push(...(await checkRemoteAssets(html)));
        return send(200, { findings, summary: summarize(findings) });
      }

      m = url.pathname.match(/^\/api\/contract\/(.+)$/);
      if (m) {
        const hit = findVariant(decodeURIComponent(m[1]), '');
        if (!hit) return send(404, { error: 'not found' });
        return send(200, { cases: hit.msg.cases, contract: readContract(path.dirname(hit.v.file)), report: contractFor(hit.msg) });
      }

      if (url.pathname === '/api/pick' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const entry = writePick(path.resolve(dir), body);
        broadcast(clients, 'picks');
        return send(200, entry);
      }

      if (url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('retry: 1000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      send(404, { error: 'not found' });
    } catch (e) {
      send(500, { error: String(e && e.message) });
    }
  });

  if (watch) {
    let t;
    try {
      fs.watch(path.resolve(dir), { recursive: true }, (_ev, file) => {
        if (file && (file.includes('shots') || file.endsWith('picks.json'))) return;
        clearTimeout(t);
        t = setTimeout(() => broadcast(clients, 'change'), 120);
      });
    } catch {
      /* recursive watch unsupported: live reload off, manual refresh still works */
    }
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}` }));
  });
}

function broadcast(clients, event) {
  for (const c of clients) c.write(`event: ${event}\ndata: ${Date.now()}\n\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => resolve(s || '{}'));
    req.on('error', reject);
  });
}

// Which fields each variant uses, and where each comes from (existe / falta / sin origen).
export function contractFor(msg) {
  const dir = path.dirname(msg.variants[0].file);
  const contract = readContract(dir);
  const variantFields = {};
  for (const v of msg.variants) {
    const raw = fs.readFileSync(v.file, 'utf8');
    variantFields[v.key] = isTemplate(raw) ? renderTemplate(raw, caseData(dir, contract, msg.cases[0]), { contract }).fields : [];
  }
  return contractReport(contract, variantFields);
}

// The requirement after design: every field a variant uses has a declared source.
export function contractFindings(msg, v) {
  if (!msg.template) return [];
  const rep = contractFor(msg);
  const out = [];
  for (const f of rep.fields.filter((x) => x.variants.includes(v.key))) {
    if (f.status === 'sin') out.push({ rule: 'field-no-source', severity: 'warn', message: `Field "${f.field}" has no source in contract.json — say which endpoint provides it, or mark it "falta".`, excerpt: f.field });
    else if (f.status === 'falta') out.push({ rule: 'field-endpoint-missing', severity: 'info', message: `Field "${f.field}" needs an endpoint that does not exist yet: ${f.endpoint || '(unnamed)'}${f.note ? ` — ${f.note}` : ''}`, excerpt: f.field });
  }
  // Every data case (real + stress-*) rendered through this variant: empty joins, unescaped values, overflow.
  for (const r of checkStress(path.dirname(v.file), [v])) {
    for (const f of r.findings) out.push({ ...f, message: `[case ${r.case}] ${f.message}` });
  }
  return out;
}
