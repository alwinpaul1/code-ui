import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'

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
const screenLinesReader: RpcCompatibleReader<unknown, 'screen-lines', string[]> = (raw) => {
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
