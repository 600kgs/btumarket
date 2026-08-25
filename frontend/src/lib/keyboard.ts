// Keeps the field a user just tapped visible above the on-screen keyboard.
//
// Browsers already scroll a focused field into view, but only when two things
// hold: the page has somewhere left to scroll, and the browser knows the
// keyboard is covering part of the window. A form that ends just below its
// last field fails the first - which is why a login page's email field
// behaves and the password field under it does not. In-app browsers
// (Instagram, Facebook) fail the second: they keep the viewport at full
// height and report no resize, so nothing in the page can tell the keyboard
// is there.
//
// So: give the document room to scroll, wait for the keyboard animation, and
// if the viewport never reported anything, move the field up ourselves.

const SETTLE_MS = 350;
// a real keyboard takes far more than this; anything smaller is a toolbar
const VIEWPORT_CHANGE_PX = 80;
// where a lifted field should sit, as a fraction of window height
const TARGET_FROM_TOP = 0.34;
// Fallback share of the window a keyboard takes when we have never measured
// one on this device - only in-app browsers get this far, since every real
// browser reports the resize. Deliberately at the high end of the range
// phone keyboards actually occupy (a number row, a suggestion strip or an
// emoji bar each add height): being too low clips the field, which is a
// broken screen, while being too high leaves space below it that the rule
// below paints to match the composer. Keyboards taller than this are what
// the measured value exists for.
const ASSUMED_KEYBOARD = 0.5;
// Bounds for a measured value, so a stray reading can't wreck the layout.
const MIN_KEYBOARD = 0.25;
const MAX_KEYBOARD = 0.6;
const MEASURED_KEY = "kbFraction";

let settleTimer: number | undefined;

// The keyboard is the same size in every browser on a given phone, but only
// some of them say so. Remember the share it took the last time a browser
// did report it, and reuse that where nothing reports anything - which is
// how the in-app browsers get a fitted layout instead of a guessed one.
function rememberKeyboardFraction(before: number, after: number): void {
  const fraction = (before - after) / before;
  if (fraction >= MIN_KEYBOARD && fraction <= MAX_KEYBOARD) {
    try {
      localStorage.setItem(MEASURED_KEY, fraction.toFixed(3));
    } catch {
      // private mode: fall back to the default, nothing else to do
    }
  }
}

function keyboardFraction(): number {
  let stored = NaN;
  try {
    stored = parseFloat(localStorage.getItem(MEASURED_KEY) || "");
  } catch {
    stored = NaN;
  }
  if (stored >= MIN_KEYBOARD && stored <= MAX_KEYBOARD) return stored;
  return ASSUMED_KEYBOARD;
}

function viewportHeight(): number {
  return window.visualViewport ? window.visualViewport.height : window.innerHeight;
}

// Only devices with an on-screen keyboard need any of this; a hardware
// keyboard covers nothing. Checked per focus rather than once at startup so
// a device that changes input mode (tablet with a detachable keyboard) is
// judged on what it is at the time.
function hasOnScreenKeyboard(): boolean {
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

export function openKeyboardRoom(el: HTMLElement | null): void {
  if (!hasOnScreenKeyboard()) return;
  document.body.classList.add("kb-room");
  const before = viewportHeight();
  window.clearTimeout(settleTimer);

  settleTimer = window.setTimeout(() => {
    if (!el || !el.isConnected) return;

    const after = viewportHeight();
    if (before - after > VIEWPORT_CHANGE_PX) {
      // The browser saw the keyboard and resized for it, so it can place the
      // field itself - and its measurement tells us this phone's keyboard
      // size for the browsers that never will.
      rememberKeyboardFraction(before, after);
      el.scrollIntoView({ block: "nearest" });
      return;
    }

    // No signal at all. The chat page is pinned to the viewport and cannot
    // scroll, so shrink the height it is pinned to instead - same mechanism
    // the real viewport would have used, on an assumed keyboard height. A
    // later real resize overwrites this with the true value.
    if (document.body.classList.contains("chat-page")) {
      // Marks that this height is a guess, so the space it may leave below
      // the composer can be painted to blend with it rather than reading as
      // a gap (see style.css).
      document.body.classList.add("kb-guess");
      const visible = Math.round(window.innerHeight * (1 - keyboardFraction()));
      document.documentElement.style.setProperty("--vvh", `${visible}px`);
      document.documentElement.style.setProperty("--vvtop", "0px");
      return;
    }

    // Ordinary page: lift the field into the upper third.
    const top = el.getBoundingClientRect().top;
    const target = window.innerHeight * TARGET_FROM_TOP;
    // "instant" explicitly: the stylesheet sets scroll-behavior: smooth on
    // html, and a smooth scroll both competes with the keyboard animation
    // and is unreliable in the in-app browsers this exists for
    if (top - target > 8) window.scrollBy({ top: top - target, behavior: "instant" });
  }, SETTLE_MS);
}

export function closeKeyboardRoom(): void {
  window.clearTimeout(settleTimer);
  document.body.classList.remove("kb-room", "kb-guess");
  if (document.body.classList.contains("chat-page")) {
    document.documentElement.style.setProperty("--vvh", `${viewportHeight()}px`);
  }
}
