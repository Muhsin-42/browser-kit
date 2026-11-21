// Browser Kit: page-context half of the Instagram DM link revealer (see
// ig-links.js). Auto-replies sent when you comment on a post ("Here's your
// access 👇") carry their link as a button that only the app draws; the web
// page still receives it in the message data, it just never shows it.
// Instagram's web DMs arrive as JSON (GraphQL responses and the live
// connection, both parsed with JSON.parse), so this looks through what the
// page parses for links next to a message id, and hands them to ig-links.js.

(() => {
  const links = new Map(); // url -> { url, label, mid }
  const texts = new Map(); // message id -> message text

  // Files and pictures, not links someone sent.
  const ASSET_HOST = /(^|\.)(fbcdn\.net|cdninstagram\.com|fbsbx\.com|instagram\.com|facebook\.com|fb\.com|whatsapp\.net)$/i;
  const ASSET_PATH = /\.(jpe?g|png|webp|gif|heic|mp4|m4a|mp3|js|css|svg|ico)$/i;
  const URL_RE = /^https?:\/\/\S+$/;
  const MID_RE = /^mid\.[\w$.:-]+$/;

  // l.instagram.com/?u=<real link> → the real link.
  function unwrap(u) {
    try {
      const x = new URL(u);
      if (/^l\.(instagram|facebook)\.com$/i.test(x.hostname) && x.searchParams.get('u')) {
        return x.searchParams.get('u');
      }
    } catch {}
    return u;
  }

  function wanted(u) {
    try {
      const x = new URL(u);
      return !ASSET_HOST.test(x.hostname) && !ASSET_PATH.test(x.pathname);
    } catch {
      return false;
    }
  }

  // A button title or similar: short, has letters, isn't an id or a link.
  const isLabel = (s) => s.length >= 2 && s.length <= 80 && /\p{L}/u.test(s) &&
    !URL_RE.test(s) && !MID_RE.test(s) && !/^[\w-]{20,}$/.test(s) &&
    !/^[a-z]+([A-Z][a-z0-9]*)+$/.test(s) && !/^[a-z0-9]+(_[a-z0-9]+)+$/.test(s); // codeNames, field_names
  // Message text: has a space and some length.
  const isText = (s) => s.length >= 12 && s.length <= 5000 && /\s/.test(s) && !URL_RE.test(s);

  let added = false;

  function walk(node, mid, depth) {
    if (!node || typeof node !== 'object' || depth > 60) return;
    const kids = Array.isArray(node) ? node : Object.values(node);
    const strings = kids.filter((k) => typeof k === 'string');
    const here = strings.find((s) => MID_RE.test(s)) || mid;

    if (here) {
      const text = strings.filter(isText).sort((a, b) => b.length - a.length)[0];
      if (text && text.length > (texts.get(here)?.length || 0)) {
        texts.set(here, text);
        added = true;
      }
    }
    for (const s of strings) {
      if (!URL_RE.test(s) || s.length > 4000) continue;
      const url = unwrap(s);
      if (!wanted(url)) continue;
      const old = links.get(url);
      const label = strings.find(isLabel) || '';
      if (old && (old.mid || !here) && (old.label || !label)) continue;
      links.set(url, { url, label: old?.label || label, mid: old?.mid || here || '' });
      added = true;
    }
    for (const k of kids) if (k && typeof k === 'object') walk(k, here, depth + 1);
  }

  function snapshot() {
    return JSON.stringify([...links.values()].map((l) => ({ ...l, text: texts.get(l.mid) || '' })));
  }
  const send = () => document.dispatchEvent(new CustomEvent('bk-ig-links', { detail: snapshot() }));
  let timer = 0;
  const sendSoon = () => {
    if (!timer) timer = setTimeout(() => { timer = 0; send(); }, 200);
  };

  // Only parsed text that might hold DM data is walked: anything with a
  // message id, or anything at all while you're in your DMs.
  const interesting = (text) => text.length > 40 && text.includes('http') &&
    (text.includes('mid.') || location.pathname.startsWith('/direct'));

  const parse = JSON.parse;
  JSON.parse = function (text) {
    const out = parse.apply(this, arguments);
    try {
      if (typeof text === 'string' && interesting(text)) {
        added = false;
        walk(out, '', 0);
        if (added) sendSoon();
      }
    } catch {}
    return out;
  };

  document.addEventListener('bk-ig-links-ask', send);
  // Troubleshooting: run this in the console on instagram.com.
  //   document.dispatchEvent(new Event('bk-ig-links-debug'))
  document.addEventListener('bk-ig-links-debug', () => {
    console.log('[Browser Kit] DM links seen:', [...links.values()], 'message texts:', texts);
  });
})();
