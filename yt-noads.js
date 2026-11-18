// Browser Kit: stops YouTube video ads before they start, the way Brave and
// uBlock Origin do: YouTube tells its player which ads to show inside the
// "player response" data, so we remove the ad entries from that data before
// the player reads it. Runs in the page's context at document_start.
//
// settings.js still mutes and fast-forwards any ad that gets through (YouTube
// changes this data from time to time).

(() => {
  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];

  // settings.js mirrors the popup's settings into page storage. Until it has
  // (first run), the defaults apply: on.
  function enabled() {
    try {
      const s = JSON.parse(localStorage.getItem('ytqh-settings') || '{}');
      return s.enabled !== false && s['skip-ads'] !== false;
    } catch {
      return true;
    }
  }

  function strip(o) {
    if (!o || typeof o !== 'object') return;
    let on;
    for (const key of AD_KEYS) {
      if (!(key in o)) continue;
      on ??= enabled();
      if (!on) return;
      delete o[key];
    }
  }

  // The player response arrives bare, wrapped as { playerResponse }, or (on
  // in-site navigation) as an array of such objects.
  function prune(data) {
    try {
      for (const o of Array.isArray(data) ? data : [data]) {
        strip(o);
        strip(o?.playerResponse);
      }
    } catch {}
    return data;
  }

  // 1. The response embedded in the watch page's HTML.
  let initial = window.ytInitialPlayerResponse;
  prune(initial);
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: () => initial,
      set: (value) => { initial = prune(value); },
    });
  } catch {}

  // 2. Responses fetched later (next video, embeds), however they're decoded.
  const parse = JSON.parse;
  JSON.parse = function () {
    return prune(parse.apply(this, arguments));
  };
  const json = Response.prototype.json;
  Response.prototype.json = function () {
    return json.apply(this, arguments).then(prune);
  };
})();
