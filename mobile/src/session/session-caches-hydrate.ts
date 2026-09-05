import { hydrateSessionViewPreferences } from '../storage/session-view-preferences'
import { hydrateNativeChatTranscriptCache } from './mobile-native-chat-transcript-cache'
import { hydrateSessionTabsCache } from './mobile-session-tabs-cache'

/** Load the persisted project caches once at app start, before any project opens. */
export function hydrateSessionCaches(): Promise<void> {
  return Promise.all([
    hydrateSessionTabsCache(),
    hydrateNativeChatTranscriptCache(),
    hydrateSessionViewPreferences()
  ]).then(() => undefined)
}
