import type { ReactNode } from 'react'
import { Prose } from './MobileNativeChatProse'
import { MobileNativeChatImageStrip } from './MobileNativeChatImageStrip'
import { MobileNativeChatFileCardRow } from './MobileNativeChatFileCard'
import type { ProseGroup } from './mobile-native-chat-prose-groups'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'

/** One prose group: a picture strip, a run of Claude Code's own file cards
 *  (docs/claude-app-parity.md item 9), or an ordinary text/image block. The
 *  `never` default keeps a future `ProseGroup` variant from silently falling
 *  through to the `block` branch, which reads a field (`.block`) that
 *  variant does not carry. */
export function renderProseGroup(
  group: ProseGroup,
  options: {
    isUser: boolean
    fontScale: number
    onOpenFile?: (relativePath: string) => void
    styles: ChatMessageStyles
  }
): ReactNode {
  switch (group.type) {
    case 'image-strip':
      return (
        <MobileNativeChatImageStrip uris={group.uris} label={group.alt} styles={options.styles} />
      )
    case 'file-cards':
      return <MobileNativeChatFileCardRow cards={group.cards} />
    case 'block':
      return (
        <Prose
          block={group.block}
          invert={options.isUser}
          fontScale={options.fontScale}
          onOpenFile={options.onOpenFile}
          styles={options.styles}
        />
      )
    default: {
      const exhaustive: never = group
      return exhaustive
    }
  }
}
