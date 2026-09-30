import type { ListAndDetailEffectsModel } from './use-mobile-tasks-list-and-detail-effects'
import { useEffect, useState } from './mobile-tasks-dependencies'
import {
  githubAssignableUserListRead,
  githubRepoLabelListRead
} from './mobile-task-item-detail-operations'
import { useTaskReadAgainAfterReconnect } from './use-task-read-again-after-reconnect'

/**
 * The open GitHub item's label and assignee pickers. Each list is its own read with its own stale
 * guard, so a failed one is read again once per NEW connection of the host (`lastConnectedAt`,
 * from MobileTasksScreen; null, the default, follows no connection) without reading the other,
 * which loaded. Opening an item reads both, labels first, as they always were.
 */
export function useMobileTasksItemDetailMetadataEffects(
  model: ListAndDetailEffectsModel,
  lastConnectedAt: number | null = null
) {
  const {
    actionItem,
    client,
    detailPayload,
    setItemAssignableUsers,
    setItemAssignableUsersError,
    setItemAssignableUsersLoading,
    setItemAvailableLabels,
    setItemBodyDraft,
    setItemLabelsError,
    setItemLabelsLoading,
    tasksSupported
  } = model
  const [labelReads, setLabelReads] = useState(0)
  const [assigneeReads, setAssigneeReads] = useState(0)
  // Each read's own failure, which its error line cannot stand for: a rejection with an empty
  // message leaves that line ''.
  const [labelsFailed, setLabelsFailed] = useState(false)
  const [assigneesFailed, setAssigneesFailed] = useState(false)
  useEffect(() => {
    if (!detailPayload) {
      setItemBodyDraft('')
      return
    }
    setItemBodyDraft(
      detailPayload.provider === 'linear' ? detailPayload.description : detailPayload.body
    )
  }, [detailPayload])

  useEffect(() => {
    setLabelsFailed(false)
    if (
      !tasksSupported ||
      !client ||
      actionItem?.provider !== 'github' ||
      (actionItem.source.type !== 'issue' && actionItem.source.type !== 'pr')
    ) {
      setItemAvailableLabels([])
      setItemLabelsLoading(false)
      setItemLabelsError('')
      return
    }

    let stale = false
    setItemAvailableLabels([])
    setItemLabelsError('')
    setItemLabelsLoading(true)
    void githubRepoLabelListRead
      .request(client, { repo: `id:${actionItem.source.repoId}` }, { timeoutMs: 30_000 })
      .then((response) => {
        if (stale) {
          return
        }
        setItemAvailableLabels(githubRepoLabelListRead.interpret(response))
      })
      .catch((err) => {
        if (!stale) {
          setItemLabelsError(err instanceof Error ? err.message : 'Failed to load labels')
          setLabelsFailed(true)
        }
      })
      .finally(() => {
        if (!stale) {
          setItemLabelsLoading(false)
        }
      })

    return () => {
      stale = true
    }
  }, [actionItem, client, tasksSupported, labelReads])

  useEffect(() => {
    setAssigneesFailed(false)
    if (!tasksSupported || !client || actionItem?.provider !== 'github') {
      setItemAssignableUsers([])
      setItemAssignableUsersLoading(false)
      setItemAssignableUsersError('')
      return
    }

    let stale = false
    setItemAssignableUsers([])
    setItemAssignableUsersError('')
    setItemAssignableUsersLoading(true)
    void githubAssignableUserListRead
      .request(client, { repo: `id:${actionItem.source.repoId}` }, { timeoutMs: 30_000 })
      .then((response) => {
        if (stale) {
          return
        }
        setItemAssignableUsers(githubAssignableUserListRead.interpret(response))
      })
      .catch((err) => {
        if (!stale) {
          setItemAssignableUsersError(
            err instanceof Error ? err.message : 'Failed to load assignees'
          )
          setAssigneesFailed(true)
        }
      })
      .finally(() => {
        if (!stale) {
          setItemAssignableUsersLoading(false)
        }
      })

    return () => {
      stale = true
    }
  }, [actionItem, client, tasksSupported, assigneeReads])

  const pickerItem = actionItem?.provider === 'github' ? actionItem.source.id : null
  useTaskReadAgainAfterReconnect({
    key: pickerItem === null ? null : `${pickerItem}\u0000labels`,
    failed: labelsFailed,
    lastConnectedAt,
    readAgain: () => setLabelReads((current) => current + 1)
  })
  useTaskReadAgainAfterReconnect({
    key: pickerItem === null ? null : `${pickerItem}\u0000assignees`,
    failed: assigneesFailed,
    lastConnectedAt,
    readAgain: () => setAssigneeReads((current) => current + 1)
  })
  return model
}

export type ItemDetailMetadataEffectsModel = ReturnType<
  typeof useMobileTasksItemDetailMetadataEffects
>
