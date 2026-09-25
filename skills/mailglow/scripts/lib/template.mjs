// Templates + data contract. An email variant can be a template ({{field}}), rendered with a data case
// (cases/<name>.json) and checked against contract.json, which says where every field comes from:
//
//   { "params": { "conversation_id": "con_…" },
//     "fields": {
//       "contact.name":   { "status": "existe", "endpoint": "GET /conversations/{conversation_id}", "path": "contact.name" },
//       "messages":       { "status": "existe", "endpoint": "GET /conversations/{conversation_id}/messages?limit=3", "path": "data" },
//       "brief":          { "status": "falta",  "endpoint": "GET /conversations/{conversation_id}/brief", "note": "…", "sample": "…" } } }
//
// Syntax (mustache subset): {{x.y}} escaped · {{{x}}} raw · {{#list}}…{{/list}} loop / truthy block ·
// {{^x}}…{{/x}} when empty · {{.}} current item · {{! comment }}.
//
// "Huecos" mode (a preview toggle, never in the exported HTML) outlines every field with where it comes
// from: green = the data exists today, amber = the endpoint is missing, red = no source declared at all.
import fs from 'node:fs';
import path from 'node:path';

export const isTemplate = (html) => /\{\{[#^/!{]?\s*[\w.[\]-]+/.test(html);

export function readContract(dir) {
  const p = path.join(dir, 'contract.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

export function listCases(dir) {
  const d = path.join(dir, 'cases');
  if (!fs.existsSync(d)) return [];
  // Real cases first (cases[0] is the default render), generated stress-* cases last.
  const names = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => f.replace(/\.json$/, ''));
  const stress = (n) => n.startsWith('stress-');
  return [...names.filter((n) => !stress(n)), ...names.filter(stress)];
}

export function readCase(dir, name) {
  const p = path.join(dir, 'cases', `${name}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

// Samples from the contract are the fallback data: a field whose endpoint is missing still renders.
export function sampleData(contract) {
  const data = {};
  for (const [key, f] of Object.entries(contract?.fields || {})) {
    if (f.sample !== undefined && !key.includes('[]')) setPath(data, key, f.sample);
  }
  return data;
}

export function caseData(dir, contract, name) {
  return deepMerge(sampleData(contract), (name && readCase(dir, name)) || {});
}

// ---------------------------------------------------------------------------------------------------

export function fieldInfo(contract, key) {
  const fields = contract?.fields || {};
  if (fields[key]) return { key, ...fields[key] };
  // messages[].text → messages
  const base = key.split('[]')[0];
  if (fields[base]) return { key: base, ...fields[base] };
  return { key, status: 'sin', endpoint: null };
}

export function statusOf(contract, key) {
  const s = fieldInfo(contract, key).status;
  return s === 'existe' || s === 'falta' ? s : 'sin';
}

function label(contract, key) {
  const f = fieldInfo(contract, key);
  if (f.status === 'existe') return `existe · ${f.endpoint || '?'}${f.path ? ` → ${f.path}` : ''}  [${key}]`;
  if (f.status === 'falta') return `falta · ${f.endpoint || 'endpoint por crear'}${f.note ? ` — ${f.note}` : ''}  [${key}]`;
  return `sin origen · ${key} no está en contract.json`;
}

/**
 * Render a template. Returns { html, fields } where fields = every field key the variant uses.
 * annotate: wrap text fields and mark elements for the huecos overlay (preview only).
 */
export function renderTemplate(template, data, { contract = null, annotate = false } = {}) {
  const fields = new Set();
  const src = markTags(template);
  const bodyAt = src.search(/<body[\s>]/i);
  const tokens = tokenize(src);
  const tree = parse(tokens);
  let html = walk(tree, [data], '', { fields, annotate, contract, bodyAt });
  html = finishMarks(html, contract, annotate);
  if (annotate) html = injectHuecosCss(html);
  return { html, fields: [...fields] };
}

// Pre-pass on the raw template: an element whose attributes hold fields gets data-vf-a="field …";
// the first element of a section body gets data-vf-s="section". Both are removed unless annotating.
function markTags(t) {
  let out = t.replace(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (whole, tag, attrs) => {
    const keys = [...attrs.matchAll(/\{\{\{?\s*([\w.[\]-]+)\s*\}?\}\}/g)].map((m) => m[1]).filter((k) => !/^[#^/!]/.test(k));
    return keys.length ? `<${tag} data-vf-a="${keys.join(' ')}"${attrs}>` : whole;
  });
  out = out.replace(/\{\{#\s*([\w.[\]-]+)\s*\}\}(\s*)<([a-zA-Z][\w-]*)/g, (_w, key, ws, tag) => `{{#${key}}}${ws}<${tag} data-vf-s="${key}"`);
  return out;
}

function tokenize(s) {
  const out = [];
  const re = /\{\{\{\s*([\w.[\]-]+)\s*\}\}\}|\{\{\s*([#^/!]?)\s*([^}]*?)\s*\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    if (m[1]) out.push({ t: 'raw', k: m[1], at: m.index, src: s });
    else if (m[2] === '!') { /* comment */ }
    else if (m[2] === '#') out.push({ t: 'open', k: m[3], at: m.index });
    else if (m[2] === '^') out.push({ t: 'inv', k: m[3], at: m.index });
    else if (m[2] === '/') out.push({ t: 'close', k: m[3] });
    else out.push({ t: 'var', k: m[3], at: m.index, src: s });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

function parse(tokens) {
  const root = [];
  const stack = [{ k: null, kids: root }];
  for (const tk of tokens) {
    const top = stack.at(-1);
    if (tk.t === 'open' || tk.t === 'inv') {
      const node = { ...tk, kids: [] };
      top.kids.push(node);
      stack.push(node);
    } else if (tk.t === 'close') {
      if (top.k !== tk.k) throw new Error(`template: {{/${tk.k}}} closes {{#${top.k}}}`);
      stack.pop();
    } else top.kids.push(tk);
  }
  if (stack.length > 1) throw new Error(`template: {{#${stack.at(-1).k}}} is never closed`);
  return root;
}

function walk(nodes, ctx, scope, o) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') { out += n.v; continue; }
    const key = n.k === '.' ? scope : scope ? `${scope}[].${n.k}` : n.k;
    const fieldKey = n.k === '.' ? scope : key;
    if (n.t === 'var' || n.t === 'raw') {
      o.fields.add(fieldKey);
      const val = lookup(ctx, n.k);
      const text = val == null ? '' : n.t === 'raw' ? String(val) : escapeHtml(String(val));
      const inText = !insideTag(n.src || '', n.at) && (o.bodyAt < 0 || n.at > o.bodyAt);
      out += o.annotate && inText ? `<span data-vf="${fieldKey}" class="vf vf-${statusOf(o.contract, fieldKey)}" data-vf-label="${escapeAttr(label(o.contract, fieldKey))}">${text}</span>` : text;
    } else if (n.t === 'open') {
      o.fields.add(key);
      const val = lookup(ctx, n.k);
      if (Array.isArray(val)) for (const item of val) out += walk(n.kids, [...ctx, item], key, o);
      else if (val && typeof val === 'object') out += walk(n.kids, [...ctx, val], key, o);
      else if (val) out += walk(n.kids, ctx, scope, o);
    } else if (n.t === 'inv') {
      o.fields.add(key);
      const val = lookup(ctx, n.k);
      if (!val || (Array.isArray(val) && !val.length)) out += walk(n.kids, ctx, scope, o);
    }
  }
  return out;
}

function insideTag(src, at) {
  return src.lastIndexOf('<', at) > src.lastIndexOf('>', at);
}

function lookup(ctx, key) {
  if (key === '.') return ctx.at(-1);
  for (let i = ctx.length - 1; i >= 0; i--) {
    const v = getPath(ctx[i], key);
    if (v !== undefined) return v;
  }
  return undefined;
}

// data-vf-a / data-vf-s → classes + label when annotating, gone otherwise (the exported HTML is clean).
function finishMarks(html, contract, annotate) {
  return html.replace(/\sdata-vf-([as])="([^"]*)"/g, (_w, kind, keys) => {
    if (!annotate) return '';
    const list = keys.split(' ').filter(Boolean);
    const worst = list.map((k) => statusOf(contract, k)).sort((a, b) => rank(a) - rank(b))[0];
    const lab = list.map((k) => label(contract, k)).join(' | ');
    return ` data-vf="${keys}" data-vf-kind="${kind === 'a' ? 'attr' : 'section'}" data-vf-status="${worst}" data-vf-label="${escapeAttr(lab)}"`;
  });
}
const rank = (s) => ({ sin: 0, falta: 1, existe: 2 })[s];

function injectHuecosCss(html) {
  const css = `<style id="mailglow-huecos">
[data-vf]{outline:1.5px dashed var(--vf,#16a34a)!important;outline-offset:2px;position:relative}
.vf-existe,[data-vf-status=existe]{--vf:#16a34a}.vf-falta,[data-vf-status=falta]{--vf:#d97706}.vf-sin,[data-vf-status=sin]{--vf:#dc2626}
.vf-falta,[data-vf-status=falta]{background-image:repeating-linear-gradient(135deg,rgba(217,119,6,.10) 0 6px,transparent 6px 12px)!important}
.vf-sin,[data-vf-status=sin]{background-image:repeating-linear-gradient(135deg,rgba(220,38,38,.12) 0 6px,transparent 6px 12px)!important}
[data-vf]:hover{z-index:99}
/* preview layer only: an ancestor with overflow:hidden (rounded cards) would clip the hover label */
*{overflow:visible!important}
[data-vf]:hover::after{content:attr(data-vf-label);position:absolute;left:0;top:calc(100% + 6px);z-index:100;background:#111;color:#fff;font:500 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;padding:5px 7px;border-radius:6px;white-space:pre-wrap;width:max-content;max-width:420px;box-shadow:0 6px 20px rgba(0,0,0,.25);text-align:left;letter-spacing:0;text-transform:none;font-style:normal}
</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${css}</head>`) : css + html;
}

// ---------------------------------------------------------------------------------------------------

export function contractReport(contract, variantFields) {
  // variantFields: { variantKey: [field keys] } → per field: status, source, which variants use it.
  const rows = {};
  for (const [v, keys] of Object.entries(variantFields)) {
    for (const k of keys) {
      const info = fieldInfo(contract, k);
      const id = info.key;
      rows[id] ||= { field: id, status: info.status === 'existe' || info.status === 'falta' ? info.status : 'sin', endpoint: info.endpoint || null, path: info.path || null, note: info.note || null, variants: [] };
      if (!rows[id].variants.includes(v)) rows[id].variants.push(v);
    }
  }
  const fields = Object.values(rows).sort((a, b) => rank(a.status) - rank(b.status) || a.field.localeCompare(b.field));
  const perVariant = Object.fromEntries(Object.keys(variantFields).map((v) => {
    const mine = fields.filter((f) => f.variants.includes(v));
    return [v, { existe: mine.filter((f) => f.status === 'existe').length, falta: mine.filter((f) => f.status === 'falta').length, sin: mine.filter((f) => f.status === 'sin').length }];
  }));
  // A missing field on an existing endpoint is still work to build: name the endpoint AND the field.
  const missingEndpoints = [...new Set(fields.filter((f) => f.status === 'falta').map((f) => (f.endpoint ? `${f.endpoint}${f.path ? ` → ${f.path}` : ''}` : `(${f.field})`)))];
  return { fields, perVariant, missingEndpoints };
}

// Build a data case by calling the real endpoints the contract names (status "existe").
export async function fetchCase(contract, { base, headers = {}, params = {}, log = () => {} }) {
  const allParams = { ...(contract.params || {}), ...params };
  const cache = new Map();
  const data = sampleData(contract);
  const meta = { fetched_at: new Date().toISOString(), base, params: allParams, fields: {} };
  for (const [key, f] of Object.entries(contract.fields || {})) {
    if (key.includes('[]')) continue;
    if (f.status !== 'existe' || !f.endpoint) { meta.fields[key] = f.status === 'falta' ? 'sample (endpoint falta)' : 'sample'; continue; }
    const [method, rawPath] = f.endpoint.includes(' ') ? f.endpoint.split(/\s+/, 2) : ['GET', f.endpoint];
    const url = base.replace(/\/$/, '') + rawPath.replace(/\{(\w+)\}/g, (_w, p) => {
      if (allParams[p] == null) throw new Error(`fetch: ${key} needs --param ${p}=…`);
      return encodeURIComponent(allParams[p]);
    });
    if (!cache.has(url)) {
      log(`  ${method} ${url}`);
      cache.set(url, fetch(url, { method, headers }).then(async (r) => {
        if (!r.ok) throw new Error(`${method} ${url} → ${r.status}`);
        return r.json();
      }));
    }
    try {
      const body = await cache.get(url);
      const val = f.path ? getPath(body, f.path) : body;
      if (val === undefined) { meta.fields[key] = `sample (path ${f.path} vacío)`; continue; }
      setPath(data, key, val);
      meta.fields[key] = 'api';
    } catch (e) {
      meta.fields[key] = `sample (${e.message})`;
    }
  }
  return { ...data, _meta: meta };
}

// ---------------------------------------------------------------------------------------------------

export function getPath(obj, p) {
  let cur = obj;
  for (const part of p.match(/[^.[\]]+|\[-?\d*:?-?\d*\]/g) || []) {
    if (cur == null) return undefined;
    const slice = part.match(/^\[(-?\d*):(-?\d*)\]$/);
    const idx = part.match(/^\[(-?\d+)\]$/);
    if (slice && Array.isArray(cur)) cur = cur.slice(slice[1] === '' ? undefined : +slice[1], slice[2] === '' ? undefined : +slice[2]);
    else if (idx && Array.isArray(cur)) cur = cur.at(+idx[1]);
    else cur = cur[part];
  }
  return cur;
}

export function setPath(obj, p, val) {
  const parts = p.split('.');
  let cur = obj;
  for (const k of parts.slice(0, -1)) cur = cur[k] = cur[k] && typeof cur[k] === 'object' ? cur[k] : {};
  cur[parts.at(-1)] = val;
}

function deepMerge(a, b) {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? deepMerge(a[k], v) : v;
  return out;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeAttr = (s) => s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
