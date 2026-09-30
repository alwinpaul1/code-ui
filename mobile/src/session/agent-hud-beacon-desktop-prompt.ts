import type { DesktopPrompt } from './agent-hud-beacon'

// The prompt hook's fields on a beacon (`up=`, `cut=`, `at=`, `ts=`), read
// into the copy the chat draws (use-desktop-prompt-echoes.ts). Moved out of
// agent-hud-beacon.ts, which holds the store; this holds only the reading.

/** `up=<hook pid>:<JSON string body>`, `raw` as parseAgentHudBeaconPayload
 *  hands it over. Two encodings sit on the body, and each is undone once:
 *
 *   - The hook's `q` (ENCODE_FN, agent-hud-tty-write.ts) writes `%` as `%25`,
 *     space as `%20` and `;` as `%3B`, so the words fit the payload's
 *     space-separated `key=value` grammar. The payload parser's decodeValue
 *     has already undone exactly those three; nothing here decodes a `%`
 *     again. A second pass (decodeURIComponent, until 2026-09-30) turned any
 *     `%XX` the person typed into the byte it names: `a%20b` came out `a b`,
 *     `%41` came out `A`, `%5Cn` came out a newline, and the copy then never
 *     matched its own transcript row. No writer the phone can still hear
 *     from sends any other `%` code: the first PowerShell hook's `%0D` and
 *     `%0A` (release 0.5.33) went in 0.5.34, which sends the JSON body
 *     instead, and a Windows host gets no beacon flag at all
 *     (hostTakesAgentHudFlag).
 *   - The body is the raw JSON text of the prompt, so `\n` and `\"` are
 *     still escaped there, and unescapeJsonStringBody undoes that. */
export function readDesktopPrompt(
  raw: string | undefined,
  cutByHook: boolean,
  anchorRaw?: string,
  typedRaw?: string
): DesktopPrompt | null {
  if (!raw) {
    return null
  }
  const cut = raw.indexOf(':')
  if (cut <= 0) {
    return null
  }
  const nonce = raw.slice(0, cut)
  const body = raw.slice(cut + 1)
  if (!/^[0-9]+$/.test(nonce) || body.length === 0) {
    return null
  }
  // A uuid the hook read off the transcript; anything else is not an anchor.
  const anchorId = anchorRaw && /^[0-9a-fA-F-]{8,}$/.test(anchorRaw) ? anchorRaw : undefined
  // Epoch seconds by the desk clock: nine to eleven digits, 1973 to 5138.
  // Anything else is not a time, and a wrong one would place the copy wrong.
  const typedAt = typedRaw && /^[0-9]{9,11}$/.test(typedRaw) ? Number(typedRaw) * 1000 : undefined
  const text = unescapeJsonStringBody(cutByHook ? withoutCutDebris(body) : body)
  if (text.length === 0) {
    return null
  }
  return { nonce, text, cut: cutByHook, ...(anchorId ? { anchorId } : {}), ...(typedAt !== undefined ? { typedAt } : {}) }
}

/** A cut body less what the cut left half-written. The hook cuts the JSON
 *  body at 2000 BYTES (`awk substr` on a byte-counting awk), so it can split
 *  a multibyte character, whose leading bytes decode to U+FFFD, or a JSON
 *  escape: a lone `\`, or `\u` with fewer than four hex digits. None of it is
 *  what the person typed, and any of it keeps the copy from being a prefix of
 *  its transcript row, so the copy never retired and the message drew twice
 *  for the rest of the session (review of 2026-09-30). Dropping it only
 *  shortens the prefix the copy is matched by. The trailing U+FFFD is also
 *  dropped from a cut copy the warm start restores (`withoutCutTail`). */
export function withoutCutDebris(body: string): string {
  const out = withoutCutTail(body)
  const unicode = /\\u[0-9a-fA-F]{0,3}$/.exec(out)
  if (unicode && startsAnEscape(out, unicode.index)) {
    return out.slice(0, unicode.index)
  }
  return out.endsWith('\\') && startsAnEscape(out, out.length - 1) ? out.slice(0, -1) : out
}

/** A cut copy's text less the U+FFFD a split multibyte character leaves. */
export function withoutCutTail(text: string): string {
  return text.replace(/\uFFFD+$/, '')
}

/** Whether the backslash at `index` begins an escape: the run of backslashes
 *  ending there is odd, so it is not the second half of a `\\`. */
function startsAnEscape(body: string, index: number): boolean {
  let run = 0
  while (index - run >= 0 && body[index - run] === '\\') {
    run++
  }
  return run % 2 === 1
}

/** Undo the escaping a JSON string body carries, without a JSON parse: a body
 *  may end in a lone backslash (one the person typed at the end of an uncut
 *  prompt reads as itself; a cut's half escape is gone by now,
 *  `withoutCutDebris`). */
export function unescapeJsonStringBody(body: string): string {
  let out = ''
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\' || i === body.length - 1) {
      out += body[i]
      continue
    }
    const next = body[++i]
    if (next === 'n') {
      out += '\n'
    } else if (next === 't') {
      out += '\t'
    } else if (next === 'r') {
      // Dropped. A CRLF copy still retires, since the retire key folds the
      // line end as whitespace on both sides (`landedKey`); a lone CR does
      // not. Keeping it is left to a change that also rebuilds the stored
      // copy mobile-native-chat-remember-echo.test.ts makes with this
      // function, which asserts the CR is gone (isCutAtHookLength allows
      // for it with CRLF_ALLOWANCE_BYTES, and would size a kept one exactly).
      out += ''
    } else if (next === 'b') {
      // The characters JSON means, not the letters: the row keeps them, and
      // the retire key strips them on both sides (review of 2026-09-30).
      out += '\b'
    } else if (next === 'f') {
      out += '\f'
    } else if (next === 'u') {
      const hex = body.slice(i + 1, i + 5)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(Number.parseInt(hex, 16))
        i += 4
      } else {
        out += next
      }
    } else {
      out += next
    }
  }
  return out
}
