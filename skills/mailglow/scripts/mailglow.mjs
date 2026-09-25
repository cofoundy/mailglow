#!/usr/bin/env node
// mailglow — preview, lint and screenshot HTML emails in a local mini inbox. Zero dependencies, Node >= 22.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadMailbox, readPicks } from './lib/mailbox.mjs';
import { lint, summarize, checkRemoteAssets, RULES } from './lib/lint.mjs';
import { startServer, contractFor, contractFindings } from './lib/server.mjs';
import { readContract, fetchCase } from './lib/template.mjs';
import { materialize } from './lib/mailbox.mjs';
import { shoot, snap } from './lib/shoot.mjs';
import { writeStressCases, checkStress, STRESS_RULES } from './lib/stress.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELP = `mailglow — a local inbox for designing HTML emails

  serve  [dir] [--port 4555] [--open]     mini inbox: list + opened message, live reload,
                                          desktop/mobile, light/dark/forced-dark, images off,
                                          variant switcher with Pick + notes (→ picks.json)
  lint   [dir|file.html ...] [--net] [--json]
                                          email-client compatibility; exit 1 on any error
  shoot  [dir] [--out dir/shots] [--views desktop,mobile] [--schemes light,dark,forced]
         [--only slug,slug] [--no-inbox]  screenshot every email (+ the inbox view) and write
                                          an index.html contact sheet
  new    <slug> [dir] [--variants 3]      start an email from the starter (dir/slug/a.html…)
  picks  [dir]                            print what was picked in the inbox, with notes
  rules                                   every lint rule as a markdown table
  snap   <url> [--out f.png] [--width 1440 --height 900] [--full] [--dark]   screenshot any page (e.g. the inbox)

  Templates + data contract (after the design is picked):
  contract <dir>/<slug> [--strict]        every field → the endpoint it comes from; which are missing;
                                          --strict exits 1 while any field has no declared source
  fetch    <dir>/<slug> --base URL --name <case> [--param k=v ...] [--header "K: V" ...]
                                          build cases/<case>.json by calling the real endpoints
  render   <dir>/<slug> [--variant a] [--case x] [--out file]   the clean production HTML
  stress   <dir>/<slug> [--from <case>] [--check] [--strict] [--json]
                                          write cases/stress-*.json (empty, emoji/fancy/CAPS names,
                                          600-char text, HTML-ish, lists 0/1/12/media-only…) from the
                                          contract + a real case, then render every variant with every
                                          case: exit 1 on stress errors (--strict: on warnings too).
                                          --check = only check, write nothing

  Share + install:
  gallery  [dir] [--out site] [--base https://mailglow.cofoundy.dev] [--no-shots]
                                          static landing + template gallery (cards with desktop/mobile
                                          light/dark thumbnails, detail page per template with live
                                          preview, Copy HTML, lint status), sitemap.xml, robots.txt.
                                          dir defaults to this skill's examples/
  init     [--agents claude,codex,cursor,gemini] [--global] [--force] [--dry-run] [--project .]
                                          copy this skill into the project's agent skill folders
                                          (.claude/skills, .agents/skills…); default: detect agents

  dir defaults to ./emails. Layout: dir/welcome.html, or dir/welcome/{a,b,c}.html for variants.
  Metadata: dir/manifest.json or <meta name="mail:subject|mail:from|mail:preheader">.`;

const [cmd = 'help', ...rest] = process.argv.slice(2);
const { pos, flags } = parse(rest);
const dir = pos[0] && !pos[0].endsWith('.html') ? pos[0] : 'emails';

try {
  if (cmd === 'serve') await serve();
  else if (cmd === 'lint') process.exitCode = await runLint();
  else if (cmd === 'shoot') await runShoot();
  else if (cmd === 'new') runNew();
  else if (cmd === 'contract') process.exitCode = runContract();
  else if (cmd === 'fetch') await runFetch();
  else if (cmd === 'render') runRender();
  else if (cmd === 'gallery') await runGallery();
  else if (cmd === 'init') await runInit();
  else if (cmd === 'stress') process.exitCode = runStress();
  else if (cmd === 'snap') console.log(`${await snap(pos[0], flags.out || 'snap.png', { width: +(flags.width || 1440), height: +(flags.height || 900), full: Boolean(flags.full), dark: Boolean(flags.dark) })} bytes → ${flags.out || 'snap.png'}`);
  else if (cmd === 'rules') console.log(rulesMarkdown());
  else if (cmd === 'picks') console.log(JSON.stringify(readPicks(path.resolve(pos[0] || 'emails')), null, 2));
  else console.log(HELP);
} catch (e) {
  console.error(`mailglow: ${e.message}`);
  process.exitCode = 2;
}

async function serve() {
  ensureDir(dir);
  const { url } = await startServer({ dir, port: +(flags.port ?? 4555), host: flags.host || '127.0.0.1' });
  const n = loadMailbox(dir).messages.length;
  console.log(`mailglow inbox → ${url}   (${n} message${n === 1 ? '' : 's'} in ${path.resolve(dir)}, live reload on)`);
  if (flags.open) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  }
}

async function runLint() {
  const inputs = pos.length ? pos : ['emails'];
  const targets = inputs.flatMap((p) =>
    p.endsWith('.html')
      ? [{ name: p, file: ensureDir(p) }]
      : loadMailbox(ensureDir(p)).messages.flatMap((m) => m.variants.map((v) => ({ name: m.variants.length > 1 ? `${m.slug}/${v.key}` : m.slug, file: v.file, msg: m, v }))),
  );
  const report = [];
  for (const t of targets) {
    const html = t.msg ? materialize(t.file, { caseName: t.msg.cases[0] }) : fs.readFileSync(t.file, 'utf8');
    const findings = [...lint(html), ...(t.msg ? contractFindings(t.msg, t.v) : [])];
    if (flags.net) findings.push(...(await checkRemoteAssets(html)));
    report.push({ name: t.name, file: t.file, summary: summarize(findings), findings });
  }
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else {
    const icon = { error: '✖', warn: '▲', info: '·' };
    for (const r of report) {
      const s = r.summary;
      console.log(`\n${s.error ? '✖' : s.warn ? '▲' : '✓'} ${r.name}  (${s.error} error, ${s.warn} warn, ${s.info} info)`);
      for (const f of r.findings) if (f.severity !== 'info' || flags.info) console.log(`   ${icon[f.severity]} ${f.rule}${f.line ? `:${f.line}` : ''}  ${f.message}${f.excerpt ? `\n       ${f.excerpt}` : ''}`);
    }
    const tot = report.reduce((a, r) => a + r.summary.error, 0);
    console.log(`\n${report.length} email(s), ${tot} error(s).${flags.info ? '' : ' (--info shows best-practice notes)'}`);
  }
  return report.some((r) => r.summary.error) ? 1 : 0;
}

async function runShoot() {
  ensureDir(dir);
  const out = path.resolve(flags.out || path.join(dir, 'shots'));
  const list = (v, d) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : d);
  console.log(`Shooting ${path.resolve(dir)} → ${out}`);
  const shots = await shoot({
    dir,
    out,
    views: list(flags.views, ['desktop', 'mobile']),
    schemes: list(flags.schemes, ['light', 'dark']),
    inbox: !flags['no-inbox'],
    only: flags.only ? list(flags.only) : null,
  });
  console.log(`${shots.length} screenshots · contact sheet: ${path.join(out, 'index.html')}`);
}

function runNew() {
  const slug = pos[0];
  if (!slug) throw new Error('usage: mailglow new <slug> [dir] [--variants 3]');
  const target = path.resolve(pos[1] || 'emails', slug);
  if (fs.existsSync(target) || fs.existsSync(target + '.html')) throw new Error(`${slug} already exists in ${path.dirname(target)}`);
  const n = Math.min(5, Math.max(1, +(flags.variants ?? 3)));
  const starter = fs.readFileSync(path.join(HERE, '..', 'templates', 'starter.html'), 'utf8');
  if (n === 1) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target + '.html', starter);
    console.log(`created ${target}.html`);
    return;
  }
  fs.mkdirSync(target, { recursive: true });
  for (const k of 'abcde'.slice(0, n)) fs.writeFileSync(path.join(target, `${k}.html`), starter);
  console.log(`created ${n} variants in ${target}/ — make them structurally different, then \`serve\` and pick one`);
}

function rulesMarkdown() {
  const order = { error: 0, warn: 1, info: 2 };
  const rows = Object.entries(RULES).sort((a, b) => order[a[1][0]] - order[b[1][0]] || a[0].localeCompare(b[0]));
  return ['| rule | severity | why |', '|---|---|---|', ...rows.map(([k, [sev, msg]]) => `| \`${k}\` | ${sev} | ${msg.replace(/\|/g, '\\|')} |`)].join('\n');
}

function messageAt(p) {
  const full = path.resolve(ensureDir(p));
  const box = loadMailbox(path.dirname(full));
  const msg = box.messages.find((m) => m.slug === path.basename(full));
  if (!msg) throw new Error(`no message at ${full} (a folder with variant .html files)`);
  return { full, msg };
}

function runContract() {
  const { full, msg } = messageAt(pos[0] || '');
  if (!msg.template) { console.log(`${msg.slug} has no {{fields}} — nothing to map yet.`); return 0; }
  const rep = contractFor(msg);
  const icon = { existe: '✓', falta: '✗', sin: '?' };
  if (flags.json) console.log(JSON.stringify(rep, null, 2));
  else {
    console.log(`\n${msg.slug} — ${rep.fields.length} fields · cases: ${msg.cases.join(', ') || '(samples only)'}${readContract(full) ? '' : ' · NO contract.json'}\n`);
    for (const f of rep.fields) console.log(`  ${icon[f.status]} ${f.status.padEnd(6)} ${f.field.padEnd(26)} ${f.endpoint || '—'}${f.path ? ` → ${f.path}` : ''}   [${f.variants.join(',')}]${f.note ? `\n             ${f.note}` : ''}`);
    console.log('\n  per variant: ' + Object.entries(rep.perVariant).map(([v, c]) => `${v} ${c.existe}✓ ${c.falta}✗ ${c.sin}?`).join(' · '));
    if (rep.missingEndpoints.length) console.log('  endpoints to build:\n' + rep.missingEndpoints.map((e) => `    - ${e}`).join('\n'));
  }
  return flags.strict && rep.fields.some((f) => f.status === 'sin') ? 1 : 0;
}

async function runFetch() {
  const { full } = messageAt(pos[0] || '');
  const contract = readContract(full);
  if (!contract) throw new Error(`no contract.json in ${full}`);
  if (!flags.base || !flags.name) throw new Error('usage: fetch <dir>/<slug> --base URL --name <case> [--param k=v] [--header "K: V"]');
  const multi = (k) => rest.flatMap((a, i) => (a === `--${k}` ? [rest[i + 1]] : a.startsWith(`--${k}=`) ? [a.slice(k.length + 3)] : []));
  const params = Object.fromEntries(multi('param').map((kv) => kv.split(/=(.*)/s).slice(0, 2)));
  const headers = Object.fromEntries(multi('header').map((h) => h.split(/:\s*(.*)/s).slice(0, 2)));
  const data = await fetchCase(contract, { base: flags.base, headers, params, log: console.log });
  fs.mkdirSync(path.join(full, 'cases'), { recursive: true });
  const out = path.join(full, 'cases', `${flags.name}.json`);
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
  const src = Object.values(data._meta.fields);
  console.log(`wrote ${out} — ${src.filter((x) => x === 'api').length} fields from the API, ${src.length - src.filter((x) => x === 'api').length} from samples`);
}

function runStress() {
  // `--check` is not a boolean flag in parse(): `stress --check emails/x` puts the path in flags.check.
  const target = pos[0] || (typeof flags.check === 'string' ? flags.check : '');
  const { full, msg } = messageAt(target);
  if (!msg.template) { console.log(`${msg.slug} has no {{fields}} — stress needs a template + contract (step D).`); return 0; }
  let written = null;
  if (!flags.check) {
    const { base, cases, fields } = (written = writeStressCases(full, { from: typeof flags.from === 'string' ? flags.from : undefined }));
    if (!flags.json) {
    const kinds = fields.map((f) => `${f.key}:${f.kind}`).join(' · ');
    console.log(`\n${msg.slug} — ${cases.length} stress case(s) from "${base}" → ${path.join(full, 'cases')}/stress-*.json\n  fields: ${kinds}`);
    for (const c of cases) console.log(`  + ${c.name.padEnd(28)} ${c.data._meta.note}  [${c.data._meta.fields.length} field(s)]`);
    }
  }
  const report = checkStress(full, msg.variants);
  if (flags.json) console.log(JSON.stringify({ base: written?.base ?? null, written: written ? written.cases.map((c) => c.name) : [], fields: written ? written.fields.map((f) => ({ key: f.key, kind: f.kind })) : [], report }, null, 2));
  else {
    const icon = { error: '✖', warn: '▲' };
    console.log(report.length ? '' : '\n✓ every variant survives every case');
    for (const r of report) {
      console.log(`${r.findings.some((f) => f.severity === 'error') ? '✖' : '▲'} ${msg.slug}/${r.variant} × ${r.case}`);
      for (const f of r.findings) console.log(`   ${icon[f.severity]} ${f.rule}  ${f.message}`);
    }
    if (report.length) console.log(`\n  why: ${Object.entries(STRESS_RULES).map(([k, [, why]]) => `\n   ${k} — ${why}`).join('')}`);
  }
  const all = report.flatMap((r) => r.findings);
  return all.some((f) => f.severity === 'error') || (flags.strict && all.length) ? 1 : 0;
}

function runRender() {
  const { msg } = messageAt(pos[0] || '');
  const v = msg.variants.find((x) => x.key === flags.variant) || msg.variants[0];
  const html = materialize(v.file, { caseName: flags.case || msg.cases[0] });
  if (flags.out) fs.writeFileSync(flags.out, html);
  else process.stdout.write(html);
}

function ensureDir(d) {
  if (!fs.existsSync(d)) throw new Error(`folder not found: ${path.resolve(d)} (create it or pass a path)`);
  return d;
}

function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--') && !['open', 'net', 'json', 'info', 'no-inbox', 'strict', 'huecos', 'full', 'dark', 'no-shots', 'force', 'dry-run', 'global'].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

async function runGallery() {
  const { buildGallery } = await import('./lib/gallery.mjs');
  const src = pos[0] || path.join(HERE, '..', 'examples');
  ensureDir(src);
  const out = flags.out || 'site';
  console.log(`Building gallery from ${path.resolve(src)} → ${path.resolve(out)}`);
  const r = await buildGallery({ dir: src, out, base: flags.base, repo: flags.repo, shots: !flags['no-shots'] });
  console.log(`${r.templates.length} templates · open ${path.join(r.out, 'index.html')} · canonical base ${r.base}`);
}

async function runInit() {
  const { install } = await import('./lib/install.mjs');
  const project = path.resolve(flags.project || '.');
  console.log(`Installing the mailglow skill into ${flags.global ? 'your home folder' : project}`);
  const r = install({ project, agents: flags.agents, global: Boolean(flags.global), force: Boolean(flags.force), dryRun: Boolean(flags['dry-run']) });
  if (r.some((x) => x.status === 'installed' || x.status === 'updated')) console.log('Done. Ask your agent: "design a welcome email for our app".');
}
