import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import {
  View,
  Plus,
  colors,
  Text,
  Linking,
  ExternalLink,
  Copy,
  RefreshCw,
  X,
  GitBranch
} from './mobile-tasks-dependencies'
import { styles } from './mobile-tasks-legacy-styles'
import { TasksRow } from './mobile-tasks-pressables'
import {
  taskExternalOpenLabel,
  type TaskItem,
  taskStatusActionLabel,
  isGitHubPrMergeBlocked
} from './mobile-tasks-legacy-foundation'

export function renderMobileTasksItemActions(model: ConnectionPresentationModel) {
  const {
    actionItem,
    copiedLinkKey,
    copyTaskLink,
    copyTextToClipboard,
    creatingKey,
    mutatingStatus,
    openWorkspaceCreate,
    setLinearStatusPickerItem,
    setMergeMethodTaskItem,
    setPendingHostedStateChange,
    setWorkspaceRepoPickerItem,
    workspaceRepos
  } = model
  if (!actionItem) {
    return null
  }
  return (
    <View style={styles.actionGroup}>
      <TasksRow
        style={styles.actionRow}
        disabled={creatingKey === actionItem.key}
        onPress={() => {
          if (actionItem.provider === 'linear' && workspaceRepos.length > 1) {
            setWorkspaceRepoPickerItem(actionItem)
            return
          }
          openWorkspaceCreate(actionItem)
        }}
      >
        <Plus size={16} color={colors.textPrimary} />
        <Text style={styles.actionText}>
          {creatingKey === actionItem.key ? 'Creating...' : 'Create Workspace'}
        </Text>
      </TasksRow>

      <View style={styles.actionSeparator} />
      <TasksRow
        style={styles.actionRow}
        onPress={() => void Linking.openURL(actionItem.source.url)}
      >
        <ExternalLink size={16} color={colors.textPrimary} />
        <Text style={styles.actionText}>{taskExternalOpenLabel(actionItem)}</Text>
      </TasksRow>

      {actionItem.provider === 'linear' ? (
        <>
          <View style={styles.actionSeparator} />
          <TasksRow
            style={styles.actionRow}
            onPress={() =>
              void copyTextToClipboard(`linear-url:${actionItem.key}`, actionItem.source.url)
            }
          >
            <Copy size={16} color={colors.textPrimary} />
            <Text style={styles.actionText}>
              {copiedLinkKey === `linear-url:${actionItem.key}` ? 'Copied' : 'Copy Linear link'}
            </Text>
          </TasksRow>
        </>
      ) : null}

      {actionItem.provider === 'github' ? (
        <>
          <View style={styles.actionSeparator} />
          <TasksRow
            style={styles.actionRow}
            onPress={() => void copyTaskLink(`task:${actionItem.key}`, actionItem.source.url)}
          >
            <Copy size={16} color={colors.textPrimary} />
            <Text style={styles.actionText}>
              {copiedLinkKey === `task:${actionItem.key}` ? 'Copied' : 'Copy GitHub link'}
            </Text>
          </TasksRow>
        </>
      ) : null}

      {actionItem.provider === 'github' && actionItem.source.state !== 'merged' ? (
        <>
          <View style={styles.actionSeparator} />
          <TasksRow
            style={styles.actionRow}
            disabled={mutatingStatus}
            onPress={() => {
              const githubItem = actionItem as Extract<TaskItem, { provider: 'github' }>
              setPendingHostedStateChange({
                source: 'task',
                item: githubItem,
                nextState: githubItem.source.state === 'closed' ? 'open' : 'closed'
              })
            }}
          >
            {actionItem.source.state === 'closed' ? (
              <RefreshCw size={16} color={colors.textPrimary} />
            ) : (
              <X size={16} color={colors.textPrimary} />
            )}
            <Text style={styles.actionText}>{taskStatusActionLabel(actionItem)}</Text>
          </TasksRow>
        </>
      ) : null}

      {actionItem.provider === 'github' &&
      actionItem.source.type === 'pr' &&
      actionItem.source.state === 'open' ? (
        <>
          <View style={styles.actionSeparator} />
          <TasksRow
            style={styles.actionRow}
            disabled={mutatingStatus || isGitHubPrMergeBlocked(actionItem)}
            onPress={() =>
              setMergeMethodTaskItem(actionItem as Extract<TaskItem, { provider: 'github' }>)
            }
          >
            <GitBranch size={16} color={colors.textPrimary} />
            <Text style={styles.actionText}>Merge pull request</Text>
          </TasksRow>
          {isGitHubPrMergeBlocked(actionItem) ? (
            <Text style={styles.emptyInlineText}>GitHub reports merge conflicts.</Text>
          ) : null}
        </>
      ) : null}

      {actionItem.provider === 'gitlab' &&
      actionItem.source.state !== 'merged' &&
      actionItem.source.state !== 'locked' ? (
        <>
          <View style={styles.actionSeparator} />
          <TasksRow
            style={styles.actionRow}
            disabled={mutatingStatus}
            onPress={() => {
              const gitlabItem = actionItem as Extract<TaskItem, { provider: 'gitlab' }>
              setPendingHostedStateChange({
                source: 'task',
                item: gitlabItem,
                nextState: gitlabItem.source.state === 'closed' ? 'opened' : 'closed'
              })
            }}
          >
            {actionItem.source.state === 'closed' ? (
              <RefreshCw size={16} color={colors.textPrimary} />
            ) : (
              <X size={16} color={colors.textPrimary} />
            )}
            <Text style={styles.actionText}>{taskStatusActionLabel(actionItem)}</Text>
          </TasksRow>
        </>
      ) : null}

      {actionItem.provider === 'gitlab' &&
      actionItem.source.type === 'mr' &&
      actionItem.source.state === 'opened' ? (
        <>
          <View style={styles.actionSeparator} />
          <TasksRow
            style={styles.actionRow}
            disabled={mutatingStatus}
            onPress={() =>
              setMergeMethodTaskItem(actionItem as Extract<TaskItem, { provider: 'gitlab' }>)
            }
          >
            <GitBranch size={16} color={colors.textPrimary} />
            <Text style={styles.actionText}>Merge merge request</Text>
          </TasksRow>
        </>
      ) : null}

      {actionItem.provider === 'linear' ? (
        <>
          <View style={styles.actionSeparator} />
          <TasksRow
            style={styles.actionRow}
            disabled={mutatingStatus}
            onPress={() => {
              setLinearStatusPickerItem(actionItem as Extract<TaskItem, { provider: 'linear' }>)
            }}
          >
            <GitBranch size={16} color={colors.textPrimary} />
            <Text style={styles.actionText}>Change status</Text>
          </TasksRow>
        </>
      ) : null}
    </View>
  )
}
