# Terminal-mode scroll: why 0.2.81 still jittered, and what 0.2.82 changes

Reported on the Galaxy S23 (120 Hz) against 0.2.81: "still laggy and jittery".
0.2.81 had introduced the sub-row compositor transform on `.xterm-screen`, so
the remaining problem had to be in the pairing between that transform and
xterm's own repaint, or in the input path. Measured in desktop Chrome against
the emitted WebView document with xterm 6.1.0-beta.303, driving synthetic
touch events and sampling the PAINTED state (xterm's `onRender` row plus the
transform actually in the DOM) after each frame.

## What was measured

Finger moving 6 px per frame over a 4 460-row scrollback.

| scenario | 0.2.81 painted steps (px/frame) | frames behind the finger |
| --- | --- | --- |
| quiet terminal | 6, 6, 6, … | 2 |
| agent output landing in the same frames | 21, −9, 21, −9, 6, … | 2 |
| agent output wrapped in synchronized output (DEC 2026) | rows freeze, then snap | 2 |

The quiet case was smooth but two frames late. The other two are exactly what
the S23 shows while Claude Code streams: Claude wraps every repaint in
`ESC[?2026h … ESC[?2026l`, and over the relay the two halves often arrive in
different chunks.

## Three causes

1. **A frame of lag that bought nothing.** Each touchmove parked its delta in a
   `requestAnimationFrame` before calling `term.scrollLines()`. Chromium already
   delivers one touchmove per display frame, and xterm's `RenderDebouncer` folds
   every `scrollLines()` of a frame into one repaint, so the extra frame
   coalesced nothing. Finger → buffer → xterm paint was three frames.
2. **The remainder was written on a predicted frame, not the painted one.**
   The transform was deferred one frame to meet xterm's repaint. But a write the
   agent streamed in the same frame had already booked xterm's next paint, so
   the committed rows landed one frame before the remainder written for them: a
   whole row forward, most of it back. That is the +21/−9 oscillation.
3. **Synchronized output parks the repaint.** With `?2026h` open, xterm buffers
   every `refreshRows`, scroll included, until the closing sequence (or a 1 s
   timeout). The buffer scrolled, the transform followed the finger, the
   picture did not move, and then everything snapped when `?2026l` arrived.

## What 0.2.82 does

- `enqueueNormalBufferScrollDelta` applies the delta in the touchmove itself.
- `term.onRender` is the ground truth. It records the row xterm actually
  painted (`renderedViewportY`) and rewrites the transform in that same frame,
  cancelling the predicted one.
- Rows the buffer has scrolled past but xterm has not painted ride on the
  transform (`unpaintedRowsOffsetY`). When the paint lands, the same call hands
  the distance back to the rows, so nothing jumps. The cost during a long
  synchronized-output hold is a strip of unpainted background at one edge,
  which beats a frozen picture and a snap.
- `androidLayerType="hardware"` is gone from `TerminalWebView`. It was added in
  0.2.81 on a guess; LAYER_TYPE_HARDWARE makes the framework redraw the
  WebView's whole offscreen texture on every content change, and Chromium's
  compositor already moves the translated layer without it.

Re-measured with the same harness, input dispatched as a task before each
frame as real touch input is:

| scenario | 0.2.82 painted steps | frames behind |
| --- | --- | --- |
| quiet | 6 × 90 | 0 |
| interleaved writes with split `?2026h`/`?2026l` | 6 × 90 | 0 |

## Tests

`mobile/src/terminal/terminal-webview-smooth-scroll.test.ts` boots the real
document in happy-dom with a fake xterm whose paint runs one frame late and can
be withheld. Three tests failed before the change with the measured symptoms
(0 px after one frame; −20 px steps; +10 px steps) and pass after:

- shows the finger's move on the very next frame, not two frames later
- keeps every frame's step even when agent output already booked xterm's repaint
- keeps the picture moving while synchronized output withholds the repaint

## Not verified

The S23 itself: the phone was not connected while this was measured. The
harness proves the algorithm; the device still has to confirm the frame budget
(a full-viewport WebGL repaint per committed row) holds at 120 Hz.
