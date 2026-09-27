import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import { tapTargetHitSlop } from '../ui/tap-target'
import { View, ChevronLeft, StatusDot, Text, RefreshCw, Plus } from './mobile-tasks-dependencies'
import { TasksButton } from './mobile-tasks-pressables'
import { renderMobileTasksProviderControls } from './mobile-tasks-provider-controls'
import { renderMobileTasksSearchControl } from './mobile-tasks-search-control'

export function renderMobileTasksChrome(model: ConnectionPresentationModel) {
  const { setTaskCopyFeedbackRootRef, styles } = model
  return (
    <View ref={setTaskCopyFeedbackRootRef} style={styles.topChrome}>
      {renderMobileTasksStatusBar(model)}

      {renderMobileTasksProviderControls(model)}

      {renderMobileTasksSearchControl(model)}
    </View>
  )
}

export function renderMobileTasksStatusBar(model: ConnectionPresentationModel) {
  const {
    colors,
    connState,
    githubMode,
    githubProjectLoading,
    headerVerdict,
    linearConnected,
    loading,
    provider,
    refreshGitHubProject,
    refreshTasks,
    refreshing,
    router,
    setCreateBody,
    setCreateTitle,
    setLinearApiKeyDraft,
    setLinearConnectError,
    setLinearConnectState,
    setShowCreateTask,
    setShowLinearConnect,
    showHeaderCreateTask,
    styles,
    taskUiReady
  } = model
  return (
    <View style={styles.statusBar}>
      <TasksButton
        hitSlop={tapTargetHitSlop(styles.backButton)}
        style={styles.backButton}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <ChevronLeft size={22} color={colors.text} />
      </TasksButton>
      <View style={styles.titleWrap}>
        <StatusDot state={connState} verdict={headerVerdict} />
        <Text style={styles.title}>Tasks</Text>
      </View>
      <TasksButton
        hitSlop={tapTargetHitSlop(styles.iconButton, { horizontalGap: 0 })}
        style={styles.iconButton}
        disabled={!taskUiReady || loading || refreshing || githubProjectLoading}
        onPress={() => {
          if (!taskUiReady) {
            return
          }
          if (provider === 'github' && githubMode === 'project') {
            refreshGitHubProject()
            return
          }
          refreshTasks()
        }}
      >
        <RefreshCw size={16} color={taskUiReady ? colors.textSecondary : colors.textMuted} />
      </TasksButton>
      {showHeaderCreateTask ? (
        <TasksButton
          hitSlop={tapTargetHitSlop(styles.iconButton, { horizontalGap: 0 })}
          style={styles.iconButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            if (provider === 'linear' && !linearConnected) {
              setLinearApiKeyDraft('')
              setLinearConnectState('idle')
              setLinearConnectError('')
              setShowLinearConnect(true)
              return
            }
            setCreateTitle('')
            setCreateBody('')
            setShowCreateTask(true)
          }}
        >
          <Plus size={16} color={taskUiReady ? colors.textSecondary : colors.textMuted} />
        </TasksButton>
      ) : null}
    </View>
  )
}
