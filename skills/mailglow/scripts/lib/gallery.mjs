// Static landing + template gallery, built from a folder of emails (default: the skill's examples).
// Zero dependencies: every page is plain HTML/CSS with a few lines of inline JS; thumbnails come from
// the same headless-Chrome `shoot` pipeline. Links inside the site are relative (works on file:// and
// any host); canonical / og:url / sitemap use the absolute --base.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMailbox, materialize } from './mailbox.mjs';
import { lint, summarize, RULES } from './lint.mjs';
import { renderForClient } from './render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..', '..');
const REPO = path.resolve(SKILL, '..', '..');
export const DEFAULT_BASE = 'https://mailglow.cofoundy.dev';
const DEFAULTS = { base: DEFAULT_BASE, repo: 'cofoundy/mailglow', name: 'mailglow' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const tagOf = (m, v) => (m.variants.length > 1 ? `${m.slug}--${v.key}` : m.slug).replaceAll('/', '__');
export const titleOf = (slug) => {
  const s = slug.split('/').at(-1).replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function readSiteConfig(out) {
  const p = path.join(out, 'config.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

// Builds the site. `shots: false` skips Chrome (cards fall back to a scaled live preview).
export async function buildGallery({ dir = path.join(SKILL, 'examples'), out = 'site', base, repo, shots = true, log = console.log } = {}) {
  out = path.resolve(out);
  fs.mkdirSync(out, { recursive: true });
  const cfg = { ...DEFAULTS, ...readSiteConfig(out) };
  if (base) cfg.base = base;
  if (repo) cfg.repo = repo;
  cfg.base = cfg.base.replace(/\/+$/, '');

  const box = loadMailbox(dir);
  if (!box.messages.length) throw new Error(`No emails found in ${box.root}`);
  // Stable, human order: alphabetical by name (the inbox sorts by date, which is noise here).
  const messages = [...box.messages].sort((a, b) => a.slug.localeCompare(b.slug));

  // Fresh output, but keep config.json (the one tracked file in site/).
  for (const f of fs.readdirSync(out)) if (f !== 'config.json') fs.rmSync(path.join(out, f), { recursive: true, force: true });

  let shotFiles = new Set();
  if (shots) {
    const { shoot } = await import('./shoot.mjs');
    const list = await shoot({ dir, out: path.join(out, 'shots'), views: ['desktop', 'mobile'], schemes: ['light', 'dark'], inbox: false, log: () => {} });
    fs.rmSync(path.join(out, 'shots', 'index.html'), { force: true });
    fs.rmSync(path.join(out, 'shots', 'shots.json'), { force: true });
    shotFiles = new Set(list.map((s) => s.file));
    log(`  ✓ ${list.length} thumbnails`);
  }

  // Static assets: the mark, favicon and the inbox screenshots for the hero.
  const assetsOut = path.join(out, 'assets');
  fs.mkdirSync(assetsOut, { recursive: true });
  for (const f of ['logo-mark.svg', 'favicon.png', 'inbox.png', 'inbox-dark.png', 'compare.png', 'huecos.png']) {
    const src = path.join(REPO, 'assets', f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(assetsOut, f));
  }
  const has = (f) => fs.existsSync(path.join(assetsOut, f));

  const templates = messages.map((m) => {
    const variants = m.variants.map((v) => {
      const html = materialize(v.file, { caseName: m.cases?.[0] });
      const findings = lint(html);
      const tag = tagOf(m, v);
      const shot = (view, scheme) => (shotFiles.has(`${tag}--${view}-${scheme}.png`) ? `shots/${tag}--${view}-${scheme}.png` : null);
      return {
        key: v.key, subject: v.subject, from_name: v.from_name, from_email: v.from_email, preheader: v.preheader,
        html, bytes: Buffer.byteLength(html), findings, summary: summarize(findings),
        shots: { desktop: { light: shot('desktop', 'light'), dark: shot('desktop', 'dark') }, mobile: { light: shot('mobile', 'light'), dark: shot('mobile', 'dark') } },
      };
    });
    const group = m.slug.includes('/') ? titleOf(m.slug.split('/').slice(0, -1).join('/')) : '';
    return { slug: m.slug, name: titleOf(m.slug), group, subject: m.subject, from_name: m.from_name, preheader: m.preheader, variants, href: `templates/${m.slug}/` };
  });

  // Per-template files: the source a user copies, plus light/dark renders for the preview iframe.
  for (const t of templates) {
    const tdir = path.join(out, 'templates', t.slug);
    fs.mkdirSync(tdir, { recursive: true });
    for (const v of t.variants) {
      fs.writeFileSync(path.join(tdir, `${v.key}.html`), v.html);
      fs.writeFileSync(path.join(tdir, `${v.key}.light.html`), renderForClient(v.html, { scheme: 'light' }));
      fs.writeFileSync(path.join(tdir, `${v.key}.dark.html`), renderForClient(v.html, { scheme: 'dark' }));
    }
  }

  const stats = { templates: templates.length, rules: Object.keys(RULES).length };
  const ctx = { cfg, stats, templates, has };
  fs.writeFileSync(path.join(out, 'index.html'), indexPage(ctx));
  templates.forEach((t, i) => fs.writeFileSync(path.join(out, 'templates', t.slug, 'index.html'), detailPage(ctx, t, templates[(i - 1 + templates.length) % templates.length], templates[(i + 1) % templates.length])));
  fs.writeFileSync(path.join(out, '404.html'), notFoundPage(ctx));

  const urls = ['/', ...templates.map((t) => `/${t.href}`)];
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(cfg.base + u)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${cfg.base}/sitemap.xml\n`);
  fs.writeFileSync(path.join(out, 'templates.json'), JSON.stringify(templates.map((t) => ({
    slug: t.slug, name: t.name, subject: t.subject, from: t.from_name, preheader: t.preheader, url: `${cfg.base}/${t.href}`,
    variants: t.variants.map((v) => ({ key: v.key, source: `${cfg.base}/${t.href}${v.key}.html`, lint: v.summary })),
  })), null, 2) + '\n');
  log(`  ✓ ${templates.length} template pages · sitemap.xml · robots.txt`);
  return { out, templates, stats, base: cfg.base };
}

// ── shared chrome ──────────────────────────────────────────────────────────────────────────────
const MARK = (fs.existsSync(path.join(REPO, 'assets', 'logo-mark.svg')) ? fs.readFileSync(path.join(REPO, 'assets', 'logo-mark.svg'), 'utf8') : '<svg viewBox="0 0 512 512"><rect x="60" y="110" width="392" height="330" rx="30" fill="#151B3F"/></svg>').replace(/<\?xml[^>]*>/, '').replace(/\swidth="512" height="512"/, '').replace(/id="mg-/g, 'id="mgx-').replace(/url\(#mg-/g, 'url(#mgx-');

const ICON = {
  copy: '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
  sun: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="i" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  gh: '<svg class="i fill" viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 4.9.4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>',
  desktop: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  mobile: '<svg class="i" viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  code: '<svg class="i" viewBox="0 0 24 24"><path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/></svg>',
  eye: '<svg class="i" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  down: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  arrow: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  back: '<svg class="i" viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  ext: '<svg class="i" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

const CSS = `
:root{
  --font:"Geist",ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
  --mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --display:"Instrument Serif","Iowan Old Style","Palatino Linotype",Georgia,serif;
  --bg:#f5f4f0; --panel:#fff; --panel-2:#faf9f7; --sunken:#eeece7;
  --line:rgba(28,25,20,.10); --line-2:rgba(28,25,20,.06); --dot:rgba(28,25,20,.09);
  --ink:#16151a; --ink-2:#55524c; --ink-3:#8b877f; --ink-4:#b4b0a8;
  --hover:rgba(28,25,20,.045);
  --navy:#151B3F; --glow:#E2692D; --glow-2:#FFB45C; --halo:rgba(255,138,61,.22);
  --accent:#3d5afe; --sel:#eef1ff;
  --err:#dc3d43; --warn:#d97706; --ok:#2f9e63; --info:#6e56cf;
  --err-bg:rgba(220,61,67,.08); --warn-bg:rgba(217,119,6,.09); --ok-bg:rgba(47,158,99,.09); --info-bg:rgba(110,86,207,.08);
  --shadow-sm:0 1px 1px rgba(28,25,20,.04),0 1px 3px rgba(28,25,20,.07);
  --shadow:0 1px 2px rgba(28,25,20,.05),0 6px 16px -4px rgba(28,25,20,.08),0 24px 48px -16px rgba(28,25,20,.12);
  --shadow-lg:0 2px 4px rgba(0,0,0,.06),0 16px 40px -8px rgba(0,0,0,.16),0 40px 80px -24px rgba(0,0,0,.2);
  --ease:cubic-bezier(.2,.8,.2,1);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#0d0d0f; --panel:#131316; --panel-2:#18181c; --sunken:#09090a;
  --line:rgba(255,255,255,.085); --line-2:rgba(255,255,255,.05); --dot:rgba(255,255,255,.055);
  --ink:#ededf0; --ink-2:#a9a9b1; --ink-3:#74747c; --ink-4:#4d4d55; --hover:rgba(255,255,255,.05);
  --navy:#e9ebff; --glow:#FF9A55; --glow-2:#FFD08A; --halo:rgba(255,138,61,.16);
  --accent:#7c8cff; --sel:rgba(124,140,255,.12);
  --err:#ff6b70; --warn:#f5b441; --ok:#4cd68f; --info:#a592ff;
  --err-bg:rgba(255,107,112,.10); --warn-bg:rgba(245,180,65,.10); --ok-bg:rgba(76,214,143,.10); --info-bg:rgba(165,146,255,.10);
  --shadow-sm:0 1px 2px rgba(0,0,0,.5); --shadow:0 1px 2px rgba(0,0,0,.5),0 12px 32px -8px rgba(0,0,0,.55); --shadow-lg:0 2px 4px rgba(0,0,0,.4),0 24px 60px -12px rgba(0,0,0,.7);
  color-scheme:dark;
}}
:root[data-theme=dark]{
  --bg:#0d0d0f; --panel:#131316; --panel-2:#18181c; --sunken:#09090a;
  --line:rgba(255,255,255,.085); --line-2:rgba(255,255,255,.05); --dot:rgba(255,255,255,.055);
  --ink:#ededf0; --ink-2:#a9a9b1; --ink-3:#74747c; --ink-4:#4d4d55; --hover:rgba(255,255,255,.05);
  --navy:#e9ebff; --glow:#FF9A55; --glow-2:#FFD08A; --halo:rgba(255,138,61,.16);
  --accent:#7c8cff; --sel:rgba(124,140,255,.12);
  --err:#ff6b70; --warn:#f5b441; --ok:#4cd68f; --info:#a592ff;
  --err-bg:rgba(255,107,112,.10); --warn-bg:rgba(245,180,65,.10); --ok-bg:rgba(76,214,143,.10); --info-bg:rgba(165,146,255,.10);
  --shadow-sm:0 1px 2px rgba(0,0,0,.5); --shadow:0 1px 2px rgba(0,0,0,.5),0 12px 32px -8px rgba(0,0,0,.55); --shadow-lg:0 2px 4px rgba(0,0,0,.4),0 24px 60px -12px rgba(0,0,0,.7);
  color-scheme:dark;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--font);font-feature-settings:"ss01","cv11";-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}
code,kbd,pre{font-family:var(--mono)}
svg.i{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
svg.i.fill{fill:currentColor;stroke:none}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
.mark{--mg-ink:#151B3F;width:28px;height:28px;flex:none;filter:drop-shadow(0 2px 8px rgba(255,138,61,.4))}
.mark svg{display:block;width:100%;height:100%}
:root[data-theme=dark] .mark{--mg-ink:#2E3878}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .mark{--mg-ink:#2E3878}}

/* nav */
.nav{position:sticky;top:0;z-index:20;backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);background:color-mix(in srgb,var(--bg) 78%,transparent);border-bottom:1px solid transparent;transition:border-color .2s}
.nav.stuck{border-bottom-color:var(--line)}
.nav .wrap{display:flex;align-items:center;gap:8px;height:60px}
.logo{display:flex;align-items:center;gap:9px;font:700 19px/1 var(--font);letter-spacing:-.03em;margin-right:auto}
.logo .m{color:var(--navy)} .logo .g{color:var(--glow)}
.nav a.l{padding:7px 11px;border-radius:8px;color:var(--ink-2);font-weight:500;font-size:14px;transition:background .12s,color .12s}
.nav a.l:hover{background:var(--hover);color:var(--ink)}
.ibtn{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:9px;color:var(--ink-2);transition:background .12s,color .12s}
.ibtn:hover{background:var(--hover);color:var(--ink)}
.theme .sun{display:none}
:root[data-theme=dark] .theme .sun{display:block} :root[data-theme=dark] .theme .moon{display:none}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .theme .sun{display:block}:root:not([data-theme=light]) .theme .moon{display:none}}
.gh{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px;border-radius:9px;background:var(--ink);color:var(--bg);font-weight:600;font-size:13.5px;margin-left:4px;transition:transform .12s}
.gh:hover{transform:translateY(-1px)}

/* buttons, pills */
.btn{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:10px;font-weight:600;font-size:14px;border:1px solid var(--line);background:var(--panel);box-shadow:var(--shadow-sm);transition:transform .12s,box-shadow .12s,background .12s}
.btn:hover{transform:translateY(-1px);box-shadow:var(--shadow)}
.btn.primary{background:var(--ink);color:var(--bg);border-color:transparent}
.pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:99px;font:500 12px/1 var(--font);white-space:nowrap}
.pill i{width:6px;height:6px;border-radius:50%;background:currentColor}
.pill.ok{color:var(--ok);background:var(--ok-bg)} .pill.warn{color:var(--warn);background:var(--warn-bg)} .pill.err{color:var(--err);background:var(--err-bg)} .pill.mute{color:var(--ink-2);background:var(--hover)}
.seg{display:inline-flex;padding:3px;gap:2px;border-radius:10px;background:var(--sunken);border:1px solid var(--line-2)}
.seg button{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:8px;font-size:13px;font-weight:500;color:var(--ink-2);transition:background .12s,color .12s,box-shadow .12s}
.seg button:hover{color:var(--ink)}
.seg button[aria-pressed=true]{background:var(--panel);color:var(--ink);box-shadow:var(--shadow-sm)}

/* hero */
.hero{position:relative;padding:72px 0 36px;text-align:center;isolation:isolate}
.hero::before{content:"";position:absolute;inset:-60px 0 auto;height:720px;z-index:-1;background:radial-gradient(520px 300px at 50% 26%,var(--halo),transparent 70%),radial-gradient(var(--dot) 1px,transparent 1.3px) 0 0/22px 22px;-webkit-mask:linear-gradient(#000 40%,transparent);mask:linear-gradient(#000 40%,transparent)}
.hero .big{width:84px;height:84px;margin:0 auto 26px;filter:drop-shadow(0 10px 30px rgba(255,138,61,.55))}
.eyebrow{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 13px 0 7px;border-radius:99px;border:1px solid var(--line);background:var(--panel);box-shadow:var(--shadow-sm);font-size:13px;color:var(--ink-2);margin-bottom:22px}
.eyebrow b{display:inline-grid;place-items:center;height:19px;padding:0 7px;border-radius:99px;background:var(--navy);color:var(--bg);font:600 11px/1 var(--font);letter-spacing:.02em}
h1{font:400 clamp(44px,7.4vw,86px)/.98 var(--display);letter-spacing:-.025em;margin:0 auto;max-width:15ch;text-wrap:balance}
h1 em{font-style:italic;background:linear-gradient(100deg,var(--glow) 10%,var(--glow-2) 90%);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:.06em}
.lede{max-width:600px;margin:22px auto 0;font-size:18px;line-height:1.55;color:var(--ink-2);text-wrap:pretty}
.install{max-width:620px;margin:34px auto 0;text-align:left;border-radius:14px;background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow)}
.install .tabs{display:flex;gap:2px;padding:6px 6px 0;border-bottom:1px solid var(--line-2);overflow-x:auto;scrollbar-width:none}
.install .tabs button{height:36px;padding:0 12px;font-size:13px;font-weight:500;color:var(--ink-3);border-bottom:2px solid transparent;white-space:nowrap}
.install .tabs button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--glow)}
.cmd{display:flex;align-items:center;gap:10px;padding:14px 12px 14px 18px;font:500 14px/1.4 var(--mono)}
.cmd code{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;scrollbar-width:none}
.cmd code::before{content:"$ ";color:var(--ink-4)}
.cmd code.slash::before{content:""}
.cmd .copy{flex:none}
.install .hint{padding:0 18px 14px;font-size:13px;color:var(--ink-3)}
.install .hint code{color:var(--ink-2)}
.ctas{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin-top:22px}
.stats{display:flex;justify-content:center;flex-wrap:wrap;gap:10px 28px;margin:34px auto 0;color:var(--ink-3);font-size:13.5px}
.stats b{font:600 15px/1 var(--mono);color:var(--ink);margin-right:5px;font-variant-numeric:tabular-nums}
.shot{margin:52px auto 0;max-width:1100px;border-radius:16px;overflow:hidden;border:1px solid var(--line);box-shadow:var(--shadow-lg);background:var(--panel)}
.shot .bar{display:flex;align-items:center;gap:7px;height:34px;padding:0 14px;border-bottom:1px solid var(--line-2);background:var(--panel-2)}
.shot .bar i{width:10px;height:10px;border-radius:50%;background:var(--line)}
.shot .bar span{margin:0 auto;font:12px/1 var(--mono);color:var(--ink-3);padding-right:44px}
.shot img{display:block;width:100%;height:auto}
.shot .dk{display:none}
:root[data-theme=dark] .shot .lt{display:none} :root[data-theme=dark] .shot .dk{display:block}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .shot .lt{display:none}:root:not([data-theme=light]) .shot .dk{display:block}}

/* sections */
section.s{padding:96px 0 0}
.sh{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:28px}
.kicker{font:600 11.5px/1 var(--font);letter-spacing:.1em;text-transform:uppercase;color:var(--glow);margin-bottom:12px}
h2{font:400 clamp(34px,4.6vw,50px)/1.02 var(--display);letter-spacing:-.02em;margin:0;text-wrap:balance}
h2 em{font-style:italic}
.sub{color:var(--ink-2);margin:10px 0 0;max-width:560px}

/* gallery */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:22px}
.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid.two .stage{aspect-ratio:16/10}
.card{display:flex;flex-direction:column;border-radius:16px;background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow-sm);overflow:hidden;transition:transform .25s var(--ease),box-shadow .25s var(--ease),border-color .25s}
.card:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg);border-color:var(--line)}
.stage{position:relative;aspect-ratio:4/3.1;overflow:hidden;background:var(--sunken) radial-gradient(var(--dot) 1px,transparent 1.3px) 0 0/16px 16px;border-bottom:1px solid var(--line-2)}
.stage .desk{position:absolute;left:9%;top:9%;width:72%;height:100%;border-radius:10px 10px 0 0;overflow:hidden;box-shadow:var(--shadow);background:#fff;transition:transform .4s var(--ease)}
.stage .phone{position:absolute;right:6%;bottom:-14%;width:26%;aspect-ratio:9/18.5;border-radius:18px;padding:4px;background:#111;box-shadow:var(--shadow-lg);transition:transform .4s var(--ease)}
.stage .phone .scr{width:100%;height:100%;border-radius:14px;overflow:hidden;background:#fff}
.card:hover .desk{transform:translateY(-6px)} .card:hover .phone{transform:translateY(-10px) rotate(-1.5deg)}
.stage img{display:block;width:100%;height:auto}
.stage .dk{display:none}
[data-mail=dark] .stage .lt{display:none} [data-mail=dark] .stage .dk{display:block}
[data-mail=dark] .stage .desk,[data-mail=dark] .stage .phone .scr{background:#111}
.stage iframe{border:0;width:800px;height:1400px;transform-origin:0 0;pointer-events:none;background:#fff}
.stage .phone iframe{width:390px}
.meta{padding:16px 18px 18px;display:flex;flex-direction:column;gap:6px}
.meta .row{display:flex;align-items:center;gap:8px}
.meta h3{margin:0;font:600 16px/1.25 var(--font);letter-spacing:-.01em}
.meta .grp{font:500 11px/1 var(--mono);color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em}
.meta .subj{color:var(--ink-2);font-size:14px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meta .from{font-size:12.5px;color:var(--ink-3)}
.meta .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.meta .go{margin-left:auto;color:var(--ink-3);transition:transform .2s var(--ease),color .2s}
.card:hover .go{transform:translateX(3px);color:var(--glow)}

/* features */
.feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.feat{background:var(--panel);padding:24px 22px}
.feat .n{font:500 12px/1 var(--mono);color:var(--glow);margin-bottom:14px}
.feat h3{margin:0 0 6px;font:600 16px/1.3 var(--font)}
.feat p{margin:0;color:var(--ink-2);font-size:14px}
.pics{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px}
.pics figure{margin:0;border-radius:14px;overflow:hidden;border:1px solid var(--line);box-shadow:var(--shadow);background:var(--panel)}
.pics img{display:block;width:100%;height:auto}
.pics figcaption{padding:10px 14px;font-size:13px;color:var(--ink-3);border-top:1px solid var(--line-2)}
.flow{margin:0;padding:22px;border-radius:14px;background:var(--panel);border:1px solid var(--line);font:13px/1.7 var(--mono);color:var(--ink-2);overflow-x:auto}
.flow b{color:var(--glow);font-weight:500}

/* cta + footer */
.end{margin:110px 0 0;padding:64px 24px;border-radius:24px;text-align:center;position:relative;overflow:hidden;background:#11152f;color:#eef0ff;isolation:isolate}
.end::before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(420px 260px at 50% 110%,rgba(255,150,70,.55),transparent 70%),radial-gradient(rgba(255,255,255,.06) 1px,transparent 1.3px) 0 0/22px 22px}
.end h2{color:#fff} .end h2 em{color:#FFC06E}
.end p{color:#b9bddb;margin:12px auto 26px;max-width:520px}
.end .cmd{max-width:520px;margin:0 auto;border-radius:12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#fff;text-align:left}
.end .cmd code::before{color:rgba(255,255,255,.35)}
.end .ibtn{color:#cfd3f1} .end .ibtn:hover{background:rgba(255,255,255,.08);color:#fff}
footer{padding:40px 0 48px;color:var(--ink-3);font-size:13px}
footer .wrap{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
footer a:hover{color:var(--ink)}
footer .sp{margin-left:auto}

/* detail */
.crumbs{display:flex;align-items:center;gap:8px;padding:26px 0 0;font-size:13.5px;color:var(--ink-3)}
.crumbs a:hover{color:var(--ink)}
.dhead{display:flex;gap:28px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;padding:14px 0 22px}
.dhead h1{font-size:clamp(40px,5.6vw,64px);max-width:none;margin:0}
.dhead .subj{margin:10px 0 0;font-size:16.5px;color:var(--ink-2);max-width:640px}
.dhead .from{margin-top:6px;font-size:13.5px;color:var(--ink-3)}
.dhead .acts{display:flex;gap:8px;flex-wrap:wrap}
.tool{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px;border-radius:14px 14px 0 0;background:var(--panel);border:1px solid var(--line);border-bottom:0}
.tool .sp{flex:1}
.tool .size{font:500 12px/1 var(--mono);color:var(--ink-3)}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:22px;align-items:start}
.layout>*{min-width:0}
.canvas{min-height:620px;display:flex;justify-content:center;align-items:flex-start;padding:36px 20px;border:1px solid var(--line);border-radius:0 0 14px 14px;background:var(--sunken) radial-gradient(var(--dot) 1px,transparent 1.3px) 0 0/18px 18px}
.frame{width:min(100%,720px);border-radius:10px;overflow:hidden;box-shadow:var(--shadow-lg);background:#fff;transition:width .35s var(--ease)}
.frame iframe{display:block;width:100%;height:900px;border:0;background:#fff}
.canvas.dark .frame,.canvas.dark .frame iframe{background:#111}
.canvas.mobile .frame{width:406px;max-width:100%;border-radius:44px;padding:8px;background:#0f0f12;box-shadow:var(--shadow-lg),inset 0 0 0 1.5px #2a2a30}
.canvas.mobile .frame iframe{border-radius:36px;height:780px}
.canvas pre{display:none;margin:0;width:100%;max-height:900px;overflow:auto;padding:18px 20px;border-radius:10px;background:var(--panel);border:1px solid var(--line);font-size:12.5px;line-height:1.6;color:var(--ink-2);white-space:pre-wrap;word-break:break-all;tab-size:2}
.canvas.source .frame{display:none} .canvas.source pre{display:block}
.side{display:flex;flex-direction:column;gap:14px;position:sticky;top:76px}
.box{border-radius:14px;background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow-sm);padding:16px 18px}
.box h4{margin:0 0 10px;font:600 11px/1 var(--font);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.box p{margin:0;font-size:13.5px;color:var(--ink-2)}
.lintsum{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.lintsum .big{font:600 15px/1.2 var(--font)}
.lintsum .ok{color:var(--ok)} .lintsum .bad{color:var(--err)} .lintsum .w{color:var(--warn)}
.counts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}
.counts div{padding:8px 10px;border-radius:9px;background:var(--panel-2);border:1px solid var(--line-2);font-size:11.5px;color:var(--ink-3)}
.counts b{display:block;font:600 17px/1.2 var(--mono);color:var(--ink)}
.finds{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto}
.finds li{font-size:12.5px;color:var(--ink-2);line-height:1.45;padding-left:14px;position:relative}
.finds li::before{content:"";position:absolute;left:0;top:6px;width:6px;height:6px;border-radius:50%;background:var(--info)}
.finds li.warn::before{background:var(--warn)} .finds li.error::before{background:var(--err)}
.finds code{font-size:11.5px;color:var(--ink)}
.box .cmd code{white-space:normal;word-break:break-all}
.box .cmd{padding:10px 8px 10px 12px;margin:10px 0 0;border-radius:10px;background:var(--panel-2);border:1px solid var(--line-2);font-size:12.5px}
.box ol{margin:0;padding-left:18px;font-size:13.5px;color:var(--ink-2)} .box ol li{margin:6px 0}
.box ol code{font-size:12px;color:var(--ink)}
.pn{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:26px 0 0}
.pn a{display:flex;flex-direction:column;gap:4px;padding:16px 18px;border-radius:14px;background:var(--panel);border:1px solid var(--line);transition:box-shadow .2s,transform .2s}
.pn a:hover{box-shadow:var(--shadow);transform:translateY(-1px)}
.pn span{font-size:12px;color:var(--ink-3)} .pn b{font-weight:600}
.pn a:last-child{text-align:right}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);opacity:0;padding:10px 16px;border-radius:10px;background:var(--ink);color:var(--bg);font-size:13.5px;font-weight:500;box-shadow:var(--shadow-lg);transition:all .25s var(--ease);pointer-events:none;z-index:50}
.toast.on{opacity:1;transform:translate(-50%,0)}

@media (max-width:900px){
  .layout{grid-template-columns:1fr} .side{position:static}
  .pics{grid-template-columns:1fr}
}
@media (max-width:640px){
  .wrap{padding:0 16px}
  .nav a.l{display:none}
  .hero{padding:44px 0 20px}
  .hero .big{width:64px;height:64px;margin-bottom:20px}
  .lede{font-size:16.5px}
  .install .tabs button{padding:0 8px;font-size:12.5px}
  .cmd{font-size:12.5px;padding:12px 8px 12px 14px}
  section.s{padding-top:68px}
  .grid,.grid.two{grid-template-columns:1fr}
  .shot{margin-top:36px;border-radius:12px}
  .shot .bar{display:none}
  .end{margin-top:80px;padding:48px 18px;border-radius:18px}
  .canvas{padding:18px 10px;min-height:0}
  .canvas.mobile .frame{border-radius:36px;padding:6px} .canvas.mobile .frame iframe{border-radius:30px}
  .frame iframe{height:720px}
  .tool{gap:6px;padding:8px} .tool .size,.tool .sp,.tool .seg.views{display:none} .tool .seg button{padding:0 9px}
  .dhead .acts{width:100%} .dhead .acts .btn{flex:1;justify-content:center}
  .pn{grid-template-columns:1fr} .pn a:last-child{text-align:left}
  footer .sp{margin-left:0;width:100%}
}
`;

const JS_THEME = `(function(){try{var t=localStorage.getItem('mg-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}})();`;
const JS_COMMON = `
var root=document.documentElement;
function dark(){return root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches}
document.querySelectorAll('[data-toggle-theme]').forEach(function(b){b.addEventListener('click',function(){var t=dark()?'light':'dark';root.dataset.theme=t;try{localStorage.setItem('mg-theme',t)}catch(e){};document.dispatchEvent(new Event('mg-theme'))})});
var nav=document.querySelector('.nav');addEventListener('scroll',function(){nav.classList.toggle('stuck',scrollY>8)},{passive:true});
var toastEl=document.querySelector('.toast'),tt;function toast(m){toastEl.textContent=m;toastEl.classList.add('on');clearTimeout(tt);tt=setTimeout(function(){toastEl.classList.remove('on')},1600)}
function copy(text,msg){(navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(text):Promise.reject()).catch(function(){var a=document.createElement('textarea');a.value=text;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy')}catch(e){}a.remove()}).finally(function(){toast(msg||'Copied')})}
document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){var el=b.closest('.cmd').querySelector('code');copy(el.textContent,'Copied to clipboard')})});
`;

function head(ctx, { title, description, urlPath, image, type = 'website' }) {
  const { cfg } = ctx;
  const url = cfg.base + urlPath;
  const img = image ? (/^https?:/.test(image) ? image : `${cfg.base}/${image}`) : null;
  const up = urlPath === '/' ? '' : '../'.repeat(urlPath.split('/').filter(Boolean).length);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="mailglow">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
${img ? `<meta property="og:image" content="${esc(img)}">\n<meta name="twitter:image" content="${esc(img)}">\n` : ''}<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="theme-color" content="#f5f4f0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d0d0f" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${up}assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap">
<script>${JS_THEME}</script>
<style>${CSS}</style>
</head>`;
}

function navBar(ctx, up) {
  return `<header class="nav"><div class="wrap">
  <a class="logo" href="${up || './'}" aria-label="mailglow home"><span class="mark">${MARK}</span><span><span class="m">mail</span><span class="g">glow</span></span></a>
  <a class="l" href="${up}#templates">Templates</a>
  <a class="l" href="${up}#install">Install</a>
  <a class="l" href="https://github.com/${esc(ctx.cfg.repo)}#readme">Docs</a>
  <button class="ibtn theme" data-toggle-theme aria-label="Toggle light/dark">${ICON.moon.replace('class="i"', 'class="i moon"')}${ICON.sun.replace('class="i"', 'class="i sun"')}</button>
  <a class="gh" href="https://github.com/${esc(ctx.cfg.repo)}">${ICON.gh}<span>Star</span></a>
</div></header>`;
}

function footerBar(ctx, up) {
  return `<footer><div class="wrap">
  <a class="logo" href="${up || './'}" style="font-size:15px;margin:0"><span class="mark" style="width:20px;height:20px">${MARK}</span><span><span class="m">mail</span><span class="g">glow</span></span></a>
  <span>MIT · zero dependencies · made by <a href="https://cofoundy.dev">Cofoundy</a></span>
  <span class="sp"></span>
  <a href="https://github.com/${esc(ctx.cfg.repo)}">GitHub</a>
  <a href="https://github.com/${esc(ctx.cfg.repo)}/blob/main/CONTRIBUTING.md#add-a-template">Add a template</a>
  <a href="${up}sitemap.xml">Sitemap</a>
</div></footer><div class="toast" role="status" aria-live="polite"></div>`;
}

const copyBtn = `<button class="ibtn copy" data-copy aria-label="Copy command">${ICON.copy}</button>`;
const lintPill = (s) => (s.error ? `<span class="pill err"><i></i>${s.error} error${s.error > 1 ? 's' : ''}</span>` : s.warn ? `<span class="pill warn"><i></i>${s.warn} warning${s.warn > 1 ? 's' : ''}</span>` : '<span class="pill ok"><i></i>Client-safe</span>');

function thumb(t, up = '', eager = false) {
  const lazy = eager ? '' : ' loading="lazy"';
  const v = t.variants[0];
  const img = (view) => {
    const { light, dark } = v.shots[view];
    if (!light) return `<iframe src="${up}${t.href}${v.key}.light.html" loading="lazy" tabindex="-1" aria-hidden="true" scrolling="no" title=""></iframe>`;
    return `<img class="lt" src="${up}${light}" alt=""${lazy}><img class="dk" src="${up}${dark || light}" alt=""${lazy}>`;
  };
  return `<div class="stage"><div class="desk">${img('desktop')}</div><div class="phone"><div class="scr">${img('mobile')}</div></div></div>`;
}

// ── index ──────────────────────────────────────────────────────────────────────────────────────
function indexPage(ctx) {
  const { cfg, stats, templates, has } = ctx;
  const repoUrl = `https://github.com/${cfg.repo}`;
  const cards = templates.map((t, i) => {
    const v = t.variants[0];
    const worst = t.variants.reduce((a, x) => ({ error: a.error + x.summary.error, warn: a.warn + x.summary.warn }), { error: 0, warn: 0 });
    return `<a class="card" href="${esc(t.href)}">
  ${thumb(t, '', i < 6)}
  <div class="meta">
    ${t.group ? `<span class="grp">${esc(t.group)}</span>` : ''}
    <div class="row"><h3>${esc(t.name)}</h3><span class="go">${ICON.arrow}</span></div>
    <div class="subj">${esc(v.subject)}</div>
    <div class="from">from ${esc(v.from_name)}</div>
    <div class="tags">${lintPill(worst)}<span class="pill mute">Light · Dark · Mobile</span>${t.variants.length > 1 ? `<span class="pill mute">${t.variants.length} variants</span>` : ''}</div>
  </div>
</a>`;
  }).join('\n');

  const tabs = [
    ['skill', 'Agent skill', `npx skills add ${cfg.repo}`, 'Claude Code, Codex, Cursor, Gemini CLI, Copilot and <b>70+</b> agents. Then ask: <code>design a welcome email for our app</code>.'],
    ['init', 'Init project', `npx github:${cfg.repo} init`, 'Copies the skill into <code>.claude/skills</code>, <code>.agents/skills</code>… for the agents it finds. <code>--agents claude,codex,cursor,gemini</code> to choose.'],
    ['plugin', 'Claude plugin', `/plugin marketplace add ${cfg.repo}`, 'Then <code>/plugin install mailglow@mailglow</code>.'],
    ['inbox', 'Inbox only', `npx github:${cfg.repo} serve ./emails --open`, 'One Node script, zero dependencies (Node 22+).'],
  ];
  const title = 'mailglow — vibe-code beautiful, responsive HTML emails';
  const description = `An open-source agent skill and local inbox for designing HTML emails: ${stats.templates} free responsive templates, a ${stats.rules}-rule linter for Gmail, Outlook and Apple Mail, light/dark/mobile previews and screenshots. Zero dependencies.`;
  return `${head(ctx, { title, description, urlPath: '/', image: has('inbox.png') ? 'assets/inbox.png' : null })}
<body data-mail="light">
${navBar(ctx, '')}
<main>
<div class="hero"><div class="wrap">
  <div class="mark big">${MARK}</div>
  <a class="eyebrow" href="${repoUrl}"><b>OSS</b>An agent skill + a local inbox · MIT</a>
  <h1>Vibe-code <em>beautiful,</em> responsive emails</h1>
  <p class="lede">Describe the email. Your agent designs three, you pick one in a real inbox, and it ships the one that works in Gmail, Outlook and Apple Mail — light, dark and mobile.</p>
  <div class="install" id="install" role="tablist">
    <div class="tabs">${tabs.map(([id, label], i) => `<button role="tab" data-tab="${id}" aria-selected="${i === 0}">${label}</button>`).join('')}</div>
    ${tabs.map(([id, , cmd, hint], i) => `<div data-panel="${id}"${i ? ' hidden' : ''}><div class="cmd"><code${cmd.startsWith('/') ? ' class="slash"' : ''}>${esc(cmd)}</code>${copyBtn}</div><div class="hint">${hint}</div></div>`).join('')}
  </div>
  <div class="ctas"><a class="btn primary" href="#templates">Browse templates ${ICON.arrow}</a><a class="btn" href="${repoUrl}">${ICON.gh} View on GitHub</a></div>
  <div class="stats"><span><b>${stats.templates}</b>templates</span><span><b>${stats.rules}</b>lint rules</span><span><b>3</b>schemes: light · dark · forced</span><span><b>0</b>dependencies</span></div>
  ${has('inbox.png') ? `<div class="shot"><div class="bar"><i></i><i></i><i></i><span>localhost:4555</span></div><img class="lt" src="assets/inbox.png" alt="The mailglow inbox: the message list, the opened email and the variant cards with Pick buttons" width="1760" height="1100">${has('inbox-dark.png') ? '<img class="dk" src="assets/inbox-dark.png" alt="" width="1760" height="1100">' : ''}</div>` : ''}
</div></div>

<section class="s" id="templates"><div class="wrap">
  <div class="sh">
    <div><div class="kicker">Gallery</div><h2>Templates that <em>survive</em> the inbox</h2>
    <p class="sub">Every one lints with zero errors and zero warnings, uses hosted images only, and was looked at in light, dark and on a phone. Open one to preview it live and copy the HTML.</p></div>
    <div class="seg" role="group" aria-label="Email color scheme"><button data-mail-set="light" aria-pressed="true">${ICON.sun} Light</button><button data-mail-set="dark" aria-pressed="false">${ICON.moon} Dark</button></div>
  </div>
  <div class="grid${templates.length <= 4 && templates.length % 2 === 0 ? ' two' : ''}">${cards}</div>
</div></section>

<section class="s"><div class="wrap">
  <div class="sh"><div><div class="kicker">How it works</div><h2>Design emails the way you <em>design screens</em></h2></div></div>
  <div class="feats">
    <div class="feat"><div class="n">01 — inbox</div><h3>A local mini inbox</h3><p>Your emails as messages, the opened one next to them. Desktop or phone, light, dark or forced dark, images on or blocked. Live reload.</p></div>
    <div class="feat"><div class="n">02 — variants</div><h3>Pick, don't describe</h3><p>The agent writes three structurally different versions. Flip with ← →, compare side by side, press Pick, leave a note. It reads your pick back.</p></div>
    <div class="feat"><div class="n">03 — lint</div><h3>A linter that knows clients</h3><p>${stats.rules} rules: local images, localhost links, flexbox, CSS variables, Gmail's 102 KB clip, missing dark mode — each names the clients it breaks.</p></div>
    <div class="feat"><div class="n">04 — proof</div><h3>Screenshots of everything</h3><p>Every email × desktop/mobile × light/dark as PNGs plus a contact sheet, from one command. For PRs, client reviews, or an audit of what you already send.</p></div>
  </div>
  ${has('compare.png') ? `<div class="pics"><figure><img src="assets/compare.png" alt="Compare mode: three variants side by side, each with its lint status and a Pick button" width="1760" height="1100"><figcaption>Compare mode — three variants, one Pick.</figcaption></figure>${has('huecos.png') ? '<figure><img src="assets/huecos.png" alt="Huecos mode: every field outlined by where its data comes from" width="1760" height="1100"><figcaption>Huecos — every field outlined by where its data comes from.</figcaption></figure>' : ''}</div>` : ''}
</div></section>

<section class="s"><div class="wrap">
  <div class="end">
    <h2>Stop designing email <em>blind</em></h2>
    <p>Install the skill, then ask your agent for the email you need. It opens the inbox for you.</p>
    <div class="cmd"><code>npx skills add ${esc(cfg.repo)}</code>${copyBtn}</div>
  </div>
</div></section>
</main>
${footerBar(ctx, '')}
<script>${JS_COMMON}
document.querySelectorAll('[data-tab]').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('[data-tab]').forEach(function(x){x.setAttribute('aria-selected',x===b)});document.querySelectorAll('[data-panel]').forEach(function(p){p.hidden=p.dataset.panel!==b.dataset.tab})})});
var userMail=null;function setMail(s){document.body.dataset.mail=s;document.querySelectorAll('[data-mail-set]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.mailSet===s)})}
setMail(dark()?'dark':'light');
document.addEventListener('mg-theme',function(){if(!userMail)setMail(dark()?'dark':'light')});
document.querySelectorAll('[data-mail-set]').forEach(function(b){b.addEventListener('click',function(){userMail=b.dataset.mailSet;setMail(userMail)})});
function fit(){document.querySelectorAll('.stage iframe').forEach(function(f){var w=f.parentElement.clientWidth;f.style.transform='scale('+(w/f.offsetWidth)+')'})}
fit();addEventListener('resize',fit);
</script>
</body>
</html>`;
}

// ── detail ─────────────────────────────────────────────────────────────────────────────────────
function detailPage(ctx, t, prev, next) {
  const { cfg } = ctx;
  const up = '../'.repeat(t.slug.split('/').length + 1);
  const v0 = t.variants[0];
  const title = `${t.name} — responsive HTML email template`;
  const description = `${t.name} email template: “${v0.subject}”. ${v0.preheader ? v0.preheader.replace(/\s+/g, ' ').slice(0, 110) + ' ' : ''}Free, MIT, tested in Gmail, Outlook and Apple Mail — light, dark and mobile.`;
  const data = t.variants.map((v) => ({ key: v.key, subject: v.subject, from: v.from_email ? `${v.from_name} <${v.from_email}>` : v.from_name, preheader: v.preheader, bytes: v.bytes, summary: v.summary, findings: v.findings.map(({ rule, severity, message, line }) => ({ rule, severity, message, line })), html: v.html }));
  return `${head(ctx, { title, description: description.slice(0, 300), urlPath: `/${t.href}`, image: v0.shots.desktop.light, type: 'article' })}
<body>
${navBar(ctx, up)}
<main class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="${up}#templates">Templates</a><span>/</span><span>${esc(t.group ? `${t.group} / ` : '')}${esc(t.name)}</span></nav>
  <div class="dhead">
    <div>
      <h1>${esc(t.name)}</h1>
      <p class="subj" id="subj">${esc(v0.subject)}</p>
      <div class="from" id="from">from ${esc(v0.from_name)}${v0.from_email ? ` &lt;${esc(v0.from_email)}&gt;` : ''}</div>
    </div>
    <div class="acts">
      <button class="btn primary" id="copyhtml">${ICON.copy} Copy HTML</button>
      <a class="btn" id="dl" href="${esc(v0.key)}.html" download="${esc(t.slug.replaceAll('/', '-'))}.html">${ICON.down} Download</a>
    </div>
  </div>
  <div class="layout">
    <div>
      <div class="tool">
        <div class="seg views" role="group" aria-label="Width"><button data-view="desktop" aria-pressed="true">${ICON.desktop} Desktop</button><button data-view="mobile" aria-pressed="false">${ICON.mobile} Mobile</button></div>
        <div class="seg" role="group" aria-label="Color scheme"><button data-scheme="light" aria-pressed="true">${ICON.sun} Light</button><button data-scheme="dark" aria-pressed="false">${ICON.moon} Dark</button></div>
        ${t.variants.length > 1 ? `<div class="seg" role="group" aria-label="Variant">${t.variants.map((v, i) => `<button data-variant="${esc(v.key)}" aria-pressed="${i === 0}">${esc(v.key.toUpperCase())}</button>`).join('')}</div>` : ''}
        <span class="sp"></span>
        <span class="size" id="size"></span>
        <div class="seg" role="group" aria-label="Preview or source"><button data-mode="preview" aria-pressed="true">${ICON.eye} Preview</button><button data-mode="source" aria-pressed="false">${ICON.code} HTML</button></div>
      </div>
      <div class="canvas" id="canvas">
        <div class="frame"><iframe id="frame" title="${esc(t.name)} email preview" sandbox="allow-same-origin allow-popups" src="${esc(v0.key)}.light.html"></iframe></div>
        <pre id="src"></pre>
      </div>
      <div class="pn">
        <a href="${up}${esc(prev.href)}"><span>← Previous</span><b>${esc(prev.name)}</b></a>
        <a href="${up}${esc(next.href)}"><span>Next →</span><b>${esc(next.name)}</b></a>
      </div>
    </div>
    <aside class="side">
      <div class="box" id="lint"></div>
      <div class="box">
        <h4>Make it yours</h4>
        <ol>
          <li>Install the skill: <div class="cmd"><code>npx github:${esc(cfg.repo)} init</code>${copyBtn}</div></li>
          <li>Ask your agent: <em>“adapt the ${esc(t.name.toLowerCase())} template to our brand and data”</em>.</li>
          <li>Pick in the inbox, then <code>mailglow lint</code> and <code>shoot</code> before you ship.</li>
        </ol>
      </div>
      <div class="box"><h4>Preheader</h4><p id="pre">${esc(v0.preheader)}</p></div>
    </aside>
  </div>
</main>
${footerBar(ctx, up)}
<script type="application/json" id="data">${json(data)}</script>
<script>${JS_COMMON}
var D=JSON.parse(document.getElementById('data').textContent),st={v:D[0].key,view:'desktop',scheme:dark()?'dark':'light',mode:'preview'},userScheme=false;
var frame=document.getElementById('frame'),canvas=document.getElementById('canvas');
function cur(){return D.find(function(x){return x.key===st.v})}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function lintBox(x){var s=x.summary,ok=!s.error&&!s.warn;var h='<h4>Client check</h4><div class="lintsum"><span class="pill '+(s.error?'err':s.warn?'warn':'ok')+'"><i></i>'+(s.error?'Breaks in some clients':s.warn?'Needs attention':'Client-safe')+'</span></div>'+
'<div class="counts"><div><b>'+s.error+'</b>errors</div><div><b>'+s.warn+'</b>warnings</div><div><b>'+(x.bytes/1024).toFixed(1)+'</b>KB</div></div>';
var f=x.findings;h+=f.length?'<ul class="finds">'+f.map(function(y){return '<li class="'+y.severity+'"><code>'+esc(y.rule)+'</code> — '+esc(y.message)+'</li>'}).join('')+'</ul>':'<p>No findings, not even best-practice notes.</p>';
h+='<p style="margin-top:12px;font-size:12px;color:var(--ink-3)">'+(ok?'Zero errors and zero warnings from the '+${ctx.stats.rules}+'-rule mailglow linter.':'')+' Gmail clips at 102 KB.</p>';document.getElementById('lint').innerHTML=h}
function fitH(){try{var d=frame.contentDocument;if(!d||!d.documentElement)return;var h=Math.max(d.documentElement.scrollHeight,d.body?d.body.scrollHeight:0);if(h>50)frame.style.height=h+'px'}catch(e){}}
frame.addEventListener('load',function(){frame.style.height='';fitH();setTimeout(fitH,400)});
function render(){var x=cur();var src=st.v+'.'+st.scheme+'.html';if(frame.getAttribute('src')!==src)frame.setAttribute('src',src);
canvas.className='canvas '+st.view+(st.scheme==='dark'?' dark':'')+(st.mode==='source'?' source':'');
document.querySelectorAll('[data-view]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.view===st.view)});
document.querySelectorAll('[data-scheme]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.scheme===st.scheme)});
document.querySelectorAll('[data-variant]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.variant===st.v)});
document.querySelectorAll('[data-mode]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.mode===st.mode)});
document.getElementById('size').textContent=(st.view==='mobile'?'390':'720')+' px · '+st.scheme;
document.getElementById('subj').textContent=x.subject;document.getElementById('from').textContent='from '+x.from;document.getElementById('pre').textContent=x.preheader||'—';
document.getElementById('src').textContent=x.html;var dl=document.getElementById('dl');dl.href=x.key+'.html';
lintBox(x);setTimeout(fitH,60)}
document.querySelectorAll('[data-view]').forEach(function(b){b.onclick=function(){st.view=b.dataset.view;render()}});
document.querySelectorAll('[data-scheme]').forEach(function(b){b.onclick=function(){st.scheme=b.dataset.scheme;userScheme=true;render()}});
document.querySelectorAll('[data-variant]').forEach(function(b){b.onclick=function(){st.v=b.dataset.variant;render()}});
document.querySelectorAll('[data-mode]').forEach(function(b){b.onclick=function(){st.mode=b.dataset.mode;render()}});
document.addEventListener('mg-theme',function(){if(!userScheme){st.scheme=dark()?'dark':'light';render()}});
document.getElementById('copyhtml').onclick=function(){copy(cur().html,'HTML copied — '+(cur().bytes/1024).toFixed(1)+' KB')};
if(matchMedia('(max-width: 640px)').matches)st.view='mobile';
render();
</script>
</body>
</html>`;
}

function notFoundPage(ctx) {
  return `${head(ctx, { title: 'Not found — mailglow', description: 'This page does not exist.', urlPath: '/404.html' })}
<body>${navBar(ctx, '/')}<main class="wrap" style="text-align:center;padding:120px 0"><h1>Lost in the <em>spam folder</em></h1><p class="lede">This page does not exist. The templates do.</p><div class="ctas"><a class="btn primary" href="/#templates">Browse templates ${ICON.arrow}</a></div></main>${footerBar(ctx, '/')}<script>${JS_COMMON}</script></body></html>`;
}
