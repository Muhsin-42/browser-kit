// Browser Kit: a seek bar along the bottom of every video on instagram.com,
// which shows no progress bar of its own on reels. Shows how far the video
// has played; click or drag anywhere on it to jump to that moment. Hovering
// shows the time under the pointer.
//
// Like ig-button.js, the bars live in a layer of our own over the page:
// inside Instagram's player they'd sit under its click layer, and clicks
// would pause the video instead.

(() => {
  if (window !== top) return;

  let on = true;
  const bars = new Map(); // video -> { host, fill, knob, tip, dragging }

  const CSS = `
    :host { all: initial; }
    .hit {
      position: absolute; left: 0; right: 0; bottom: 0; height: 16px;
      display: flex; align-items: flex-end; cursor: pointer; touch-action: none;
    }
    .track {
      position: relative; width: 100%; height: 3px; background: rgba(255, 255, 255, 0.3);
      transition: height 0.12s;
    }
    .hit:hover .track, .drag .track { height: 7px; }
    .buf, .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; }
    .buf { background: rgba(255, 255, 255, 0.35); }
    .fill { background: #fff; }
    .knob {
      position: absolute; top: 50%; width: 13px; height: 13px; margin: -6.5px 0 0 -6.5px;
      border-radius: 50%; background: #fff; box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
      transform: scale(0); transition: transform 0.12s;
    }
    .hit:hover .knob, .drag .knob { transform: scale(1); }
    .tip {
      position: absolute; bottom: 16px; transform: translateX(-50%); padding: 3px 7px;
      border-radius: 5px; background: rgba(0, 0, 0, 0.8); color: #fff; white-space: nowrap;
      font: 600 12px/1.2 system-ui, -apple-system, Roboto, Arial, sans-serif;
      font-variant-numeric: tabular-nums; pointer-events: none; display: none;
    }
    .hit:hover .tip, .drag .tip { display: block; }
  `;

  const fmt = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  };
  const duration = (v) => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0);

  function build(video) {
    const host = document.createElement('bk-ig-seek');
    host.style.cssText = 'all: initial; position: fixed; display: block; height: 16px;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="hit" title="">
        <div class="track"><div class="buf"></div><div class="fill"></div><div class="knob"></div></div>
        <div class="tip"></div>
      </div>`;
    const hit = root.querySelector('.hit');
    const bar = {
      host, hit,
      fill: root.querySelector('.fill'),
      buf: root.querySelector('.buf'),
      knob: root.querySelector('.knob'),
      tip: root.querySelector('.tip'),
      dragging: false,
    };

    // Keep our clicks away from Instagram (pause, like, open the post).
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }

    const fraction = (e) => {
      const r = hit.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
    };
    const showTip = (f) => {
      bar.tip.style.left = Math.min(Math.max(f * 100, 4), 96) + '%';
      bar.tip.textContent = `${fmt(f * duration(video))} / ${fmt(duration(video))}`;
    };
    const seek = (f) => {
      const d = duration(video);
      if (!d) return;
      video.currentTime = Math.min(f * d, d - 0.05);
      paint(video, bar);
    };

    hit.addEventListener('pointermove', (e) => {
      const f = fraction(e);
      showTip(f);
      if (bar.dragging) seek(f);
    });
    hit.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      hit.setPointerCapture(e.pointerId);
      bar.dragging = true;
      hit.classList.add('drag');
      const f = fraction(e);
      showTip(f);
      seek(f);
    });
    const end = (e) => {
      if (!bar.dragging) return;
      bar.dragging = false;
      hit.classList.remove('drag');
      if (hit.hasPointerCapture(e.pointerId)) hit.releasePointerCapture(e.pointerId);
    };
    hit.addEventListener('pointerup', end);
    hit.addEventListener('pointercancel', end);
    hit.addEventListener('click', (e) => e.preventDefault());

    return bar;
  }

  function paint(video, bar) {
    const d = duration(video);
    const f = d ? Math.min(1, video.currentTime / d) : 0;
    bar.fill.style.width = f * 100 + '%';
    bar.knob.style.left = f * 100 + '%';
    let buffered = 0;
    const b = video.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= video.currentTime + 0.5) buffered = Math.max(buffered, b.end(i));
    }
    bar.buf.style.width = (d ? Math.min(1, buffered / d) : 0) * 100 + '%';
  }

  // --- Placement (same rules as ig-button.js) ---

  let layer = null;
  function getLayer() {
    if (!layer?.isConnected) {
      layer = document.createElement('bk-ig-seek-layer');
      layer.style.cssText = 'all: initial; position: fixed; inset: 0; width: 0; height: 0; z-index: 2147483645; display: block;';
      document.documentElement.appendChild(layer);
    }
    return layer;
  }

  function visible(video, r) {
    if (r.width < 120 || r.height < 120 || r.bottom < 40 || r.top > innerHeight - 40 ||
      r.right < 40 || r.left > innerWidth) return false;
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const dialog = document.elementFromPoint(x, y)?.closest('[role="dialog"]');
    return !dialog || dialog.contains(video);
  }

  function place(video) {
    let bar = bars.get(video);
    const r = on && video.isConnected && duration(video) ? video.getBoundingClientRect() : null;
    if (!r || !visible(video, r)) {
      if (bar && !bar.dragging) bar.host.style.display = 'none';
      return false;
    }
    if (!bar) {
      bar = build(video);
      bars.set(video, bar);
    }
    if (bar.host.parentElement !== getLayer()) layer.appendChild(bar.host);
    const left = Math.max(r.left, 0);
    const right = Math.min(r.right, innerWidth);
    const bottom = Math.min(r.bottom, innerHeight);
    bar.host.style.display = 'block';
    bar.host.style.left = left + 'px';
    bar.host.style.width = right - left + 'px';
    bar.host.style.top = bottom - 16 + 'px';
    paint(video, bar);
    return true;
  }

  function scan() {
    for (const [video, bar] of bars) {
      if (!video.isConnected) {
        bar.host.remove();
        bars.delete(video);
      }
    }
    let any = false;
    document.querySelectorAll('video').forEach((v) => { if (place(v)) any = true; });
    if (any) tick();
  }

  // Smooth progress while something is on screen; stops when nothing is.
  let frame = 0;
  function tick() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      let any = false;
      for (const [video, bar] of bars) {
        if (bar.host.style.display === 'none') continue;
        any = true;
        if (!bar.dragging) paint(video, bar);
      }
      if (any && !document.hidden) tick();
    });
  }

  let repos = 0;
  const reposition = () => {
    if (!repos) repos = requestAnimationFrame(() => { repos = 0; scan(); });
  };
  addEventListener('scroll', reposition, { capture: true, passive: true });
  addEventListener('resize', reposition);
  // A video's duration is known only once it loads.
  document.addEventListener('loadedmetadata', reposition, true);
  document.addEventListener('play', reposition, true);

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; scan(); }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 500);

  function applySettings(s) {
    on = !!(s.enabled && s['ig-seek']);
    scan();
  }
  const KEYS = { enabled: true, 'ig-seek': true };
  chrome.storage.sync.get(KEYS, applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && ('enabled' in changes || 'ig-seek' in changes)) chrome.storage.sync.get(KEYS, applySettings);
  });
})();
