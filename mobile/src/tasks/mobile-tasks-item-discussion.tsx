import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import { View, Text } from './mobile-tasks-dependencies'
import { TasksButton } from './mobile-tasks-pressables'
import { discussionSummary } from './mobile-tasks-legacy-foundation'

/**
 * The open item's Discussion section: its comments and the composer under them.
 *
 * A Linear comment list the desktop refused is not an issue with no comments (review,
 * 2026-09-30), so it says so, with no count, and offers Retry. Retry asks for the detail again, as
 * the refresh icon does; the list is also read again on its own once the host reconnects
 * (use-mobile-tasks-item-detail-loading.tsx), so Retry is for a read that failed anyway.
 *
 * A comment posted from here over such a list is appended to it and the flag stays, so the list
 * then holds only what this sheet posted. Those are drawn, under a line saying the earlier ones
 * could not be read: drawing the failure alone hid a comment the desktop had taken, and the user
 * posted it again (review, 2026-09-30). Still no count, which would state a wrong total.
 */
export function renderMobileTasksItemDiscussion(model: ConnectionPresentationModel) {
  const {
    actionItem,
    addHostedItemComment,
    addLinearComment,
    detailCommentGroups,
    detailPayload,
    itemCommentDraft,
    linearCommentDraft,
    mutatingStatus,
    renderCommentComposer,
    renderDetailCommentGroup,
    setDetailRefreshSeq,
    setItemCommentDraft,
    setLinearCommentDraft,
    styles
  } = model
  if (!actionItem || !detailPayload) {
    return null
  }
  const commentsFailed = detailPayload.provider === 'linear' && detailPayload.commentsFailed === true
  return (
    <View style={styles.detailSection}>
      <View style={styles.detailSectionHeader}>
        <Text style={styles.detailSectionTitle}>Discussion</Text>
        {commentsFailed ? null : (
          <Text style={styles.detailSectionMeta}>
            {discussionSummary(detailPayload.comments.length)}
          </Text>
        )}
      </View>
      {commentsFailed ? (
        <>
          <View style={styles.detailLoadingInline}>
            <Text style={[styles.detailError, styles.repoPickerTextWrap]}>
              {detailPayload.comments.length > 0
                ? "Couldn't load the earlier comments"
                : "Couldn't load comments"}
            </Text>
            <TasksButton
              accessibilityRole="button"
              accessibilityLabel="Retry loading comments"
              style={styles.sourceErrorRetry}
              onPress={() => setDetailRefreshSeq((current) => current + 1)}
            >
              <Text style={styles.sourceErrorRetryText}>Retry</Text>
            </TasksButton>
          </View>
          {detailCommentGroups.map(renderDetailCommentGroup)}
        </>
      ) : detailPayload.comments.length === 0 ? (
        <Text style={styles.detailMuted}>No comments.</Text>
      ) : (
        detailCommentGroups.map(renderDetailCommentGroup)
      )}
      {(detailPayload.provider === 'github' && actionItem.provider === 'github') ||
      (detailPayload.provider === 'gitlab' && actionItem.provider === 'gitlab')
        ? renderCommentComposer({
            value: itemCommentDraft,
            onChangeText: setItemCommentDraft,
            disabled: mutatingStatus,
            onSubmit: () => void addHostedItemComment(actionItem)
          })
        : null}
      {detailPayload.provider === 'linear' && actionItem.provider === 'linear'
        ? renderCommentComposer({
            value: linearCommentDraft,
            onChangeText: setLinearCommentDraft,
            disabled: mutatingStatus,
            onSubmit: () => void addLinearComment(actionItem)
          })
        : null}
    </View>
  )
}
