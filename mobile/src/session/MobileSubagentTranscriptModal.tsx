import { FlashList } from '@shopify/flash-list'
import { Diamond } from 'lucide-react-native'
import { useCallback, useEffect, useMemo } from 'react'
import { ActivityIndicator, Modal, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { encodeNativeChatTranscriptIdentity } from '../../../src/shared/native-chat-transcript-retention'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import { useHostClient } from '../transport/host-client-hooks'
import { useTheme } from '../theme/theme-context'
import { ScreenHeader } from '../ui/ScreenHeader'
import { Txt } from '../ui/Txt'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { MobileNativeChatLoadEarlier } from './mobile-native-chat-list-edges'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { useChatViewStyles } from './mobile-native-chat-view-styles'
import { subagentTranscriptBodyState } from './mobile-subagent-transcript'
import {
  closeSubagentTranscript,
  useSubagentTranscriptRequest,
  type SubagentTranscriptRequest
} from './subagent-transcript-store'
import { useMobileNativeChatSession } from './use-mobile-native-chat-session'

/**
 * What a subagent did, read from its own transcript and drawn with the parent
 * chat's rows. Read-only: there is no composer, because there is nothing to
 * send to — a subagent takes its prompt from the parent and reports back to it.
 *
 * The transcript comes through the same subscription the parent lane uses
 * (`useMobileNativeChatSession`), so a running agent's turns land live the same
 * way the parent's do, a finished one delivers its snapshot and then nothing,
 * and a read that failed while the relay was down is retried once per new
 * connection (`shouldRefetchAfterReconnect`, inside that hook). What differs is
 * only the target — see `mobile-subagent-transcript.ts` for why the session key
 * is `agent-<id>` and never the parent's session id.
 */
export function MobileSubagentTranscriptModal({
  hostId,
  worktreeId
}: {
  hostId: string
  worktreeId: string | null
}): React.JSX.Element | null {
  const request = useSubagentTranscriptRequest()
  // A viewer opened on one session screen must not reappear on the next.
  useEffect(() => closeSubagentTranscript, [])
  if (!request) {
    return null
  }
  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={closeSubagentTranscript}>
      <MobileSubagentTranscriptScreen
        request={request}
        hostId={hostId}
        worktreeId={worktreeId}
        onClose={closeSubagentTranscript}
      />
    </Modal>
  )
}

/** The screen inside the modal, exported so tests can mount it without the
 *  native modal host. */
export function MobileSubagentTranscriptScreen({
  request,
  hostId,
  worktreeId,
  onClose
}: {
  request: SubagentTranscriptRequest
  hostId: string
  worktreeId: string | null
  onClose: () => void
}): React.JSX.Element {
  const { target, running } = request
  const { colors, space } = useTheme()
  const styles = useChatViewStyles()
  const insets = useSafeAreaInsets()
  const { client } = useHostClient(hostId)
  const lastConnectedAt = useLastConnectedAt(hostId)
  const session = useMobileNativeChatSession({
    client,
    // Its own retention slot: the parent tab's identity is host+worktree, and a
    // subagent must never be seeded from, or captured into, the parent's cache.
    sourceIdentity: encodeNativeChatTranscriptIdentity([hostId, worktreeId, 'subagent']),
    agent: target.agent,
    sessionId: target.sessionId,
    transcriptPath: target.transcriptPath,
    lastConnectedAt
  })
  const folded = useMemo(() => foldMobileNativeChatMessages(session.messages), [session.messages])
  const newestFirst = useMemo(() => folded.toReversed(), [folded])
  const body = subagentTranscriptBodyState({
    status: session.status,
    messageCount: folded.length,
    error: session.error
  })
  const renderItem = useCallback(
    ({ item }: { item: NativeChatMessage }) => <MobileNativeChatMessage message={item} />,
    []
  )

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={target.title}
        subtitle={`Subagent · ${running ? 'Running' : 'Finished'}`}
        onBack={onClose}
        backLabel="Back to background tasks"
      />
      {body.kind === 'messages' ? (
        <FlashList
          data={newestFirst}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onEndReached={session.loadEarlier}
          onEndReachedThreshold={0.5}
          maxItemsInRecyclePool={0}
          ListHeaderComponent={<View style={{ height: insets.bottom + space.md }} />}
          ListFooterComponent={
            <MobileNativeChatLoadEarlier
              hasMore={session.hasMore}
              loadingEarlier={session.loadingEarlier}
              onLoadEarlier={session.loadEarlier}
              styles={styles}
              colors={colors}
            />
          }
        />
      ) : (
        <SubagentTranscriptEmpty kind={body.kind} message={body.kind === 'error' ? body.message : null} />
      )}
    </View>
  )
}

/** The three states with no rows to draw. The absent file is the common one:
 *  an agent that has just been launched has nothing on disk yet, and the read
 *  stays open until it does. */
function SubagentTranscriptEmpty({
  kind,
  message
}: {
  kind: 'loading' | 'nothing-yet' | 'error'
  message: string | null
}): React.JSX.Element {
  const { colors } = useTheme()
  const styles = useChatViewStyles()
  switch (kind) {
    case 'loading':
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      )
    case 'nothing-yet':
      return (
        <View style={styles.center}>
          <Diamond size={32} color={colors.accentText} />
          <Txt variant="heading" weight="semibold" align="center">
            Nothing written yet
          </Txt>
          <Txt variant="body" tone="muted" align="center">
            The agent has not recorded a turn. This stays open and fills in as it works.
          </Txt>
        </View>
      )
    case 'error':
      return (
        <View style={styles.center}>
          <Txt variant="heading" weight="semibold" align="center">
            Couldn't read this transcript
          </Txt>
          <Txt variant="body" tone="muted" align="center">
            {message ?? ''}
          </Txt>
        </View>
      )
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}
