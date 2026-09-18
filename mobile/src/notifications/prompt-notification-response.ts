import type { RpcClient } from '../transport/rpc-client'
import type { PendingPrompt } from './permission-lookup'
import {
  answerPermissionFromNotification,
  type PromptAnswerOutcome
} from './permission-notification-response'
import {
  answerQuestionFromNotification,
  type QuestionAnswerSend
} from './question-notification-response'

function readIds(data: unknown): { hostId?: string; worktreeId?: string } {
  if (data == null || typeof data !== 'object') {
    return {}
  }
  const box = Object(data)
  const hostId: unknown = Reflect.get(box, 'hostId')
  const worktreeId: unknown = Reflect.get(box, 'worktreeId')
  return {
    ...(typeof hostId === 'string' ? { hostId } : {}),
    ...(typeof worktreeId === 'string' ? { worktreeId } : {})
  }
}

/**
 * Answer a tap on either kind of prompt banner.
 *
 * The banner's data says which it is: a permission carries `sends`, a question
 * carries `picks`. Each path keeps its own re-check; this only decides which
 * one the tap belongs to and leaves a line behind when nothing was written,
 * because this runs from the shade with no screen up and a tap that did
 * nothing is otherwise indistinguishable from a slow one.
 *
 * 'open-app' is the Answer button on a question the shade cannot hold: the
 * caller turns it into navigation to the session, exactly as a body tap.
 */
export async function answerPromptFromNotification(args: {
  actionIdentifier: string
  data: unknown
  resolveClient: (hostId: string) => RpcClient | null
  lookup: (client: RpcClient, worktreeId: string) => Promise<PendingPrompt | null>
  sendPermission: (input: { client: RpcClient; terminal: string; text: string }) => Promise<boolean>
  sendQuestion: (input: QuestionAnswerSend) => Promise<boolean>
}): Promise<PromptAnswerOutcome> {
  const { actionIdentifier, data, resolveClient, lookup } = args
  let outcome: PromptAnswerOutcome = await answerPermissionFromNotification({
    actionIdentifier,
    data,
    resolveClient,
    lookup,
    send: args.sendPermission
  })
  if (outcome === 'not-an-answer') {
    outcome = await answerQuestionFromNotification({
      actionIdentifier,
      data,
      resolveClient,
      lookup,
      send: args.sendQuestion
    })
  }
  switch (outcome) {
    case 'sent':
    case 'open-app':
    case 'not-an-answer':
      break
    case 'unroutable':
    case 'offline':
    case 'stale':
    case 'failed':
      console.log('[prompt-notification] tap answered nothing', {
        outcome,
        actionIdentifier,
        ...readIds(data)
      })
      break
    default: {
      const exhaustive: never = outcome
      return exhaustive
    }
  }
  return outcome
}
