// Browser Kit: shows the links Instagram's web DMs hide. Auto-replies you get
// after commenting on a post ("Here's your access 👇") put their link in a
// button that only the app draws. ig-links-capture.js finds those links in
// the message data; this shows them:
//   - under the message they came with, when it can find that message, and
//   - in a "Links" list (bottom right, in your DMs) with every one it found.

(() => {
  if (window !== top) return;

  let on = true;
  let entries = []; // { url, label, mid, text }

  const squash = (s) => (s || '').replace(/\s+/g, '').toLowerCase();
  const inDMs = () => location.pathname.startsWith('/direct');
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  // Links already shown as links on the page don't need us.
  function shownOnPage(url) {
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.href;
      if (href === url || decodeURIComponent(href).includes(url)) return true;
    }
    return false;
  }

  const CHIP_CSS = `
    :host { all: initial; display: block; margin-top: 8px; }
    a {
      display: flex; align-items: center; gap: 6px; margin-top: 6px; padding: 8px 12px;
      border-radius: 10px; background: rgba(0, 149, 246, 0.16); color: #4cb5f9;
      font: 600 14px/1.3 system-ui, -apple-system, Roboto, Arial, sans-serif;
      text-decoration: none; word-break: break-all; text-align: left;
    }
    a:hover { background: rgba(0, 149, 246, 0.26); }
    small { display: block; color: #a8a8a8; font-weight: 400; font-size: 12px; }
  `;

  function linkHtml(e) {
    const a = document.createElement('a');
    a.href = e.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = e.url;
    const title = document.createElement('span');
    title.textContent = '🔗 ' + (e.label || host(e.url));
    const small = document.createElement('small');
    small.textContent = e.url.length > 70 ? e.url.slice(0, 70) + '…' : e.url;
    const wrap = document.createElement('span');
    wrap.append(title, small);
    a.append(wrap);
    return a;
  }

  // --- Under the message ---

  // Message text sits in dir="auto" elements; find the one whose text is
  // this message's (compared without spaces, as the page lays it out freely).
  // Only the open conversation counts, not the chat list beside it: its
  // previews start with the same text. The conversation is the column above
  // the message box, so a match must sit within that box's left and right.
  function composerColumn() {
    const box = document.querySelector('[role="main"] [role="textbox"][contenteditable="true"], [role="main"] textarea');
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return r.width > 0 ? { left: r.left - 80, right: r.right + 20 } : null;
  }

  function inColumn(el, col) {
    const r = el.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    return r.width > 0 && mid > col.left && mid < col.right && r.left > col.left - 40;
  }

  function findMessage(text, col) {
    const key = squash(text).slice(0, 40);
    if (key.length < 8) return null;
    let found = null;
    for (const el of document.querySelectorAll('[role="main"] [dir="auto"], [role="main"] span, [role="main"] div')) {
      if (el.closest('bk-ig-links-chip')) continue;
      const t = squash(el.textContent);
      if (t.length > key.length * 6 || !t.startsWith(key)) continue;
      if (inColumn(el, col)) found = el; // later matches are deeper: keep the innermost
    }
    return found;
  }

  function placeChips() {
    const col = on && inDMs() ? composerColumn() : null;
    const keep = new Set();
    if (col) {
      const byMessage = new Map();
      for (const e of entries) {
        if (!e.text || shownOnPage(e.url)) continue;
        if (!byMessage.has(e.text)) byMessage.set(e.text, []);
        byMessage.get(e.text).push(e);
      }
      for (const [text, list] of byMessage) {
        const el = findMessage(text, col);
        if (!el) continue;
        const key = list.map((e) => e.url).join('\n');
        const next = el.nextElementSibling;
        if (next?.tagName === 'BK-IG-LINKS-CHIP' && next.dataset.key === key) {
          keep.add(next);
          continue;
        }
        const chip = document.createElement('bk-ig-links-chip');
        chip.dataset.key = key;
        const root = chip.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = CHIP_CSS;
        root.append(style, ...list.map(linkHtml));
        // Keep clicks from reaching Instagram's message handlers.
        for (const type of ['click', 'mousedown', 'pointerdown']) chip.addEventListener(type, (ev) => ev.stopPropagation());
        el.insertAdjacentElement('afterend', chip);
        keep.add(chip);
      }
    }
    // Anything else (an old spot, the chat list, a closed chat) goes.
    for (const chip of document.querySelectorAll('bk-ig-links-chip')) {
      if (!keep.has(chip)) chip.remove();
    }
  }

  // --- The "Links" list ---

  const PANEL_CSS = `
    :host { all: initial; position: fixed; right: 20px; bottom: 96px; z-index: 2147483646; }
    .btn {
      display: flex; align-items: center; gap: 6px; margin-left: auto; padding: 8px 14px;
      border: 0; border-radius: 999px; background: #0095f6; color: #fff; cursor: pointer;
      font: 600 13px/1 system-ui, -apple-system, Roboto, Arial, sans-serif;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    }
    .list {
      position: absolute; right: 0; bottom: 44px; width: 340px; max-height: 60vh; overflow: auto;
      padding: 12px; border-radius: 14px; background: #262626; color: #f5f5f5;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
      font: 13px/1.35 system-ui, -apple-system, Roboto, Arial, sans-serif;
    }
    .list[hidden] { display: none; }
    h3 { margin: 0 0 6px; font-size: 13px; color: #a8a8a8; font-weight: 600; }
    .item { padding: 8px 0; border-top: 1px solid #363636; }
    .item:first-of-type { border-top: 0; }
    .msg { color: #a8a8a8; font-size: 12px; margin-bottom: 4px; }
    ${CHIP_CSS.replace(':host { all: initial; display: block; margin-top: 8px; }', '')}
  `;

  let panel = null;
  function getPanel() {
    if (panel?.isConnected) return panel;
    panel = document.createElement('bk-ig-links-panel');
    const root = panel.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${PANEL_CSS}</style>
      <div class="list" hidden><h3>Links in your DMs</h3><div class="items"></div></div>
      <button class="btn" type="button" title="Links Instagram's web DMs don't show"></button>`;
    root.querySelector('.btn').addEventListener('click', () => {
      const list = root.querySelector('.list');
      list.hidden = !list.hidden;
    });
    document.documentElement.appendChild(panel);
    return panel;
  }

  function renderPanel() {
    const visible = on && inDMs() && entries.length > 0;
    if (!visible) {
      if (panel) panel.style.display = 'none';
      return;
    }
    const root = getPanel().shadowRoot;
    panel.style.display = '';
    root.querySelector('.btn').textContent = `🔗 Links (${entries.length})`;
    const items = root.querySelector('.items');
    items.replaceChildren(...[...entries].reverse().map((e) => {
      const item = document.createElement('div');
      item.className = 'item';
      if (e.text) {
        const msg = document.createElement('div');
        msg.className = 'msg';
        msg.textContent = e.text.length > 90 ? e.text.slice(0, 90) + '…' : e.text;
        item.append(msg);
      }
      item.append(linkHtml(e));
      return item;
    }));
  }

  function render() {
    renderPanel();
    placeChips();
  }

  document.addEventListener('bk-ig-links', (ev) => {
    try { entries = JSON.parse(ev.detail) || []; } catch { entries = []; }
    render();
  });

  // Instagram redraws the chat as you scroll and switch threads.
  let queued = false;
  new MutationObserver((records) => {
    if (queued || !on || !entries.length) return;
    const ours = (n) => n.nodeName === 'BK-IG-LINKS-CHIP' || n.nodeName === 'BK-IG-LINKS-PANEL';
    if (records.every((r) => [...r.addedNodes, ...r.removedNodes].every(ours))) return;
    queued = true;
    setTimeout(() => { queued = false; render(); }, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });

  function applySettings(s) {
    on = !!(s.enabled && s['ig-links']);
    render();
  }
  const KEYS = { enabled: true, 'ig-links': true };
  chrome.storage.sync.get(KEYS, applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && ('enabled' in changes || 'ig-links' in changes)) chrome.storage.sync.get(KEYS, applySettings);
  });
  document.dispatchEvent(new Event('bk-ig-links-ask'));
})();
