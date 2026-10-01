import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'
import { screenLinesReader } from './mobile-terminal-ask-about-screen-operations'

/** What the send's looks at the desktop input need from a screen read: the
 *  rendered rows and the text Orca took out of the composer row and published
 *  beside them (claude-composer-screen.ts says when each carries the input). */
export type MobileNativeChatScreen = { lines: string[]; draft: string }

const screenWithDraftReader: RpcCompatibleReader<
  unknown,
  'screen-with-draft',
  MobileNativeChatScreen
> = (raw) => {
  const base = screenLinesReader(raw)
  if (!base.compatible) {
    return base
  }
  const box = raw == null ? {} : Object(raw)
  const terminal: unknown = Reflect.get(box, 'terminal')
  const draft: unknown =
    terminal != null && typeof terminal === 'object'
      ? Reflect.get(Object(terminal), 'draft')
      : undefined
  return {
    compatible: true,
    variant: 'screen-with-draft',
    value: { lines: base.value, draft: typeof draft === 'string' ? draft : '' },
    salvage: base.salvage
  }
}

/** `terminal.read` in screen mode, with the draft. A separate operation from the
 *  lines-only read (mobile-terminal-ask-about-screen-operations.ts) rather than a
 *  widened one: that read's callers must not start seeing a field they ignore. */
export const terminalScreenWithDraftRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.read-screen-with-draft',
    method: 'terminal.read',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: screenWithDraftReader
  })
)

/** How long one look waits. A slower one is no look at all. */
export const MOBILE_NATIVE_CHAT_SCREEN_READ_MS = 2_000

/**
 * One look at the tab's screen, or null when there is none to be had: the RPC
 * failed or timed out, the host answered with the stream rather than the
 * screen (an older Orca), or the reply is not a screen. Never throws; a caller
 * decides what a missing look means for the write it is guarding.
 */
export async function readMobileNativeChatScreen(args: {
  client: Parameters<typeof terminalScreenWithDraftRead.request>[0]
  terminal: string
  /** The action's own budget; the look never outlasts it. */
  deadline?: number
}): Promise<MobileNativeChatScreen | null> {
  const remaining = (args.deadline ?? Infinity) - Date.now()
  if (remaining < 1) {
    return null
  }
  try {
    return terminalScreenWithDraftRead.interpret(
      await terminalScreenWithDraftRead.request(
        args.client,
        { terminal: args.terminal, screen: true },
        {
          timeoutMs: Math.max(1, Math.min(MOBILE_NATIVE_CHAT_SCREEN_READ_MS, remaining)),
          budgetSpansConnect: true
        }
      )
    )
  } catch {
    return null
  }
}
