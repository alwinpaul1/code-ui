import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'
import { withoutPasteWrappers } from './mobile-native-chat-paste-wrapper'

// The row as Claude Code wrote it (6116568a…jsonl row 7, 2026-09-20): a paste
// wrapped in `<pasted_content id="329c">` … `</pasted_content id="329c">`, with
// the typed words after the closing tag.
const ROW = '\n\n<pasted_content id="329c">\nFind me a men\'s insulated winter jacket to buy in Germany right now, under 150 EUR.\n\nWHO IT IS FOR\n\nI live in Cottbus.\n</pasted_content id="329c">\n\n use jev /typesafe:typesafe-ai'

describe('a pasted prompt', () => {
  it('shows its words, not the tags Claude Code wrapped them in', () => {
    expect(withoutPasteWrappers(ROW)).toBe(
      "Find me a men's insulated winter jacket to buy in Germany right now, under 150 EUR.\n\nWHO IT IS FOR\n\nI live in Cottbus.\n\n use jev /typesafe:typesafe-ai"
    )
    const folded = foldMobileNativeChatMessages([
      { id: 'u', role: 'user', blocks: [{ type: 'text', text: ROW }], timestamp: 1, source: 'transcript' }
    ])
    const text = folded[0]!.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
    expect(text.startsWith('Find me')).toBe(true)
    expect(text).not.toContain('pasted_content')
  })

  it('still retires the hook copy, which carries the tags', () => {
    const folded = foldMobileNativeChatMessages([
      { id: 'u', role: 'user', blocks: [{ type: 'text', text: ROW }], timestamp: 1, source: 'transcript' }
    ])
    const hook = [{ nonce: 's', text: ROW.slice(0, 200), cut: true, at: 1 }]
    expect(withoutLandedDesktopPrompts(hook, folded)).toEqual([])
  })

  it('leaves a message with no paste alone', () => {
    expect(withoutPasteWrappers('plain words')).toBe('plain words')
  })
})
