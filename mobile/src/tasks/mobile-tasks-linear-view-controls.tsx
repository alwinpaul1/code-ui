import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import { Text } from './mobile-tasks-dependencies'
import { styles } from './mobile-tasks-legacy-styles'
import { TasksButton } from './mobile-tasks-pressables'

export function renderMobileTasksLinearViewControls(model: ConnectionPresentationModel) {
  const {
    linearConnected,
    linearFilterLabel,
    linearGroupLabel,
    linearOrderLabel,
    linearTeamLabel,
    linearViewLabel,
    linearWorkspaceLabel,
    linearWorkspaces,
    provider,
    setShowLinearDisplayPicker,
    setShowLinearFilterPicker,
    setShowLinearGroupPicker,
    setShowLinearOrderPicker,
    setShowLinearTeamPicker,
    setShowLinearViewPicker,
    setShowLinearWorkspacePicker,
    taskUiReady
  } = model
  return (
    provider === 'linear' &&
    linearConnected && (
      <>
        {linearWorkspaces.length > 1 ? (
          <TasksButton
            style={styles.segmentButton}
            disabled={!taskUiReady}
            onPress={() => {
              if (!taskUiReady) {
                return
              }
              setShowLinearWorkspacePicker(true)
            }}
          >
            <Text style={styles.segmentSecondaryText}>{linearWorkspaceLabel}</Text>
          </TasksButton>
        ) : null}
        <TasksButton
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearTeamPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>{linearTeamLabel}</Text>
        </TasksButton>
        <TasksButton
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearFilterPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>{linearFilterLabel}</Text>
        </TasksButton>
        <TasksButton
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearViewPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>{linearViewLabel}</Text>
        </TasksButton>
        <TasksButton
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearGroupPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>Group: {linearGroupLabel}</Text>
        </TasksButton>
        <TasksButton
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearOrderPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>Order: {linearOrderLabel}</Text>
        </TasksButton>
        <TasksButton
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearDisplayPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>Display</Text>
        </TasksButton>
      </>
    )
  )
}
