// Browser Kit: puts a download button on the top-right corner of every video
// on instagram.com (feed posts, reels, the reels tab, post pages). Instagram
// plays its videos from blob: URLs, so the button works out which post the
// video belongs to, asks Instagram's own web API for that post (with your
// login cookies, like reels.js), and hands the best-quality file to
// background.js to save under Downloads/Instagram/.

(() => {
  if (window !== top) return;

  const APP_ID = '936619743392459'; // instagram.com's own web app id
  const FOLDER = 'Instagram';
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const CODE_RE = /\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]{5,})/;

  // Firefox content scripts fetch as the extension unless they use content.fetch.
  const pageFetch = typeof content !== 'undefined' && content?.fetch
    ? content.fetch.bind(content) : fetch;

  let on = true;
  const buttons = new Map(); // video -> host element

  // --- Which post is this video from? ---

  const codeOf = (href) => href?.match(CODE_RE)?.[1] || null;

  // Walk up from the video until a container holds a link to exactly one post.
  // Feed posts link to /p/CODE (the timestamp); reels in the reels tab sit in
  // a container whose own URL is the page's.
  function postCode(video) {
    for (let el = video.parentElement, depth = 0; el && el !== document.body && depth < 25;
      el = el.parentElement, depth++) {
      const codes = new Set();
      for (const a of el.querySelectorAll('a[href]')) {
        const c = codeOf(a.getAttribute('href'));
        if (c) codes.add(c);
      }
      if (codes.size === 1) return [...codes][0];
      if (codes.size > 1) break; // reached a container with several posts
    }
    // A post or reel page, or the reels tab (its URL follows the visible reel).
    return codeOf(location.pathname);
  }

  // Shortcodes are the media id in base64 (Instagram's alphabet); private
  // posts add extra characters after the first 11.
  function mediaId(code) {
    let id = 0n;
    for (const ch of code.slice(0, 11)) {
      const n = ALPHABET.indexOf(ch);
      if (n < 0) return null;
      id = id * 64n + BigInt(n);
    }
    return id.toString();
  }

  async function postInfo(code) {
    const id = mediaId(code);
    if (!id) throw new Error('Couldn\'t read this post\'s link.');
    const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] || '';
    const res = await pageFetch(`${location.origin}/api/v1/media/${id}/info/`, {
      credentials: 'include',
      headers: { 'X-IG-App-ID': APP_ID, 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' },
    });
    const body = await res.json().catch(() => null);
    const media = body?.items?.[0];
    if (!res.ok || !media) {
      // Logged out, Instagram answers 200 with a login page instead of data.
      throw new Error(res.status === 401 || res.status === 403 || body?.require_login || !body
        ? 'Instagram wants you logged in for this one. Play the video for a moment and try again, or log in.'
        : 'Instagram said: ' + (body.message || 'HTTP ' + res.status));
    }
    return media;
  }

  // The copy of this post Instagram's own page loaded (see ig-capture.js), in
  // the same shape as the API's. Works logged out and needs no request.
  function capturedPost(code) {
    let answer = '';
    const listen = (e) => { answer = e.detail; };
    document.addEventListener('bk-ig-answer', listen);
    document.dispatchEvent(new CustomEvent('bk-ig-ask', { detail: code }));
    document.removeEventListener('bk-ig-answer', listen);
    if (!answer) return null;
    try { return normalize(JSON.parse(answer)); } catch { return null; }
  }

  // The older GraphQL shape → the API's shape that filesOf reads.
  function normalize(o) {
    if (!o || o.video_versions || o.carousel_media) return o;
    const slide = (n) => ({
      video_versions: n.video_url ? [{ url: n.video_url, ...(n.dimensions || {}) }] : [],
    });
    const children = o.edge_sidecar_to_children?.edges?.map((e) => slide(e.node)) || [];
    return {
      code: o.shortcode,
      user: { username: o.owner?.username },
      media_type: children.length ? 8 : 2,
      ...(children.length ? { carousel_media: children } : slide(o)),
    };
  }

  const area = (v) => (v.width || 0) * (v.height || 0);
  const best = (list) => list.reduce((a, b) => (area(b) > area(a) ? b : a));

  // For a carousel, guess the slide from the video's position among the
  // carousel's <li> items; without a confident guess, take every video.
  function slideIndex(video) {
    const li = video.closest('li');
    const ul = li?.parentElement;
    if (!li || !ul) return -1;
    const items = [...ul.children].filter((x) => x.tagName === 'LI');
    // Instagram keeps a spacer <li> with no media at the start of carousels.
    const real = items.filter((x) => x.querySelector('video, img'));
    return real.indexOf(li);
  }

  function filesOf(media, video) {
    const user = (media.user?.username || 'unknown').replace(/[^\w.-]/g, '_');
    const code = (media.code || String(media.pk || media.id)).replace(/[^\w-]/g, '_');
    const base = `${FOLDER}/${user}_${code}`;
    if (media.media_type !== 8) {
      return media.video_versions?.length
        ? [{ url: best(media.video_versions).url, filename: base + '.mp4' }] : [];
    }
    const slides = media.carousel_media || [];
    const files = slides
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.video_versions?.length)
      .map(({ s, i }) => ({ i, url: best(s.video_versions).url, filename: `${base}_${i + 1}.mp4` }));
    if (files.length <= 1) return files;
    const i = slideIndex(video);
    const match = files.find((f) => f.i === i);
    return match ? [match] : files;
  }

  // --- The button ---

  const CSS = `
    :host { all: initial; }
    button {
      display: flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; margin: 0; padding: 0; border: 0; border-radius: 50%;
      background: rgba(0, 0, 0, 0.55); color: #fff; cursor: pointer;
      opacity: 0.85; transition: opacity 0.15s, transform 0.15s;
    }
    button:hover { opacity: 1; transform: scale(1.06); }
    button[disabled] { cursor: progress; }
    svg { width: 18px; height: 18px; }
    .spin svg { animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .tip {
      position: absolute; top: 40px; right: 0; max-width: 220px; width: max-content;
      padding: 5px 8px; border-radius: 6px; background: rgba(0, 0, 0, 0.8); color: #fff;
      font: 500 12px/1.3 system-ui, -apple-system, Roboto, Arial, sans-serif;
    }
    .tip:empty { display: none; }
  `;
  const ICONS = {
    download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    busy: '<path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    done: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    error: '<path d="M12 7v6m0 4h.01" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  };

  function setIcon(btn, name) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
    btn.classList.toggle('spin', name === 'busy');
  }

  function build(video) {
    const host = document.createElement('bk-ig-download');
    host.style.cssText = 'all: initial; position: fixed; display: block;';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Download video';
    btn.setAttribute('aria-label', 'Download video');
    setIcon(btn, 'download');
    const tip = document.createElement('div');
    tip.className = 'tip';
    root.append(style, btn, tip);

    // Keep clicks on the button from pausing, liking or opening the post.
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      download(video, btn, tip, host);
    });
    return host;
  }

  async function download(video, btn, tip, host) {
    if (btn.disabled) return;
    btn.disabled = true;
    tip.textContent = '';
    setIcon(btn, 'busy');
    let reset = 2500;
    try {
      host.busy = true;
      const code = postCode(video);
      let files = [];
      let apiError = null;
      if (code) {
        const seen = capturedPost(code);
        if (seen) files = filesOf(seen, video);
        if (!files.length) {
          try { files = filesOf(await postInfo(code), video); } catch (e) { apiError = e; }
        }
      }
      // Logged out, Instagram often plays a plain .mp4 rather than a blob:
      // URL; then the video's own file is the download.
      if (!files.length && /^https:/.test(video.currentSrc)) {
        files = [{ url: video.currentSrc, filename: `${FOLDER}/${code || 'instagram_' + Date.now()}.mp4` }];
      }
      if (!files.length) {
        console.warn('[Browser Kit] Instagram download:', { code, src: video.currentSrc, apiError });
        throw apiError || new Error(code ? 'No video found in this post.'
          : 'Couldn\'t tell which post this video is from. Open the post and try again.');
      }
      for (const f of files) {
        const r = await chrome.runtime.sendMessage({ type: 'bk-reels-download', url: f.url, filename: f.filename })
          .catch((e) => ({ ok: false, error: e.message }));
        if (!r?.ok) throw new Error('Download failed: ' + (r?.error || 'unknown error'));
      }
      setIcon(btn, 'done');
      btn.title = files.length > 1 ? `Saved ${files.length} videos to Downloads/Instagram` : 'Saved to Downloads/Instagram';
    } catch (e) {
      setIcon(btn, 'error');
      tip.textContent = e.message;
      reset = 5000;
    }
    setTimeout(() => {
      host.busy = false;
      btn.disabled = false;
      tip.textContent = '';
      btn.title = 'Download video';
      setIcon(btn, 'download');
    }, reset);
  }

  // The buttons live in a layer of our own at the top of the page, positioned
  // over each video. Inside Instagram's player they'd sit under its
  // transparent click layer, and clicks would pause the video instead.
  let layer = null;
  function getLayer() {
    if (!layer?.isConnected) {
      layer = document.createElement('bk-ig-layer');
      layer.style.cssText = 'all: initial; position: fixed; inset: 0; width: 0; height: 0; z-index: 2147483646; display: block;';
      document.documentElement.appendChild(layer);
    }
    return layer;
  }

  // Is the video on screen and not under one of Instagram's dialogs (a post
  // opened over the feed)? Instagram covers its videos with overlays of its
  // own, so only a dialog that doesn't contain the video counts as covering.
  function visible(video, r) {
    if (r.width < 120 || r.height < 120 || r.bottom < 40 || r.top > innerHeight - 40 ||
      r.right < 40 || r.left > innerWidth) return false;
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const dialog = document.elementFromPoint(x, y)?.closest('[role="dialog"]');
    return !dialog || dialog.contains(video);
  }

  function place(video) {
    let host = buttons.get(video);
    const r = on && video.isConnected ? video.getBoundingClientRect() : null;
    if (!r || !visible(video, r)) {
      if (host && !host.busy) host.style.display = 'none';
      return;
    }
    if (!host) {
      host = build(video);
      buttons.set(video, host);
    }
    if (host.parentElement !== getLayer()) layer.appendChild(host);
    host.style.display = 'block';
    host.style.top = Math.max(r.top, 0) + 10 + 'px';
    host.style.left = Math.min(r.right, innerWidth) - 44 + 'px';
  }

  function scan() {
    for (const [video, host] of buttons) {
      if (!video.isConnected) {
        host.remove();
        buttons.delete(video);
      }
    }
    document.querySelectorAll('video').forEach(place);
  }

  // Follow the videos as the page scrolls (reels also slide without a scroll event).
  let frame = 0;
  const reposition = () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; scan(); });
  };
  addEventListener('scroll', reposition, { capture: true, passive: true });
  addEventListener('resize', reposition);

  // Instagram is a single-page app that keeps adding posts as you scroll.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; scan(); }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 500);

  function applySettings(s) {
    on = !!(s.enabled && s['reels-button']);
    scan();
  }
  console.log('[Browser Kit] Instagram download button ready');
  const KEYS = { enabled: true, 'reels-button': true };
  chrome.storage.sync.get(KEYS, applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && ('enabled' in changes || 'reels-button' in changes)) chrome.storage.sync.get(KEYS, applySettings);
  });
})();
