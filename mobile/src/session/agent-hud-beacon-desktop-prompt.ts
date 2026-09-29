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
  return { nonce, text: unescapeJsonStringBody(body), cut: cutByHook, ...(anchorId ? { anchorId } : {}), ...(typedAt !== undefined ? { typedAt } : {}) }
}

/** Undo the escaping a JSON string body carries, without a JSON parse: the
 *  text may hold a lone trailing backslash after the 2000-character cut. */
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
      out += ''
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
