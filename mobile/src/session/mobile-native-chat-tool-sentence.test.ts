import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { toolCallKind, toolRunSentence } from './mobile-native-chat-tool-sentence'

function call(name: string): NativeChatBlock {
  return { type: 'tool-call', id: `c-${name}-${Math.random()}`, name, input: {} }
}
function result(isError = false): NativeChatBlock {
  return { type: 'tool-result', toolCallId: 'x', output: '', ...(isError ? { isError: true } : {}) }
}

// The Claude app's fold rows, 2026-09-12 screenshots: "Ran 3 commands ›",
// "Ran a command, read a file ›", "Ran 12 commands (2 failed), read 6 files ›".
describe('toolRunSentence', () => {
  it('reads like the Claude app for the common shapes', () => {
    expect(toolRunSentence([call('Bash'), result(), call('Bash'), result(), call('Bash'), result()])).toBe(
      'Ran 3 commands'
    )
    expect(toolRunSentence([call('Bash'), result(), call('Read'), result()])).toBe('Ran a command, read a file')
  })

  it('counts failures against the kind that failed', () => {
    const blocks: NativeChatBlock[] = []
    for (let i = 0; i < 12; i += 1) {
      blocks.push(call('Bash'), result(i < 2))
    }
    for (let i = 0; i < 6; i += 1) {
      blocks.push(call('Read'), result())
    }
    expect(toolRunSentence(blocks)).toBe('Ran 12 commands (2 failed), read 6 files')
  })

  it('groups by what the tool did, across agents', () => {
    expect(toolCallKind('shell')).toBe('command')
    expect(toolCallKind('Bash')).toBe('command')
    expect(toolCallKind('MultiEdit')).toBe('edit')
    expect(toolCallKind('Grep')).toBe('search')
    expect(toolCallKind('Agent')).toBe('agent')
    expect(toolCallKind('WebFetch')).toBe('web')
    expect(toolCallKind('browser.open')).toBe('other')
    expect(toolRunSentence([call('Edit'), result(), call('Grep'), result(), call('Grep'), result()])).toBe(
      'Edited a file, searched 2 times'
    )
  })

  it('is empty for a run with no calls', () => {
    expect(toolRunSentence([])).toBe('')
  })
})
