// Browser Kit: page-context helper for ig-button.js. Instagram's own page
// fetches each post's data (video URLs included) to play it, logged in or not.
// This keeps a copy of the posts it sees, by shortcode, and hands one to
// ig-button.js on request, so the download button works without a login and
// without any extra requests to Instagram.

(() => {
  const posts = new Map(); // shortcode -> media object
  const MAX = 300;

  // Two shapes: the REST/"xdt" one (code, video_versions, carousel_media) and
  // the older GraphQL one (shortcode, video_url, edge_sidecar_to_children).
  const isPost = (o) => (typeof o.code === 'string' || typeof o.shortcode === 'string') &&
    ('video_versions' in o || 'video_url' in o || 'carousel_media' in o || 'edge_sidecar_to_children' in o);

  function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 40) return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, depth + 1);
      return;
    }
    if (isPost(o)) {
      const code = o.code || o.shortcode;
      const old = posts.get(code);
      // Keep the most complete copy (feed items can be trimmed).
      if (!old || JSON.stringify(o).length >= JSON.stringify(old).length) posts.set(code, o);
      if (posts.size > MAX) posts.delete(posts.keys().next().value);
    }
    for (const k in o) walk(o[k], depth + 1);
  }

  const parse = JSON.parse;
  JSON.parse = function (text) {
    const out = parse.apply(this, arguments);
    try {
      if (typeof text === 'string' && (text.includes('"video_versions"') || text.includes('"video_url"'))) walk(out, 0);
    } catch {}
    return out;
  };
  const json = Response.prototype.json;
  Response.prototype.json = function () {
    return json.apply(this, arguments).then((out) => {
      try { walk(out, 0); } catch {}
      return out;
    });
  };

  // ig-button.js asks with a shortcode; the answer is a JSON string (or '').
  document.addEventListener('bk-ig-ask', (e) => {
    const code = String(e.detail || '');
    let found = posts.get(code) || null;
    // Private posts' codes carry extra characters after the first 11.
    if (!found) for (const [k, v] of posts) if (k.slice(0, 11) === code.slice(0, 11)) found = v;
    document.dispatchEvent(new CustomEvent('bk-ig-answer', { detail: found ? JSON.stringify(found) : '' }));
  });
})();
