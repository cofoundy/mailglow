// Stress cases (derived edge-case data) and the findings they surface. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inferKind, collectFields, buildStressCases, writeStressCases, stressFindings, checkStress, textRuns } from '../skills/mailglow/scripts/lib/stress.mjs';
import { renderTemplate, listCases } from '../skills/mailglow/scripts/lib/template.mjs';

const CONTRACT = {
  fields: {
    'contact.name': { status: 'existe', sample: 'Ana Torres', stress: ['Kapso User'] },
    'contact.phone': { status: 'existe', sample: '+51 987 654 321' },
    'conversation.id': { status: 'existe', sample: 'con_1' },
    motivo: { status: 'existe', sample: 'Pide mesa para 12' },
    wait: { status: 'falta', kind: 'text', sample: '4 min' },
    messages: { status: 'existe', sample: [{ inbound: true, author: 'Lucía', content: 'Hola' }, { inbound: false, author: 'Sofía', content: '¿En qué te ayudo?' }] },
    'messages[].content': { status: 'existe' },
    secret: { status: 'existe', stress: false, sample: 'x' },
  },
};
const BASE = { contact: { name: 'Ana Torres', phone: '+51 987 654 321' }, conversation: { id: 'con_1' }, motivo: 'Pide mesa para 12', wait: '4 min', messages: CONTRACT.fields.messages.sample, secret: 'x' };

const SAFE = `<!DOCTYPE html><html><head><meta name="mail:subject" content="{{contact.name}} te espera"><style>td{overflow-wrap:anywhere}</style></head><body>
<p>Hola, {{contact.name}}</p><p>{{motivo}}</p>{{#contact.phone}}<p>Tel: {{contact.phone}}</p>{{/contact.phone}}
<table>{{#messages}}<tr><td>{{author}}: {{content}}</td></tr>{{/messages}}</table></body></html>`;
const GUARDED = `<!DOCTYPE html><html><head><meta name="mail:subject" content="{{#contact.name}}{{contact.name}} te espera{{/contact.name}}{{^contact.name}}Tu cliente te espera{{/contact.name}}"></head><body>
<p>{{#contact.name}}Hola, {{contact.name}}{{/contact.name}}{{^contact.name}}Hola{{/contact.name}}</p><p>{{motivo}}</p></body></html>`;

test('kinds: declared wins, otherwise inferred from key and sample', () => {
  assert.equal(inferKind('contact.name', 'Lucía'), 'name');
  assert.equal(inferKind('contact.phone', null), 'phone');
  assert.equal(inferKind('x', '+51 987 654 321'), 'phone');
  assert.equal(inferKind('logo_url', ''), 'url');
  assert.equal(inferKind('created_at', ''), 'date');
  assert.equal(inferKind('conversation.id', 'con_1'), 'id');
  assert.equal(inferKind('messages', []), 'list');
  assert.equal(inferKind('total', 3), 'number');
  assert.equal(inferKind('motivo', 'x'), 'longtext');
  assert.equal(inferKind('label', 'x'.repeat(200)), 'longtext');
  assert.equal(inferKind('channel', 'WhatsApp'), 'text');
  const fields = collectFields(CONTRACT, BASE);
  const by = Object.fromEntries(fields.map((f) => [f.key, f]));
  assert.equal(by.wait.kind, 'text');
  assert.ok(!by.secret, 'stress:false skips the field');
  assert.deepEqual(by.messages.items.map((i) => `${i.key}:${i.kind}`), ['author:name', 'content:longtext', 'inbound:bool']);
});

test('stress cases: the production shapes, marked, deterministic', () => {
  const a = buildStressCases(CONTRACT, BASE, { baseName: 'demo' });
  const b = buildStressCases(CONTRACT, BASE, { baseName: 'demo' });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c = Object.fromEntries(a.map((x) => [x.name, x.data]));
  for (const n of ['missing', 'empty', 'no-phone', 'name-emoji', 'name-fancy', 'name-placeholder', 'caps', 'short', 'long', 'long-token', 'html', 'list-0', 'list-1', 'list-many', 'list-media']) {
    assert.ok(c[`stress-${n}`], n);
    assert.equal(c[`stress-${n}`]._meta.stress, true);
    assert.equal(c[`stress-${n}`]._meta.base, 'demo');
  }
  assert.ok(!c['stress-number-zero'], 'no number field → no number case');
  assert.equal(c['stress-missing'].contact.name, null);
  assert.equal(c['stress-missing'].secret, 'x');
  assert.equal(c['stress-empty'].contact.name, '');
  assert.deepEqual(c['stress-empty'].messages, []);
  assert.equal(c['stress-no-phone'].contact.phone, null);
  assert.equal(c['stress-no-phone'].contact.name, 'Ana Torres');
  assert.equal(c['stress-name-emoji'].contact.name, '🌼🌼🌼');
  assert.equal(c['stress-name-emoji'].messages[0].author, '🌼🌼🌼');
  assert.equal(c['stress-caps'].contact.name, 'ANA TORRES');
  assert.equal(c['stress-short'].messages.at(-1).content, 'ok');
  assert.equal(c['stress-short'].messages[0].content, 'Hola');
  assert.ok(c['stress-long'].motivo.length >= 600);
  assert.ok(c['stress-long-token'].motivo.length >= 600 && !/\s/.test(c['stress-long-token'].motivo));
  assert.match(c['stress-html'].contact.name, /<b>/);
  assert.equal(c['stress-list-1'].messages.length, 1);
  assert.equal(c['stress-list-many'].messages.length, 12);
  assert.deepEqual(c['stress-list-media'].messages.map((m) => m.content), ['', '']);
  assert.equal(c['stress-list-media'].messages[0].author, 'Lucía');
  assert.equal(c['stress-custom-contact-name-1'].contact.name, 'Kapso User');
});

const findingsFor = (tpl, data) => stressFindings(renderTemplate(tpl, data).html, renderTemplate(tpl, BASE).html, data);
const cases = () => Object.fromEntries(buildStressCases(CONTRACT, BASE, { baseName: 'demo' }).map((x) => [x.name, x.data]));

test('stress-empty-join: "Hola ," and " te espera" with the name missing; quiet when the copy is guarded', () => {
  const miss = cases()['stress-missing'];
  const f = findingsFor(SAFE, miss);
  const joins = f.filter((x) => x.rule === 'stress-empty-join').map((x) => x.message);
  assert.ok(joins.some((m) => /subject: "te espera"/.test(m)), joins.join('\n'));
  assert.ok(joins.some((m) => /"Hola,"/.test(m)), joins.join('\n'));
  assert.deepEqual(findingsFor(GUARDED, miss), []);
  // the real, tidy case never trips it, and neither does authored copy that is identical in the base
  assert.deepEqual(findingsFor(SAFE, BASE), []);
  assert.deepEqual(findingsFor(SAFE, cases()['stress-name-emoji']), []);
});

test('stress-unescaped: {{{raw}}} on a stranger value is an error; {{x}} is fine', () => {
  const html = cases()['stress-html'];
  assert.deepEqual(findingsFor(SAFE, html).filter((x) => x.rule === 'stress-unescaped'), []);
  const raw = SAFE.replace('{{motivo}}', '{{{motivo}}}');
  const f = findingsFor(raw, html).filter((x) => x.rule === 'stress-unescaped');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'error');
  assert.equal(f[0].field, 'motivo');
});

test('stress-long-token: warned only when nothing lets the word wrap', () => {
  const tok = cases()['stress-long-token'];
  assert.deepEqual(findingsFor(SAFE, tok).filter((x) => x.rule === 'stress-long-token'), []);
  const noWrap = SAFE.replace('<style>td{overflow-wrap:anywhere}</style>', '');
  const f = findingsFor(noWrap, tok).filter((x) => x.rule === 'stress-long-token');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /motivo/);
});

test('stress-leak: a whole object or "undefined" printed as text', () => {
  const tpl = '<html><body><p>Cliente: {{contact}}</p></body></html>';
  const f = stressFindings(renderTemplate(tpl, BASE).html, '<html><body><p>Cliente: Lucía</p></body></html>', BASE);
  assert.deepEqual(f.map((x) => x.rule), ['stress-leak']);
});

test('textRuns: inline tags merge, preheader filler is invisible, meta subject is read', () => {
  const runs = textRuns('<head><meta name="mail:subject" content=" te espera"></head><body><p>Hola, <strong></strong></p><div>&#847;&zwnj; </div></body>');
  assert.deepEqual(runs.map((r) => [r.where, r.raw]), [['subject', ' te espera'], ['body', 'Hola, ']]);
});

test('writeStressCases + checkStress on a folder: files replaced, real cases untouched and first', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mailglow-stress-'));
  fs.mkdirSync(path.join(d, 'cases'));
  fs.writeFileSync(path.join(d, 'a.html'), SAFE);
  fs.writeFileSync(path.join(d, 'b.html'), GUARDED);
  fs.writeFileSync(path.join(d, 'contract.json'), JSON.stringify(CONTRACT));
  fs.writeFileSync(path.join(d, 'cases', 'zeta.json'), JSON.stringify(BASE));
  fs.writeFileSync(path.join(d, 'cases', 'stress-stale.json'), JSON.stringify({ _meta: { stress: true } }));
  const { base, cases: made } = writeStressCases(d, {});
  assert.equal(base, 'zeta');
  const names = listCases(d);
  assert.equal(names[0], 'zeta', 'real cases sort before stress-*');
  assert.ok(!names.includes('stress-stale'), 'stale stress files are replaced');
  assert.equal(names.length, 1 + made.length);
  assert.throws(() => writeStressCases(d, { from: 'nope' }), /no case "nope"/);
  const rep = checkStress(d, [{ key: 'a', file: path.join(d, 'a.html') }, { key: 'b', file: path.join(d, 'b.html') }]);
  assert.ok(rep.some((r) => r.variant === 'a' && r.case === 'stress-missing'));
  assert.ok(!rep.some((r) => r.variant === 'b' && r.findings.some((f) => f.rule === 'stress-empty-join')), JSON.stringify(rep.filter((r) => r.variant === 'b')));
});

test('stress-html: the value names the field without "[]", so it never reads as empty brackets', () => {
  const html = cases()['stress-html'];
  assert.ok(html.messages.every((m) => !m.author.includes('[]') && !m.content.includes('[]')), JSON.stringify(html.messages));
  assert.match(html.messages[0].author, /<i>messages\.author<\/i>/);
  assert.deepEqual(findingsFor(SAFE, html).filter((f) => f.rule === 'stress-empty-join'), []);
});

test('required: true keeps a field out of missing/empty, and only those shapes', () => {
  const C = { fields: { ...CONTRACT.fields, 'contact.name': { ...CONTRACT.fields['contact.name'], required: true } } };
  const c = Object.fromEntries(buildStressCases(C, BASE, { baseName: 'demo' }).map((x) => [x.name, x.data]));
  assert.equal(c['stress-missing'].contact.name, 'Ana Torres');
  assert.equal(c['stress-empty'].contact.name, 'Ana Torres');
  assert.ok(!c['stress-missing']._meta.fields.includes('contact.name'));
  assert.equal(c['stress-missing'].motivo, null, 'fields not marked required still go missing');
  assert.equal(c['stress-name-emoji'].contact.name, '🌼🌼🌼');
  assert.equal(c['stress-html'].contact.name.includes('<b>'), true);
});
