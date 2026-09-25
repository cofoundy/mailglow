// Mailbox loader: turns a folder of .html emails into "messages" with variants + inbox metadata.
//
// Layout conventions (both can be mixed in one folder):
//   emails/welcome.html              → message "welcome", one variant
//   emails/welcome/a.html, b.html    → message "welcome", variants a, b (the "pick one" flow)
//
// Metadata, first match wins:
//   1. manifest.json next to the emails  ([{slug, subject, from_name, from_email, preheader, date, to}] or {slug: {...}})
//   2. <meta name="mail:subject|mail:from|mail:to|mail:preheader|mail:date" content="…"> in the HTML
//   3. <title>, the hidden preheader element, the first visible text, file mtime
import fs from 'node:fs';
import path from 'node:path';
import { isTemplate, readContract, listCases, caseData, renderTemplate } from './template.mjs';

const SKIP_DIRS = new Set(['node_modules', 'shots', '.git', '.mailpreview']);

export function loadMailbox(dir) {
  const root = path.resolve(dir);
  const manifest = readManifest(root);
  const messages = [];
  collect(root, '', manifest, messages);
  messages.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug));
  return { root, messages, picks: readPicks(root) };
}

// A folder holding .html files is one message whose files are variants; a folder holding only folders
// is a group, walked recursively (slug "group/case"). Dot-folders are hidden (".archive").
function collect(dir, prefix, manifest, messages) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isFile() && ent.name.endsWith('.html')) {
      const slug = prefix + ent.name.replace(/\.html$/, '');
      messages.push(buildMessage(slug, [{ key: 'default', file: full }], manifest[slug]));
    } else if (ent.isDirectory() && !SKIP_DIRS.has(ent.name)) {
      const slug = prefix + ent.name;
      const variants = fs.readdirSync(full)
        .filter((f) => f.endsWith('.html'))
        .sort()
        .map((f) => ({ key: f.replace(/\.html$/, ''), file: path.join(full, f) }));
      if (variants.length) messages.push(buildMessage(slug, variants, manifest[slug]));
      else collect(full, slug + '/', manifest, messages);
    }
  }
}

function readManifest(root) {
  const p = path.join(root, 'manifest.json');
  if (!fs.existsSync(p)) return {};
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((m) => [m.slug, m]));
  return raw;
}

export function picksPath(root) {
  return path.join(root, 'picks.json');
}

export function readPicks(root) {
  const p = picksPath(root);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

export function writePick(root, { slug, variant, note, pick }) {
  const picks = readPicks(root);
  const entry = picks[slug] || { picked: null, notes: {} };
  if (pick) {
    entry.picked = variant;
    entry.picked_at = new Date().toISOString();
  }
  if (typeof note === 'string') {
    if (note.trim()) entry.notes[variant] = note.trim();
    else delete entry.notes[variant];
  }
  picks[slug] = entry;
  fs.writeFileSync(picksPath(root), JSON.stringify(picks, null, 2) + '\n');
  return entry;
}

// Every variant carries its own inbox metadata (variants often disagree on the subject line — that is
// part of what is being compared). The message row shows the variant that declares its metadata
// (mail:* meta or <title>) first, so a legacy fragment kept as the baseline doesn't name the thread.
function buildMessage(slug, variants, man = {}) {
  const dir = path.dirname(variants[0].file);
  const contract = readContract(dir);
  const cases = listCases(dir);
  const template = variants.some((v) => isTemplate(fs.readFileSync(v.file, 'utf8')));
  const vs = variants.map((v) => {
    const html = materialize(v.file, { contract, dir, caseName: cases[0] });
    const m = metaFromHtml(html);
    const [fromName, fromEmail] = splitFrom(m.from);
    const stat = fs.statSync(v.file);
    return {
      key: v.key,
      file: v.file,
      bytes: stat.size,
      declared: Boolean(m.subject || m.from),
      subject: man.subject || m.subject || slug,
      from_name: man.from_name || fromName || 'Sender',
      from_email: man.from_email || fromEmail || '',
      to: man.to || m.to || 'you@example.com',
      preheader: man.preheader || m.preheader || firstText(html).slice(0, 160),
      date: man.date || m.date || stat.mtime.toISOString(),
    };
  });
  const lead = vs.find((v) => v.declared) || vs[0];
  return {
    slug,
    subject: lead.subject,
    from_name: lead.from_name,
    from_email: lead.from_email,
    to: lead.to,
    preheader: lead.preheader,
    date: vs.map((v) => v.date).sort().at(-1),
    template,
    cases,
    has_contract: Boolean(contract),
    trigger: man.trigger || '',
    source: man.source || '',
    variants: vs.map(({ declared, ...v }) => v),
  };
}

function splitFrom(from) {
  if (!from) return [null, null];
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? [m[1] || m[2], m[2]] : [from, from.includes('@') ? from : null];
}

export function metaFromHtml(html) {
  // Quoted attribute values may contain ">" ("Acme <hi@acme.com>"), so tokenise quotes, not up to the first ">".
  const tags = html.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) || [];
  const meta = (name) => {
    const tag = tags.find((t) => new RegExp(`name=["']mail:${name}["']`, 'i').test(t));
    const c = tag && tag.match(/content=(?:"([^"]*)"|'([^']*)')/i);
    return c ? decode(c[1] ?? c[2]) : null;
  };
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    subject: meta('subject') || (title && decode(title[1]).trim()) || null,
    from: meta('from'),
    to: meta('to'),
    date: meta('date'),
    preheader: meta('preheader') || hiddenPreheader(html),
  };
}

// The conventional preheader: the first element hidden with display:none (or max-height:0) near the top of <body>.
export function hiddenPreheader(html) {
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, '');
  const m = body.match(/<(div|span|p)[^>]*style=["'][^"']*(display\s*:\s*none|max-height\s*:\s*0)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);
  if (!m) return null;
  const text = toText(m[3]).replace(/[͏‌​ \s]+/g, ' ').trim();
  return text || null;
}

export function firstText(html) {
  return toText(html.replace(/<head[\s\S]*?<\/head>/i, ''));
}

export function toText(html) {
  return decode(
    html
      .replace(/<(style|script|title)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// The HTML a recipient would get: templates are rendered with a data case (or the contract samples).
export function materialize(file, { contract, dir = path.dirname(file), caseName, annotate = false } = {}) {
  const raw = fs.readFileSync(file, 'utf8');
  if (!isTemplate(raw)) return raw;
  const c = contract === undefined ? readContract(dir) : contract;
  return renderTemplate(raw, caseData(dir, c, caseName), { contract: c, annotate }).html;
}
