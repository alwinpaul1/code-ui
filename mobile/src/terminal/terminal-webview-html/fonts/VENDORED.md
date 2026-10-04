# Vendored fonts

`NotoSansSymbols2-MediaControls.ttf` (+ `NOTO-SANS-SYMBOLS2-LICENSE`, SIL Open Font License 1.1):
Noto Sans Symbols 2 v2.008 (https://github.com/notofonts/symbols), subset to U+23F4..U+23FA for
Claude Code's `⏵⏵ auto mode on`, which no font on a Galaxy S23 has. 6,436 bytes, sha256
`0a0654fdc5eec8a511adeaa0aeebe95044195ec579425125085da69ca30bf43d`.

First vendored for the Termux engine in 9c01356bd (removed with that engine); taken back from that
commit unchanged. The WebView terminal document embeds it as a base64 `@font-face` limited to that
range (`../media-control-glyphs-font-face.ts`); `terminal-webview-media-control-glyphs.test.ts`
checks the embedded copy against this file byte for byte.

The symbols-only Nerd Font 9c01356bd also carried (2.2 MB, private-use powerline and devicon cells)
is not vendored here: the user's status line and recent Orca terminal history draw no private-use
glyphs.
