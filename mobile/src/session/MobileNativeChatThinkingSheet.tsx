import { View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from '../components/mobile-markdown-prose-scale'
import { useTheme } from '../theme/theme-context'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'

/** The row's words and the sheet's title (`ccr_thinking_thought_process`). */
export const THOUGHT_PROCESS_LABEL = 'Thought process'

/**
 * The sheet a thought's row opens: "Thought process" over the thinking as
 * Markdown, the way the Claude app 1.261009.20 shows it. Opens part way and
 * drags up, like the run sheet; the whole thought is here, unfolded, since
 * this is where a long one is read.
 */
export function MobileNativeChatThinkingSheet({
  visible,
  text,
  fontScale,
  onOpenFile,
  onClose
}: {
  visible: boolean
  text: string
  fontScale: number
  onOpenFile?: (relativePath: string) => void
  onClose: () => void
}) {
  const { space } = useTheme()
  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      dragContentToDismiss
      expandable
      header={<MobileSheetTitleBar title={THOUGHT_PROCESS_LABEL} onClose={onClose} />}
    >
      <View style={{ paddingBottom: space.md }} testID="thinking-sheet">
        <MobileMarkdown
          content={text}
          textScale={fontScale}
          onOpenFile={onOpenFile}
          typography={TRANSCRIPT_MARKDOWN_TYPOGRAPHY}
          widthKey="chat-thought"
        />
      </View>
    </BottomDrawer>
  )
}
