import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

import { useTheme } from '../../theme/theme-context'
import { Txt } from '../Txt'

/** Vertical inset of an alert's text block: 20 above the title and 20 below
 *  the message, after UIAlertController. The sides use the theme's `space.lg`. */
export const ALERT_TEXT_INSET = 20

/** A scroll region inside the card is capped here (BitChord's
 *  UpdateAvailableDialog caps its notes at ~220), and it is the one part of
 *  the card that gives way when the whole card would not fit the screen. */
export const ALERT_SCROLL_REGION_MAX_HEIGHT = 220

/**
 * The part of an alert that may be longer than the card: release notes, a
 * failure message. Capped, scrolling, and `flexShrink: 1` so that on a small
 * screen or at a large font size it is this region that shrinks, never the
 * action rows below it. Carries the bottom inset itself; the text block above
 * it is rendered `closed={false}`.
 */
export function AlertScrollRegion({ children }: { children: ReactNode }) {
  const { space } = useTheme()
  return (
    <ScrollView
      style={{ maxHeight: ALERT_SCROLL_REGION_MAX_HEIGHT, flexShrink: 1, alignSelf: 'stretch' }}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: ALERT_TEXT_INSET }}
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

/** Title, message and anything else that sits above the action rows. */
export function AlertTextBlock({
  children,
  /** False when a scroller follows and carries the bottom inset itself. */
  closed = true
}: {
  children: ReactNode
  closed?: boolean
}) {
  const { space } = useTheme()
  return (
    <View
      style={{
        alignItems: 'center',
        paddingHorizontal: space.lg,
        paddingTop: ALERT_TEXT_INSET,
        paddingBottom: closed ? ALERT_TEXT_INSET : space.sm,
        gap: space.xs
      }}
    >
      {children}
    </View>
  )
}

/** 17 semibold, tracked tighter than the heading token and set solid.
 *  -0.4 is the tightening SF Pro's own table applies at 17pt; 21 (1.24)
 *  because a title is one or two lines and wants to sit close, while the
 *  13/18 message under it gets the air. Hierarchy comes from weight, size
 *  and leading together, not from a bigger number. */
export function AlertTitle({ children }: { children: ReactNode }) {
  return (
    <Txt
      accessibilityRole="header"
      variant="heading"
      weight="semibold"
      align="center"
      style={{ letterSpacing: -0.4, lineHeight: 21 }}
    >
      {children}
    </Txt>
  )
}

/** 13/18 secondary, tracking 0: the alert message size, and the size the
 *  release notes are rendered at so the two read as one column. */
export function AlertMessage({ children }: { children: ReactNode }) {
  return (
    <Txt variant="label" tone="secondary" align="center">
      {children}
    </Txt>
  )
}
