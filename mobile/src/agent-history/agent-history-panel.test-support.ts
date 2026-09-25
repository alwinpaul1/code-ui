import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import type { AiVaultSession } from '../../../src/shared/ai-vault-types'
import { createFakeRpcClient } from '../mobile-web-shell/bridge-host-test-fakes'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'

/**
 * Test doubles for the agent-history panel's suites: a host that answers every request through one
 * responder, and the records it answers with.
 *
 * The responder sees the method and params the panel actually sent, so a suite asserts on the wire
 * and answers on it in one place. Returning a promise holds the reply until the suite settles it,
 * which is how a suite parks a search mid-flight.
 */

export type SentRequest = { method: string; params: unknown }

export type HostReply = RpcResponse | Promise<RpcResponse>

export type Responder = (method: string, params: unknown) => HostReply

export type AnsweringClient = {
  client: RpcClient
  requests: SentRequest[]
  sent: (method: string) => SentRequest[]
}

export function ok(result: unknown): RpcResponse {
  return { id: 'reply', ok: true, result }
}

export function refused(code: string, message: string): RpcResponse {
  return { id: 'reply', ok: false, error: { code, message } }
}

/** What the history screen needs before it draws a list: the capability, a worktree and rows. */
export function historyReplies(
  sessions: readonly AiVaultSession[],
  next: Responder = () => refused('method_not_found', 'not answered by this suite')
): Responder {
  return (method, params) => {
    switch (method) {
      case 'status.get':
        return ok({ capabilities: ['aiVault.v1'] })
      case 'worktree.ps':
        return ok({ worktrees: [{ worktreeId: 'wt-1', path: '/Users/ada/repo/app', repo: 'app' }] })
      case 'aiVault.listSessions':
        return ok({ sessions, issues: [] })
      default:
        return next(method, params)
    }
  }
}

/**
 * The bridge suites' fake client, answering through `responder`. Built on that fake rather than a
 * client of its own, because an object that satisfies `RpcClient` declares the raw request port,
 * and the port's inventory only shrinks (unvalidated-rpc-request-port-boundary.test.ts).
 */
export function createAnsweringClient(responder: Responder): AnsweringClient {
  const client = createFakeRpcClient({}, responder)
  const sentSoFar = (): SentRequest[] =>
    client.requests.map((request) => ({ method: request.method, params: request.args[1] }))
  return {
    client,
    get requests() {
      return sentSoFar()
    },
    sent: (method) => sentSoFar().filter((request) => request.method === method)
  }
}

export function historySession(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'claude:1',
    executionHostId: 'local',
    agent: 'claude',
    sessionId: 'session-1',
    title: 'Implement vault filters',
    cwd: '/Users/ada/repo/app',
    branch: 'feature/vault',
    model: 'claude-sonnet-4-5',
    filePath: '/Users/ada/.claude/projects/session-1.jsonl',
    codexHome: null,
    createdAt: '2026-06-28T23:00:00.000Z',
    updatedAt: '2026-06-28T23:55:00.000Z',
    modifiedAt: '2026-06-28T23:55:00.000Z',
    messageCount: 4,
    totalTokens: 1200,
    previewMessages: [
      { role: 'user', text: 'add the scope tabs', timestamp: null },
      { role: 'assistant', text: 'done, tabs added', timestamp: null }
    ],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: '',
    subagent: null,
    ...overrides
  }
}

/** Every style object on a node, flattened the way React Native flattens an array style. */
export function flatStyle(style: unknown): Record<string, unknown> {
  const entries = (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...entries)
}

type ListSlot = ReactElement | (() => ReactElement | null) | null | undefined

function slot(value: ListSlot): ReactNode {
  if (typeof value === 'function') {
    return value()
  }
  return isValidElement(value) ? value : null
}

/**
 * A SectionList that draws every row, for a suite mocking `react-native` with string host types.
 * The bare string `'SectionList'` never calls `renderItem`, so a suite asserting on a row would find
 * nothing.
 */
export function SectionListDouble(props: {
  sections: readonly { key: string; data: readonly { id: string }[] }[]
  renderSectionHeader?: (info: { section: never }) => ReactElement | null
  renderItem: (info: { item: never }) => ReactElement | null
  refreshControl?: ReactElement
}): ReactElement {
  return createElement(
    'SectionList',
    { refreshControl: props.refreshControl },
    props.refreshControl,
    props.sections.map((section) =>
      createElement(
        'Section',
        { key: section.key },
        props.renderSectionHeader?.({ section: section as never }),
        section.data.map((item) =>
          createElement('Row', { key: item.id }, props.renderItem({ item: item as never }))
        )
      )
    )
  )
}

/** The FlatList counterpart, with the header and footer slots the search results use. */
export function FlatListDouble(props: {
  data: readonly unknown[]
  keyExtractor: (item: never, index: number) => string
  renderItem: (info: { item: never; index: number }) => ReactElement | null
  ListHeaderComponent?: ListSlot
  ListFooterComponent?: ListSlot
  ListEmptyComponent?: ListSlot
  refreshControl?: ReactElement
}): ReactElement {
  return createElement(
    'FlatList',
    { refreshControl: props.refreshControl },
    props.refreshControl,
    slot(props.ListHeaderComponent),
    props.data.length === 0 ? slot(props.ListEmptyComponent) : null,
    props.data.map((item, index) =>
      createElement(
        'Row',
        { key: props.keyExtractor(item as never, index) },
        props.renderItem({ item: item as never, index })
      )
    ),
    slot(props.ListFooterComponent)
  )
}

/** A ScrollView that keeps its refresh control reachable, like the lists above. */
export function ScrollViewDouble(props: {
  children?: ReactNode
  refreshControl?: ReactElement
}): ReactElement {
  return createElement(
    'ScrollView',
    { refreshControl: props.refreshControl },
    props.refreshControl,
    props.children
  )
}
