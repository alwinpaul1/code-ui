import { useEffect, useState } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

/**
 * Whether recolouring a label's spans reaches accessibility services on this
 * platform. Checked against AOSP (2026-09-27):
 *
 * - TextView.setText ends in notifyViewAccessibilityStateChangedIfNeeded.
 *   Android 13 and later call it only when AccessibilityUtils.textOrSpanChanged
 *   says the text or a ParcelableSpan's class, range or flags changed; a
 *   colour-only change keeps all of those, so it sends nothing. Android 12 and
 *   older call it on every setText.
 * - View.notifyViewAccessibilityStateChangedIfNeeded, on a view that is not a
 *   live region, hands the change to ViewGroup.notifySubtreeAccessibilityStateChanged,
 *   which walks up to the nearest live-region ancestor and sends
 *   TYPE_WINDOW_CONTENT_CHANGED from there. Neither checks
 *   importantForAccessibility, so hiding the label would not stop it.
 *
 * The running rows are polite live regions, so on Android 12 a sweep would
 * send one of those every 100 ms (the recurring-event interval) for as long as
 * an agent runs.
 */
export function recolourReachesAccessibility(os: string, version: number | string): boolean {
  return os === 'android' && typeof version === 'number' && version < 33
}

/** AccessibilityInfo.addEventListener for the one Android event React
 *  Native's .d.ts leaves out. The runtime has it: AccessibilityInfo.js maps
 *  'accessibilityServiceChanged' to the native 'accessibilityServiceDidChange'. */
type ServiceChangedListener = (
  eventName: 'accessibilityServiceChanged',
  handler: (enabled: boolean) => void
) => { remove: () => void }

/**
 * True while the shimmer must hold still for accessibility: on Android 12 and
 * older, while any accessibility service is on, and while that is not yet
 * known. Nothing to ask anywhere else.
 */
export function useShimmerHeldForAccessibility(): boolean {
  const legacy = recolourReachesAccessibility(Platform.OS, Platform.Version)
  const [serviceOn, setServiceOn] = useState<boolean | null>(null)
  useEffect(() => {
    if (!legacy) {
      return undefined
    }
    let mounted = true
    const apply = (enabled: boolean) => {
      if (mounted) {
        setServiceOn(enabled)
      }
    }
    let subscription: { remove: () => void } | null = null
    try {
      void AccessibilityInfo.isAccessibilityServiceEnabled()
        .then(apply)
        .catch(() => undefined)
      const addListener = AccessibilityInfo.addEventListener.bind(
        AccessibilityInfo
      ) as unknown as ServiceChangedListener
      subscription = addListener('accessibilityServiceChanged', apply)
    } catch {
      // No accessibility module in this runtime: stays unknown, and still.
    }
    return () => {
      mounted = false
      subscription?.remove()
    }
  }, [legacy])
  return legacy && serviceOn !== false
}
