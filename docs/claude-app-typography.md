# Claude Android app: chat typography, colour and spacing

Read from the official Claude Android app on the user's own phone (Samsung
S23 Ultra), 2026-10-11:

- package `com.anthropic.claude`, **versionName 1.261009.20**, versionCode
  26100920 (from `dumpsys package`)
- splits pulled with `adb pull`: `base.apk`, `split_config.arm64_v8a.apk`,
  `split_config.xxhdpi.apk`
- decompiled with jadx 1.5.6 in a scratch directory outside the repo. Only
  names and numbers are recorded here. One exception: the working footer's
  animation. On 2026-10-15 the user chose to ship the old spinner sprite
  `cc_spinner_sprite` after being told it is Anthropic's artwork. App
  1.261013.20 dropped that sprite for a "working mark" drawn from frame data,
  and that frame data now ships as
  `mobile/src/session/claude-working-mark-data.ts` in its place (see "Working
  footer" below). It is Anthropic's animation data in the same way the sprite
  was Anthropic's artwork. Nothing else from the APK (fonts, images, code) is
  in this repo.

The class names below are R8-obfuscated (`jn7`, `zv`, `pl7`, ...). They
change with every release, so treat them as pointers for re-checking this
build, not as stable names. Resource names (`R.string.*`, font file names)
are stable.

## Stack

**Native Kotlin, Jetpack Compose with Compose Multiplatform resources.** No
React Native bundle, no Hermes, no Flutter engine. Evidence: the font files
live under `assets/composeResources/claude.theme.generated.resources/font/`,
which is the Compose Multiplatform resource layout, and the code builds
`TextStyle`, `FontWeight`, `LineHeightStyle` and Material 3 `ColorScheme`
objects directly. The Markdown renderer is a fork of the open-source
compose-richtext library (its style classes keep their `toString` names:
`RichTextStyle`, `ListStyle`, `CodeBlockStyle`, `TableStyle`,
`InlineCodeChipStyle`, `BarGutter`).

## Fonts

| Family | File in the APK | Kind | Axes | Used for |
|---|---|---|---|---|
| Anthropic Sans (name table: "Anthropic Sans Text") | `anthropic_sans.ttf`, `anthropic_sans_italic.ttf` | variable | `wght` 300–800, `opsz` 16–48 | all UI text, and the transcript prose in Claude Code sessions (default) |
| Anthropic Serif ("Anthropic Serif Text") | `anthropic_serif.ttf`, `anthropic_serif_italic.ttf` | variable | `wght` 300–800, `opsz` 16–48 | display and title styles, and the prose of ordinary claude.ai chats |
| Noto Serif | `noto_serif.ttf`, `noto_serif_italic.ttf` | variable | `wght` 400–700 | glyph fallback behind Anthropic Serif only (`be4.AnthropicSerif` carries it) |
| JetBrains Mono 2.304 | `jetbrains_mono.ttf` | variable | `wght` 100–800 | code in the base theme (`kob.G` builds the default type set with it). In a Claude Code session it is used **only when the user picks it** in Code font; the default there is the system monospace (`jhf.b` = `FontFamily.Monospace`) |
| anthropicon_symbols | `assets/anthropicon_symbols.ttf` | icon font | – | icons |
| Latin Modern Math | `assets/fonts/latinmodern-math.otf` | – | – | LaTeX |

How the families are built (`jhf`, `be4`, font loader `tff`):

- The variable fonts are instantiated at fixed points: optical sizes
  **16, 17, 20, 24, 28, 32, 34, 48** (`jhf.c`) and weights **400, 500, 550,
  600, 700** (`jhf.d`). A style passes its own size as the optical size
  (`agf.a(17f)` for a 17 sp style), so 17 sp text is drawn from the opsz 17
  master and 28 sp titles from opsz 28. Below API 29 it falls back to static
  instances.
- **Weight 550** (`po1.L()` returns `FontWeight(550)`) is the app's "semibold".
  It is used for every heading and every bold variant. When the app is drawing
  with system fonts (where 550 does not exist), any weight from 500 up to 599
  is bumped to 600 (`y330.q`).
- **No letter spacing anywhere.** Every style in the type scale leaves
  `letterSpacing` unspecified (0).
- Every style uses `LineHeightStyle(alignment = Center, trim = None,
  mode = Fixed)` (`kn7.j`; `p5j`, `m5j.b = 0.5`) and `TextDirection.Content`.
  Line heights are given in **em** (multiples of the font size), not sp.

### Claude Code reading settings

Claude Code sessions have their own reading settings
(`a41`, keys in SharedPreferences, strings `code_transcript_*`, `code_font_*`):

| Setting | Key | Options | Default |
|---|---|---|---|
| Transcript font | `code_prose_font` | Anthropic Sans, System (`v31`) | **Anthropic Sans** |
| Code font | `code_mono_font` | System, JetBrains Mono (`u31`) | **System** (`FontFamily.Monospace`) |
| Transcript text size | (`w31`) | Small, Medium, Large | **Medium** |
| Line wrap | `code_line_wrap_enabled` | on/off | off |

Text size is applied as a font-scale multiplier on top of the system font
scale (`s230.p`): **Small 0.85, Medium 1.0, Large 1.15**. All sizes below are
at Medium. The session then picks one of four variants of the type set
(`s230` → `kn7.f/g/h/i` = `kn7.d(prose, code)`), so in a default Code session
prose is Anthropic Sans and code is the platform monospace.

## The two type sets

Values are `fontSize / weight / lineHeight`. Line height in sp is size ×
the em value, worked out in the last column.

### UI scale (`jn7`, reached as `en7.c(..).k.w`)

| Field | Family | Size | Weight | Line height | = sp |
|---|---|---|---|---|---|
| `v` | Serif, opsz 48 | 28 | 400 | 1.3 | 36.4 |
| `w` | Serif, opsz 32 | 22 | 400 | 1.3 | 28.6 |
| `x` | Serif, opsz 48 | 28 | 500 | 1.3 | 36.4 |
| `y` | Serif, opsz 48 | 34 | 550 | 1.3 | 44.2 |
| `z` | Serif, opsz 48 | 17 | 550 | 1.3 | 22.1 |
| `A` | Sans | 20 | 500 | 1.4 | 28 |
| `B` | Sans | 17 | 400 | 1.4 | 23.8 |
| `C` | Sans | 17 | 550 | 1.4 | 23.8 |
| `D` | Sans | 17 | 400 | 1.6 | 27.2 |
| `E` | Sans | 15 | 400 | 1.4 | 21 |
| `F` | Sans | 15 | 550 | 1.4 | 21 |
| `G` | Sans | 15 | 500 | 1.6 | 24 |
| `H` | Sans | 13 | 400 | 1.4 | 18.2 |
| `I` | Sans | 13 | 550 | 1.4 | 18.2 |
| `J` | Sans | 13 | 400 | 1.6 | 20.8 |
| `K` | Sans | 11 | 400 | 1.5 | 16.5 |
| `L` | Sans | 11 | 550 | 1.5 | 16.5 |

`E` (15 sp) is by far the most used style in the app, then `H` and `B`. The
Material typography is mapped from it (`p5y.a`: `z` for display, `B` for
titles, `E` for body, `H` and `K` for labels).

### Prose scale for chat Markdown (`zv`, reached as `en7.c(..).k.x`)

This set uses the **prose family** of the active variant: Anthropic Sans in a
default Claude Code session, Anthropic Serif in an ordinary chat.

| Field | Role | Size | Weight | Line height | = sp |
|---|---|---|---|---|---|
| `a` | H1 | 28 | 550 | 1.3 | 36.4 |
| `b` | H2 | 24 | 550 | 1.3 | 31.2 |
| `c` | H3, and H4–H6 (the same style) | 20 | 550 | 1.3 | 26 |
| `d` | **assistant body text** | **17** | **400** | **1.5** | **25.5** |
| `e` | body bold | 17 | 550 | 1.5 | 25.5 |
| `f` | small prose: thinking block, tool-step details | 15 | 400 | 1.6 | 24 |
| `g` | small prose bold | 15 | 550 | 1.6 | 24 |
| `h` | code (code blocks, inline code) | 15 | 400 | 1.5 | 22.5 |
| `i` | small code (code-block language label, tool-row details) | 13 | 400 | 1.5 | 19.5 |

`h` and `i` use the code family with `TextDirection.Ltr`: JetBrains Mono in
the base theme, the platform monospace in a default Claude Code session
(`s230.k`, `code_mono_font` = "system").

## Roles in the chat screen

| Role | Size / weight / line height | Font | Colour (light / dark) | Source |
|---|---|---|---|---|
| Assistant body text | 17 / 400 / 1.5 em (25.5 sp) | Anthropic Sans (Code session default) | `#131313` / `#F9F9F7` | `zv.d` is the default style of the Markdown composable `yy20.e`; the Code-session message part `n84` calls it with no style. The colour is the content colour `pl7.O` (Material `onBackground`/`onSurface`, `krz.k`) |
| Screen background | – | – | `#F9F9F7` / `#151515` | `pl7.q`, Material `background` |
| Raised surface | – | – | `#FFFFFF` / `#20201F` | `pl7.p`, Material `surface` |
| Secondary text | – | – | `#383835` / `#C3C2B7` | `pl7.P` |
| Muted text | – | – | `#7B7974` / `#97958D` | `pl7.Q`, Material `onSurfaceVariant` |
| H1 / H2 / H3–H6 | 28 / 24 / 20, weight 550, 1.3 em | prose family | body colour | `zv.a/b/c` via `ics.a` (`HeadingStyles`) |
| Bold | weight 550 (700 if unset) | – | – | `ics.b`, `RichTextStringStyle.boldStyle` |
| Paragraph spacing | 8 sp between blocks | – | – | `ics.a` (`RichTextStyle.paragraphSpacing`) |
| Lists | marker indent 8 sp, contents indent 4 sp, item spacing 4 sp | – | – | `ics.b` → `lmj` (`ListStyle`) |
| Block quote | 6 sp start margin, 3 sp bar, 6 sp end margin | – | – | `e04` (`BarGutter`) |
| Links | underlined | – | `pl7.c` = `#D97757` both modes (callers can override) | `ics.b`, `fcs.linkStyle` |
| Inline code text | 15 / 400 / 1.5 em, the code font | system mono | `#184F95` / `#6DA7EC` | `ad5.C0()` passed by `yy20.e`; inline code can be a file link (`InlineCodeLinkTarget(path, line)`) |
| Inline code chip | background, 0.5 dp border, **6.4 dp radius**, 4 dp horizontal and 1 dp vertical padding | – | bg `#0B0B0B` at 5% / `#FFFFFF` at 7.5%; border `#1E1E1D` at 15% / `#E1E0D9` at 15% | `ics.b` → `xph` (`InlineCodeChipStyle`), bg `ad5.I0()`, border `pl7.x` |
| Code block text | 15 / 400 / 1.5 em, no wrap by default | system mono | syntax-highlighted | `zv.h` in `CodeBlockStyle` (`r08`, `wordWrap = false`) |
| Code block container | 12 dp radius, clipped; body padding 16 dp all round | – | body `#F3F3F0` / `#111111` | `w330` (body `pl7.r`, header `pl7.s`) |
| Code block header | at least 40 dp tall, 16 dp horizontal padding; language label (first letter capital; **"Code"** when the fence has none — "plaintext" is only the highlighter's default), Copy and Expand icons | label 13 / 400 / 1.5 mono | header `#F0EFEC` / `#0D0D0D`; label and icons `#383835` / `#C3C2B7` | `kso` (label `zv.i`, tint `pl7.P`, strings `code_block_copy_button`, `code_block_expand_button`) |
| Tables | header row bold, cell max width 520 dp | – | border `#1E1E1D` at 30% / `#E1E0D9` at 30% | `kpx` (`TableStyle`) via `yy20.e` (`kvc(520)`), border `pl7.w` |
| Thinking status line | 15 / 400 / 1.6 em, rotating verbs (`R.array.thinking_timeline_verbs`) | Sans | – | `hz20.c` uses `zv.f` |
| User message (Code session) | 15 / 400 / 1.4 em (21 sp) | Anthropic Sans | text `#131313` / `#F9F9F7` | `w030.g`, default `jn7.E`. Headings inside a user message are flattened to the body size at weight 550 (`ics.c`) |
| User message card (Code session) | card, **12 dp radius**, hairline border, **12 dp horizontal × 14 dp vertical padding**, max width 652.8 dp | – | fill `#F0EFEC` / `#2C2C2A`; border `pl7.x` (`#1E1E1D` / `#E1E0D9` at 15%) | `w030.b` (shape `bn7.v` = 12 dp, fill `pl7.w0`, padding in `mvt`). See the note below |

**User message layout depends on the conversation's "presentation".** The
app has two (`bkl`): `Page` and `Bubbles`. A Claude Code session is
configured as `Document` presentation (`hy8` "CodeSessionConfig" =
`bp9(63)` → presentation 1 → `bkl.Page`), so its user messages are the
**card** in the last row. The bubble layout (`vml.b`) is used in Messaging
presentation and, behind the `claudeai_chat_reply_bubbles` flag, in ordinary
chats:

| Bubble mode | Text | Corners | Padding | Max width |
|---|---|---|---|---|
| Messaging (mode 2) | `jn7.B` 17 / 400 / 1.4 | 24 dp, 4 dp on the tail corner (end side) | 16 dp horizontal, 12 dp vertical | 312 dp |
| Flagged chat (mode 1) | `jn7.E` 15 / 400 / 1.4 | 20 dp, 4 dp on the tail corner | 20 dp horizontal, 14 dp vertical | 312 dp |

Both bubbles fill with `pl7.w0` (`#F0EFEC` / `#2C2C2A`) and draw text in
`pl7.O` (`BubbleShape(tail, big, small)` in `db4`, radii from `bn7.i/j/b`,
padding `vml.d/e/f/g`).

### Tool rows, status line, composer, thumbnails

| Role | Values | Colour (light / dark) | Source |
|---|---|---|---|
| Tool-run label ("Ran 3 commands, read a file") | `jn7.E` 15 / 400 / 1.4, one line, ellipsis (middle ellipsis for a lone file path) | verbs `pl7.Q` `#7B7974` / `#97958D`; a file name in the label is `pl7.O` in the code font; an all-failed part is `ad5.u()` `#8E2626` / `#EC7E7E` | `da20.a`, `h330.i`, `zx20` |
| Tool-run row box | 12 dp radius, padding 8 dp sides, 6 dp top and bottom; label, 4 dp, 16 dp chevron (`caretRight`) in `pl7.Q` | – | `w55.b`, `da20.a` |
| Live-run icon | 24 dp, nudged 2 dp left, then 4 dp gap | `ad5.y()` `#898781` both | `da20.c` |
| Line-count pill ("+93 −2") | 8 dp after the label; 11 / 550 / 1.5 (`jn7.L`); two joined segments 18 tall with 6 horizontal padding; 4.5 sp corner radius | add `#1E9E3C` / `#32D74B` on itself at 20%; delete `#CD2054` / `#FF2C56` on itself at 20% | `ra20.a` |
| Working footer ("12s · 1,234 tokens · 3 running tasks · thinking…"); 1.261009.20 values, superseded by "Working footer" below | `jn7.E` 15 / 400 / 1.4; 16 dp clay spinner, 8 dp gap; separator " · "; 16 dp vertical padding | text `pl7.Q`; "N running tasks" link `ad5.C0()` `#184F95` / `#6DA7EC`; verb-only form ("Cooking...") in clay `pl7.e` | `nl7.b`, `au8` |
| Status line, what it says (read 2026-10-15) | Four forms (`zaw`): `Stats` (stats, count, " · status", `yaw`), the random verb + "..." (`vaw`), a connection `Message` "Connecting..." / "Connection lost..." (`waw`, one line, trailing "…" swapped for "...") and an offline `Notice` (`xaw`, any lines). After thinking: "thought for %1$s" until 2000 ms after the span closed, span at least 1 s. Token figure counts up (first over 1200 ms, a rise over the gap since the last figure held to 300..3000 ms, a fall jumps; drawn 1..real). Idle with tasks: spinner at rest frame 4, 16 dp gap, count | same colours; messages in clay | `au8` case 0, `zs20.x` (886-1048), `g8y`, `xrd` default case, `nl7.b` 187-188 |
| Composer shell | 24 dp radius, 0.5 dp border, shadow blur 8 / black 10% / y 2, 8 dp vertical padding | fill `pl7.p` at 96% (`#FFFFFF` / `#20201F`); border `pl7.x` | `o530.b` |
| Composer text | `jn7.B` **17 / 400 / 1.4** (23.8 sp), padding **13 dp horizontal, 8 dp vertical**, 1 to 6 lines then scrolls | text and caret `pl7.O`; placeholder `pl7.Q` | `aj1` case 1, `ib8` |
| Composer text-to-buttons gap | **16 dp**, measured on the user's screen recording (2026-10-14: 46 px at 2.8125 px/dp from the caret's foot to the buttons' top). Read as 11 dp (8 + 3, half of the row's extra 6) from the decompile before that; the recording does not bear it out | – | `di9`, `yg9.a = 6` |
| Composer button row | 8 dp in from each side, 42 dp tall (36 dp buttons + 6) | – | `ai9` |
| Composer buttons | all 36 dp, 48 dp touch target, 20 dp icons; model chip 36 dp pill, 16 dp side padding, max 220 dp | Send fill `pl7.e` `#C6613F` / `#D97757`, white arrow; Stop fill `pl7.x0` `#F0EFEC` / white at 8%, icon `pl7.O`; mic `pl7.P` | `yg9`, `bb8`, `md6.a` |
| Queued message ("Queue a message…") | 80% width, 12 dp radius, 12 dp padding, `jn7.E` **italic**, 14 dp "x" at top end | fill `pl7.s` `#F0EFEC` / `#0D0D0D`; text `pl7.Q` | `hb20.e` |
| Image thumbnails in a user message | **96 × 96 dp, 12 dp radius, Crop**, one horizontally scrolling row with 8 dp gaps, 8 dp below when text follows; no shimmer, the tile is filled while loading | tile `pl7.q` `#F9F9F7` / `#151515` | `m330`, `g330.c` |
| Images in assistant or tool content | full width, max 400 dp tall, 12 dp radius, Fit, 8 dp from the text | tile `pl7.s` `#F0EFEC` / `#0D0D0D` | `y030.s` |
| Scroll-to-bottom button | 40 dp circle, 48 dp target, 16 dp `arrowDown`, 0.5 dp border, shadow blur 8 / black 10% / y 2 | fill `pl7.p` at 96%; icon `pl7.O` | `gc20.c`, `c6b` |
| Chat list gutters | 16 dp horizontal; most rows 12 dp above; tool runs and notices a further 8 dp each side | – | `yv8.x` |

## Working footer (app 1.261013.20, read 2026-10-15)

Re-read from **1.261013.20** (versionCode 26101320, installed 2026-10-14),
the build the user's screen recording of 2026-10-15 was made with. It
replaces the 16 dp sprite spinner of 1.261009.20 with a 20 dp "working
mark", and the footer is a **row of the transcript list**, not a bar pinned
above the composer. Code UI follows both after 0.9.154 (the change landed
unreleased; check which release carries it).

| What | App 1.261013.20 | Where in the decompile |
|---|---|---|
| Placement | A `LazyColumn` item keyed `"thinking_spark"`, the list's last row. In the reversed list it is emitted after `session_pills` and `queued_message`, so on screen it sits **above** a queued message and scrolls with the transcript | `y07` case 15, `d6j.k(.., "thinking_spark", ..)` |
| Horizontal inset | the list item's 16 dp horizontal padding, the same gutter as the transcript's prose | `rrb.Q(.., 16f, 0, 2)` |
| Row | fillMaxWidth, **16 dp padding top and bottom**, children centred vertically | `wm7.a`, `oxb.I(.., 0, 16, 1)` |
| Mark | a **20 dp** canvas, then an **8 dp** spacer, then the label | `zq20.a`, `pmw.p(.., 20f)`, `pmw.u(.., 8f)` |
| Label switching | `AnimatedContent` labelled `"spark line"`, keyed by the call id in the `Call` form and by a constant otherwise, so verb, stats and message swap **without** a transition | `el00.a`, `r0x`, `s0x` |
| Forms (`w0x`) | `v0x` Stats: stats (rolling), " · " + count link, " · " + status, all muted; `t0x` Message (connection; a trailing "…" becomes "..."); `u0x` Notice; `s0x` verb + "..." in clay; `r0x` Call (a running call's text + 8 dp + clock), not ported | `wm7.b`, `wm7.d`, `z530.a` |
| Idle with tasks | the count alone, no mark, min width 48 dp | `wm7.a` |
| Text | 15 / 400 / 1.4 (21) | `xo7.C` |
| Colours | verb clay `ro7.e` `#C6613F` / `#D97757`; stats and status `ro7.Q` `#7B7974` / `#97958D`; count link `ro7.a.C0()` `#184F95` / `#6DA7EC`; mark in the footer's clay (token `ro7.R` / `z74.b`, not pinned down; the recording's dots are clay) | `wm7.a`, `zq20` |
| Separator | `ccr_spark_segment_separator` " · " | strings |
| Elapsed | `ccr_thinking_elapsed_seconds` "%1$ds", minutes "%1$dm %2$ds" | `rt30`, `qq30.o` |
| Verbs | the same 20, the same clock (3 s, 4 s, then every 6 s; read in 1.261009.20 `l8`, assumed unchanged) | `wm7.a` list |
| Placeholder | `ccr_input_placeholder_existing_session_queue` "Queue a message…" (U+2026) | strings |
| Stop | the composer's send slot, as before | `yg9` |

**The working mark** (`zq20`, `tr20`, `vq20`, `ar20`, `aa10`, `ir20`). A 20 dp
canvas drawing up to a handful of shapes per frame. Each shape is six shorts
`(kind, cx, cy, r, a, b)` in thousandths of the box: kind 0 a filled circle,
1 a ring of stroke width `a`, 2 an ellipse with radii `(r, a)` rotated `b`
degrees. Some strips carry a colour per frame (Waiting for user does).

| Kind (`rq20`) | opening | loop | exit frames | rest frame | closing |
|---|---|---|---|---|---|
| Think | 16 | 110 | 54 | 95 | 15 |
| Generic | 16 | 40 | none (loop end) | 38 | 14 |
| Search | 16 | 20 | none | 4 | 14 |
| Read | 21 | 60 | none | 44 | 19 |
| Code | 16 | 75 | 18, 37, 56 | 74 | 9 |
| Write | 31 | 60 | none | 36 | 14 |
| Waiting for user | 16 | 30 | none | 0 | 16 |
| Grow (shared) | 10 | – | – | – | – |

- Player (`tr20.a`): 30 frames a second (33,333,333 ns). Grow, then the
  kind's opening, then its loop for ever.
- Retarget (`aa10` case 10): play the current loop on to its next exit
  frame, close it, open the new kind. Waiting for user does not wait more
  than 1.5 s for an exit: it jumps to 20 frames before the loop's end.
- A change that moves the frame cross-fades for 300 ms, eased
  cubic-bezier(0.42, 0, 0.58, 1) (`ir20.c`, `jfd.c`).
- Reduced motion or preview (`s7i.a`): the kind's loop rest frame, still.
- Appear and disappear scale and fade over 400 ms with
  cubic-bezier(0.22, 1, 0.36, 1) (`fr20`): **not ported**.
- Which kind (`zr8` case 18): while working, the turn's running tool call
  (`d1x.a`); with none running and no thinking under way, the turn's last
  tool call; else Think. Tools map as Read/Grep/Glob and MCP resource reads →
  Read; Edit/NotebookEdit/Write/TodoWrite and SendMessage/SendUserMessage/
  SendUserFile → Write; Bash → Code; web tools → Search; Task, ExitPlanMode,
  slash commands → Generic; any other tool → Code if it is a git tool
  (`mcp__git__git_*`), else Generic. The packed-switch targets were matched
  from jadx's grouping, not traced instruction by instruction.

Regenerating the frame data after an app update: pull the APK, find the
strips the clips in `vq20` point at, and re-run the two scratch scripts used
on 2026-10-15 (`extract_mark.py` reads the `short[]` arrays and the frame
offsets out of the decompiled class, `gen_ts.py` writes
`claude-working-mark-data.ts`). The test
`claude-working-mark.test.ts` checks every strip still tiles into its
opening, loop and closing.

**Rolling figures** (`z530.a`, `u95`, `z530.x`, `z530.y`): digit runs (with
"," "." " " or "'" between two digits) are numbers; every digit is drawn in a
slot as wide as the widest of 0..9; segments are keyed from the end; a
changed digit slides by the full line height on spring(damping ratio 0.9,
stiffness 380) and fades over 130 ms, upward when the number grew. Code UI:
`claude-rolling-text.ts`, `ClaudeRollingText.tsx`.

### Measured on the user's phone

S23 Ultra, density 450 (2.8125 px/dp), font scale 1.0.

| Measure | App recording, 2026-10-15 (1.261013.20) | Code UI 0.9.153 screenshot | Code UI after this change (by code) |
|---|---|---|---|
| Transcript prose left edge | 46–48 px (16.4 dp) | 16.4 dp | 16 dp |
| Mark box | 45–101 px, dots 48–97 px (17–34.5 dp), centre y 1826 | 16 dp sprite, four 5.7 dp dots, 17.8–31 dp | 20 dp box at 16–36 dp, the app's frames |
| Words start | 126 px (44.8 dp) | 44.8 dp | 16 + 20 + 8 = 44 dp + glyph bearing |
| Text | 15 / 21, clay verb, muted stats, blue count | same | same |
| Mark glyph size | dots about 3.5 dp | dots about 5.7 dp | the app's frames |
| Cap top → composer shell | 48.4 dp | 47.7 dp | not measured |
| Glyph bottom → composer shell | 93 px (33.1 dp) | 32.5 dp | not measured |
| Footer box bottom → composer shell | about 47 px (16.7 dp) | – | 8 dp list padding + 4 dp composer inset = 12 dp by code; unverified on device |
| Scroll behaviour | scrolls with the transcript | pinned over the transcript: at a scroll position the count sat on top of prose (0.9.154) | scrolls with the transcript |

The 0.9.153 screenshot does not agree with that build's code: by code its
words started at 36 dp and its line sat about 4 dp + padding above the
composer, but the screenshot measures 44.8 dp and about 12 dp more. That
difference is not explained, so the "after" column's 12 dp gap below the
footer is a reading of the code, not a measurement. Check it on the device
against the app's 16.7 dp before adjusting.

## Colour tokens used above

Two layers. `pl7` is the app's colour scheme (light `c59.e`, dark `c59.f`).
Its first 41 fields come from `n5y` (light) and `m5y` (dark), built from the
primitive ramp `r59`. A second token interface, `ad5`, is implemented by
`j95` (light) and `i65` (dark).

| Token | Light | Dark | Role as used |
|---|---|---|---|
| `pl7.O` | `#131313` | `#F9F9F7` | primary text, Material onBackground/onSurface |
| `pl7.P` | `#383835` | `#C3C2B7` | secondary text |
| `pl7.Q` | `#7B7974` | `#97958D` | muted text |
| `pl7.q` | `#F9F9F7` | `#151515` | screen background |
| `pl7.p` | `#FFFFFF` | `#20201F` | surface |
| `pl7.r` | `#F3F3F0` | `#111111` | code block body |
| `pl7.s` | `#F0EFEC` | `#0D0D0D` | code block header, image tiles in assistant content |
| `pl7.w0` | `#F0EFEC` | `#2C2C2A` | user message fill |
| `pl7.w` | `#1E1E1D` at 30% | `#E1E0D9` at 30% | table borders |
| `pl7.x` | `#1E1E1D` at 15% | `#E1E0D9` at 15% | hairlines, inline code border, Material outline |
| `pl7.c` | `#D97757` | `#D97757` | Claude clay (brand), link colour |
| `ad5.C0()` | `#184F95` | `#6DA7EC` | inline code text |
| `ad5.I0()` | `#0B0B0B` at 5% | `#FFFFFF` at 7.5% | inline code fill |
| `ad5.x0()` | `#52514E` | `#C3C2B7` | dimmed assistant text (passed when a message part is marked inactive, `n84`) |
| `ad5.u0()` | `#0B0B0B` | `#F0EFEC` | sender name in "Received message from …" rows, numbers in task counts |
| `pl7.e` | `#C6613F` | `#D97757` | Send button, spinner, Material primary |
| `ad5.y()` | `#898781` | `#898781` | live tool-row icon, section headers |

**The earlier screenshot sample is confirmed.** Dark body text (248,248,246)
on (21,21,21) matches `#F9F9F7` (249,249,247) on `#151515` (21,21,21). The
one-step difference in the text is anti-aliasing in the screenshot. Light
mode is `#131313` on `#F9F9F7`.

## Closest freely licensed alternative in the repo

Code UI uses **Instrument Sans** (`@expo-google-fonts/instrument-sans` 0.4.2,
static 400/500/600/700, SIL OFL). Anthropic Sans is proprietary and must not
be bundled. Measured with fontTools on both files (Anthropic Sans instanced at
wght 400, opsz 17):

| Metric (per em) | Anthropic Sans | Instrument Sans | Difference |
|---|---|---|---|
| x-height | 0.540 | 0.510 | Anthropic's lowercase is about 6% taller |
| cap height | 0.720 | 0.720 | same |
| ascender / descender | 0.993 / −0.258 | 0.970 / −0.250 | about 2% shorter in Instrument |
| width of a pangram at 400 | 26.56 em | 26.21 em | Instrument about 1.3% narrower |
| weights | variable, uses 400 / 500 / 550 / 600 / 700 | 400 / 500 / 600 / 700 | no 550 in Instrument: use 600 for headings and bold, as the app itself does on system fonts |
| optical sizes | opsz 16–48, per style | none | Instrument's large sizes look a little looser than Anthropic's opsz 28–48 cuts |

At the same point size Instrument Sans reads slightly smaller because of the
lower x-height. Matching the app's 17 sp body with Instrument Sans at 17 gives
the same line length to within about 1–2%. For code, the app's default is the
platform monospace, not JetBrains Mono, so Code UI's bundled JetBrains Mono
already matches the app's **optional** code font.

For comparison, Code UI's current scale (`mobile/src/theme/tokens.ts`) has
body 15/21, heading 17/22 and mono 13/18. The app's Claude Code transcript
body is **17/25.5**, its user message 15/21, and its code 15/22.5.

## Not determined

- **Which user-message layout a given chat gets is set by server-side
  config.** The Code-session config (`hy8`) gives the Page card. A flag or a
  different conversation type can give the bubble. Check a screenshot before
  choosing.
- **Heading spacing.** Only the 8 sp paragraph spacing was found. I saw no extra
  margin above or below headings, but did not trace the renderer's heading
  composable.
- **Syntax colours** in code blocks (`y230.b`) were not extracted.
- **The attach (+) button** composable, and the exact trigger for the
  one-row (collapsed) composer, which looks like keyboard hidden and field
  empty but is not confirmed.
- **The pill unit.** Its 18 and 6 go through a font-scale helper (`krz.v`), so
  they are probably dp that scale with font size.
- **On-device check.** All values are read from code at the Medium transcript
  size and font scale 1.0. None was measured on screen in this pass.
