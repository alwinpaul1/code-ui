import { describe, expect, it } from 'vitest'
import {
  AGENT_HUD_CHANNEL_DELIMITER,
  AGENT_HUD_CHANNEL_DIGITS,
  AGENT_HUD_CHANNEL_MAX_PAYLOAD_BYTES,
  createAgentHudChannelState,
  decodeAgentHudChannelText,
  encodeAgentHudChannelFrame,
  posixCksum,
  takeAgentHudChannel
} from './agent-hud-channel'

const ACK = AGENT_HUD_CHANNEL_DELIMITER
const PAYLOAD =
  'CUIHUD1 agent=claude hk=1 hb=5 model=claude-opus-5 used=649540 win=1000000 pct=64'

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Feeds `stream` in the given pieces through one state, like chunks off the wire. */
function feed(pieces: string[]): { text: string; payloads: string[] } {
  const state = createAgentHudChannelState()
  let text = ''
  const payloads: string[] = []
  for (const piece of pieces) {
    const taken = takeAgentHudChannel(state, piece)
    text += taken.text
    payloads.push(...taken.payloads)
  }
  return { text, payloads }
}

describe('the checksum is the host cksum, so a frame the host wrote is one the phone accepts', () => {
  it('matches POSIX cksum on the values /usr/bin/cksum gives (macOS 27, 2026-09-25)', () => {
    expect(posixCksum(bytes('abc'))).toBe(1219131554)
    expect(posixCksum(bytes('CUIHUD1 agent=claude'))).toBe(2813502745)
    expect(posixCksum(bytes(''))).toBe(4294967295)
    expect(posixCksum(bytes('hé'))).toBe(1388735601)
  })
})

describe('the phone reads a beacon wherever the channel bytes land', () => {
  it('decodes a frame and hands every other byte on unchanged', () => {
    const out = feed([`before${encodeAgentHudChannelFrame(PAYLOAD)}after`])
    expect(out).toEqual({ text: 'beforeafter', payloads: [PAYLOAD] })
  })

  it('decodes a frame split across every chunk boundary, once', () => {
    const stream = `a${encodeAgentHudChannelFrame(PAYLOAD)}b`
    for (let cut = 0; cut <= stream.length; cut += 1) {
      expect(feed([stream.slice(0, cut), stream.slice(cut)]), `cut at ${cut}`).toEqual({
        text: 'ab',
        payloads: [PAYLOAD]
      })
    }
    // One byte per chunk, the degenerate end of the same thing.
    expect(feed([...stream])).toEqual({ text: 'ab', payloads: [PAYLOAD] })
  })

  it('decodes two beacons written back to back, in order', () => {
    const second = 'CUIHUD1 agent=claude run=b0q56d8gf'
    const out = feed([encodeAgentHudChannelFrame(PAYLOAD) + encodeAgentHudChannelFrame(second)])
    expect(out).toEqual({ text: '', payloads: [PAYLOAD, second] })
  })

  it('decodes UTF-8 past ASCII, as a desktop prompt carries it', () => {
    const prompt = 'CUIHUD1 agent=claude up=123:déjà%20vu,%20日本語 🙂'
    expect(decodeAgentHudChannelText(encodeAgentHudChannelFrame(prompt))).toEqual([prompt])
  })
})

describe('nothing that is not a whole checksummed frame becomes a beacon', () => {
  it('ignores an empty frame and a frame whose payload is empty', () => {
    expect(feed([`x${ACK}${ACK}y`])).toEqual({ text: 'xy', payloads: [] })
    expect(feed([encodeAgentHudChannelFrame('')])).toEqual({ text: '', payloads: [] })
  })

  it('rejects a frame with one digit changed, by its checksum', () => {
    const frame = encodeAgentHudChannelFrame(PAYLOAD)
    // Flip every digit in turn; no single-digit error may pass.
    for (let at = 1; at < frame.length - 1; at += 1) {
      const digit = AGENT_HUD_CHANNEL_DIGITS.indexOf(frame[at] as '\u0001')
      const flipped = AGENT_HUD_CHANNEL_DIGITS[(digit + 1) % 3]!
      const bad = frame.slice(0, at) + flipped + frame.slice(at + 1)
      expect(decodeAgentHudChannelText(bad), `digit ${at}`).toEqual([])
    }
  })

  it('rejects stray channel bytes a program printed, and still reads the next real beacon', () => {
    // readline leaks SOH/STX around prompts; a binary dump prints anything.
    // Seeded so a failure names one sequence.
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const alphabet = [ACK, ...AGENT_HUD_CHANNEL_DIGITS]
    for (let run = 0; run < 200; run += 1) {
      let garbage = ''
      for (let i = Math.floor(random() * 400); i > 0; i -= 1) {
        garbage += alphabet[Math.floor(random() * alphabet.length)]
      }
      const out = feed([`x${garbage}y`])
      expect(out.payloads, `run ${run}`).toEqual([])
      expect(out.text).toBe('xy')
      // The stream is back in step at the next opening ACK.
      expect(feed([garbage, encodeAgentHudChannelFrame(PAYLOAD)]).payloads, `run ${run}`).toEqual([
        PAYLOAD
      ])
    }
  })

  it('drops a frame that stray digits landed inside, rather than decoding it wrong', () => {
    const frame = encodeAgentHudChannelFrame(PAYLOAD)
    const middle = Math.floor(frame.length / 2)
    const hit = frame.slice(0, middle) + AGENT_HUD_CHANNEL_DIGITS[1] + frame.slice(middle)
    expect(decodeAgentHudChannelText(hit)).toEqual([])
  })

  it('gives up on a frame that never closes instead of holding it forever', () => {
    const state = createAgentHudChannelState()
    const digit = AGENT_HUD_CHANNEL_DIGITS[0]
    takeAgentHudChannel(state, ACK + digit.repeat((AGENT_HUD_CHANNEL_MAX_PAYLOAD_BYTES + 32) * 6))
    expect(state.open).toBe(false)
    expect(state.digits).toEqual([])
    // A frame past the cap is not a beacon even when it does close.
    const huge = encodeAgentHudChannelFrame(`CUIHUD1 ${'x'.repeat(AGENT_HUD_CHANNEL_MAX_PAYLOAD_BYTES + 64)}`)
    expect(decodeAgentHudChannelText(huge)).toEqual([])
  })

  it('returns a chunk with no channel bytes as the same string', () => {
    const state = createAgentHudChannelState()
    const chunk = '\u001b[?2026h plain output \u001b[?2026l'
    expect(takeAgentHudChannel(state, chunk)).toEqual({ text: chunk, payloads: [] })
  })
})
