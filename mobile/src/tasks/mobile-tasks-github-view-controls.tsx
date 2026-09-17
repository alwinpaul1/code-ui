import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import { tapTargetHitSlop } from '../ui/tap-target'
import { Text, View, Linking, ExternalLink, colors } from './mobile-tasks-dependencies'
import { styles } from './mobile-tasks-legacy-styles'
import { TasksButton } from './mobile-tasks-pressables'

export function renderMobileTasksGitHubViewControls(model: ConnectionPresentationModel) {
  const {
    activeGitHubProjectView,
    activeProjectLabel,
    githubIssueSourceLabel,
    githubIssueSourceRows,
    githubMode,
    githubModeLabel,
    githubPresetLabel,
    githubProjectAvailableSummaryFields,
    githubProjectFieldsLabel,
    githubProjectSortLabel,
    githubProjectTable,
    provider,
    selectedGitHubProjectViewUrl,
    setShowGitHubIssueSourcePicker,
    setShowGitHubKindPicker,
    setShowGitHubPresetPicker,
    setShowGitHubProjectFieldsPicker,
    setShowGitHubProjectPicker,
    setShowGitHubProjectSortPicker,
    setShowGitHubProjectViewPicker,
    taskUiReady,
    visibleGitHubProjectRows
  } = model
  return (
    provider === 'github' && (
      <>
        <TasksButton
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowGitHubKindPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>{githubModeLabel}</Text>
        </TasksButton>
        {githubMode === 'items' ? (
          <>
            <TasksButton
              style={styles.segmentButton}
              disabled={!taskUiReady}
              onPress={() => {
                if (!taskUiReady) {
                  return
                }
                setShowGitHubPresetPicker(true)
              }}
            >
              <Text style={styles.segmentSecondaryText}>{githubPresetLabel}</Text>
            </TasksButton>
            {githubIssueSourceRows.length > 0 ? (
              <TasksButton
                style={styles.segmentButton}
                disabled={!taskUiReady}
                onPress={() => {
                  if (!taskUiReady) {
                    return
                  }
                  setShowGitHubIssueSourcePicker(true)
                }}
              >
                <Text style={styles.segmentSecondaryText}>Source: {githubIssueSourceLabel}</Text>
              </TasksButton>
            ) : null}
          </>
        ) : (
          <>
            <TasksButton
              style={styles.segmentButton}
              disabled={!taskUiReady}
              onPress={() => {
                if (!taskUiReady) {
                  return
                }
                setShowGitHubProjectPicker(true)
              }}
            >
              <Text style={styles.segmentSecondaryText}>{activeProjectLabel}</Text>
            </TasksButton>
            {activeGitHubProjectView ? (
              <TasksButton
                style={styles.segmentButton}
                disabled={!taskUiReady}
                onPress={() => {
                  if (!taskUiReady) {
                    return
                  }
                  setShowGitHubProjectViewPicker(true)
                }}
              >
                <Text style={styles.segmentSecondaryText}>{activeGitHubProjectView.name}</Text>
              </TasksButton>
            ) : null}
            {githubProjectTable ? (
              <TasksButton
                style={styles.segmentButton}
                disabled={!taskUiReady}
                onPress={() => {
                  if (!taskUiReady) {
                    return
                  }
                  setShowGitHubProjectSortPicker(true)
                }}
              >
                <Text style={styles.segmentSecondaryText}>Sort: {githubProjectSortLabel}</Text>
              </TasksButton>
            ) : null}
            {githubProjectAvailableSummaryFields.length > 0 ? (
              <TasksButton
                style={styles.segmentButton}
                disabled={!taskUiReady}
                onPress={() => {
                  if (!taskUiReady) {
                    return
                  }
                  setShowGitHubProjectFieldsPicker(true)
                }}
              >
                <Text style={styles.segmentSecondaryText}>Fields: {githubProjectFieldsLabel}</Text>
              </TasksButton>
            ) : null}
            {githubProjectTable ? (
              <View style={styles.segmentCountPill}>
                <Text style={styles.segmentSecondaryText}>{visibleGitHubProjectRows.length}</Text>
              </View>
            ) : null}
            {selectedGitHubProjectViewUrl ? (
              <TasksButton
                hitSlop={tapTargetHitSlop(styles.segmentIconButton)}
                accessibilityRole="button"
                accessibilityLabel="Open view in GitHub"
                style={styles.segmentIconButton}
                disabled={!taskUiReady}
                onPress={() => {
                  if (!taskUiReady) {
                    return
                  }
                  void Linking.openURL(selectedGitHubProjectViewUrl)
                }}
              >
                <ExternalLink size={14} color={colors.textSecondary} />
              </TasksButton>
            ) : null}
          </>
        )}
      </>
    )
  )
}
