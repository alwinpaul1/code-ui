import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildMobileNativeChatTransientData, foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { groupProseBlocks } from './mobile-native-chat-prose-groups'
import { splitNativeChatBlocks } from '../../../src/shared/native-chat-tool-fold'

const user = (id: string, text: string): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: [{ type: 'text', text }],
  createdAt: 0
})

// 2026-09-12: three screenshots pasted on the desktop arrive as three
// `[Image: source: /var/folders/…/orca-paste-….png]` text blocks followed by
// the prompt. With the host previews fetched they must land side by side in
// one strip, not stacked one under the other.
describe('desktop-pasted images reach the sideways strip', () => {
  it('folds three pasted screenshots into one strip ahead of the prompt', () => {
    const src = (n: number) =>
      `[Image: source: /var/folders/0y/T/orca-paste-17892493${n}-8487f477.png]`
    const raw = [
      user('s1', src(1)),
      user('s2', src(2)),
      user('s3', src(3)),
      user('prompt', '[Image #1] [Image #2] [Image #3] see these all')
    ]
    const folded = foldMobileNativeChatMessages(raw)
    const { data } = buildMobileNativeChatTransientData({
      messages: folded,
      folded,
      streaming: null,
      pending: [],
      imagePreviewsByMessageId: {
        prompt: ['file:///p1.png', 'file:///p2.png', 'file:///p3.png']
      }
    })
    expect(data).toHaveLength(1)
    const { prose } = splitNativeChatBlocks(data[0]!.blocks)
    const groups = groupProseBlocks(prose)
    expect(groups.map((g) => g.type)).toEqual(['image-strip', 'block'])
    expect(groups[0]).toMatchObject({ uris: ['file:///p1.png', 'file:///p2.png', 'file:///p3.png'] })
  })
})
