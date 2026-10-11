import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildMobileNativeChatTransientData, foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { READ_CALL_ID, SEND_CALL_ID, SEND_FILE_CAPTION, SEND_FILE_TURN } from './fixtures/claude-send-user-file-2.1.296'

// The coordinator's review of 61da3b3d5/22be887d0: the host fetch is off on the
// structured lane and while disconnected (use-mobile-native-chat-controller.ts
// passes `enabled: showNativeChat && !activeChatStructured && connState ===
// 'connected'`), so the hook hands the view no entry at all for those rows.
// A placeholder there was permanent, since nobody would ever ask. A slot is
// drawn only where the hook holds an entry: asked, pending, or refused.

const STEP_ID = '790c0712-a09f-4359-9754-562f9f77ac86'

function step(raw: NativeChatMessage[], previews: Record<string, string[]> | undefined): NativeChatMessage {
  const folded = foldMobileNativeChatMessages(raw)
  return buildMobileNativeChatTransientData({ messages: raw, folded, streaming: null, pending: [], imagePreviewsByMessageId: previews })
    .data.find((message) => message.id === STEP_ID)!
}

const images = (message: NativeChatMessage) => message.blocks.filter((block) => block.type === 'image-ref')

describe('pictures nobody asked the host for', () => {
  it('draws no placeholder where the host fetch is switched off (structured lane, disconnected)', () => {
    const drawn = step(SEND_FILE_TURN, undefined)
    expect(images(drawn)).toEqual([])
    // The caption is the agent's own words and still shows.
    expect(drawn.blocks.some((block) => block.type === 'text' && block.text === SEND_FILE_CAPTION)).toBe(true)
  })

  it('still draws the placeholder where the fetch was asked and is pending or refused', () => {
    expect(images(step(SEND_FILE_TURN, { [READ_CALL_ID]: [''], [SEND_CALL_ID]: [''] }))).toHaveLength(2)
  })

  it('draws the picture a transcript carries itself, and no placeholder beside it', () => {
    const picture = { type: 'image-ref' as const, url: 'https://files.example/where.png' }
    const raw = SEND_FILE_TURN.map((message) =>
      message.id === 'c8849b9b-271e-4c06-af4a-dc80ed991a52'
        ? { ...message, blocks: [{ type: 'tool-result' as const, output: '' }, picture] }
        : message
    )
    // No transcript on this machine carries one (Orca 1.4.224 keeps only a
    // URL-sourced image), so the shape is the reader's own: an `image-ref`
    // with a URL in the result's row, which the vendored fold leaves a row of
    // its own after the step. Every row of the turn is checked.
    const folded = foldMobileNativeChatMessages(raw)
    const all = buildMobileNativeChatTransientData({ messages: raw, folded, streaming: null, pending: [], imagePreviewsByMessageId: undefined })
      .data.flatMap(images)
    expect(all).toEqual([picture])
  })
})
