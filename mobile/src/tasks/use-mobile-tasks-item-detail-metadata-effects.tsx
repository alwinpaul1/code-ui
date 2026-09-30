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
    itemAssignableUsersError,
    itemLabelsError,
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

  // Both errors are written by these reads alone.
  const pickerItem = actionItem?.provider === 'github' ? actionItem.source.id : null
  useTaskReadAgainAfterReconnect({
    key: pickerItem === null ? null : `${pickerItem}\u0000labels`,
    failed: itemLabelsError !== '',
    lastConnectedAt,
    readAgain: () => setLabelReads((current) => current + 1)
  })
  useTaskReadAgainAfterReconnect({
    key: pickerItem === null ? null : `${pickerItem}\u0000assignees`,
    failed: itemAssignableUsersError !== '',
    lastConnectedAt,
    readAgain: () => setAssigneeReads((current) => current + 1)
  })
  return model
}

export type ItemDetailMetadataEffectsModel = ReturnType<
  typeof useMobileTasksItemDetailMetadataEffects
>
