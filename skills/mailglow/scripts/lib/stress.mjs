// Stress cases: the data production actually sends, derived from contract.json + one real case.
//
// A design reviewed on one tidy case ("Ana Torres", one clear message) says nothing about the inbox
// that gets an emoji-only name, a "WhatsApp User" placeholder, a 600-char note, "ok" as the last
// message, an 11-message burst or no phone at all. `stress` writes those as cases/stress-<shape>.json
// (deterministic: same contract + same base → same files) and `checkStress` renders every variant with
// every case and flags what a person would see as broken:
//
//   stress-unescaped   a value with "<" reached the HTML raw ({{{x}}} on stranger data)       error
//   stress-leak        "undefined" / "null" / "[object Object]" in the visible text            error
//   stress-empty-join  copy that reads broken once a field is empty: "Hola ,", " te espera",
//                      ". Espera hace .", "· ·", "( )"                                         warn
//   stress-long-token  a 600-char word renders and nothing lets it wrap (no overflow-wrap)     warn
//
// A field's kind decides which shapes apply. Declare it in the contract or let it be inferred:
//   "contact.name": { …, "kind": "name", "stress": ["🌼🌼🌼", "Kapso User"] }     ("stress": false = skip)
//   "conversation.id": { …, "required": true }   (the backend guarantees it: no missing/empty shapes)
// kinds: name · text · longtext · phone · url · list · number · date · id (id/bool only go missing/empty)
import fs from 'node:fs';
import path from 'node:path';
import { readContract, readCase, listCases, caseData, getPath, setPath, renderTemplate, isTemplate } from './template.mjs';

export const KINDS = ['name', 'text', 'longtext', 'phone', 'url', 'list', 'number', 'date', 'id', 'bool'];

export const STRESS_RULES = {
  'stress-unescaped': ['error', 'A stress value containing "<" reached the HTML unescaped — use {{x}}, never {{{x}}}, for anything a stranger typed.'],
  'stress-leak': ['error', '"undefined", "null", "NaN" or "[object Object]" shows up as text — a missing value or a whole object is being printed.'],
  'stress-empty-join': ['warn', 'With the field empty the copy reads broken ("Hola ,", " te espera", ". Espera hace ."). Wrap the phrase in {{#x}}…{{/x}} with a {{^x}} fallback, or normalize the value upstream.'],
  'stress-long-token': ['warn', 'A 600-char word (a URL, a pasted token, "jajajaja…") renders and nothing lets it break: add overflow-wrap:anywhere / word-break:break-word on the cells that hold user text.'],
};

// ---------------------------------------------------------------------------------------------------
// kinds

export function inferKind(key, sample) {
  if (Array.isArray(sample)) return 'list';
  if (typeof sample === 'number') return 'number';
  if (typeof sample === 'boolean') return 'bool';
  const leaf = key.toLowerCase().split(/[.[\]]+/).filter(Boolean).at(-1) || '';
  const s = typeof sample === 'string' ? sample : '';
  if (/^https?:\/\//.test(s) || /(^|_)(url|link|href|src|avatar|logo)$/.test(leaf)) return 'url';
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /(^|_)(at|date|time|fecha|when)$/.test(leaf)) return 'date';
  if (/phone|tel$|mobile|celular|whatsapp_number/.test(leaf) || /^\+?[\d][\d\s().-]{6,}$/.test(s)) return 'phone';
  if (/(^|_)(id|uuid|slug|code|token)$/.test(leaf)) return 'id';
  if (/(^|_)(count|total|amount|price|qty|number|n)$/.test(leaf) || (s && /^-?\d+(\.\d+)?$/.test(s))) return 'number';
  if (/name|nombre|author|sender|first|last|full|apellido/.test(leaf)) return 'name';
  if (s.length > 120 || /reason|motivo|note|nota|summary|resumen|message|mensaje|content|text|body|description|brief|quiere|falta|comment/.test(leaf)) return 'longtext';
  return 'text';
}

// Every field worth stressing: the contract's keys + the leaves of the base case. Item fields of a
// list (`messages[].content`) come from the contract or the first item.
export function collectFields(contract, base) {
  const decl = contract?.fields || {};
  const keys = new Set(Object.keys(decl).filter((k) => !k.includes('[]')));
  walkLeaves(base, '', (k) => keys.add(k));
  // a declared parent whose children are also leaves: keep the leaves only (contact vs contact.name)
  for (const k of [...keys]) if ([...keys].some((o) => o !== k && o.startsWith(`${k}.`))) keys.delete(k);
  const fields = [];
  for (const key of [...keys].sort()) {
    const d = decl[key] || {};
    if (d.stress === false) continue;
    const sample = getPath(base, key) ?? d.sample;
    const kind = KINDS.includes(d.kind) ? d.kind : inferKind(key, sample);
    const f = { key, kind, sample, required: d.required === true, custom: Array.isArray(d.stress) ? d.stress : [] };
    if (kind === 'list') {
      const first = Array.isArray(sample) ? sample.find((x) => x != null) : undefined;
      const itemKeys = new Set(Object.keys(decl).filter((k) => k.startsWith(`${key}[].`)).map((k) => k.slice(key.length + 3)));
      if (first && typeof first === 'object') Object.keys(first).forEach((k) => itemKeys.add(k));
      f.items = [...itemKeys].sort().map((ik) => {
        const dd = decl[`${key}[].${ik}`] || {};
        const s = first && typeof first === 'object' ? first[ik] : undefined;
        return { key: ik, kind: KINDS.includes(dd.kind) ? dd.kind : inferKind(ik, s) };
      });
      f.scalarItems = first != null && typeof first !== 'object';
    }
    fields.push(f);
  }
  return fields;
}

function walkLeaves(obj, prefix, fn) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) walkLeaves(v, key, fn);
    else fn(key);
  }
}

// ---------------------------------------------------------------------------------------------------
// values (fixed strings: the output must not change between runs)

const V = {
  emoji: '🌼🌼🌼',
  fancy: '𝓜𝓪𝓻𝓲𝓪 ✨ 𝕷𝖚𝖈𝖎𝖆',
  placeholder: 'WhatsApp User',
  capsName: 'MARIANA GUTIÉRREZ DEL CAMPO',
  short: 'ok',
  longWord: 'Supercalifragilístico',
  html: (key) => `<b>x</b> & <i>${key}</i>`,
};
const STRINGY = new Set(['name', 'text', 'longtext', 'phone', 'url', 'date', 'id']);
const PROSE = new Set(['text', 'longtext']);

function longProse(seed, min = 620) {
  const base = (typeof seed === 'string' && seed.trim()) || 'Este texto es deliberadamente largo para ver cómo se comporta el diseño';
  let out = base;
  for (let i = 2; out.length < min; i++) out += ` (${i}) ${base}`;
  return out;
}
const longToken = (kind) => (kind === 'url' ? `https://example.com/${'a'.repeat(600)}` : V.longWord.repeat(Math.ceil(620 / V.longWord.length)));
const upper = (v, fallback) => (typeof v === 'string' && v.trim() ? v.toUpperCase() : fallback);

// shape → (field) => new value, or undefined to leave the field alone.
const SHAPES = {
  missing: { absent: true, note: 'every field absent (null)', f: (f) => (f.kind === 'bool' ? undefined : null) },
  empty: { absent: true, note: 'every field present but empty ("" / [])', f: (f) => (f.kind === 'list' ? [] : f.kind === 'number' ? 0 : STRINGY.has(f.kind) ? '' : undefined) },
  'no-phone': { note: 'no phone (identity by username/BSUID only)', f: (f) => (f.kind === 'phone' ? null : undefined) },
  'name-emoji': { note: 'names that are only emoji', f: (f) => (f.kind === 'name' ? V.emoji : undefined), item: (ik) => (ik.kind === 'name' ? V.emoji : undefined) },
  'name-fancy': { note: 'names in "fancy" Unicode (math script/fraktur) + sparkles', f: (f) => (f.kind === 'name' ? V.fancy : undefined), item: (ik) => (ik.kind === 'name' ? V.fancy : undefined) },
  'name-placeholder': { note: 'the provider placeholder instead of a name', f: (f) => (f.kind === 'name' ? V.placeholder : undefined), item: (ik) => (ik.kind === 'name' ? V.placeholder : undefined) },
  caps: { note: 'ALL-CAPS names and text', f: (f) => (f.kind === 'name' ? upper(f.sample, V.capsName) : PROSE.has(f.kind) ? upper(f.sample, 'NECESITO AYUDA URGENTE') : undefined) },
  short: { note: 'text fields that say almost nothing ("ok")', f: (f) => (PROSE.has(f.kind) ? V.short : undefined), item: (ik) => (PROSE.has(ik.kind) ? V.short : undefined), last: true },
  long: { note: 'very long values (names ~120, short text ~80, long text 620+ chars)', f: (f) => (f.kind === 'name' ? longProse(f.sample, 120) : f.kind === 'longtext' ? longProse(f.sample) : f.kind === 'text' ? longProse(f.sample, 80) : undefined), item: (ik) => (PROSE.has(ik.kind) ? longProse('', 620) : undefined) },
  'long-token': { note: '600+ chars without a single space (URLs, pasted tokens)', f: (f) => (PROSE.has(f.kind) || f.kind === 'url' ? longToken(f.kind) : undefined), item: (ik) => (PROSE.has(ik.kind) ? longToken(ik.kind) : undefined) },
  html: { note: 'values that look like HTML — must render as text', f: (f) => (STRINGY.has(f.kind) ? V.html(f.key) : undefined), item: (ik, f) => (STRINGY.has(ik.kind) ? V.html(`${f.key}.${ik.key}`) : undefined) },
  'list-0': { note: 'every list empty', f: (f) => (f.kind === 'list' ? [] : undefined) },
  'list-1': { note: 'every list with a single item', f: (f) => (f.kind === 'list' ? listOf(f, 1) : undefined) },
  'list-many': { note: 'every list with 12 items (a burst of messages)', f: (f) => (f.kind === 'list' ? listOf(f, 12) : undefined) },
  'list-media': { note: 'list items with no text (a photo, a location, a voice note)', f: (f) => (f.kind === 'list' ? listOf(f, null).map((it) => mapItem(it, f, (ik) => (PROSE.has(ik.kind) ? '' : undefined))) : undefined) },
  'number-zero': { note: 'numbers at 0', f: (f) => (f.kind === 'number' ? 0 : undefined) },
  'number-big': { note: 'numbers far bigger than the sample', f: (f) => (f.kind === 'number' ? 1234567.89 : undefined) },
};

function listOf(f, n) {
  const items = Array.isArray(f.sample) && f.sample.length ? f.sample : f.scalarItems ? ['item'] : [{}];
  if (n == null) return items.map((x) => clone(x));
  return Array.from({ length: n }, (_v, i) => clone(items[i % items.length]));
}
function mapItem(item, f, fn) {
  if (item == null || typeof item !== 'object') {
    const ik = { key: '.', kind: (f.items || [])[0]?.kind || 'text' };
    const v = fn(ik, f);
    return v === undefined ? item : v;
  }
  const out = { ...item };
  for (const ik of f.items || []) {
    const v = fn(ik, f);
    if (v !== undefined) out[ik.key] = v;
  }
  return out;
}
const clone = (x) => (x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x);

/**
 * Build the stress cases. Returns [{ name, data }] — data is a full case (base + mutations) with
 * _meta: { stress: true, shape, base, note, fields }. Shapes that change nothing are not emitted.
 */
export function buildStressCases(contract, base, { baseName = null } = {}) {
  const clean = stripMeta(base);
  const fields = collectFields(contract, clean);
  const out = [];
  for (const [shape, def] of Object.entries(SHAPES)) {
    const data = clone(clean);
    const changed = [];
    for (const f of fields) {
      if (f.required && def.absent) continue;
      let v = def.f(f);
      if (v === undefined && def.item && f.kind === 'list' && Array.isArray(f.sample) && f.sample.length) {
        const items = listOf(f, null);
        if (def.last) items[items.length - 1] = mapItem(items.at(-1), f, def.item);
        else items.forEach((it, i) => { items[i] = mapItem(it, f, def.item); });
        if (JSON.stringify(items) !== JSON.stringify(f.sample)) v = items;
      }
      if (v === undefined || JSON.stringify(v) === JSON.stringify(f.sample)) continue;
      setPath(data, f.key, v);
      changed.push(f.key);
    }
    if (changed.length) out.push({ name: `stress-${shape}`, data: { _meta: { stress: true, shape, base: baseName, note: def.note, fields: changed }, ...data } });
  }
  for (const f of fields) {
    f.custom.forEach((val, i) => {
      const data = clone(clean);
      setPath(data, f.key, val);
      out.push({ name: `stress-custom-${slug(f.key)}-${i + 1}`, data: { _meta: { stress: true, shape: 'custom', base: baseName, note: `contract.json stress[${i}] for ${f.key}`, fields: [f.key] }, ...data } });
    });
  }
  return out;
}

const slug = (k) => k.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function stripMeta(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (!k.startsWith('_')) out[k] = clone(v);
  return out;
}

export const isStressCase = (data) => Boolean(data?._meta?.stress);

/** Write cases/stress-*.json for the message folder. Old stress files are replaced; hand-written cases are never touched. */
export function writeStressCases(dir, { from } = {}) {
  const contract = readContract(dir);
  const real = listCases(dir).filter((n) => !isStressCase(readCase(dir, n)));
  const baseName = from || real[0] || null;
  if (from && !real.includes(from)) throw new Error(`stress: no case "${from}" in ${path.join(dir, 'cases')} (have: ${real.join(', ') || 'none'})`);
  if (!contract && !baseName) throw new Error(`stress: ${dir} has neither contract.json nor a case to derive from`);
  const base = caseData(dir, contract, baseName);
  const cases = buildStressCases(contract, base, { baseName: baseName || 'samples' });
  const cdir = path.join(dir, 'cases');
  fs.mkdirSync(cdir, { recursive: true });
  for (const n of listCases(dir)) if (isStressCase(readCase(dir, n))) fs.unlinkSync(path.join(cdir, `${n}.json`));
  for (const c of cases) fs.writeFileSync(path.join(cdir, `${c.name}.json`), JSON.stringify(c.data, null, 2) + '\n');
  return { base: baseName || 'samples', cases, fields: collectFields(contract, stripMeta(base)) };
}

// ---------------------------------------------------------------------------------------------------
// checks

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', zwnj: '', zwj: '', shy: '' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp|zwnj|zwj|shy);/g, (_w, e) => ENT[e]).replace(/&#(\d+);/g, (_w, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_w, d) => String.fromCodePoint(parseInt(d, 16)));
const INLINE = 'a|b|strong|i|em|span|font|u|small|sup|sub|abbr|code|mark|s|strike|br';

/** Visible text runs: block-level boundaries split, inline tags merge; plus subject/preheader meta. */
export function textRuns(html) {
  const runs = [];
  let h = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '');
  for (const m of h.matchAll(/<meta\b[^>]*\bname=["']mail:(subject|preheader)["'][^>]*>/gi)) {
    const c = m[0].match(/\bcontent=("([^"]*)"|'([^']*)')/i);
    if (c) runs.push({ where: m[1], raw: decode(c[2] ?? c[3]) });
  }
  h = h.replace(new RegExp(`</?(?:${INLINE})\\b[^>]*>`, 'gi'), '');
  for (const m of h.matchAll(/>([^<]+)</g)) {
    const raw = decode(m[1]);
    if (norm(raw)) runs.push({ where: 'body', raw });
  }
  return runs;
}
// preheader filler (combining grapheme joiner, zero-widths, figure space) is invisible: drop it
const norm = (s) => s.replace(/[\u034f\u200b-\u200d\u2007\u00ad\ufeff]/g, '').replace(/\s+/g, ' ').trim();

const JOIN_TESTS = [
  [/[\p{L}\p{N}]\s+[,;:.!?](\s|$)/u, 'space before punctuation'],
  [/^[,;:.!?)]/u, 'starts with punctuation'],
  [/,$/u, 'ends with a comma'],
  [/[·•|—–]\s*[·•|—–]/u, 'two separators with nothing between'],
  [/\(\s*\)|\[\s*\]|"\s*"|“\s*”|«\s*»/u, 'empty brackets/quotes'],
  [/,\s*,|:\s*[.,]/u, 'doubled punctuation'],
];

/**
 * Findings for one rendered case, compared against the base render (copy that is identical in the base
 * is authored text, not a join — this is what keeps the heuristics quiet on real designs).
 */
export function stressFindings(html, baseHtml, data) {
  const out = [];
  const shape = data?._meta?.shape;
  const values = [];
  walkValues(data, '', (k, v) => values.push([k, v]));

  // unescaped: an HTML-looking value found verbatim in the output
  for (const [k, v] of values) {
    if (typeof v === 'string' && v.includes('<') && html.includes(v)) out.push(finding('stress-unescaped', `"${k}" renders raw HTML`, v, k));
  }

  const baseRuns = new Set(textRuns(baseHtml || '').map((r) => norm(r.raw)));
  const strVals = values.filter(([, v]) => typeof v === 'string' && v.trim()).map(([, v]) => norm(v));
  const seen = new Set();
  for (const r of textRuns(html)) {
    const t = norm(r.raw);
    if (!t || baseRuns.has(t) || seen.has(t)) continue; // <title> repeats the subject: report it once
    seen.add(t);
    if (strVals.some((v) => v === t || v.includes(t))) continue; // the value itself, not the copy around it
    if (/\b(undefined|null|NaN)\b|\[object Object\]/.test(t) && !strVals.some((v) => /\b(undefined|null|NaN)\b|\[object Object\]/.test(v))) {
      out.push(finding('stress-leak', `${r.where}: "${clip(t)}"`, t));
      continue;
    }
    const hit = JOIN_TESTS.find(([re]) => re.test(t));
    // a phrase that lost its subject: " te espera" — same-line space right after a tag, then lowercase
    const orphan = (shape === 'missing' || shape === 'empty') && /^[ \t]+\p{Ll}/u.test(r.raw);
    if (hit || orphan) out.push(finding('stress-empty-join', `${r.where}: "${clip(t)}" (${hit ? hit[1] : 'phrase starts where a value was'})`, r.raw.replace(/\s+/g, ' ')));
  }

  // long token with nothing letting it wrap
  if (shape === 'long-token' && !/overflow-wrap|word-break|word-wrap/i.test(html)) {
    const toks = values.filter(([, v]) => typeof v === 'string' && v.length >= 600 && !/\s/.test(v) && html.includes(v.slice(0, 80)));
    if (toks.length) {
      const names = toks.map(([k]) => k);
      out.push(finding('stress-long-token', `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''} render a ${toks[0][1].length}-char word and no overflow-wrap/word-break exists anywhere`, clip(toks[0][1], 60), names[0]));
    }
  }
  return out;
}

function walkValues(obj, prefix, fn) {
  if (obj == null || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue;
    const key = Array.isArray(obj) ? `${prefix}[]` : prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') walkValues(v, key, fn);
    else fn(key, v);
  }
}
const clip = (s, n = 70) => (s.length > n ? `${s.slice(0, n)}…` : s);
function finding(rule, message, excerpt, field) {
  return { rule, severity: STRESS_RULES[rule][0], message, excerpt: clip(excerpt, 90), ...(field ? { field } : {}) };
}

/**
 * Render every variant × every case of a message folder and collect stress findings.
 * variants: [{ key, file }]. Returns [{ variant, case, findings }] (only entries with findings).
 */
export function checkStress(dir, variants) {
  const contract = readContract(dir);
  const all = listCases(dir);
  const cases = all.map((n) => ({ name: n, data: readCase(dir, n) }));
  const real = cases.filter((c) => !isStressCase(c.data));
  const report = [];
  for (const v of variants) {
    const raw = fs.readFileSync(v.file, 'utf8');
    if (!isTemplate(raw)) continue;
    const render = (name) => renderTemplate(raw, caseData(dir, contract, name), { contract }).html;
    const cache = new Map();
    const baseOf = (name) => {
      if (!cache.has(name)) cache.set(name, render(name));
      return cache.get(name);
    };
    for (const c of cases) {
      const baseName = isStressCase(c.data) ? (c.data._meta.base && all.includes(c.data._meta.base) ? c.data._meta.base : real[0]?.name ?? null) : null;
      if (!isStressCase(c.data) && c.name === real[0]?.name) continue; // the base itself
      const findings = stressFindings(render(c.name), baseOf(baseName ?? real[0]?.name ?? null), caseData(dir, contract, c.name));
      if (findings.length) report.push({ variant: v.key, case: c.name, findings });
    }
  }
  return report;
}
