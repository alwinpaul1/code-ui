import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { UPDATE_PRIMARY_PRESSED_OPACITY } from './update-card-metrics'

// The building blocks of the update card (2026-10-10 redesign: solid, not
// glass). A header that is either a version hero or an icon + title, a scroll
// region for anything long, and an action bar pinned under it: one accent
// pill for the action the card exists for, one quiet text button for the way
// out. Every colour comes from the theme, so light and dark are both drawn
// from the same tokens.

/** Inset of the card's content from its edges. */
export const UPDATE_CARD_INSET = 24

/** Release notes and failure messages scroll past this instead of growing the
 *  card. It is also the one region that gives way when the whole card does
 *  not fit the screen (a small phone, a large font size). */
export const UPDATE_SCROLL_REGION_MAX_HEIGHT = 320

/** The accent pill's height. Comfortably over the 48dp touch target. */
export const UPDATE_PRIMARY_BUTTON_HEIGHT = 52

/** The quiet button's height: the 48dp touch target exactly. */
export const UPDATE_SECONDARY_BUTTON_HEIGHT = 48

/** The hero version number. The display token is 30; the version is the one
 *  thing the card is about, so it is set larger and tracked tighter. */
const HERO_SIZE = 40
const HERO_LINE_HEIGHT = 46

/** The card's column: shrinks with the screen so the action bar stays
 *  reachable; inside it only a scroll region gives way. */
export function UpdateColumn({ children }: { children: ReactNode }) {
  return <View style={{ flexShrink: 1 }}>{children}</View>
}

/** "Update available" over a large version number, with a muted meta line. */
export function UpdateHero({
  eyebrow,
  version,
  meta,
  children
}: {
  eyebrow: string
  version: string
  meta: string
  children?: ReactNode
}) {
  const { colors, space, fonts } = useTheme()
  return (
    <View
      style={{
        paddingHorizontal: UPDATE_CARD_INSET,
        paddingTop: UPDATE_CARD_INSET,
        paddingBottom: space.lg + 4,
        gap: space.xs
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent }}
        />
        <Txt variant="label" weight="semibold" tone="accent" accessibilityRole="header">
          {eyebrow}
        </Txt>
      </View>
      {/* No version is known in one corner (a cold start that found a
          downloaded update before any check ran): no hero then, rather than
          an empty 46-high line read out as "Version". */}
      {version ? (
        <Txt
          testID="update-hero-version"
          accessibilityLabel={`Version ${version}`}
          style={{
            fontFamily: fonts.bold,
            fontSize: HERO_SIZE,
            lineHeight: HERO_LINE_HEIGHT,
            letterSpacing: -1.2,
            fontVariant: ['tabular-nums'],
            color: colors.text,
            marginTop: 2
          }}
        >
          {version}
        </Txt>
      ) : null}
      <Txt variant="label" tone="muted">
        {meta}
      </Txt>
      {children}
    </View>
  )
}

export type UpdateIconTone = 'accent' | 'success' | 'danger' | 'muted'

/** An icon in a soft round well, a title, and an optional message: the
 *  header of every state that is not offering a version. */
export function UpdateStatusHeader({
  icon: Icon,
  tone,
  title,
  message,
  accessory
}: {
  icon?: LucideIcon
  tone: UpdateIconTone
  title: string
  message?: string
  /** Drawn in place of the icon, e.g. a spinner. */
  accessory?: ReactNode
}) {
  const { colors, space } = useTheme()
  const wells: Record<UpdateIconTone, { fill: string; ink: string }> = {
    accent: { fill: colors.accentSoft, ink: colors.accentText },
    success: { fill: colors.successSoft, ink: colors.success },
    danger: { fill: colors.dangerSoft, ink: colors.danger },
    muted: { fill: colors.bgRaised, ink: colors.textSecondary }
  }
  const well = wells[tone]
  return (
    <View
      style={{
        paddingHorizontal: UPDATE_CARD_INSET,
        paddingTop: UPDATE_CARD_INSET,
        paddingBottom: space.lg + 4,
        gap: space.sm
      }}
    >
      <View
        testID="update-status-well"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: well.fill,
          marginBottom: space.xs
        }}
      >
        {accessory ?? (Icon ? <Icon size={22} color={well.ink} strokeWidth={2} /> : null)}
      </View>
      <Txt variant="title" weight="semibold" accessibilityRole="header">
        {title}
      </Txt>
      {message ? (
        <Txt variant="body" tone="secondary">
          {message}
        </Txt>
      ) : null}
    </View>
  )
}

/** A hairline across the card, where the header turns into scrolling content. */
export function UpdateDivider() {
  const { colors } = useTheme()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignSelf: 'stretch', height: StyleSheet.hairlineWidth, backgroundColor: colors.border }}
    />
  )
}

/**
 * The part of the card that may be longer than the card: release notes, a
 * failure message. Capped, scrolling, and `flexShrink: 1`, so on a small
 * screen or at a large font size it is this region that shrinks and never the
 * action bar below it.
 */
export function UpdateScrollRegion({ children }: { children: ReactNode }) {
  const { space } = useTheme()
  return (
    <ScrollView
      style={{ maxHeight: UPDATE_SCROLL_REGION_MAX_HEIGHT, flexShrink: 1, alignSelf: 'stretch' }}
      contentContainerStyle={{
        paddingHorizontal: UPDATE_CARD_INSET,
        paddingTop: space.lg + 4,
        paddingBottom: space.lg + 4
      }}
      // Android fades its bar out; this is read at rest, and a reader has to
      // be able to see there is more below the cap.
      showsVerticalScrollIndicator
      persistentScrollbar
      nestedScrollEnabled
    >
      {children}
    </ScrollView>
  )
}

export type UpdateAction = { label: string; onPress: () => void }

/**
 * The card's actions, pinned under its content: an accent pill for the action
 * the card exists for, a quiet text button under it for the way out. Both
 * full width, both over 48dp, both painting their pressed state on the
 * PRESS (a Pressable style function), not on the release.
 */
export function UpdateActionBar({
  primary,
  secondary,
  divided = false
}: {
  primary?: UpdateAction | null
  secondary?: UpdateAction | null
  /** A hairline above the bar, when content scrolls under it. */
  divided?: boolean
}) {
  const { colors, space, radius } = useTheme()
  if (!primary && !secondary) {
    return null
  }
  return (
    <View
      style={{
        flexShrink: 0,
        paddingHorizontal: UPDATE_CARD_INSET - space.xs,
        paddingTop: divided ? space.lg : 0,
        paddingBottom: space.md,
        gap: space.xs,
        borderTopWidth: divided ? StyleSheet.hairlineWidth : 0,
        borderTopColor: colors.border
      }}
    >
      {primary ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={primary.label}
          onPress={primary.onPress}
          style={({ pressed }) => ({
            // A minimum, not a height: at a large font size the label grows
            // and the pill grows with it rather than clipping.
            minHeight: UPDATE_PRIMARY_BUTTON_HEIGHT,
            flexShrink: 0,
            alignSelf: 'stretch',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: space.lg,
            borderRadius: radius.pill,
            backgroundColor: colors.accentText,
            opacity: pressed ? UPDATE_PRIMARY_PRESSED_OPACITY : 1
          })}
        >
          <Txt variant="body" weight="semibold" align="center" style={{ color: colors.onAccent }}>
            {primary.label}
          </Txt>
        </Pressable>
      ) : null}
      {secondary ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={secondary.label}
          onPress={secondary.onPress}
          style={({ pressed }) => ({
            minHeight: UPDATE_SECONDARY_BUTTON_HEIGHT,
            flexShrink: 0,
            alignSelf: 'stretch',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: space.lg,
            borderRadius: radius.pill,
            backgroundColor: pressed ? colors.bgRaised : 'transparent'
          })}
        >
          <Txt variant="body" weight="medium" tone="secondary" align="center">
            {secondary.label}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}
