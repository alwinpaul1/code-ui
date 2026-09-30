import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'
import {
  projectConfigFileCreate,
  projectConfigFileRead,
  projectConfigFileWrite
} from './project-config-file-operations'
import { classifyProjectConfigFileError, describeProjectConfigFileError } from './project-config-file-error'

/**
 * The shared read → local-edit → save state machine behind all three
 * project-config screens (MCP servers, permission rules, project memory).
 * Each screen owns its own parsing of `content` (JSON for the first two,
 * plain text for the third) — this hook only knows it is reading and
 * writing one worktree-relative text file.
 *
 * `saveError` never discards `content`: a refused write leaves the draft
 * exactly as the user left it, with the refusal shown alongside it. (On a
 * host whose mobile gate refuses `files.write` — Orca 1.4.205 — the screens
 * never offer Save at all; see project-config-file-operations.ts.)
 */
export type ProjectConfigFileState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'too-large'; byteLength: number }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      content: string
      savedContent: string
      isDirty: boolean
      saving: boolean
      saveError: string | null
      creating: false
      createError: string | null
    }

export function useProjectConfigFile(args: {
  client: RpcClient | null
  /** The host whose connections a failed read is retried on. */
  hostId: string
  worktreeId: string
  relativePath: string
}) {
  const { client, hostId, worktreeId, relativePath } = args
  const [state, setState] = useState<ProjectConfigFileState>({ status: 'loading' })
  const readSeqRef = useRef(0)
  const saveSeqRef = useRef(0)

  const load = useCallback(async () => {
    if (!client) {
      return
    }
    const seq = (readSeqRef.current += 1)
    setState({ status: 'loading' })
    try {
      const response = await projectConfigFileRead.request(client, {
        worktree: `id:${worktreeId}`,
        relativePath
      })
      const result = projectConfigFileRead.interpret(response) as {
        content: string
        truncated: boolean
        byteLength: number
      }
      if (readSeqRef.current !== seq) {
        return
      }
      if (result.truncated) {
        setState({ status: 'too-large', byteLength: result.byteLength })
        return
      }
      setState({
        status: 'ready',
        content: result.content,
        savedContent: result.content,
        isDirty: false,
        saving: false,
        saveError: null,
        creating: false,
        createError: null
      })
    } catch (error) {
      if (readSeqRef.current !== seq) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      if (classifyProjectConfigFileError(message) === 'missing') {
        setState({ status: 'missing' })
        return
      }
      setState({ status: 'error', message: describeProjectConfigFileError(message, 'read') })
    }
  }, [client, worktreeId, relativePath])

  useEffect(() => {
    void load()
  }, [load])

  // A screen opened before the relay was up fails its read ('Not connected') and the client object
  // is the same across reconnects, so `load` never changes: read again once per NEW connection
  // (stale-after-reconnect.ts). Only a failed read: a ready draft, dirty or not, is never
  // replaced, and a file the host said is missing was a good read.
  const lastConnectedAt = useLastConnectedAt(hostId)
  const staleLedgerRef = useRef(createStaleAfterReconnectLedger())
  useEffect(() => {
    const status =
      state.status === 'error' ? 'error' : state.status === 'loading' ? 'loading' : 'ready'
    if (
      shouldRefetchAfterReconnect(staleLedgerRef.current, relativePath, status, lastConnectedAt) &&
      status === 'error'
    ) {
      void load()
    }
  }, [lastConnectedAt, load, relativePath, state.status])

  const setContent = useCallback((content: string) => {
    setState((prev) => {
      if (prev.status !== 'ready') {
        return prev
      }
      return { ...prev, content, isDirty: content !== prev.savedContent, saveError: null }
    })
  }, [])

  const save = useCallback(async () => {
    if (!client || state.status !== 'ready' || state.saving) {
      return
    }
    // What the write carries is the draft at tap time. An edit made while it is on the wire never
    // reached the host, so the answer marks `contentToSave` saved, not whatever the draft is now.
    const contentToSave = state.content
    setState((prev) => (prev.status === 'ready' ? { ...prev, saving: true, saveError: null } : prev))
    const seq = (saveSeqRef.current += 1)
    // A read since the tap (another file on a screen that switches, or a refresh) replaced the
    // state this write answers for; its answer must not land on that one.
    const readSeq = readSeqRef.current
    const superseded = () => saveSeqRef.current !== seq || readSeqRef.current !== readSeq
    try {
      const response = await projectConfigFileWrite.request(client, {
        worktree: `id:${worktreeId}`,
        relativePath,
        content: contentToSave
      })
      projectConfigFileWrite.interpret(response)
      if (superseded()) {
        return
      }
      setState((prev) =>
        prev.status === 'ready'
          ? {
              ...prev,
              savedContent: contentToSave,
              isDirty: prev.content !== contentToSave,
              saving: false,
              saveError: null
            }
          : prev
      )
    } catch (error) {
      if (superseded()) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      setState((prev) =>
        prev.status === 'ready'
          ? { ...prev, saving: false, saveError: describeProjectConfigFileError(message, 'write') }
          : prev
      )
    }
  }, [client, worktreeId, relativePath, state])

  const create = useCallback(async () => {
    if (!client) {
      return
    }
    try {
      const response = await projectConfigFileCreate.request(client, {
        worktree: `id:${worktreeId}`,
        relativePath
      })
      projectConfigFileCreate.interpret(response)
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setState({ status: 'error', message: describeProjectConfigFileError(message, 'create') })
    }
  }, [client, worktreeId, relativePath, load])

  return { state, setContent, refresh: load, save, create }
}
