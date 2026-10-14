import { useState, useSyncExternalStore } from 'react'
import { Pressable, View } from 'react-native'
import { X } from 'lucide-react-native'
import { useNow } from '../hooks/use-now'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { rateLimitNotice, type RateLimitNotice } from './hud-rate-limit-notice'
import { MobileUsageSheet } from './MobileContextWindowSheet'
import type { MobileSessionController } from './use-mobile-session-controller'

// The Claude app's rate-limit banner (com.anthropic.claude 1.261009.20, `pj8.a`, `bb8` case 4 and
// `hq8` case 18). A `Surface` of radius 16 in `pl7.s`, 12 dp of padding all round, a row spread across
// the width and centred (`wwb.g`, `jbg.H`). The words fill the row (weight 1): the title at `jn7.I`
// 13/550, then 2 dp (`lb1(2)`), the subtitle at `jn7.K` 11/400 in `pl7.P`. At the end, 8 dp apart: a
// small secondary button "View usage" (`i820.c`, style `lf4` "Secondary", size `bf4` "Small": 36 dp
// tall, a 40 dp touch target, label `jn7.F` 15/550, fill `pl7.x`, text `pl7.O`), and the close
// glyph (`e1t.c`: the X, 20 dp, `pl7.P`, named "Dismiss") when the notice can be closed.
//
// Not read in the decompile, so chosen: the button's horizontal padding (16) and its shape (a
// capsule), and the banner's margins, which are the dock's (`space.md` at the sides, as the session
// pills have).
//
// Code UI's tokens stand in where the app's have no match, each the same value: `pl7.s` is
// `codeBlockHeader`, `pl7.P` is `composerIcon`, `pl7.x` is `composerBorder`, and 550 weight is the
// medium face the app ships here (MobileSessionPillRow.tsx says the same).
//
// Where the figures come from, and when a notice is drawn: hud-rate-limit-notice.ts.

const BANNER_RADIUS = 16
const BANNER_PADDING = 12
const WORDS_GAP = 2
const ACTIONS_GAP = 8
const BUTTON_HEIGHT = 36
const BUTTON_TOUCH_HEIGHT = 40
const BUTTON_PADDING_X = 16
const CLOSE_TARGET = 40
const CLOSE_GLYPH = 20
const SUBTITLE_SIZE = 11
const SUBTITLE_LINE = 16.5

/** The banner, from its notice. Pure of the connection: the connected banner below feeds it, and the
 *  tests drive it in light and dark. `onViewUsage` absent draws no "View usage" (the credits notice
 *  has none, `nj8Var2 = null`); `onDismiss` is drawn only for a notice that can be closed. */
export function RateLimitBannerView({
  notice,
  onViewUsage,
  onDismiss
}: {
  notice: RateLimitNotice
  onViewUsage?: () => void
  onDismiss?: () => void
}): React.JSX.Element {
  const { colors, space } = useTheme()
  const spoken = notice.subtitle === null ? notice.title : `${notice.title}. ${notice.subtitle}`
  return (
    <View style={{ paddingHorizontal: space.md, paddingBottom: space.xs }}>
      <View
        testID="rate-limit-banner"
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: BANNER_RADIUS,
          padding: BANNER_PADDING,
          backgroundColor: colors.codeBlockHeader
        }}
      >
        <View testID="rate-limit-banner-words" accessible accessibilityLabel={spoken} style={{ flex: 1, gap: WORDS_GAP }}>
          <Txt variant="label" weight="medium">
            {notice.title}
          </Txt>
          {notice.subtitle === null ? null : (
            <Txt
              variant="caption"
              style={{
                fontSize: SUBTITLE_SIZE,
                lineHeight: SUBTITLE_LINE,
                letterSpacing: 0,
                color: colors.composerIcon
              }}
            >
              {notice.subtitle}
            </Txt>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ACTIONS_GAP }}>
          {onViewUsage === undefined ? null : (
            <Pressable
              testID="rate-limit-view-usage"
              accessibilityRole="button"
              onPress={onViewUsage}
              hitSlop={{ top: (BUTTON_TOUCH_HEIGHT - BUTTON_HEIGHT) / 2, bottom: (BUTTON_TOUCH_HEIGHT - BUTTON_HEIGHT) / 2, left: 0, right: 0 }}
              style={({ pressed }) => ({
                height: BUTTON_HEIGHT,
                paddingHorizontal: BUTTON_PADDING_X,
                borderRadius: BUTTON_HEIGHT / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.composerBorder,
                opacity: pressed ? 0.7 : 1
              })}
            >
              <Txt variant="body" weight="medium" numberOfLines={1}>
                View usage
              </Txt>
            </Pressable>
          )}
          {notice.dismissible && onDismiss !== undefined ? (
            <Pressable
              testID="rate-limit-dismiss"
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              onPress={onDismiss}
              style={({ pressed }) => ({
                width: CLOSE_TARGET,
                height: CLOSE_TARGET,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1
              })}
            >
              <X size={CLOSE_GLYPH} color={colors.composerIcon} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  )
}

// What the user closed, by notice key, for as long as the app runs: the Claude app keeps it with the
// session's state, and a banner that came back at every tab switch would be the thing they closed.
// A different kind, window or reset cycle has another key (hud-rate-limit-notice.ts).
const dismissed = new Set<string>()
const listeners = new Set<() => void>()
let dismissals = 0

function dismiss(key: string): void {
  dismissed.add(key)
  dismissals += 1
  listeners.forEach((listener) => listener())
}

export function resetDismissedRateLimitNotices(): void {
  dismissed.clear()
  dismissals += 1
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const NO_WINDOWS: never[] = []
/** How often the clock is read again while a window is held: a reset that passes, or a share of the
 *  window that grows, is noticed within the minute (and at once when the app returns to the front). */
const CLOCK_MS = 60_000

export function MobileNativeChatRateLimitBanner({
  controller
}: {
  controller: MobileSessionController
}): React.JSX.Element | null {
  const chat = controller.nativeChatController
  const windows = chat.nativeChatRateLimits ?? NO_WINDOWS
  useSyncExternalStore(subscribe, () => dismissals)
  const now = useNow(CLOCK_MS, windows.length > 0)
  const [usageOpen, setUsageOpen] = useState(false)
  const notice = rateLimitNotice({ windows, agent: chat.nativeChatAgent ?? null, now })
  if (notice === null || dismissed.has(notice.key)) {
    // The sheet lists the windows of a notice that is gone; shut, so it does not open itself over the
    // next one (the pill row does the same for its hint).
    if (usageOpen) {
      setUsageOpen(false)
    }
    return null
  }
  return (
    <>
      <RateLimitBannerView
        notice={notice}
        onViewUsage={notice.kind === 'credits' ? undefined : () => setUsageOpen(true)}
        onDismiss={() => dismiss(notice.key)}
      />
      <MobileUsageSheet visible={usageOpen} limits={windows} onClose={() => setUsageOpen(false)} />
    </>
  )
}
