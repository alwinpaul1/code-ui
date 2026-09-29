import type { DesktopPrompt } from './agent-hud-beacon'

// The prompt hook's fields on a beacon (`up=`, `cut=`, `at=`, `ts=`), read
// into the copy the chat draws (use-desktop-prompt-echoes.ts). Moved out of
// agent-hud-beacon.ts, which holds the store; this holds only the reading.

/** `up=<hook pid>:<percent-encoded JSON string body>`. The body is the raw
 *  JSON text of the prompt, so `\n` and `\"` are still escaped there. */
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
  let decoded: string
  try {
    decoded = decodeURIComponent(body)
  } catch {
    decoded = body
  }
  // A uuid the hook read off the transcript; anything else is not an anchor.
  const anchorId = anchorRaw && /^[0-9a-fA-F-]{8,}$/.test(anchorRaw) ? anchorRaw : undefined
  // Epoch seconds by the desk clock: nine to eleven digits, 1973 to 5138.
  // Anything else is not a time, and a wrong one would place the copy wrong.
  const typedAt = typedRaw && /^[0-9]{9,11}$/.test(typedRaw) ? Number(typedRaw) * 1000 : undefined
  return { nonce, text: unescapeJsonStringBody(decoded), cut: cutByHook, ...(anchorId ? { anchorId } : {}), ...(typedAt !== undefined ? { typedAt } : {}) }
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
