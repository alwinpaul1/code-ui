import type { GestureResponderEvent } from 'react-native'

/**
 * Whether the browser pane's pan responder may be taken from the current touch.
 *
 * The long-press right-click outlives the WebView's own long-press `contextmenu` at ~500 ms, so
 * that event must not end it. Native touches carry no `type`, and a native press is always yielded.
 */
export function mayTerminateBrowserPan(event: Pick<GestureResponderEvent, 'nativeEvent'>): boolean {
  const nativeEvent: object = event.nativeEvent
  return !('type' in nativeEvent) || nativeEvent.type !== 'contextmenu'
}
