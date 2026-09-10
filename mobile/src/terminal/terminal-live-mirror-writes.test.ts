import { describe, expect, it } from 'vitest'
import { AGENT_TUI_MAX_KEY_WRITE_BYTES } from '../session/agent-tui-clear-write-chunks'
import { TERMINAL_DEL_BYTE } from './terminal-live-preedit-mirror'
import { buildTerminalLiveMirrorWrites } from './terminal-live-mirror-writes'

describe('mirroring an edit that deletes a lot of a long draft', () => {
  it('never asks the agent to read a paste-sized run of deletes at once', () => {
    // Same measured bound as the send's clear burst: a live Claude Code
    // 2.1.266 read 63 control bytes as keys and 64 as pasted text. A long
    // erase run went out as one write, so the deletes were inserted instead
    // of applied and the draft the agent held stopped matching the phone's.
    const writes = buildTerminalLiveMirrorWrites({
      eraseCount: 200,
      appendText: 'the replacement text',
      nextSentText: 'the replacement text'
    })

    for (const write of writes) {
      expect(write.length).toBeLessThan(AGENT_TUI_MAX_KEY_WRITE_BYTES)
    }
    expect(writes.join('')).toBe(TERMINAL_DEL_BYTE.repeat(200) + 'the replacement text')
  })

  it('keeps the appended text in one write, so it still arrives as one paste', () => {
    const appendText = 'a'.repeat(500)
    const writes = buildTerminalLiveMirrorWrites({
      eraseCount: 0,
      appendText,
      nextSentText: appendText
    })
    expect(writes).toEqual([appendText])
  })

  it('keeps the common small edit a single write', () => {
    const writes = buildTerminalLiveMirrorWrites({
      eraseCount: 2,
      appendText: 'yz',
      nextSentText: 'xyz'
    })
    expect(writes).toEqual([TERMINAL_DEL_BYTE.repeat(2) + 'yz'])
  })

  it('emits nothing when there is nothing to mirror', () => {
    expect(
      buildTerminalLiveMirrorWrites({ eraseCount: 0, appendText: '', nextSentText: '' })
    ).toEqual([])
  })
})
