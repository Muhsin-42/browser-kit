// Browser Kit: keep videos playing when you switch tabs or windows.
// Sites like Instagram pause their player as soon as the tab is hidden or the
// window loses focus, which also freezes the picture-in-picture window (its
// play button does nothing, because the site pauses again straight away).
// While a video is playing or popped out, this hides those signals from the
// page: the visibilitychange / blur events never reach it, and
// document.hidden / visibilityState / hasFocus() keep saying "visible".
// Runs in the page context at document_start so it sees events first.
// speed.js turns it on and off (the "Keep videos playing when you switch tabs" setting).

(() => {
  let on = true; // until speed.js says otherwise
  let masked = false; // the page was told "visible" while the tab was really hidden

  const desc = (proto, key) => Object.getOwnPropertyDescriptor(proto, key);
  const realHidden = desc(Document.prototype, 'hidden')?.get;
  const realFocus = Document.prototype.hasFocus;
  const reallyHidden = () => (realHidden ? realHidden.call(document) : false);

  const mediaActive = () => {
    if (document.pictureInPictureElement) return true;
    for (const el of document.querySelectorAll('video, audio')) {
      if (!el.paused && !el.ended) return true;
    }
    return false;
  };
  const shouldMask = () => on && (masked || mediaActive());

  // --- Events: swallow them before any page listener runs ---

  // Registered first, in the capture phase on window, so this runs before the
  // page's own listeners on window or document.
  window.addEventListener('visibilitychange', (e) => {
    if (reallyHidden()) {
      if (!shouldMask()) return;
      masked = true;
      e.stopImmediatePropagation();
    } else if (masked) {
      // Back on the tab: the page already thinks it's visible.
      masked = false;
      e.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('webkitvisibilitychange', (e) => {
    if (shouldMask()) e.stopImmediatePropagation();
  }, true);
  for (const type of ['blur', 'pagehide', 'freeze']) {
    window.addEventListener(type, (e) => {
      // Only the window's own blur, not focus leaving an input.
      if (type === 'blur' && e.target !== window && e.target !== document) return;
      if (shouldMask()) e.stopImmediatePropagation();
    }, true);
  }

  // --- Properties: keep reporting "visible" while masked ---

  const define = (key, value) => {
    const d = desc(Document.prototype, key);
    if (!d?.get) return;
    Object.defineProperty(Document.prototype, key, {
      ...d,
      get() { return masked && on ? value : d.get.call(this); },
    });
  };
  define('hidden', false);
  define('webkitHidden', false);
  define('visibilityState', 'visible');
  define('webkitVisibilityState', 'visible');
  Document.prototype.hasFocus = function () {
    return (masked && on) || realFocus.call(this);
  };

  // If the tab was hidden while masking was off (or a video only started
  // later), start masking once a video plays in the background, so the play
  // button in the picture-in-picture window works.
  document.addEventListener('play', () => {
    if (on && reallyHidden()) masked = true;
  }, true);
  document.addEventListener('enterpictureinpicture', () => {
    if (on && reallyHidden()) masked = true;
  }, true);

  document.addEventListener('bk-bgplay', (e) => {
    on = !!e.detail;
    if (!on) masked = false;
  });
  document.dispatchEvent(new Event('bk-bgplay-hello'));
})();
