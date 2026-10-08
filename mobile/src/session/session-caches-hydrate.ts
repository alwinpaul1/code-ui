import { hydrateSessionViewPreferences } from '../storage/session-view-preferences'
import { hydrateAgentHudBeacons } from './agent-hud-beacon'
import { hydrateNativeChatTranscriptCache } from './mobile-native-chat-transcript-cache'
import { hydrateNativeChatImagePreviewCache } from './mobile-native-chat-image-preview-cache'
import { hydrateWaitingPhotoSends } from './mobile-native-chat-waiting-photo-sends'
import { hydrateSessionTabsCache } from './mobile-session-tabs-cache'
import { hydrateNativeChatKeptSessions } from './native-chat-kept-session-store'
import { hydrateSessionCommandPairs } from './claude-session-command-pair'
import { hydrateStartupFramePairs } from './claude-startup-frame-pair'
import { hydrateScreenModelRecords } from './claude-screen-model-pair'
import { hydrateScheduledPromptMemory } from './scheduled-prompt-memory'

/** Load the persisted project caches once at app start, before any project opens. */
export function hydrateSessionCaches(): Promise<void> {
  return Promise.all([
    hydrateSessionTabsCache(),
    hydrateNativeChatTranscriptCache(),
    // Why: the transcript above paints a chat at once, and the photos the
    // phone sent in it must be there in that frame (mobile-native-chat-image-preview-cache,
    // and mobile-native-chat-waiting-photo-sends for a row that landed while it was closed).
    hydrateNativeChatImagePreviewCache(),
    hydrateWaitingPhotoSends(),
    hydrateSessionViewPreferences(),
    // Why: the beacon only arrives when the agent repaints, so without this a
    // cold start shows a staler source until then. See agent-hud-beacon-warm-start.
    hydrateAgentHudBeacons(),
    // Why: the tab's own agent session, kept over a nested agent's status on
    // the same pane; a cold start's first status can be that nested one.
    hydrateNativeChatKeptSessions(),
    // Why: the loop prompts a session showed, so a tick whose loop call is
    // not on the first page loaded draws no bubble (scheduled-prompt-memory).
    hydrateScheduledPromptMemory(),
    // Why: the model and effort a session last said through /model and /effort,
    // so a project left or an app killed shows them on return (claude-session-command-pair).
    hydrateSessionCommandPairs(),
    // Why: the model and effort a session's own startup frame stated, which has
    // scrolled off by the time a late attach or a relaunch looks (claude-startup-frame-pair).
    hydrateStartupFramePairs(),
    // Why: what the spinner and an alt+p toast last said about the model and
    // effort, which are on screen for seconds at a time (claude-screen-model-pair).
    hydrateScreenModelRecords()
  ]).then(() => undefined)
}
