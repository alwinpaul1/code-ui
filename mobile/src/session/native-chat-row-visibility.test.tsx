import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ChatRowOnScreenScope,
  createChatRowVisibility,
  useChatRowOnScreen
} from './native-chat-row-visibility'

/** What FlashList hands `onViewableItemsChanged`: a token per row on screen. */
function tokens(indices: number[]) {
  return {
    viewableItems: indices.map((index) => ({ index, isViewable: true, item: null, key: `m${index}`, timestamp: 0 })),
    changed: []
  }
}

function Probe({ seen }: { seen: boolean[] }) {
  seen.push(useChatRowOnScreen())
  return null
}

describe('which chat rows are on screen', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  // Fail-open: a row the list has not reported on yet still animates. A
  // shimmer that never started would say the agent had stopped.
  it('counts every row on screen until the list first reports', () => {
    const visibility = createChatRowVisibility()
    expect(visibility.isOnScreen(0)).toBe(true)
    expect(visibility.isOnScreen(40)).toBe(true)
  })

  it('reads FlashList tokens by index, so a newly added message is placed where it sits now', () => {
    const visibility = createChatRowVisibility()
    visibility.onViewableItemsChanged(tokens([0, 1, 2]))
    expect(visibility.isOnScreen(0)).toBe(true)
    expect(visibility.isOnScreen(2)).toBe(true)
    expect(visibility.isOnScreen(3)).toBe(false)
  })

  it('puts every row off screen when the list reports none', () => {
    const visibility = createChatRowVisibility()
    visibility.onViewableItemsChanged(tokens([]))
    expect(visibility.isOnScreen(0)).toBe(false)
  })

  it('tells a row when it scrolls out of view and back in', () => {
    const visibility = createChatRowVisibility()
    const seen: boolean[] = []
    act(() => {
      renderer = create(
        <ChatRowOnScreenScope visibility={visibility} index={4}>
          <Probe seen={seen} />
        </ChatRowOnScreenScope>
      )
    })
    expect(seen.at(-1)).toBe(true)
    act(() => visibility.onViewableItemsChanged(tokens([0, 1])))
    expect(seen.at(-1)).toBe(false)
    act(() => visibility.onViewableItemsChanged(tokens([3, 4, 5])))
    expect(seen.at(-1)).toBe(true)
  })

  it('stops telling a row that has gone', () => {
    const visibility = createChatRowVisibility()
    const seen: boolean[] = []
    act(() => {
      renderer = create(
        <ChatRowOnScreenScope visibility={visibility} index={0}>
          <Probe seen={seen} />
        </ChatRowOnScreenScope>
      )
    })
    act(() => renderer?.unmount())
    renderer = null
    const renders = seen.length
    act(() => visibility.onViewableItemsChanged(tokens([2])))
    expect(seen).toHaveLength(renders)
  })

  // The subagent viewer draws the same rows outside the chat list, where
  // nothing reports: those rows still animate.
  it('counts a row outside any list as on screen', () => {
    const seen: boolean[] = []
    act(() => {
      renderer = create(<Probe seen={seen} />)
    })
    expect(seen.at(-1)).toBe(true)
  })

  // Structure, not behaviour: the chat list has to feed the store and scope
  // each row, or every running row animates wherever it is. Matched against
  // code with the comments stripped, never against the prose around it.
  it('is fed by the chat list, which scopes each row by its index', () => {
    const source = readFileSync(join(import.meta.dirname, 'MobileNativeChatView.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    expect(source).toMatch(/onViewableItemsChanged=\{rowVisibility\.onViewableItemsChanged\}/)
    expect(source).toMatch(/<ChatRowOnScreenScope visibility=\{rowVisibility\} index=\{index\}>/)
    expect(source).toMatch(/const \[rowVisibility\] = useState\(createChatRowVisibility\)/)
  })
})
