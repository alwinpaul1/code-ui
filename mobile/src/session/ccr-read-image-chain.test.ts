import { describe, expect, it } from 'vitest'
import { applyCcrImages } from './ccr-image-overlay'
import { decodeCcrEvents, slimCcrEvent, ccrKeptImages } from './ccr-transcript-decode'
import { PNG_1PX } from './fixtures/ccr-session-api-2026-10-14'
import { SHEET_CALL_ID, readSheetEvents } from './fixtures/ccr-attachments-2026-10-15'
import { AGENT_READ_IMAGE_ALT, placeAgentImages } from './mobile-native-chat-agent-images'
import { collectHostImagePaths } from './use-host-image-previews'
import { ccrReadSlots } from './use-ccr-session-images'

// A Read of a .jpg through Anthropic's events, end to end except the React hooks: the decoded rows
// name the Read's path (so a slot exists), the cache the link filled by call id fills that slot,
// and the slot is drawn right after the tool run that read it, as the Claude app draws it.
// Shapes: fixtures/ccr-attachments-2026-10-15.ts (seq 18137-18138 of the recorded session).

const keep = (key: string) => `file:///cache/${encodeURIComponent(key)}`

describe('the contact sheet Claude Read, from Anthropic’s events to a drawn picture', () => {
  const { call, result } = readSheetEvents(PNG_1PX)
  const slim = slimCcrEvent(result, keep)
  const rows = decodeCcrEvents([call, slim], new WeakMap())
  const uri = keep(`ccr\0tool\0${SHEET_CALL_ID}`)

  it('gives the Read a slot, keyed by the assistant row’s own uuid', () => {
    expect(collectHostImagePaths(rows, {})).toEqual({ 'a-read-sheet': ['/private/tmp/scratchpad/rec3/sheet.jpg'] })
    expect(ccrReadSlots(rows)).toEqual([{ toolUseId: SHEET_CALL_ID, path: '/private/tmp/scratchpad/rec3/sheet.jpg' }])
  })

  it('fills the slot from the picture the link kept under the call id', () => {
    const previews = collectHostImagePaths(rows, {})
    const filled = applyCcrImages(
      Object.fromEntries(Object.entries(previews).map(([id, paths]) => [id, paths.map(() => '')])),
      { remote: { byToolUseId: Object.fromEntries(ccrKeptImages(slim).tool), byUserMessageId: {} }, messages: rows, agentIds: new Set(['a-read-sheet']), localPreviews: {} }
    )
    expect(filled).toEqual({ 'a-read-sheet': [uri] })
  })

  it('draws that picture full size right after the Read, not as a chip', () => {
    const blocks = rows.flatMap((row) => row.blocks)
    const placed = placeAgentImages(blocks, [uri])
    const tail = placed.slice(-1)[0]
    expect(tail).toEqual({ type: 'image-ref', path: '/private/tmp/scratchpad/rec3/sheet.jpg', url: uri, alt: AGENT_READ_IMAGE_ALT })
    expect(placed.findIndex((block) => block.type === 'tool-call')).toBeLessThan(placed.indexOf(tail!))
  })
})
