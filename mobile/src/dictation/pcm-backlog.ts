/**
 * Microphone audio held until it has somewhere to go: the take's stream while its account is looked
 * up (use-anthropic-dictation.ts), the socket until it opens (anthropic-voice-stream.ts). In order,
 * capped at `maxBytes`; past the cap a chunk is dropped and one log line, `overflowLine`, says so.
 */
export type PcmBacklog = {
  /** Holds the chunk, or drops it (false) once the cap is reached. */
  readonly push: (chunk: Uint8Array) => boolean
  /** Hands every held chunk to `send` in order and holds nothing after. */
  readonly drain: (send: (chunk: Uint8Array) => void) => void
  readonly clear: () => void
}

/** 16 kHz mono 16-bit PCM: 32,000 bytes a second. */
export const PCM_BYTES_PER_SECOND = 16000 * 2

export function createPcmBacklog(maxBytes: number, overflowLine: string): PcmBacklog {
  let held: Uint8Array[] = []
  let bytes = 0
  let warned = false
  return {
    push: (chunk) => {
      if (bytes + chunk.byteLength > maxBytes) {
        if (!warned) {
          warned = true
          console.warn(overflowLine)
        }
        return false
      }
      held.push(chunk)
      bytes += chunk.byteLength
      return true
    },
    drain: (send) => {
      const chunks = held
      held = []
      bytes = 0
      for (const chunk of chunks) {
        send(chunk)
      }
    },
    clear: () => {
      held = []
      bytes = 0
    }
  }
}
