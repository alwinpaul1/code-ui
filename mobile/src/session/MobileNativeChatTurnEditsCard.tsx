import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { ChevronDown, FilePen, FilePlus2 } from 'lucide-react-native'
import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'
import { Txt } from '../ui/Txt'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import {
  fileBaseName,
  TURN_EDITS_FOLDED_ROWS,
  turnEditsStat,
  turnEditsTitle,
  type TurnEditedFile
} from './mobile-native-chat-turn-edits'
import { useNativeChatAgentRuns } from './native-chat-tasks-context'
import { MobileNativeChatDiffCard } from './MobileNativeChatDiffCard'
import { ToolRunDiffChip } from './MobileNativeChatToolRunDiffChip'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'

export const TURN_EDITS_REVIEW = 'Review'

/** "Show 2 more" (`ccr_turn_edits_show_more`), or "Show less". */
export function turnEditsToggleLabel(hidden: number, open: boolean): string {
  return open ? 'Show less' : `Show ${hidden} more`
}

/**
 * The card the Claude app 1.261009.20 draws under a finished turn that
 * changed files (h130, behind its `ccr_turn_edits_card` flag): a heading,
 * "Edited run.sh" for one file or the run sentence for several, the turn's
 * "+A −R" pill, and Review. Past one file it lists them, three and then
 * "Show N more". Review opens the turn's changes as the transcript's own diff
 * cards. Sizes and colours are Code UI's.
 *
 * Drawn once the turn is over: not while the agent still works on the newest
 * turn, nor while its last call waits on an answer (a permission prompt), where
 * the Claude app has no result for it yet either.
 */
export function MobileNativeChatTurnEditsCard({
  files,
  turnIsNewest,
  trailingWork,
  styles
}: {
  files: readonly TurnEditedFile[]
  turnIsNewest: boolean
  /** The turn's work after its last words: a call there with no answer yet
   *  (a permission prompt pauses the agent mid-turn) means the turn is open. */
  trailingWork: readonly NativeChatBlock[] | undefined
  styles: ChatMessageStyles
}) {
  const runs = useNativeChatAgentRuns()
  const { colors, radius, space } = useTheme()
  const [showAll, setShowAll] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const open = turnIsNewest && (runs.agentWorking || pairToolBlocks(trailingWork ?? []).some((pair) => pair.call && !pair.result))
  if (files.length === 0 || open) {
    return null
  }
  const title = turnEditsTitle(files)
  const stat = turnEditsStat(files)
  const several = files.length > 1
  const listed = several ? (showAll ? files : files.slice(0, TURN_EDITS_FOLDED_ROWS)) : []
  const hidden = files.length - TURN_EDITS_FOLDED_ROWS
  const rowStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm
  } as const
  return (
    <View
      testID="turn-edits-card"
      style={{
        marginTop: space.sm,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        backgroundColor: colors.bgPanel,
        overflow: 'hidden'
      }}
    >
      <View style={rowStyle}>
        <FilePen size={14} color={colors.textMuted} strokeWidth={2} />
        <Txt variant="label" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
          {title}
        </Txt>
        {stat ? <ToolRunDiffChip stat={stat} styles={styles} /> : null}
        <View style={{ flex: 1 }} />
        <PressScale
          accessibilityRole="button"
          accessibilityLabel={TURN_EDITS_REVIEW}
          accessibilityHint="Shows the changes this turn made"
          pressedScale={0.97}
          onPress={() => setReviewing(true)}
          style={{
            paddingHorizontal: space.md,
            paddingVertical: space.xs,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.border
          }}
        >
          <Txt variant="caption" weight="semibold">
            {TURN_EDITS_REVIEW}
          </Txt>
        </PressScale>
      </View>
      {listed.map((file) => {
        const Icon = file.created ? FilePlus2 : FilePen
        return (
          <View
            key={file.path}
            testID="turn-edits-file"
            style={[rowStyle, { borderTopWidth: 1, borderTopColor: colors.border }]}
          >
            <Icon size={14} color={colors.textMuted} strokeWidth={2} />
            <Txt variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
              {fileBaseName(file.path)}
            </Txt>
            {file.stat ? <ToolRunDiffChip stat={file.stat} styles={styles} /> : null}
          </View>
        )
      })}
      {several && hidden > 0 ? (
        <PressScale
          accessibilityRole="button"
          accessibilityLabel={turnEditsToggleLabel(hidden, showAll)}
          accessibilityState={{ expanded: showAll }}
          pressedScale={0.98}
          onPress={() => setShowAll((value) => !value)}
          style={[rowStyle, { borderTopWidth: 1, borderTopColor: colors.border }]}
        >
          <Txt variant="caption" tone="secondary">
            {turnEditsToggleLabel(hidden, showAll)}
          </Txt>
          <View style={{ transform: [{ rotate: showAll ? '180deg' : '0deg' }] }}>
            <ChevronDown size={14} color={colors.textMuted} strokeWidth={2} />
          </View>
        </PressScale>
      ) : null}
      <BottomDrawer
        visible={reviewing}
        onClose={() => setReviewing(false)}
        dragContentToDismiss
        expandable
        header={<MobileSheetTitleBar title={title} onClose={() => setReviewing(false)} />}
      >
        <ScrollView nestedScrollEnabled contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}>
          {files.flatMap((file) =>
            file.changes.map((change, index) => (
              <MobileNativeChatDiffCard key={`${file.path}:${index}`} file={change} />
            ))
          )}
        </ScrollView>
      </BottomDrawer>
    </View>
  )
}
