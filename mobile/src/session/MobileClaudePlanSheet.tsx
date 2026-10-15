import { View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from '../components/mobile-markdown-prose-scale'
import { useTheme } from '../theme/theme-context'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'

/** The sheet's title (`ccr_plan_view_title`). */
export const CLAUDE_PLAN_TITLE = 'Plan'

/**
 * The plan Claude proposed, opened from the session bar's "Plan" pill as the Claude app opens it
 * (1.261013.20 `ccr_plan_view_title` "Plan"): the plan as Markdown, opening part way and dragging
 * up like the thought-process sheet (MobileNativeChatThinkingSheet).
 */
export function MobileClaudePlanSheet({ visible, plan, onClose }: { visible: boolean; plan: string; onClose: () => void }) {
  const { space } = useTheme()
  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      dragContentToDismiss
      expandable
      header={<MobileSheetTitleBar title={CLAUDE_PLAN_TITLE} onClose={onClose} />}
    >
      <View style={{ paddingBottom: space.md }} testID="claude-plan-sheet">
        <MobileMarkdown content={plan} typography={TRANSCRIPT_MARKDOWN_TYPOGRAPHY} widthKey="plan-sheet" />
      </View>
    </BottomDrawer>
  )
}
