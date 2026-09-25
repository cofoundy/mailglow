// Turns a stored email into what a given client would show: light, dark (the client honours
// prefers-color-scheme, like Apple Mail / iOS Mail / Outlook.com), or forced dark (the client
// inverts colours itself, like the Gmail and Outlook apps — an approximation, labelled as such).

export const SCHEMES = ['light', 'dark', 'forced'];

export function renderForClient(html, { scheme = 'light', images = true } = {}) {
  let out = html;
  // Deterministic media queries: the preview must not depend on the viewer's OS theme.
  const always = '(min-width: 0px)';
  const never = '(max-width: 0.01px)';
  out = out
    .replace(/\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, scheme === 'dark' ? always : never)
    .replace(/\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, scheme === 'dark' ? never : always);

  if (!images) {
    out = out.replace(/(<img\b[^>]*?)\ssrc=(["'])[^"']*\2/gi, '$1 src="" data-blocked="1"');
    out = inject(out, '<style>img[data-blocked]{outline:1px dashed #9aa0a6;color:#5f6368;font:12px/1.4 system-ui,sans-serif}</style>');
  }
  if (scheme === 'forced') {
    // Full-colour inversion with photos re-inverted: what Gmail (Android/iOS) and Outlook apps approximate.
    out = inject(out, '<style>html{filter:invert(1) hue-rotate(180deg);background:#fff}img,video,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}</style>');
  }
  // Links open outside the preview pane; the iframe is sandboxed without scripts anyway.
  out = inject(out, '<base target="_blank">');
  if (!/<html[\s>]/i.test(out)) {
    // Fragments get the neutral body a mail client would give them.
    out = `<!doctype html><html><head><meta charset="utf-8">${headOnly(out)}</head><body style="margin:0;padding:16px;background:#fff">${bodyOnly(out)}</body></html>`;
  }
  return out;
}

function inject(html, snippet) {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}</head>`);
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (b) => `${b}${snippet}`);
  return snippet + html;
}

// For fragments we injected <style>/<base> at the front; keep them in <head>.
function headOnly(fragment) {
  const m = fragment.match(/^((?:<style[\s\S]*?<\/style>|<base[^>]*>)*)/i);
  return m ? m[1] : '';
}

function bodyOnly(fragment) {
  return fragment.replace(/^((?:<style[\s\S]*?<\/style>|<base[^>]*>)*)/i, '');
}
