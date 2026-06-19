/**
 * analytics.js — Drop this into each GitHub Pages app.
 *
 * Either inline it just before </body>, or load it as a module:
 *   <script type="module" src="/analytics.js"></script>
 *
 * The only thing you need to change per-page is APP_ID.
 */

(function () {
  // ── CONFIG ───────────────────────────────────────────────
  const ENDPOINT = 'https://shadowfoot.com/analytics/track.php'; // ← your PHP URL
  const TOKEN    = '9b2615c7e2c8d838dd661ff0e2ff887e2a3a450a800a51494616685af25425dd';          // ← must match track.php
  // Derive app_id from the full URL path, normalised:
  //   - strip leading slash
  //   - strip file extension
  //   - strip trailing 'index' segment
  // e.g. /ingress/countdown/index.html → ingress/countdown
  //      /ingress/countdown/           → ingress/countdown
  //      /ingress/countdown/map.html   → ingress/countdown/map
  const APP_ID = location.pathname
    .replace(/^\//, '')          // strip leading slash
    .replace(/\.[^/.]+$/, '')    // strip extension
    .replace(/\/index$/, '')     // strip trailing /index
    .replace(/^index$/, '')      // handle bare index at root
    || 'root';
  // ────────────────────────────────────────────────────────

  // Don't track if running locally
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

  const payload = {
    app_id:         APP_ID,
    referrer:       document.referrer || '',
    viewport_width: window.innerWidth || null,
  };

  fetch(ENDPOINT, {
    method:   'POST',
    headers: {
      'Content-Type':      'application/json',
      'X-Analytics-Token': TOKEN,
    },
    body:      JSON.stringify(payload),
    // keepalive ensures the request completes even if the page unloads immediately
    keepalive: true,
  }).catch(function () {
    // Silently swallow errors — analytics should never break the app
  });
})();
