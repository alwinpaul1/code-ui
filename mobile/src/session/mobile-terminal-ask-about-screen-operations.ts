import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'
import type { RpcResponse } from '../transport/types'

/**
 * Read `terminal.read`'s screen-mode reply down to the rendered lines — the
 * same shape use-mobile-terminal-hud-observation.ts's poll already reads
 * (`tail`, else `lines`), typed here instead of raw so "Ask about this
 * screen" doesn't grow that file's grandfathered reference count (it stays a
 * ceiling per unvalidated-rpc-request-port-inventory.ts).
 *
 * A `source` other than 'screen' is the stream fallback an older host sends
 * when it does not understand `screen: true` — old repaints, not the current
 * screen — so it is read as incompatible rather than trusted.
 */
export const screenLinesReader: RpcCompatibleReader<unknown, 'screen-lines', string[]> = (raw) => {
  const box = raw == null ? {} : Object(raw)
  const terminal: unknown = Reflect.get(box, 'terminal')
  const terminalBox = terminal != null && typeof terminal === 'object' ? Object(terminal) : {}
  const source: unknown = Reflect.get(terminalBox, 'source')
  if (source !== undefined && source !== 'screen') {
    return {
      compatible: false,
      issues: [{ path: 'terminal.source', message: `expected a screen read, got ${String(source)}` }]
    }
  }
  const tail: unknown = Reflect.get(terminalBox, 'tail')
  const lines: unknown = Array.isArray(tail) ? tail : Reflect.get(terminalBox, 'lines')
  if (!Array.isArray(lines) || !lines.every((line) => typeof line === 'string')) {
    return { compatible: false, issues: [{ path: 'terminal.lines', message: 'not a string array' }] }
  }
  return {
    compatible: true,
    variant: 'screen-lines',
    value: lines,
    salvage: { droppedPaths: [], droppedCount: 0 }
  }
}

/**
 * The terminal's current visible screen, as rendered lines — the accessor
 * the HUD and permission parsers already poll, reused for "Ask about this
 * screen" rather than adding a new RPC. Null on refusal or an
 * unrecognizable reply; the caller reads that as "nothing to append".
 */
export const terminalScreenLinesRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.read-screen-lines',
    method: 'terminal.read',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: screenLinesReader
  })
)

/**
 * Whether a `terminal.read` reply SAYS it is the screen: `source: 'screen'`,
 * spelled out. `screenLinesReader` also accepts a reply with no `source`, which
 * is what an older Orca sends: Orca 1.4.178-rc.2 has no `screen: true` handling
 * and answers with the stream's tail, and a tail of a Claude session holds old
 * repaints (a box that left the screen long ago), so it cannot show what is on
 * the terminal now. A write that must not go without proof (a send refused for a
 * missing input box) takes only a reply that names itself.
 */
export function replyIsScreen(response: RpcResponse): boolean {
  const result: unknown = response.ok ? response.result : undefined
  const terminal: unknown = result == null ? undefined : Reflect.get(Object(result), 'terminal')
  return (
    terminal != null &&
    typeof terminal === 'object' &&
    Reflect.get(Object(terminal), 'source') === 'screen'
  )
}
