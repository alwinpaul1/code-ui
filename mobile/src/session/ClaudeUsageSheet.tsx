import { RotateCw } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import type { ThemeColors } from '../theme/tokens'
import { Txt } from '../ui/Txt'
import { contextMeterRow, planCards, USAGE_SHEET_TEXT, type UsageContextState, type UsageMeterRow, type UsageMeterTone, type UsagePlanState } from './ccr-usage-sheet-model'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'

export type ClaudeUsageSheetData = {
  context: UsageContextState
  /** The tab's own account's plan rows; null while that account is not known. */
  plan: UsagePlanState | null
  refreshing: boolean
  onRefresh: () => void
}

/**
 * The Claude app's Usage sheet (1.261009.20, 2026-10-15 screenshots): a close cross on the left,
 * "Usage" centred, refresh on the right; then "Context" (Context window), "Plan usage" (Current
 * session) and "Weekly limits" (All models, "<Model> only"), each a card of meters with the
 * weekly ones grouped into one card split by a thin gap. No chevron and no breakdown (the user,
 * 2026-10-15). Colours are the theme's: the bar is `info`, `warning` from 75%, `danger` from 90%,
 * on a `bgSunken` track, the cards `bgRaised` over the sheet. Code UI's own type sizes.
 */
export function ClaudeUsageSheet({ visible, data, onClose }: { visible: boolean; data: ClaudeUsageSheetData; onClose: () => void }) {
  return (
    <BottomDrawer visible={visible} onClose={onClose} dragContentToDismiss dismissKeyboardOnOpen>
      <ClaudeUsageSheetBody data={data} onClose={onClose} />
    </BottomDrawer>
  )
}

export function ClaudeUsageSheetBody({ data, onClose }: { data: ClaudeUsageSheetData; onClose: () => void }) {
  const { colors, space } = useTheme()
  // Read when the body mounts (the drawer mounts it on open) and again on each refresh tap, so
  // "Resets in …" counts from now, not from when the chat opened.
  const [now, setNow] = useState(() => Date.now())
  const context = contextMeterRow(data.context)
  const plan = planCards(data.plan, now)
  return (
    <View style={{ gap: space.sm }}>
      <MobileSheetTitleBar
        title={USAGE_SHEET_TEXT.title}
        onClose={onClose}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh usage"
            accessibilityState={{ busy: data.refreshing }}
            onPress={() => {
              setNow(Date.now())
              data.onRefresh()
            }}
            hitSlop={8}
            style={({ pressed }) => ({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: pressed || data.refreshing ? 0.6 : 1 })}
          >
            <RotateCw size={20} color={colors.textSecondary} />
          </Pressable>
        }
      />
      <SectionHeader text={USAGE_SHEET_TEXT.contextHeader} />
      <MeterCard rows={[context]} />
      <SectionHeader text={USAGE_SHEET_TEXT.planHeader} />
      {plan.error ? (
        <Txt variant="label" tone="secondary" style={{ paddingHorizontal: space.md }}>
          {plan.error}
        </Txt>
      ) : (
        <MeterCard rows={plan.session} />
      )}
      {plan.weekly.length > 0 ? (
        <>
          <SectionHeader text={USAGE_SHEET_TEXT.weeklyHeader} />
          <MeterCard rows={plan.weekly} />
        </>
      ) : null}
      {plan.refreshError ? (
        <Txt variant="label" tone="danger" align="center" accessibilityLiveRegion="polite">
          {plan.refreshError}
        </Txt>
      ) : null}
    </View>
  )
}

function SectionHeader({ text }: { text: string }) {
  const { space } = useTheme()
  return (
    <Txt variant="body" tone="secondary" accessibilityRole="header" style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>
      {text}
    </Txt>
  )
}

/** One card; several rows are one group split by a 2 dp gap, as the app's weekly card is. */
function MeterCard({ rows }: { rows: readonly UsageMeterRow[] }) {
  const { colors, radius } = useTheme()
  if (rows.length === 0) {
    return null
  }
  return (
    <View style={{ borderRadius: radius.lg, overflow: 'hidden', gap: 2 }}>
      {rows.map((row, index) => (
        <View key={`${index}:${row.title}`} style={{ backgroundColor: colors.bgRaised }}>
          <MeterRow row={row} />
        </View>
      ))}
    </View>
  )
}

export function meterFillColor(colors: ThemeColors, tone: UsageMeterTone): string {
  return tone === 'critical' ? colors.danger : tone === 'warning' ? colors.warning : colors.info
}

function MeterRow({ row }: { row: UsageMeterRow }) {
  const { colors, space } = useTheme()
  return (
    <View style={{ paddingHorizontal: space.md, paddingVertical: space.md, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Txt variant="body" weight="medium" style={{ flex: 1 }} numberOfLines={1}>
          {row.title}
        </Txt>
        {row.figure ? (
          <Txt variant="body" tone="secondary">
            {row.figure}
          </Txt>
        ) : null}
      </View>
      {row.percent !== null ? (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: row.percent }}
          style={{ height: 6, borderRadius: 3, backgroundColor: colors.bgSunken, overflow: 'hidden' }}
        >
          <View testID="usage-meter-fill" style={{ height: '100%', width: `${row.percent}%`, minWidth: row.percent > 0 ? 6 : 0, borderRadius: 3, backgroundColor: meterFillColor(colors, row.tone) }} />
        </View>
      ) : null}
      {row.caption ? (
        <Txt variant="label" tone="secondary">
          {row.caption}
        </Txt>
      ) : null}
    </View>
  )
}
