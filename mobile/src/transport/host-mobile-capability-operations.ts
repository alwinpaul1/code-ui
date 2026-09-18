import { structuredAgentSessionPayloadFingerprint } from '../../../src/shared/structured-agent-session-mutation'
import { bindDeferredRpcOperation, defineRpcOperation } from './rpc-operation'
import { rpcUncheckedPayloadReader } from './rpc-reader-payload'
import type { RpcSendParams } from './rpc-params-contract'

/**
 * The two probes behind host-mobile-capabilities.ts: one call per gated
 * method, each with parameters the host must refuse without doing anything,
 * so that the ONLY thing the reply can tell us is whether the mobile-scope
 * dispatch gate let the call through.
 *
 * Neither reply body is ever read. The whole answer is the refusal's code and
 * message (`isMobileScopeRefusal`), which the caller reads off the raw
 * envelope `request()` returns — an accepted reply and any other refusal both
 * mean "the gate passed".
 *
 * This module is pure (no React, no client context) so the allowlist ratchet
 * can import the key list without the React Native chain.
 */

/** The gated methods the phone sends, each behind one probe. Adding one here
 *  means adding its probe below, its branch in probeHostMobileCapabilities,
 *  and its exception in orca-mobile-rpc-allowlist.test.ts. */
export type HostMobileCapabilityKey = 'files.write' | 'agentSession.rewind'

export const HOST_MOBILE_CAPABILITY_KEYS: readonly HostMobileCapabilityKey[] = [
  'files.write',
  'agentSession.rewind'
]

/** `files.write` with a worktree that cannot exist AND a `..` path. Orca 1.4.205
 *  resolves the worktree first (`resolveRuntimeFileTarget`) and refuses
 *  `selector_not_found`; had one matched, the jail check `Kg()` refuses
 *  `invalid_relative_path` before any byte is written. Both are thrown
 *  `Error`s, so both arrive as `{ code: 'runtime_error', message }`. */
export const filesWriteGateProbe = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.mobile-gate-probe',
    method: 'files.write',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('files-write-probe-reply')
  })
)

/** `agentSession.rewind` for a session id that is valid in shape (so the params
 *  parse cannot be what refuses it) and cannot exist. The host's `VN` admission
 *  sees no journal for it and answers, inside an accepted envelope,
 *  `{ ok: false, refusal: { code: 'agent_session_ownership_unknown', message:
 *  'This host holds no attached session by that id.' } }` — before the durable
 *  operation ledger is touched, so nothing is recorded. The one thing the
 *  handler does first is `ensureStructuredAgentSessionHost()`, the same
 *  idempotent prelude every `agentSession.*` call the phone already makes runs. */
export const agentSessionRewindGateProbe = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'agentSession.mobile-gate-probe',
    method: 'agentSession.rewind',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('agent-session-rewind-probe-reply')
  })
)

/** A worktree id no host allocates: Orca worktree ids are random hex. */
const PROBE_WORKTREE_SELECTOR = 'id:code-ui-mobile-gate-probe'

/** Matches upstream's `SESSION_ID_PATTERN` (`^[A-Za-z0-9_-]{8,128}$`) so the
 *  request reaches the handler, and names itself so a host log line reads. */
const PROBE_SESSION_ID = 'code-ui-mobile-gate-probe'
const PROBE_ITEM_ID = 'code-ui-mobile-gate-probe-item'
const PROBE_EPOCH = 'code-ui-mobile-gate-probe-epoch'

export const FILES_WRITE_GATE_PROBE_PARAMS: RpcSendParams<'files.write'> = {
  worktree: PROBE_WORKTREE_SELECTOR,
  relativePath: '../code-ui-mobile-gate-probe',
  content: ''
}

/** The fingerprint is the real one for these fields, the way the real rewind
 *  computes it: a made-up digest would fail the envelope check (`CN`) if the
 *  host ever reached it, which would still be a refusal, but a lying one. */
export const AGENT_SESSION_REWIND_GATE_PROBE_PARAMS: RpcSendParams<'agentSession.rewind'> = {
  envelope: {
    sessionId: PROBE_SESSION_ID,
    clientOperationId: 'code-ui-mobile-gate-probe-op',
    expectedRuntimeFence: null,
    payloadFingerprint: structuredAgentSessionPayloadFingerprint({
      method: 'agentSession.rewind',
      sessionId: PROBE_SESSION_ID,
      fields: { itemId: PROBE_ITEM_ID, expectedEpoch: PROBE_EPOCH }
    })
  },
  itemId: PROBE_ITEM_ID,
  expectedEpoch: PROBE_EPOCH
}

/** What a probe sends with, named from an operation so no module names the raw port. */
export type HostMobileCapabilityProbeSender = Parameters<typeof filesWriteGateProbe.request>[0]
