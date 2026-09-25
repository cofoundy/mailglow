// Templates, the data contract, huecos annotation and fetch against a fake API. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { renderTemplate, contractReport, fetchCase, getPath, isTemplate } from '../skills/mailglow/scripts/lib/template.mjs';
import { loadMailbox, materialize } from '../skills/mailglow/scripts/lib/mailbox.mjs';
import { startServer, contractFindings } from '../skills/mailglow/scripts/lib/server.mjs';

const TPL = `<!DOCTYPE html><html><head><title>{{contact.name}} te espera</title></head><body>
<p>Hola, {{contact.name}}</p>
<a href="https://app.example.com/inbox?c={{conversation.id}}">Abrir</a>
<table>{{#messages}}
<tr><td>{{author}}</td><td>{{text}}</td></tr>{{/messages}}</table>
{{^brief}}<p>sin resumen</p>{{/brief}}<p>{{brief}}</p><p>{{extra}}</p>
</body></html>`;

const CONTRACT = {
  params: { conversation_id: 'con_1' },
  fields: {
    'contact.name': { status: 'existe', endpoint: 'GET /conversations/{conversation_id}', path: 'contact.name' },
    'conversation.id': { status: 'existe', endpoint: 'GET /conversations/{conversation_id}', path: 'id' },
    messages: { status: 'existe', endpoint: 'GET /conversations/{conversation_id}/messages', path: 'data[-2:]' },
    brief: { status: 'falta', endpoint: 'GET /conversations/{conversation_id}/brief', note: 'no existe', sample: 'Mesa para 12 — falta confirmar' },
  },
};
const DATA = { contact: { name: 'Lucía <b>' }, conversation: { id: 'con_1' }, messages: [{ author: 'Lucía', text: 'Hola' }, { author: 'Sofía', text: '¿En qué te ayudo?' }], brief: 'Mesa para 12' };

test('renders fields escaped, loops, inverted sections; exported HTML carries no annotation', () => {
  const { html, fields } = renderTemplate(TPL, DATA, { contract: CONTRACT });
  assert.match(html, /Hola, Lucía &lt;b&gt;/);
  assert.match(html, /c=con_1"/);
  assert.equal((html.match(/<tr>/g) || []).length, 2);
  assert.doesNotMatch(html, /sin resumen/);
  assert.doesNotMatch(html, /data-vf|mailglow-huecos/);
  assert.ok(isTemplate(TPL) && !isTemplate(html));
  for (const k of ['contact.name', 'conversation.id', 'messages', 'messages[].author', 'brief', 'extra']) assert.ok(fields.includes(k), k);
});

test('huecos: text, attribute and section fields are outlined with status and source', () => {
  const { html } = renderTemplate(TPL, DATA, { contract: CONTRACT, annotate: true });
  assert.match(html, /<style id="mailglow-huecos">/);
  assert.match(html, /<span data-vf="contact.name" class="vf vf-existe" data-vf-label="existe · GET \/conversations\/\{conversation_id\} → contact.name/);
  assert.match(html, /<a data-vf="conversation.id" data-vf-kind="attr" data-vf-status="existe"/);
  assert.match(html, /<tr data-vf="messages" data-vf-kind="section" data-vf-status="existe"/);
  assert.match(html, /class="vf vf-falta" data-vf-label="falta · GET \/conversations\/\{conversation_id\}\/brief — no existe/);
  assert.match(html, /class="vf vf-sin"/); // {{extra}} has no source
  assert.match(html, /<title>Lucía &lt;b&gt; te espera<\/title>/); // head text is never wrapped
});

test('contract report: per-variant counts and the endpoints to build', () => {
  const rep = contractReport(CONTRACT, { a: ['contact.name', 'brief'], b: ['contact.name', 'extra', 'messages[].text'] });
  assert.deepEqual(rep.perVariant.a, { existe: 1, falta: 1, sin: 0 });
  assert.deepEqual(rep.perVariant.b, { existe: 2, falta: 0, sin: 1 });
  assert.deepEqual(rep.missingEndpoints, ['GET /conversations/{conversation_id}/brief']);
  assert.equal(rep.fields[0].status, 'sin');
});

test('getPath: dots, indexes and slices', () => {
  const o = { data: [1, 2, 3, 4], a: { b: [{ c: 'x' }] } };
  assert.deepEqual(getPath(o, 'data[-2:]'), [3, 4]);
  assert.equal(getPath(o, 'a.b[0].c'), 'x');
  assert.equal(getPath(o, 'data[-1]'), 4);
});

test('fetch builds a case from the real endpoints; missing ones fall back to the sample', async () => {
  const api = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.headers['x-api-key'] !== 'k') { res.statusCode = 401; return res.end('{}'); }
    if (req.url === '/conversations/con_9') return res.end(JSON.stringify({ id: 'con_9', contact: { name: 'Maya' } }));
    if (req.url === '/conversations/con_9/messages') return res.end(JSON.stringify({ data: [{ text: '1' }, { text: '2' }, { text: '3' }] }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  try {
    const data = await fetchCase(CONTRACT, { base: `http://127.0.0.1:${api.address().port}`, headers: { 'X-API-Key': 'k' }, params: { conversation_id: 'con_9' } });
    assert.equal(data.contact.name, 'Maya');
    assert.equal(data.conversation.id, 'con_9');
    assert.deepEqual(data.messages.map((m) => m.text), ['2', '3']);
    assert.equal(data.brief, 'Mesa para 12 — falta confirmar');
    assert.equal(data._meta.fields['contact.name'], 'api');
    assert.match(data._meta.fields.brief, /sample/);
  } finally {
    api.close();
  }
});

test('mailbox + server: template variants render per case, huecos is a toggle, lint asks for sources', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mailglow-tpl-'));
  const msg = path.join(d, 'handoff');
  fs.mkdirSync(path.join(msg, 'cases'), { recursive: true });
  fs.writeFileSync(path.join(msg, 'a.html'), TPL);
  fs.writeFileSync(path.join(msg, 'contract.json'), JSON.stringify(CONTRACT));
  fs.writeFileSync(path.join(msg, 'cases', 'maya.json'), JSON.stringify({ ...DATA, contact: { name: 'Maya' } }));
  const box = loadMailbox(d);
  const m = box.messages[0];
  assert.equal(m.template, true);
  assert.deepEqual(m.cases, ['maya']);
  assert.equal(m.subject, 'Maya te espera');
  assert.match(materialize(m.variants[0].file, { caseName: 'maya' }), /Hola, Maya/);
  const findings = contractFindings(m, m.variants[0]);
  assert.ok(findings.some((f) => f.rule === 'field-no-source' && f.excerpt === 'extra'));
  assert.ok(findings.some((f) => f.rule === 'field-endpoint-missing' && f.excerpt === 'brief'));
  const { server, url } = await startServer({ dir: d, port: 0, watch: false });
  try {
    const plain = await fetch(`${url}/raw/handoff/a?case=maya`).then((r) => r.text());
    const huecos = await fetch(`${url}/raw/handoff/a?case=maya&huecos=1`).then((r) => r.text());
    assert.doesNotMatch(plain, /data-vf/);
    assert.match(huecos, /data-vf="contact.name"/);
    const list = await fetch(`${url}/api/messages`).then((r) => r.json());
    assert.deepEqual(list.messages[0].contract.missingEndpoints, ['GET /conversations/{conversation_id}/brief']);
  } finally {
    server.close();
  }
});
