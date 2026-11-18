// Browser Kit: downloads the videos (and, if asked, photos) of your saved
// Instagram posts. popup.js injects this into an instagram.com tab. It reads
// the saved feed through Instagram's own web API (the same requests
// instagram.com makes, sent with your login cookies) and hands each file to
// background.js, which saves it with chrome.downloads.
//
// It goes slowly on purpose (a few seconds per file, longer between pages, and
// backs off when Instagram says to slow down) so it looks like normal browsing.
// Progress is kept in storage.local 'reels-job' for the popup; files already
// saved are remembered in 'reels-done' so a second run only fetches new ones.
//
// Started from a collection page (instagram.com/<you>/saved/<name>/<id>/), it
// downloads only that collection, into Downloads/Instagram Saved/<name>/.

(() => {
  if (window.bkReelsRunning) return;
  window.bkReelsRunning = true;

  const APP_ID = '936619743392459'; // instagram.com's own web app id
  const ROOT = 'Instagram Saved';

  // A collection page, but not "All posts", which is the whole saved feed.
  const coll = location.pathname.match(/^\/[\w.]+\/saved\/([^/]+)\/(\d+)\/?/);
  const collName = coll && decodeURIComponent(coll[1]).replace(/[-_]+/g, ' ').trim();
  const collection = coll && coll[1] !== 'all-posts'
    ? { id: coll[2], name: collName.replace(/[\\/:*?"<>|~.]+/g, '_').slice(0, 80) || coll[2] } : null;
  const API = location.origin + (collection
    ? `/api/v1/feed/collection/${collection.id}/posts/` : '/api/v1/feed/saved/posts/');
  const FOLDER = collection ? `${ROOT}/${collection.name}` : ROOT;
  // Collection downloads are remembered separately, so a post already saved
  // to the main folder still lands in the collection's folder.
  const doneKey = (id) => (collection ? `c${collection.id}:${id}` : id);

  // Firefox content scripts fetch as the extension unless they use
  // content.fetch; Chrome's already fetch as the page.
  const pageFetch = typeof content !== 'undefined' && content?.fetch
    ? content.fetch.bind(content) : fetch;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (min, max) => min + Math.random() * (max - min);
  const csrf = () => document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] || '';

  let job = {};
  function save(patch) {
    job = { ...job, ...patch, updatedAt: Date.now() };
    return chrome.storage.local.set({ 'reels-job': job });
  }

  // The popup's Stop button sets this.
  const stopRequested = async () => !!(await chrome.storage.local.get('reels-stop'))['reels-stop'];

  // Sleeps, keeping the heartbeat fresh (the popup treats a job that hasn't
  // updated in a while as dead) and waking early on Stop. False = stopped.
  async function wait(ms) {
    const end = Date.now() + ms;
    for (;;) {
      if (await stopRequested()) return false;
      const left = end - Date.now();
      if (left <= 0) return true;
      await save({});
      await sleep(Math.min(5000, left));
    }
  }

  class Fatal extends Error {}
  class Stopped extends Error {}

  async function getPage(maxId) {
    const url = API + (maxId ? '?max_id=' + encodeURIComponent(maxId) : '');
    for (let attempt = 0; ; attempt++) {
      let res = null;
      let body = null;
      try {
        res = await pageFetch(url, {
          credentials: 'include',
          headers: { 'X-IG-App-ID': APP_ID, 'X-CSRFToken': csrf(), 'X-Requested-With': 'XMLHttpRequest' },
        });
        body = await res.json().catch(() => null);
      } catch {}
      if (res?.ok && body?.status === 'ok') return body;

      const slowDown = !res || res.status === 429 || res.status >= 500
        || (body?.status === 'fail' && /wait|try again/i.test(body.message || ''));
      if (!slowDown) {
        if (!body || res.status === 401 || res.status === 403 || body.require_login) {
          throw new Fatal('Instagram didn\'t let us read your saved posts. Make sure you\'re logged in on instagram.com, then try again.');
        }
        throw new Fatal('Instagram said: ' + (body.message || 'HTTP ' + res.status));
      }
      if (attempt >= 4) throw new Fatal('Instagram keeps asking to slow down. Try again in an hour or so.');
      const minutes = 2 ** attempt; // 1, 2, 4, 8
      await save({ message: `Instagram asked to slow down. Waiting ${minutes} min…` });
      if (!(await wait(minutes * 60000))) throw new Stopped();
      await save({ message: '' });
    }
  }

  const area = (v) => (v.width || 0) * (v.height || 0);
  const best = (list) => list.reduce((a, b) => (area(b) > area(a) ? b : a));

  // One saved post → the files to save. Carousels give one file per slide.
  function filesOf(media, photos) {
    const user = (media.user?.username || 'unknown').replace(/[^\w.-]/g, '_');
    const key = String(media.id || media.code || media.pk);
    const base = `${FOLDER}/${user}_${(media.code || key).replace(/[^\w-]/g, '_')}`;
    const parts = media.media_type === 8 ? media.carousel_media || [] : [media];
    const out = [];
    parts.forEach((p, i) => {
      const suffix = parts.length > 1 ? `_${i + 1}` : '';
      const id = key + suffix;
      if (p.video_versions?.length) {
        out.push({ id, url: best(p.video_versions).url, filename: base + suffix + '.mp4' });
      } else if (photos && p.image_versions2?.candidates?.length) {
        out.push({ id, url: best(p.image_versions2.candidates).url, filename: base + suffix + '.jpg' });
      }
    });
    return out;
  }

  async function run() {
    const opts = await chrome.storage.sync.get({ 'reels-photos': false, 'reels-skip': true });
    const { 'reels-done': done = {} } = await chrome.storage.local.get('reels-done');
    await chrome.storage.local.remove('reels-stop');
    job = { state: 'running', posts: 0, saved: 0, skipped: 0, failed: 0, current: '', message: '', startedAt: Date.now(),
      folder: FOLDER };
    await save({});

    let maxId = null;
    do {
      const page = await getPage(maxId);
      for (const { media } of page.items || []) {
        if (!media) continue;
        await save({ posts: job.posts + 1 });
        for (const f of filesOf(media, opts['reels-photos'])) {
          if (opts['reels-skip'] && done[doneKey(f.id)]) {
            await save({ skipped: job.skipped + 1 });
            continue;
          }
          if (await stopRequested()) throw new Stopped();
          await save({ current: f.filename.slice(FOLDER.length + 1) });
          const r = await chrome.runtime.sendMessage({ type: 'bk-reels-download', url: f.url, filename: f.filename })
            .catch((e) => ({ ok: false, error: e.message }));
          if (r?.ok) {
            done[doneKey(f.id)] = 1;
            await chrome.storage.local.set({ 'reels-done': done });
            await save({ saved: job.saved + 1 });
          } else {
            await save({ failed: job.failed + 1, message: 'Last error: ' + (r?.error || 'unknown') });
          }
          if (!(await wait(jitter(1500, 3500)))) throw new Stopped();
        }
      }
      maxId = page.more_available ? page.next_max_id : null;
      if (maxId && !(await wait(jitter(2500, 5000)))) throw new Stopped();
    } while (maxId);
  }

  run()
    .then(() => save({ state: 'done', current: '' }))
    .catch((e) => save(e instanceof Stopped ? { state: 'stopped', current: '' }
      : { state: 'error', current: '', message: e instanceof Fatal ? e.message : 'Something went wrong: ' + e.message }))
    .finally(() => {
      window.bkReelsRunning = false;
      chrome.storage.local.remove('reels-stop');
    });
})();
