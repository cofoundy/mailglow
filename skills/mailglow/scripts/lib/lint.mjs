// Email-client compatibility linter. Static, dependency-free, deliberately conservative:
// every rule names the clients it protects so a finding can be judged, not just obeyed.
//
// Severity: error = will visibly break for real recipients · warn = breaks in a major client family
//           info  = best practice / accessibility / dark-mode readiness
import { hiddenPreheader } from './mailbox.mjs';

const GMAIL_CLIP_BYTES = 102 * 1024;

export const RULES = {
  'img-local-src': ['error', 'Image points at a local/relative path. Recipients cannot load it — publish the file (CDN, S3/R2, GitHub raw) and use an absolute https:// URL.'],
  'img-data-uri': ['error', 'data: URI image. Gmail and Outlook strip them. Host the image and use an https:// URL.'],
  'img-localhost': ['error', 'Image URL points at localhost / a private host. Only you can see it.'],
  'img-http': ['warn', 'Image served over plain http://. Some clients block or proxy-fail mixed content; use https://.'],
  'img-cid': ['info', 'cid: image — only renders if your sender attaches it inline. Previews here cannot show it.'],
  'img-alt': ['warn', 'Image without alt text. Many clients block images by default; alt is what the reader sees.'],
  'img-width': ['info', 'Image without a width attribute. Outlook desktop renders it at intrinsic size, ignoring CSS.'],
  'link-relative': ['error', 'Relative link. There is no "current site" inside an inbox — use an absolute URL.'],
  'link-localhost': ['error', 'Link points at localhost / a private host. It works on your machine and nowhere else — set the public base URL.'],
  'link-js': ['error', 'javascript: link. Every client strips it.'],
  'link-http': ['warn', 'Plain http:// link. Prefer https:// (spam filters and browsers flag it).'],
  'link-empty': ['warn', 'Link with href="#" or empty href — a dead CTA.'],
  'css-bg-local': ['error', 'CSS url() points at a local/relative asset. Use an absolute https:// URL.'],
  'script': ['error', '<script> tag. Every email client strips JavaScript.'],
  'embed': ['error', '<iframe>/<object>/<embed> — stripped by every major client.'],
  'media': ['warn', '<video>/<audio> only play in Apple Mail. Use a linked poster image instead.'],
  'form': ['warn', 'Forms are unsupported or disabled in Gmail app, Outlook and most webmail. Link to a page instead.'],
  'svg': ['warn', 'Inline <svg> is stripped by Gmail and Outlook. Use a hosted PNG.'],
  'link-stylesheet': ['warn', '<link rel="stylesheet"> is ignored by Gmail and Outlook. Put CSS in <style> and inline the critical rules.'],
  'css-import': ['warn', '@import is ignored by most clients (Gmail, Outlook). Web fonts need a system-font fallback stack.'],
  'css-flex-grid': ['warn', 'display:flex/grid — Outlook desktop (Word engine) and several webmail ignore it. Lay out with tables.'],
  'css-position': ['warn', 'position:absolute/fixed is stripped by Gmail and Outlook.'],
  'css-var': ['warn', 'CSS custom properties (var(--x)) are unsupported in Gmail and Outlook. Use literal values.'],
  'css-bg-image': ['info', 'CSS background-image: no support in Outlook desktop without VML, and Gmail drops it on some accounts. Always set a background-color fallback.'],
  'inline-ratio': ['warn', 'Styling depends on <style>/classes. Gmail with non-Google accounts, some Outlook.com and Yahoo variants strip or limit <head> styles — inline the critical CSS.'],
  'size-clip': ['error', 'HTML is over 102 KB: Gmail clips the message behind "[Message clipped] View entire message".'],
  'size-near-clip': ['warn', 'HTML is over 90 KB — close to Gmail\'s 102 KB clipping limit.'],
  'no-doctype': ['warn', 'No <!DOCTYPE html>. Clients fall into quirks mode and spacing drifts.'],
  'no-viewport': ['warn', 'No <meta name="viewport">. Mobile clients zoom out and render the desktop layout tiny.'],
  'no-preheader': ['warn', 'No preheader. The inbox shows whatever text comes first (often "View in browser" or alt text).'],
  'fragment': ['warn', 'HTML fragment (no <html>/<body>). Clients wrap it with their own defaults — you do not control background, width or fonts.'],
  'no-lang': ['info', 'No lang attribute on <html>. Screen readers guess the language.'],
  'no-title': ['info', 'No <title>. Some clients and the "view in browser" tab show it.'],
  'no-color-scheme': ['info', 'No color-scheme meta / prefers-color-scheme styles. Dark-mode clients will invert your colors on their own terms.'],
  'table-role': ['info', 'Layout table without role="presentation". Screen readers announce rows and columns.'],
  'wide-layout': ['warn', 'Fixed width over 700px. Desktop reading panes are ~600–700px wide; the email will scroll sideways.'],
};

export function lint(html) {
  const out = [];
  const lineOf = (idx) => html.slice(0, idx).split('\n').length;
  const add = (rule, idx, excerpt) => {
    const [severity, message] = RULES[rule];
    out.push({ rule, severity, message, line: idx == null ? null : lineOf(idx), excerpt: excerpt ? excerpt.slice(0, 140) : undefined });
  };

  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > GMAIL_CLIP_BYTES) add('size-clip', null, `${(bytes / 1024).toFixed(1)} KB`);
  else if (bytes > 90 * 1024) add('size-near-clip', null, `${(bytes / 1024).toFixed(1)} KB`);

  const isFragment = !/<html[\s>]/i.test(html) || !/<body[\s>]/i.test(html);
  if (isFragment) add('fragment', null);
  else {
    if (!/<!doctype html/i.test(html)) add('no-doctype', null);
    if (!/<html[^>]*\slang=/i.test(html)) add('no-lang', null);
    if (!/<title[^>]*>[^<]+<\/title>/i.test(html)) add('no-title', null);
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) add('no-viewport', null);
  if (!/<meta[^>]+name=["']mail:preheader["']/i.test(html) && !hiddenPreheader(html)) add('no-preheader', null);
  if (!/color-scheme/i.test(html)) add('no-color-scheme', null);

  // ---- tags --------------------------------------------------------------------------------------
  let totalEls = 0;
  let inlineStyled = 0;
  let classed = 0;
  const tagRe = /<([a-zA-Z][\w:-]*)(\s[^>]*)?>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2] || '');
    const at = m.index;
    const raw = m[0];
    if (!['html', 'head', 'meta', 'title', 'style', 'link', 'br', 'body'].includes(tag)) {
      totalEls++;
      if (attrs.style) inlineStyled++;
      if (attrs.class) classed++;
    }
    if (tag === 'script') add('script', at, raw);
    if (['iframe', 'object', 'embed'].includes(tag)) add('embed', at, raw);
    if (['video', 'audio'].includes(tag)) add('media', at, raw);
    if (['form', 'input', 'select', 'textarea'].includes(tag)) add('form', at, raw);
    if (tag === 'svg') add('svg', at, raw);
    if (tag === 'link' && /stylesheet/i.test(attrs.rel || '')) add('link-stylesheet', at, raw);
    if (tag === 'img') {
      checkAssetUrl(attrs.src, at, raw, add, 'img');
      if (attrs.alt === undefined) add('img-alt', at, raw);
      if (attrs.width === undefined) add('img-width', at, raw);
    }
    if (attrs.background) checkAssetUrl(attrs.background, at, raw, add, 'css');
    if (tag === 'a' && attrs.href !== undefined) checkHref(attrs.href, at, raw, add);
    if (tag === 'table') {
      if (!/presentation|none/i.test(attrs.role || '')) add('table-role', at, raw);
      if (+attrs.width > 700) add('wide-layout', at, raw);
    }
    if (attrs.style) checkCss(attrs.style, at, add, true);
  }
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let hasStyleRules = false;
  while ((m = styleRe.exec(html))) {
    hasStyleRules = hasStyleRules || /\{[^}]*:/.test(m[1]);
    checkCss(m[1], m.index, add, false);
  }
  if (hasStyleRules && classed > 0 && totalEls > 10 && inlineStyled / totalEls < 0.3) add('inline-ratio', null, `${inlineStyled}/${totalEls} elements carry inline styles`);

  return dedupe(out);
}

// A rule that fires 40 times on the same pattern is one finding; keep the first 3 occurrences.
function dedupe(findings) {
  const seen = {};
  return findings.filter((f) => (seen[f.rule] = (seen[f.rule] || 0) + 1) <= 3);
}

export function summarize(findings) {
  const s = { error: 0, warn: 0, info: 0 };
  for (const f of findings) s[f.severity]++;
  return s;
}

function parseAttrs(s) {
  const out = {};
  const re = /([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

const TEMPLATE_VAR = /^\s*(\{\{|\{%|\$\{|\*\||%%|<%)/;

export function classifyUrl(url) {
  if (url == null || url.trim() === '') return 'local';
  const u = url.trim();
  if (TEMPLATE_VAR.test(u)) return 'template';
  if (/^data:/i.test(u)) return 'data';
  if (/^cid:/i.test(u)) return 'cid';
  if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|[^/]*\.local\b|[^/]*\.internal\b)/i.test(u)) return 'localhost';
  if (/^https:\/\//i.test(u)) return 'https';
  if (/^http:\/\//i.test(u)) return 'http';
  if (/^\/\//.test(u)) return 'http';
  return 'local';
}

function checkAssetUrl(url, at, raw, add, kind) {
  const c = classifyUrl(url);
  if (c === 'local') add(kind === 'img' ? 'img-local-src' : 'css-bg-local', at, raw);
  else if (c === 'data') add('img-data-uri', at, raw);
  else if (c === 'localhost') add('img-localhost', at, raw);
  else if (c === 'http') add('img-http', at, raw);
  else if (c === 'cid') add('img-cid', at, raw);
}

function checkHref(href, at, raw, add) {
  const h = href.trim();
  if (!h || h === '#') return add('link-empty', at, raw);
  if (/^(mailto|tel|sms):/i.test(h) || TEMPLATE_VAR.test(h)) return;
  if (/^javascript:/i.test(h)) return add('link-js', at, raw);
  if (classifyUrl(h) === 'localhost') return add('link-localhost', at, raw);
  if (/^http:\/\//i.test(h)) return add('link-http', at, raw);
  if (!/^https:\/\//i.test(h)) add('link-relative', at, raw);
}

function checkCss(css, at, add, inline) {
  const flag = (re, rule) => {
    const mm = css.match(re);
    if (mm) add(rule, at, mm[0]);
  };
  flag(/display\s*:\s*(inline-)?(flex|grid)\b/i, 'css-flex-grid');
  flag(/position\s*:\s*(absolute|fixed)\b/i, 'css-position');
  flag(/var\(--[\w-]+/i, 'css-var');
  if (!inline) flag(/@import\b[^;]*;/i, 'css-import');
  flag(/background(-image)?\s*:[^;]*url\(/i, 'css-bg-image');
  const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  let m;
  while ((m = urlRe.exec(css))) {
    const c = classifyUrl(m[1]);
    if (c === 'local') add('css-bg-local', at, m[0]);
    else if (c === 'localhost') add('img-localhost', at, m[0]);
    else if (c === 'data' && !/font/i.test(m[1])) add('img-data-uri', at, m[0]);
  }
}

// Optional network pass: every https image must actually answer 2xx with an image content-type.
// Images only: <img src>, the background attribute and CSS background/background-image — never a
// @font-face src, which answers font/woff2.
export async function checkRemoteAssets(html, { timeoutMs = 6000 } = {}) {
  const urls = new Set();
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/\sbackground=["']([^"']+)["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/background(?:-image)?\s*:[^;{}]*?url\(\s*['"]?(https:[^'")]+)['"]?\s*\)/gi)) urls.add(m[1]);
  const findings = [];
  await Promise.all(
    [...urls].filter((u) => classifyUrl(u) === 'https').map(async (u) => {
      try {
        const res = await fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        const type = res.headers.get('content-type') || '';
        if (!res.ok) findings.push({ rule: 'img-unreachable', severity: 'error', message: `Image URL answers ${res.status}. Recipients will see a broken image.`, excerpt: u });
        else if (!/^image\//i.test(type)) findings.push({ rule: 'img-not-image', severity: 'warn', message: `URL answers ${type || 'no content-type'}, not an image (a login page or HTML viewer?).`, excerpt: u });
        res.body?.cancel();
      } catch (e) {
        findings.push({ rule: 'img-unreachable', severity: 'error', message: `Image URL did not answer (${e.name}).`, excerpt: u });
      }
    }),
  );
  return findings;
}
