import type { ReactNode } from 'react'
import { Prose } from './MobileNativeChatProse'
import { MobileNativeChatImageStrip } from './MobileNativeChatImageStrip'
import { MobileNativeChatFileCardRow } from './MobileNativeChatFileCard'
import type { ProseGroup } from './mobile-native-chat-prose-groups'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import type { MobileNativeChatVisualRender } from './mobile-native-chat-visual-context'
import { isSubagentGroupBlock } from '../../../src/shared/native-chat-types'
import { isRenderableSubagentGroup } from '../../../src/shared/native-chat-subagent-summary'
import { MobileNativeChatSubagentGroup } from './MobileNativeChatSubagentGroup'

/** One prose group: a picture strip, a run of Claude Code's own file cards
 *  (docs/claude-app-parity.md item 9), or an ordinary text/image block. The
 *  `never` default keeps a future `ProseGroup` variant from silently falling
 *  through to the `block` branch, which reads a field (`.block`) that
 *  variant does not carry. */
export function renderProseGroup(
  group: ProseGroup,
  options: {
    isUser: boolean
    /** A user row the lead agent wrote, drawn as Markdown in its bubble. */
    promptsAsMarkdown?: boolean
    fontScale: number
    onOpenFile?: (relativePath: string) => void
    styles: ChatMessageStyles
    /** Which message block this is (MobileMarkdown's `identity`). */
    identity?: string
    /** Assistant prose of a structured chat only: draws its `::orca-visual` lines. */
    renderVisual?: MobileNativeChatVisualRender
    /** The reply may still be growing: a directive still being typed at its tail is held back. */
    holdPendingVisual?: boolean
    /** The spawn groups the reader opened, held by the transcript (Orca #26125). */
    subagentGroupsOpen?: ReadonlySet<string>
    onToggleSubagentGroup?: (groupId: string) => void
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
      // A spawn group's roster draws as its live row (its frozen sentence is dropped upstream of
      // here, withoutSubagentGroupTwins); a childless one draws nothing, as Prose would.
      if (isSubagentGroupBlock(group.block)) {
        return isRenderableSubagentGroup(group.block) ? (
          <MobileNativeChatSubagentGroup
            block={group.block}
            open={options.subagentGroupsOpen?.has(group.block.groupId) === true}
            onToggle={options.onToggleSubagentGroup}
            styles={options.styles}
          />
        ) : null
      }
      return (
        <Prose
          block={group.block}
          invert={options.isUser}
          markdownPrompt={options.promptsAsMarkdown}
          fontScale={options.fontScale}
          onOpenFile={options.onOpenFile}
          styles={options.styles}
          identity={options.identity}
          renderVisual={options.renderVisual}
          holdPendingVisual={options.holdPendingVisual}
        />
      )
    default: {
      const exhaustive: never = group
      return exhaustive
    }
  }
}
