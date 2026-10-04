# Vendored fonts

`NotoSansSymbols2-MediaControls.ttf` (+ `NOTO-SANS-SYMBOLS2-LICENSE`, SIL Open Font License 1.1):
Noto Sans Symbols 2 v2.008 (https://github.com/notofonts/symbols), subset to U+23F4..U+23FA for
Claude Code's `⏵⏵ auto mode on`, which no font on a Galaxy S23 has. 6,436 bytes, sha256
`0a0654fdc5eec8a511adeaa0aeebe95044195ec579425125085da69ca30bf43d`.

First vendored for the Termux engine in 9c01356bd (removed with that engine); taken back from that
commit unchanged. The WebView terminal document embeds it as a base64 `@font-face`
(`../media-control-glyphs-font-face.ts`); `terminal-webview-media-control-glyphs.test.ts` checks the
embedded copy against this file byte for byte.

The file holds seven code points, but the face's `unicode-range` selects only the four triangles,
U+23F4..U+23F7 (advance 0.586em, inside a terminal cell of about 0.6em). ⏸ ⏹ ⏺ (U+23F8..U+23FA)
advance 0.910em here, and ⏺ is the dot Claude Code puts on every message row, so they are left to
the system fonts that drew them before (2026-10-04). The same test reads the advances from this file
and fails if the range ever selects a glyph wider than a cell. The file is not re-subset, so the size
and sha256 above still hold.

The symbols-only Nerd Font 9c01356bd also carried (2.2 MB, private-use powerline and devicon cells)
is not vendored here: the user's status line and recent Orca terminal history draw no private-use
glyphs.
