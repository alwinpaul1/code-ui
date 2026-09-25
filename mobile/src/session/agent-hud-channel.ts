/**
 * The HUD beacon's wire encoding: four C0 control bytes that no terminal on
 * the path draws, acts on, or lets end a sequence.
 *
 * Why not an OSC: the beacon is written to the agent's tty by a SECOND
 * process (the status-line command, the hooks, Codex's notify), while the
 * agent writes its own frames to the same tty. When Orca reads the pty slowly
 * the kernel splits the agent's write and the beacon lands in the gap. An OSC
 * begins with ESC, and ESC aborts whatever sequence it lands in: `ESC[?` +
 * beacon + `2026h` drew `2026h` in the desktop Claude Code composer
 * (2026-09-25, Claude Code 2.1.281), and a frame landing inside the beacon
 * ended the OSC early and drew the rest of its payload (`used=… win=…`) as
 * text. Reproduced on a private pty with Claude-shaped frames and the host's
 * exact `printf`: 1-4 % of beacons land inside an escape at 5-20 ms of reader
 * lag.
 *
 * These four bytes cannot do that, whichever way a splice lands. Verified
 * against both parsers' own tables, not from memory:
 *
 *  - xterm.js 6.1 (the desktop renderer, 6.1.0-beta.303, and Orca's headless
 *    model, 6.1.0-beta.302; `EscapeSequenceParser.ts`): C0 other than CAN,
 *    SUB and ESC is EXECUTE in ground, ESC, ESC-intermediate and every CSI
 *    state, where the parser stays in its state; IGNORE in OSC, SOS/PM and
 *    APC. InputHandler registers execute handlers only for BEL, BS, HT, LF,
 *    VT, FF, CR, SO and SI, so these four reach the no-op fallback.
 *  - Ghostty (libghostty-vt b0947378, the phone's engine; `parse_table.zig`,
 *    `stream.zig`): the same actions per state, and `execute` ignores SOH and
 *    STX explicitly and ETX and ACK in its default branch. Only 0x00-0x0F are
 *    executed there: the ground fast path PRINTS 0x10-0x1F (except ESC) as
 *    one-cell glyphs, which rules out DLE through US.
 *
 * The rest of C0 is out for a stated reason: NUL (dropped by some paths),
 * ENQ (Ghostty answers it), BEL, BS, HT, LF, VT, FF, CR (they act), SO and SI
 * (charset shift), DC1 and DC3 (flow control), CAN and SUB (they abort a
 * sequence), ESC (it starts one), EOT (macOS drops it on output under
 * ONOEOT), and 0x10-0x1F (Ghostty draws them).
 *
 * One place still takes the bytes as data: a DCS passthrough, where both
 * parsers hand C0 to the DCS handler. Claude Code and Codex paint no DCS in
 * their frames, and the phone strips these bytes before its own engine sees
 * them. A beacon that lands between the bytes of one UTF-8 character still
 * breaks that glyph, as any second writer would: that is the host's decoder,
 * not an escape, and no byte choice avoids it.
 *
 * The frame: ACK, the body in base 3 (SOH = 0, STX = 1, ETX = 2), ACK. The
 * body is `<crc> <payload>` in UTF-8, where `<crc>` is the POSIX `cksum` of
 * the payload's bytes in decimal, each body byte written as two hex nibbles,
 * high first, and each nibble as three base-3 digits, most significant first.
 * That is what `od -tx1`, one `sed` and one `tr` can produce on the host with
 * no runtime, and the checksum keeps a program that happens to print these
 * bytes from injecting a bogus beacon.
 */

/** Frame delimiter: ACK. */
export const AGENT_HUD_CHANNEL_DELIMITER = '\u0006'

/** Base-3 digits 0, 1 and 2: SOH, STX, ETX. */
export const AGENT_HUD_CHANNEL_DIGITS = ['\u0001', '\u0002', '\u0003'] as const

/** Every byte the channel uses, and so every byte the phone takes out of the stream. */
// oxlint-disable-next-line no-control-regex -- the channel IS these control bytes
const CHANNEL_BYTE = /[\u0001-\u0003\u0006]/

/** A payload is at most this many bytes. The prompt hook cuts its text at 2000
 *  characters and percent-encodes three of them, so real beacons stay far
 *  below; an open frame that never closes must not grow without bound. */
export const AGENT_HUD_CHANNEL_MAX_PAYLOAD_BYTES = 16 * 1024
const MAX_DIGITS = (AGENT_HUD_CHANNEL_MAX_PAYLOAD_BYTES + 16) * 6

/** Where one terminal's stream stands: inside a frame or not, and the digits
 *  read so far. A frame spans any number of chunks. */
export type AgentHudChannelState = {
  open: boolean
  digits: number[]
}

export function createAgentHudChannelState(): AgentHudChannelState {
  return { open: false, digits: [] }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let crc = i << 24
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1
    }
    table[i] = crc >>> 0
  }
  return table
})()

/** POSIX `cksum`: CRC-32 (0x04C11DB7, MSB first) over the bytes and then the
 *  length, least significant byte first, complemented. */
export function posixCksum(bytes: Uint8Array): number {
  let crc = 0
  const step = (byte: number) => {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0
  }
  for (const byte of bytes) {
    step(byte)
  }
  for (let length = bytes.length; length > 0; length = Math.floor(length / 256)) {
    step(length % 256)
  }
  return ~crc >>> 0
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** The exact bytes the host scripts write for `payload`. Tests hold the sh
 *  writer to this, byte for byte, so the two cannot drift. */
export function encodeAgentHudChannelFrame(payload: string): string {
  const bytes = utf8(payload)
  const head = utf8(`${posixCksum(bytes)} `)
  let out = AGENT_HUD_CHANNEL_DELIMITER
  for (const byte of [...head, ...bytes]) {
    for (const nibble of [byte >> 4, byte & 0xf]) {
      out += AGENT_HUD_CHANNEL_DIGITS[Math.floor(nibble / 9)]!
      out += AGENT_HUD_CHANNEL_DIGITS[Math.floor(nibble / 3) % 3]!
      out += AGENT_HUD_CHANNEL_DIGITS[nibble % 3]!
    }
  }
  return out + AGENT_HUD_CHANNEL_DELIMITER
}

/** The payload a closed frame carries, or null when it is not one of ours:
 *  a digit count that is not whole bytes, a nibble past 15, no checksum, or a
 *  checksum that does not match. An empty payload is no beacon either. */
function decodeFrame(digits: readonly number[]): string | null {
  if (digits.length === 0 || digits.length % 6 !== 0) {
    return null
  }
  const bytes = new Uint8Array(digits.length / 6)
  for (let i = 0; i < bytes.length; i += 1) {
    let byte = 0
    for (let half = 0; half < 2; half += 1) {
      const at = i * 6 + half * 3
      const nibble = digits[at]! * 9 + digits[at + 1]! * 3 + digits[at + 2]!
      if (nibble > 15) {
        return null
      }
      byte = byte * 16 + nibble
    }
    bytes[i] = byte
  }
  const space = bytes.indexOf(0x20)
  if (space < 1 || space > 10) {
    return null
  }
  let crc = 0
  for (let i = 0; i < space; i += 1) {
    const digit = bytes[i]! - 0x30
    if (digit < 0 || digit > 9) {
      return null
    }
    crc = crc * 10 + digit
  }
  const payload = bytes.subarray(space + 1)
  if (payload.length === 0 || posixCksum(payload) !== crc) {
    return null
  }
  return new TextDecoder().decode(payload)
}

/**
 * Takes the channel's bytes out of one chunk, wherever they sit: between the
 * agent's escapes, inside them, or around a whole frame of its output. Every
 * other byte comes back untouched and in order, so the terminal renders what
 * it would have rendered with no beacon at all. Returns the payloads of the
 * frames this chunk closed that passed their checksum.
 */
export function takeAgentHudChannel(
  state: AgentHudChannelState,
  chunk: string
): { text: string; payloads: string[] } {
  const payloads: string[] = []
  if (!CHANNEL_BYTE.test(chunk)) {
    return { text: chunk, payloads }
  }
  let text = ''
  let runStart = 0
  for (let i = 0; i < chunk.length; i += 1) {
    const code = chunk.charCodeAt(i)
    if (code !== 1 && code !== 2 && code !== 3 && code !== 6) {
      continue
    }
    text += chunk.slice(runStart, i)
    runStart = i + 1
    if (code === 6) {
      if (state.open && state.digits.length > 0) {
        const payload = decodeFrame(state.digits)
        if (payload !== null) {
          payloads.push(payload)
        }
      }
      // Every ACK opens the next frame: a frame whose opening ACK was lost
      // fails its checksum and the stream is back in step at the next one.
      state.open = true
      state.digits = []
      continue
    }
    if (!state.open) {
      continue
    }
    if (state.digits.length >= MAX_DIGITS) {
      state.open = false
      state.digits = []
      continue
    }
    state.digits.push(code - 1)
  }
  text += chunk.slice(runStart)
  return { text, payloads }
}

/** Each terminal's place in the channel: a frame spans chunks. */
const channels = new Map<string, AgentHudChannelState>()

/** `takeAgentHudChannel` for one terminal handle, keeping its state between chunks. */
export function takeAgentHudChannelFor(
  handle: string,
  chunk: string
): { text: string; payloads: string[] } {
  let state = channels.get(handle)
  if (!state) {
    state = createAgentHudChannelState()
    channels.set(handle, state)
  }
  return takeAgentHudChannel(state, chunk)
}

/** Forgets every terminal's place, with the rest of the beacon store. */
export function resetAgentHudChannels(): void {
  channels.clear()
}

/** Every payload in a complete byte string, for callers that hold the whole
 *  thing (a tty file in a test, a captured pty log). */
export function decodeAgentHudChannelText(text: string): string[] {
  return takeAgentHudChannel(createAgentHudChannelState(), text).payloads
}
