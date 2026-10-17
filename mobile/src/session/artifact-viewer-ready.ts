/**
 * The viewer had two loaders at once (reported 2026-10-17): its own spinner until the page loaded,
 * then the artifact shell's spinner while it fetched and drew the artifact in a frame. Now one
 * opaque cover with Clawd stays over the page until the page itself has nothing loading.
 *
 * FRAMES_SCRIPT runs at document start and marks each iframe that finishes loading a real address
 * (a load event does not bubble, but a capture listener on the document sees it). READY_SCRIPT runs
 * after the page has loaded and says `artifactReady` once, for two checks in a row, the page has
 * drawn something, shows no spinner (an animated or progress element that is on screen) and has
 * no frame still loading. The shell's markup is not ours and was not inspectable (the artifact is
 * private), so this is a guess at what a spinner is: when it never says, READY_FALLBACK_MS after
 * the load the cover lifts anyway, and the user sees what the page shows, as before.
 */
export const FRAMES_SCRIPT = `(function () {
  if (window.__codeUiFrames || typeof document === 'undefined') { return; }
  window.__codeUiFrames = new WeakSet();
  document.addEventListener('load', function (event) {
    var frame = event.target;
    if (frame && frame.tagName === 'IFRAME' && frame.src && frame.src !== 'about:blank') { window.__codeUiFrames.add(frame); }
  }, true);
})();
true;`

export const READY_SCRIPT = `(function () {
  if (window.__codeUiReadyWatch) { return; }
  window.__codeUiReadyWatch = true;
  var calm = 0;
  function onScreen(el) {
    var box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  function spinning() {
    var found = document.querySelectorAll('[role="progressbar"], [aria-busy="true"], .animate-spin, svg, [class*="spin"], [class*="loader"], [class*="Loader"]');
    for (var i = 0; i < found.length; i++) {
      var el = found[i];
      var marked = el.getAttribute('role') === 'progressbar' || el.getAttribute('aria-busy') === 'true';
      if ((marked || getComputedStyle(el).animationName !== 'none') && onScreen(el)) { return true; }
    }
    return false;
  }
  function framesLoading() {
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      var src = frames[i].getAttribute('src');
      if (src && src !== 'about:blank' && window.__codeUiFrames && !window.__codeUiFrames.has(frames[i])) { return true; }
    }
    return false;
  }
  function drawn() {
    return document.querySelector('iframe[src]') !== null || ((document.body && document.body.innerText) || '').trim().length > 0;
  }
  function tick() {
    calm = drawn() && !spinning() && !framesLoading() ? calm + 1 : 0;
    if (calm >= 2) {
      if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(JSON.stringify({ artifactReady: true })); }
      return;
    }
    setTimeout(tick, 150);
  }
  tick();
})();
true;`

/** How long after the page loaded the cover waits for READY_SCRIPT before it lifts anyway. */
export const READY_FALLBACK_MS = 8000

/** The page's READY_SCRIPT message. */
export function isReadyMessage(data: string): boolean {
  try {
    const parsed: unknown = JSON.parse(data)
    return typeof parsed === 'object' && parsed !== null && (parsed as { artifactReady?: unknown }).artifactReady === true
  } catch {
    return false
  }
}
