import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { contextCategoryPaletteForScheme } from '../theme/context-category-palette'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { ContextBreakdown } from './claude-context-report'
import { buildContextCard, type ContextCardSection } from './context-card-model'

// The Claude app's context card (com.anthropic.claude 1.261009.20, `s5a` and `l800`), drawn from the
// `/context` table the session last had on its screen (claude-context-report.ts). A header row (min
// 48 dp) says the share and opens the card; under it the segmented bar (`jc20.b`: 8 dp tall, a
// capsule, the segments side by side with no gap on the 15% grey track `ad5.F()`), then the caption
// "N of M tokens · model" (`usage_context_window_tokens_caption`, `jn7.H` 13/400). Open, the legend
// (a dot in the segment's colour, the name, the tokens, the percent), then the sections for MCP tools,
// memory files and custom agents (`l800.a`: a 48 dp header row, 8 dp between rows; more than 12 rows
// show 12 and a "Show N more", N at most 50, `l800.c`), then "Show less" (`ccr_context_show_less`).
//
// What the app has that this does not: the table is the user's own `/context`, so it may be old. The
// caption says how old ("Updated 9 min ago", `usage_context_window_updated_caption` is the app's
// wording) when the phone saw it printed, and nothing when it was already on the screen as the phone
// began to look.
//
// Code UI's tokens stand in where the app's have no match: the link blue `ad5.C0()` of "Show more" is
// `info`, as the status line's task count already uses it.

const BAR_HEIGHT = 8
const HEADER_MIN_HEIGHT = 48
const DOT_SIZE = 8
const INITIAL_ROWS = 12
const MORE_STEP = 50
const PERCENT_COLUMN = 48

/** "just now", "9 min ago", "3 h ago", "2 d ago"; null for a table whose age the phone cannot name. */
export function formatReportAge(readAt: number | null, now: number): string | null {
  if (readAt === null) {
    return null
  }
  const minutes = Math.floor(Math.max(0, now - readAt) / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes} min ago`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`
}

export function ContextCategoriesView({
  breakdown,
  now
}: {
  breakdown: ContextBreakdown
  now: number
}): React.JSX.Element {
  const { colors, scheme, space } = useTheme()
  const palette = contextCategoryPaletteForScheme(scheme)
  const card = useMemo(() => buildContextCard(breakdown.report), [breakdown.report])
  const [open, setOpen] = useState(false)
  const [openSections, setOpenSections] = useState<readonly ContextCardSection['key'][]>([])
  const [shownRows, setShownRows] = useState<Partial<Record<ContextCardSection['key'], number>>>({})
  const age = formatReportAge(breakdown.readAt, now)
  const Chevron = open ? ChevronUp : ChevronDown
  const close = (): void => {
    setOpen(false)
    setOpenSections([])
    setShownRows({})
  }
  return (
    <View testID="context-categories" style={{ gap: space.xs, paddingTop: space.sm }}>
      <Pressable
        testID="context-categories-toggle"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => (open ? close() : setOpen(true))}
        style={{ minHeight: HEADER_MIN_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.sm }}
      >
        <Txt variant="label" weight="medium" style={{ flex: 1 }}>
          By category
        </Txt>
        <Txt variant="label" tone="secondary">
          {`${card.displayPercent}%`}
        </Txt>
        <Chevron size={18} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>
      <View
        testID="context-bar"
        accessibilityRole="progressbar"
        accessibilityLabel={card.a11y}
        accessibilityValue={{ min: 0, max: 100, now: card.displayPercent }}
        style={{
          height: BAR_HEIGHT,
          borderRadius: BAR_HEIGHT / 2,
          overflow: 'hidden',
          flexDirection: 'row',
          backgroundColor: palette[9]
        }}
      >
        {card.segments.map((segment, index) => (
          <View
            key={`${index}:${segment.slot}`}
            testID={`context-bar-segment-${index}`}
            style={{ width: `${segment.fraction * 100}%`, height: '100%', backgroundColor: palette[segment.slot] }}
          />
        ))}
      </View>
      <View testID="context-caption">
        <Txt variant="label" tone="secondary">
          {age === null ? card.caption : `${card.caption} · Updated ${age}`}
        </Txt>
      </View>
      {open ? (
        <View style={{ gap: space.xs, paddingTop: space.xs }}>
          {card.legend.map((row, index) => (
            <View
              key={`${index}:${row.name}`}
              testID={`context-legend-row-${index}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 24 }}
            >
              <View
                testID={`context-legend-dot-${index}`}
                style={{ width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2, backgroundColor: palette[row.slot] }}
              />
              <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
                {row.name}
              </Txt>
              <Txt variant="label" tone="secondary">
                {row.tokensLabel}
              </Txt>
              <Txt variant="label" tone="secondary" align="right" style={{ minWidth: PERCENT_COLUMN }}>
                {row.percentLabel}
              </Txt>
            </View>
          ))}
          {card.sections.map((section) => {
            const expanded = openSections.includes(section.key)
            const shown = shownRows[section.key] ?? INITIAL_ROWS
            const SectionChevron = expanded ? ChevronUp : ChevronDown
            const remaining = section.rows.length - shown
            return (
              <View key={section.key}>
                <Pressable
                  testID={`context-section-${section.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() =>
                    setOpenSections((current) =>
                      current.includes(section.key)
                        ? current.filter((key) => key !== section.key)
                        : [...current, section.key]
                    )
                  }
                  style={{ minHeight: HEADER_MIN_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                >
                  <Txt variant="body" style={{ flex: 1 }}>
                    {section.title}
                  </Txt>
                  {section.totalLabel === null ? null : (
                    <Txt variant="label" tone="secondary">
                      {section.totalLabel}
                    </Txt>
                  )}
                  <SectionChevron size={18} color={colors.textSecondary} strokeWidth={2} />
                </Pressable>
                {expanded ? (
                  <View testID={`context-section-rows-${section.key}`} style={{ gap: space.sm, paddingBottom: space.sm }}>
                    {section.rows.length === 0 && section.summary !== null ? (
                      <Txt variant="label" tone="secondary">
                        {section.summary}
                      </Txt>
                    ) : null}
                    {section.rows.slice(0, shown).map((row, index) => (
                      <View
                        key={`${index}:${row.name}`}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                      >
                        <Txt variant="label" numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1 }}>
                          {row.name}
                        </Txt>
                        {row.tokensLabel === null ? null : (
                          <Txt variant="label" tone="secondary">
                            {row.tokensLabel}
                          </Txt>
                        )}
                      </View>
                    ))}
                    {remaining > 0 ? (
                      <Pressable
                        testID={`context-section-more-${section.key}`}
                        accessibilityRole="button"
                        onPress={() =>
                          setShownRows((current) => ({
                            ...current,
                            [section.key]: shown + Math.min(MORE_STEP, remaining)
                          }))
                        }
                        style={{ minHeight: HEADER_MIN_HEIGHT, justifyContent: 'center' }}
                      >
                        <Txt variant="body" style={{ color: colors.info }}>
                          {`Show ${Math.min(MORE_STEP, remaining)} more`}
                        </Txt>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            )
          })}
          <Pressable
            testID="context-show-less"
            accessibilityRole="button"
            onPress={close}
            style={{ minHeight: HEADER_MIN_HEIGHT, justifyContent: 'center' }}
          >
            <Txt variant="body" style={{ color: colors.info }}>
              Show less
            </Txt>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}
