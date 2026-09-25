// Smoke tests for the engine. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, summarize, classifyUrl } from '../skills/mailglow/scripts/lib/lint.mjs';
import { loadMailbox, readPicks } from '../skills/mailglow/scripts/lib/mailbox.mjs';
import { renderForClient } from '../skills/mailglow/scripts/lib/render.mjs';
import { startServer } from '../skills/mailglow/scripts/lib/server.mjs';
import { shoot, findChrome } from '../skills/mailglow/scripts/lib/shoot.mjs';

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'mailglow');
const starter = fs.readFileSync(path.join(SKILL, 'templates', 'starter.html'), 'utf8');
const rules = (html) => lint(html).map((f) => f.rule);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mailglow-test-'));

test('the starter is client-safe: zero errors, zero warnings', () => {
  const s = summarize(lint(starter));
  assert.equal(s.error, 0, JSON.stringify(lint(starter)));
  assert.equal(s.warn, 0, JSON.stringify(lint(starter)));
});

test('every shipped example is client-safe', () => {
  const dir = path.join(SKILL, 'examples');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.html')) : [];
  for (const f of files) {
    const s = summarize(lint(fs.readFileSync(path.join(dir, f), 'utf8')));
    assert.equal(s.error + s.warn, 0, `${f}: ${JSON.stringify(s)}`);
  }
});

test('local, data: and localhost assets are errors; https is fine', () => {
  assert.ok(rules('<img src="logo.png" alt="" width="1">').includes('img-local-src'));
  assert.ok(rules('<img src="/static/logo.png" alt="" width="1">').includes('img-local-src'));
  assert.ok(rules('<img src="file:///Users/me/logo.png" alt="" width="1">').includes('img-local-src'));
  assert.ok(rules('<img src="data:image/png;base64,AAA" alt="" width="1">').includes('img-data-uri'));
  assert.ok(rules('<img src="http://localhost:3000/a.png" alt="" width="1">').includes('img-localhost'));
  assert.ok(!rules('<img src="https://cdn.example.com/a.png" alt="" width="1">').some((r) => r.startsWith('img-')));
  assert.ok(rules('<td style="background-image:url(./bg.jpg)">').includes('css-bg-local'));
  assert.equal(classifyUrl('{{ logo_url }}'), 'template');
});

test('links: localhost and relative are errors, https and mailto pass', () => {
  assert.ok(rules('<a href="http://localhost:12220/inbox">x</a>').includes('link-localhost'));
  assert.ok(rules('<a href="/settings">x</a>').includes('link-relative'));
  assert.ok(rules('<a href="#">x</a>').includes('link-empty'));
  const ok = rules('<a href="https://app.example.com">x</a><a href="mailto:a@b.co">y</a>');
  assert.ok(!ok.some((r) => r.startsWith('link-')));
});

test('scripts, flex, css vars and Gmail clipping are caught', () => {
  assert.ok(rules('<script>alert(1)</script>').includes('script'));
  assert.ok(rules('<div style="display:flex">').includes('css-flex-grid'));
  assert.ok(rules('<div style="color:var(--ink)">').includes('css-var'));
  assert.ok(rules('<p>' + 'x'.repeat(110 * 1024) + '</p>').includes('size-clip'));
  assert.ok(rules('<div>fragment</div>').includes('fragment'));
});

test('mailbox: single files, variant folders, manifest and meta tags', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'solo.html'), '<html><head><title>Solo subject</title></head><body><div style="display:none">Pre text</div>hi</body></html>');
  fs.mkdirSync(path.join(d, 'welcome'));
  fs.writeFileSync(path.join(d, 'welcome', 'a.html'), starter);
  fs.writeFileSync(path.join(d, 'welcome', 'b.html'), starter);
  fs.mkdirSync(path.join(d, '.archive'));
  fs.writeFileSync(path.join(d, '.archive', 'old.html'), starter);
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify([{ slug: 'solo', from_name: 'Acme', from_email: 'hi@acme.com' }]));
  const box = loadMailbox(d);
  assert.equal(box.messages.length, 2);
  const solo = box.messages.find((m) => m.slug === 'solo');
  assert.equal(solo.subject, 'Solo subject');
  assert.equal(solo.preheader, 'Pre text');
  assert.equal(solo.from_name, 'Acme');
  const w = box.messages.find((m) => m.slug === 'welcome');
  assert.deepEqual(w.variants.map((v) => v.key), ['a', 'b']);
  assert.equal(w.from_email, 'hello@acme.com');
});

test('render: dark rewrites prefers-color-scheme deterministically; fragments get a document', () => {
  const html = '<html><head><style>@media (prefers-color-scheme: dark){.x{color:#fff}}</style></head><body></body></html>';
  assert.match(renderForClient(html, { scheme: 'dark' }), /@media \(min-width: 0px\)/);
  assert.match(renderForClient(html, { scheme: 'light' }), /@media \(max-width: 0\.01px\)/);
  assert.match(renderForClient('<div>x</div>'), /<!doctype html><html>/);
  assert.match(renderForClient('<img src="https://a/b.png">', { images: false }), /data-blocked/);
});

test('server: list, raw, pick → picks.json', async () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'welcome'));
  fs.writeFileSync(path.join(d, 'welcome', 'a.html'), starter);
  fs.writeFileSync(path.join(d, 'welcome', 'b.html'), starter);
  const { server, url } = await startServer({ dir: d, port: 0, watch: false });
  try {
    const list = await fetch(`${url}/api/messages`).then((r) => r.json());
    assert.equal(list.messages[0].variants.length, 2);
    const raw = await fetch(`${url}/raw/welcome/b?scheme=dark`).then((r) => r.text());
    assert.match(raw, /<base target="_blank">/);
    assert.equal((await fetch(`${url}/`)).status, 200);
    await fetch(`${url}/api/pick`, { method: 'POST', body: JSON.stringify({ slug: 'welcome', variant: 'b', note: 'header of b', pick: true }) });
    assert.deepEqual(readPicks(d).welcome.picked, 'b');
    assert.equal(readPicks(d).welcome.notes.b, 'header of b');
  } finally {
    server.close();
  }
});

test('shoot: real PNGs from headless Chrome', { skip: !findChrome() && 'no Chrome/Chromium on this machine' }, async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'starter.html'), starter);
  const out = path.join(d, 'shots');
  const shots = await shoot({ dir: d, out, views: ['mobile'], schemes: ['light', 'dark'], inbox: true, log: () => {} });
  assert.equal(shots.length, 3);
  for (const s of shots) {
    const png = fs.readFileSync(path.join(out, s.file));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.ok(png.length > 5000, `${s.file} is ${png.length} bytes`);
  }
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
});
