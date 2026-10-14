import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { applyCcrImages, collectHostImageCallIds } from './ccr-image-overlay'
import { NO_CCR_IMAGES } from './ccr-remote-images'
import { READ_IMAGE_CALL_ID, READ_IMAGE_ROWS } from './fixtures/claude-agent-message-read-image-2.1.283'

// Where Anthropic's pictures go in the chat's preview map: only where the
// desktop and the phone left a slot empty.

const READ_TOOL_ID = 'toolu_01CbCVp2SjFhYsDs8MPXLyPT'
const API = 'data:image/png;base64,AAAA'
const HOST = 'file:///cache/host.png'
const PHONE = 'file:///phone/photo.jpg'

/** One assistant record with a Read, then a SendUserFile of two pictures. */
const MIXED: NativeChatMessage = {
  id: 'mixed',
  role: 'assistant',
  timestamp: 0,
  source: 'transcript',
  blocks: [
    { type: 'tool-call', name: 'Read', input: { file_path: '/tmp/a.png' }, callId: 'toolu_read' },
    { type: 'tool-call', name: 'SendUserFile', input: { files: ['/tmp/b.png', '/tmp/c.png'], caption: '' }, callId: 'toolu_send' }
  ]
}

describe('the Read call behind each picture slot', () => {
  it('is the Read’s own id, and none for a picture SendUserFile sent', () => {
    expect(collectHostImageCallIds([MIXED])).toEqual({ mixed: ['toolu_read', undefined, undefined] })
  })

  it('follows the recorded Read', () => {
    expect(collectHostImageCallIds(READ_IMAGE_ROWS)).toEqual({ [READ_IMAGE_CALL_ID]: [READ_TOOL_ID] })
  })

  it('is nothing for no rows', () => {
    expect(collectHostImageCallIds([])).toEqual({})
  })
})

describe('laying Anthropic’s pictures into the preview map', () => {
  const remote = { byToolUseId: { toolu_read: API, [READ_TOOL_ID]: API }, byUserMessageId: { paste: [API, ''] } }

  it('fills an agent slot the desktop left empty, by its Read', () => {
    const out = applyCcrImages({ [READ_IMAGE_CALL_ID]: [''] }, { remote, messages: READ_IMAGE_ROWS, agentIds: new Set([READ_IMAGE_CALL_ID]), localPreviews: {} })
    expect(out).toEqual({ [READ_IMAGE_CALL_ID]: [API], paste: [API, ''] })
  })

  it('keeps the desktop’s picture where it sent one', () => {
    const out = applyCcrImages({ mixed: [HOST, '', ''] }, { remote, messages: [MIXED], agentIds: new Set(['mixed']), localPreviews: {} })
    expect(out.mixed).toEqual([HOST, '', ''])
  })

  it('leaves a sent picture’s slot empty: its bytes are in no tool result', () => {
    const out = applyCcrImages({ mixed: ['', '', ''] }, { remote, messages: [MIXED], agentIds: new Set(['mixed']), localPreviews: {} })
    expect(out.mixed).toEqual([API, '', ''])
  })

  it('adds a prompt’s pasted pictures, keeping an empty slot in place', () => {
    expect(applyCcrImages({}, { remote, messages: [], agentIds: new Set(), localPreviews: {} })).toEqual({ paste: [API, ''] })
  })

  it('never replaces the phone’s own preview of a prompt it sent', () => {
    expect(applyCcrImages({}, { remote, messages: [], agentIds: new Set(), localPreviews: { paste: [PHONE] } })).toEqual({})
  })

  it('never replaces a picture the desktop sent for a prompt', () => {
    expect(applyCcrImages({ paste: [HOST] }, { remote, messages: [], agentIds: new Set(), localPreviews: {} })).toEqual({ paste: [HOST] })
  })

  it('changes nothing with no pictures from Anthropic', () => {
    const previews = { [READ_IMAGE_CALL_ID]: [''] }
    expect(applyCcrImages(previews, { remote: NO_CCR_IMAGES, messages: READ_IMAGE_ROWS, agentIds: new Set([READ_IMAGE_CALL_ID]), localPreviews: {} })).toEqual({ [READ_IMAGE_CALL_ID]: [''] })
  })
})
