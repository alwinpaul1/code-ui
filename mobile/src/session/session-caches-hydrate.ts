import { hydrateSessionViewPreferences } from '../storage/session-view-preferences'
import { hydrateAgentHudBeacons } from './agent-hud-beacon'
import { hydrateNativeChatTranscriptCache } from './mobile-native-chat-transcript-cache'
import { hydrateSessionTabsCache } from './mobile-session-tabs-cache'

/** Load the persisted project caches once at app start, before any project opens. */
export function hydrateSessionCaches(): Promise<void> {
  return Promise.all([
    hydrateSessionTabsCache(),
    hydrateNativeChatTranscriptCache(),
    hydrateSessionViewPreferences(),
    // Why: the beacon only arrives when the agent repaints, so without this a
    // cold start shows a staler source until then. See agent-hud-beacon-warm-start.
    hydrateAgentHudBeacons()
  ]).then(() => undefined)
}
