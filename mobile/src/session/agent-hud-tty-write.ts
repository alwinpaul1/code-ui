// The part every POSIX beacon script shares: finding the agent's terminal and
// writing one frame to it, and percent-encoding a payload value. A leaf, so the
// scripts in agent-hud-launch-args.ts (and anything split out of it) can use
// it without importing each other.

/**
 * Finds the terminal to write to and writes `$o` there. Two ways in:
 *
 *  - Unix: the child has no controlling tty of its own, so walk up at most six
 *    parents for one (`ps -o tty=` → `ttys003` on macOS, `pts/3` on Linux) and
 *    write to `/dev/<that>`. Every `ps` is guarded: MSYS's own `ps` has no
 *    `-o tty=`, and the walk must never make noise or fail the script.
 *  - Windows: Claude Code runs status-line commands through Git Bash, where
 *    there is no PTY device to walk to. MSYS maps `/dev/tty` to the attached
 *    console instead, and the command inherits Claude's console under ConPTY —
 *    which is the stream Orca forwards. `/dev/conout` is the second try.
 *    UNTESTED on a real Windows host; see docs/mobile-agent-hud.md.
 *
 * What is written differs by branch:
 *
 *  - Unix: the C0 channel of `agent-hud-channel.ts` (`v`), never an escape.
 *    The agent paints the same tty from its own process, and the kernel can
 *    put this write inside one of the agent's writes. An OSC here began with
 *    ESC, which aborts whatever sequence it lands in: `ESC[?` + beacon +
 *    `2026h` drew `2026h` in the desktop Claude Code composer (2026-09-25).
 *    The channel's bytes draw nothing in xterm.js or Ghostty wherever a
 *    splice puts them (the limits are in `agent-hud-channel.ts`). `cksum` checks
 *    the payload, `od` turns it into hex, one `sed` turns each nibble into
 *    three base-3 letters, and `tr` maps the letters and the `w` delimiters
 *    to ACK, SOH, STX and ETX. No control byte ever sits in a shell variable
 *    (bash uses \001 internally), and the `tr -d` drops any newline a `sed`
 *    might add, which would move the cursor. With no `od` or no `cksum` the
 *    frame is empty or fails its checksum, and the phone ignores it.
 *  - Windows (MSYS): the OSC, as before (`w`). ConPTY rebuilds the output
 *    stream, and whether it passes these C0 bytes through is unknown; the
 *    Windows path has never run on a Windows machine.
 *
 * `CUIHUD_TTY` overrides the device; `CUIHUD_WIN_TTY` and `CUIHUD_WIN_CONOUT`
 * override the two Windows ones. Tests point them at temp files.
 * Quoted case patterns: an unquoted `?` would glob-match any single char.
 */
export const AGENT_HUD_TTY_WRITE = [
  // `2>/dev/null` FIRST: a failing `>>` is reported by the shell on fd 2, and
  // that must already be /dev/null or a Windows host with no console would
  // print an error into the terminal this exists to leave alone.
  'w(){ printf "\\033]7777;%s\\007" "$o" 2>/dev/null >> "$1"; }',
  'v(){ ck=$(printf %s "$o" | cksum 2>/dev/null | sed "s/ .*//"); { printf w; printf "%s %s" "$ck" "$o" | od -An -v -tx1 2>/dev/null | tr -d " \\n" | sed "s/0/xxx/g;s/1/xxy/g;s/2/xxz/g;s/3/xyx/g;s/4/xyy/g;s/5/xyz/g;s/6/xzx/g;s/7/xzy/g;s/8/xzz/g;s/9/yxx/g;s/a/yxy/g;s/b/yxz/g;s/c/yyx/g;s/d/yyy/g;s/e/yyz/g;s/f/yzx/g"; printf w; } | tr -d "\\n" | tr wxyz "\\006\\001\\002\\003" 2>/dev/null >> "$1"; }',
  'tt=$CUIHUD_TTY',
  'wn=0',
  'case $(uname -s 2>/dev/null || true) in MSYS*|MINGW*|CYGWIN*) wn=1;; esac',
  'if [ -z "$tt" ] && [ "$wn" = 0 ]; then pw=$PPID; nw=0; while [ -n "$pw" ] && [ "$pw" != 1 ] && [ $nw -lt 6 ]; do dv=$(ps -o tty= -p "$pw" 2>/dev/null | tr -d " " || true); case "$dv" in ""|"?"|"??") pw=$(ps -o ppid= -p "$pw" 2>/dev/null | tr -d " " || true);; *) tt="/dev/$dv"; break;; esac; nw=$((nw+1)); done; fi',
  'if [ -n "$tt" ] && [ "$wn" = 0 ]; then v "$tt"; elif [ -n "$tt" ]; then w "$tt"; elif [ "$wn" = 1 ]; then w "${CUIHUD_WIN_TTY:-/dev/tty}" || w "${CUIHUD_WIN_CONOUT:-/dev/conout}"; fi'
]

/** Percent-encodes what would otherwise break the `key=value` grammar:
 *  `%` first (or it would double-encode), then space and `;`. */
// LC_ALL=C: the prompt hook cuts its text at 2000 BYTES, and a byte-cut
// multibyte character made sed abort with "illegal byte sequence" in a UTF-8
// locale, so a long prompt with one umlaut or emoji sent nothing (2026-09-13).
export const ENCODE_FN = 'q(){ printf %s "$1" | LC_ALL=C sed -e "s/%/%25/g" -e "s/ /%20/g" -e "s/;/%3B/g"; }'
