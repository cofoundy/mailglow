// The static gallery (`mailglow gallery`) and the skill installer (`mailglow init`). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildGallery, titleOf } from '../skills/mailglow/scripts/lib/gallery.mjs';
import { install, plan, detectAgents, parseAgents } from '../skills/mailglow/scripts/lib/install.mjs';
import { RULES } from '../skills/mailglow/scripts/lib/lint.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(ROOT, 'skills', 'mailglow', 'examples');
const CLI = path.join(ROOT, 'skills', 'mailglow', 'scripts', 'mailglow.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mailglow-gallery-'));
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const quiet = () => {};

const EMAIL = (subject, pre, extra = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="mail:subject" content="${subject}"><meta name="mail:from" content="Acme <hi@example.com>"><title>${subject}</title></head>
<body><div style="display:none">${pre}</div><table role="presentation"><tr><td>Hello ${extra}</td></tr></table></body></html>`;

function fixture() {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'password-reset.html'), EMAIL('Reset your password', 'The link works for 30 minutes.', '</script><b>&amp;'));
  fs.mkdirSync(path.join(dir, 'welcome'));
  for (const k of ['a', 'b']) fs.writeFileSync(path.join(dir, 'welcome', `${k}.html`), EMAIL(`Welcome ${k.toUpperCase()}`, `Variant ${k}`));
  return dir;
}

test('titleOf turns slugs into names', () => {
  assert.equal(titleOf('password-reset'), 'Password reset');
  assert.equal(titleOf('lifecycle/trial_ending'), 'Trial ending');
});

test('gallery: landing, one page per template, variants, SEO and sitemap', async () => {
  const src = fixture();
  const out = path.join(tmp(), 'site');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({ base: 'https://from-config.test' }));
  fs.writeFileSync(path.join(out, 'stale.html'), 'old build');
  const r = await buildGallery({ dir: src, out, base: 'https://mail.example.org/', shots: false, log: quiet });

  assert.equal(r.base, 'https://mail.example.org', '--base wins over config.json and loses the trailing slash');
  assert.ok(fs.existsSync(path.join(out, 'config.json')), 'config.json survives a rebuild');
  assert.ok(!fs.existsSync(path.join(out, 'stale.html')), 'the rest of a previous build is cleared');

  const index = read(out, 'index.html');
  assert.match(index, /<title>mailglow — vibe-code beautiful, responsive HTML emails<\/title>/);
  assert.match(index, /<link rel="canonical" href="https:\/\/mail\.example\.org\/">/);
  assert.match(index, /Vibe-code <em>beautiful,<\/em> responsive emails/);
  assert.match(index, /href="templates\/password-reset\/"/);
  assert.match(index, /href="templates\/welcome\/"/);
  assert.match(index, />2 variants</);
  assert.match(index, new RegExp(`<b>${Object.keys(RULES).length}</b>lint rules`), 'the rule count is derived, not typed');
  assert.match(index, /npx github:cofoundy\/mailglow init/);

  const page = read(out, 'templates', 'password-reset', 'index.html');
  assert.match(page, /<title>Password reset — responsive HTML email template<\/title>/);
  assert.match(page, /<meta name="description" content="Password reset email template: “Reset your password”\. The link works for 30 minutes\./);
  assert.match(page, /<link rel="canonical" href="https:\/\/mail\.example\.org\/templates\/password-reset\/">/);
  assert.match(page, /<meta property="og:title" content="Password reset — responsive HTML email template">/);
  assert.match(page, /<meta property="og:type" content="article">/);
  // The copyable source is embedded as JSON that cannot close the <script> it lives in.
  const json = page.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)[1];
  assert.ok(!json.includes('</script'), 'embedded source escapes </script>');
  const data = JSON.parse(json);
  assert.equal(data[0].html, read(src, 'password-reset.html'), 'Copy HTML copies the exact source');
  assert.deepEqual(Object.keys(data[0].summary).sort(), ['error', 'info', 'warn']);

  for (const f of ['default.html', 'default.light.html', 'default.dark.html']) assert.ok(fs.existsSync(path.join(out, 'templates', 'password-reset', f)), f);
  assert.match(read(out, 'templates', 'password-reset', 'default.dark.html'), /<base target="_blank">/);
  const welcome = read(out, 'templates', 'welcome', 'index.html');
  assert.match(welcome, /data-variant="a"/);
  assert.match(welcome, /data-variant="b"/);
  assert.ok(fs.existsSync(path.join(out, 'templates', 'welcome', 'b.dark.html')));

  const sitemap = read(out, 'sitemap.xml');
  for (const u of ['https://mail.example.org/', 'https://mail.example.org/templates/password-reset/', 'https://mail.example.org/templates/welcome/']) assert.ok(sitemap.includes(`<loc>${u}</loc>`), u);
  assert.equal((sitemap.match(/<url>/g) || []).length, 3);
  assert.match(read(out, 'robots.txt'), /^Sitemap: https:\/\/mail\.example\.org\/sitemap\.xml$/m);
  const catalog = JSON.parse(read(out, 'templates.json'));
  assert.deepEqual(catalog.map((t) => t.slug), ['password-reset', 'welcome']);
});

test('gallery: every shipped example gets a client-safe page', async () => {
  const out = tmp();
  const r = await buildGallery({ dir: EXAMPLES, out, shots: false, log: quiet });
  const slugs = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.html') || fs.statSync(path.join(EXAMPLES, f)).isDirectory());
  assert.equal(r.templates.length, slugs.length);
  for (const t of r.templates) {
    assert.ok(fs.existsSync(path.join(out, 'templates', t.slug, 'index.html')), t.slug);
    for (const v of t.variants) assert.equal(v.summary.error + v.summary.warn, 0, `${t.slug}/${v.key} must lint 0/0`);
  }
  assert.match(read(out, 'index.html'), /<link rel="canonical" href="https:\/\/mailglow\.cofoundy\.dev\/">/, 'default base');
});

test('gallery CLI: --no-shots builds without Chrome', () => {
  const out = path.join(tmp(), 'site');
  const log = execFileSync(process.execPath, [CLI, 'gallery', fixture(), '--out', out, '--no-shots', '--base', 'https://x.test'], { encoding: 'utf8' });
  assert.match(log, /2 templates/);
  assert.ok(!fs.existsSync(path.join(out, 'shots')));
  assert.match(read(out, 'index.html'), /iframe src="templates\/password-reset\/default\.light\.html"/, 'cards fall back to a live preview');
});

test('init: detects agents, one copy per folder, never clobbers without --force', () => {
  const project = tmp();
  assert.deepEqual(detectAgents(project), ['claude', 'agents'], 'nothing detected → Claude + the shared .agents/skills');
  fs.mkdirSync(path.join(project, '.cursor'));
  fs.writeFileSync(path.join(project, 'AGENTS.md'), '# agents\n');
  assert.deepEqual(detectAgents(project).sort(), ['codex', 'cursor']);

  const targets = plan({ project, agents: 'claude,codex,cursor,gemini' });
  assert.deepEqual(targets.map((t) => path.relative(project, t.dir)).sort(), [path.join('.agents', 'skills', 'mailglow'), path.join('.claude', 'skills', 'mailglow')]);
  assert.deepEqual(targets.find((t) => t.dir.includes('.agents')).agents, ['Codex', 'Cursor', 'Gemini CLI']);

  const first = install({ project, agents: 'claude,codex', log: quiet });
  assert.deepEqual(first.map((r) => r.status), ['installed', 'installed']);
  const skill = path.join(project, '.claude', 'skills', 'mailglow');
  assert.match(read(skill, 'SKILL.md'), /^---\nname: mailglow/);
  assert.ok(fs.existsSync(path.join(skill, 'scripts', 'mailglow.mjs')), 'the engine travels with the skill');
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'edited');
  assert.deepEqual(install({ project, agents: 'claude', log: quiet }).map((r) => r.status), ['exists']);
  assert.equal(read(skill, 'SKILL.md'), 'edited', 'no --force → untouched');
  assert.deepEqual(install({ project, agents: 'claude', force: true, log: quiet }).map((r) => r.status), ['updated']);
  assert.match(read(skill, 'SKILL.md'), /^---\nname: mailglow/);

  const dry = tmp();
  install({ project: dry, agents: 'gemini', dryRun: true, log: quiet });
  assert.ok(!fs.existsSync(path.join(dry, '.agents')), '--dry-run writes nothing');
  const home = tmp();
  install({ project: dry, agents: 'codex', global: true, home, log: quiet });
  assert.ok(fs.existsSync(path.join(home, '.codex', 'skills', 'mailglow', 'SKILL.md')), '--global uses the agent home folder');
  assert.throws(() => parseAgents('claude,notepad'), /unknown agent "notepad"/);
  assert.deepEqual(parseAgents('claude-code, gemini-cli'), ['claude', 'gemini']);
});

test('init CLI installs into --project', () => {
  const project = tmp();
  const log = execFileSync(process.execPath, [CLI, 'init', '--project', project, '--agents', 'cursor'], { encoding: 'utf8' });
  assert.match(log, /\.agents\/skills\/mailglow/);
  assert.ok(fs.existsSync(path.join(project, '.agents', 'skills', 'mailglow', 'SKILL.md')));
});

test('README count badges match the engine (templates = examples, lint rules = RULES)', async () => {
  const readme = read(ROOT, 'README.md');
  const { templates } = await buildGallery({ dir: EXAMPLES, out: tmp(), shots: false, log: quiet });
  assert.match(readme, new RegExp(`badge/templates-${templates.length}-`), `templates badge should say ${templates.length}`);
  assert.match(readme, new RegExp(`badge/lint%20rules-${Object.keys(RULES).length}-`), `lint rules badge should say ${Object.keys(RULES).length}`);
});
