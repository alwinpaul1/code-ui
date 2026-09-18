import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcUncheckedPayloadReader } from '../transport/rpc-reader-payload'
import { fileTabTextRead } from '../files/mobile-file-tab-doc-operations'

/**
 * Read, write and create for the three project-scope config screens (MCP
 * servers, permission rules, project memory). All three files are small,
 * text, and worktree-relative, so all three screens share one read op, one
 * write op and one create op instead of each rolling its own.
 *
 * Reading reuses `fileTabTextRead` from mobile-file-tab-doc-operations.ts
 * (`files.read`, throws the host's message on refusal) rather than defining
 * a second operation against the same method — a session file tab already
 * exercises that exact call shape.
 *
 * `projectConfigFileWrite` (`files.write`) is defined and typed like any
 * other operation, but the host will refuse every call it ever makes: the
 * mobile-scope RPC allowlist in Orca's runtime does not include `files.write`
 * (confirmed against the 1.4.205 bundle — see project-config-file-error.ts).
 * It stays a real, typed operation rather than being left out, because the
 * refusal itself is the tested behaviour: a screen's Save button must call
 * the real method and show the real, always-identical rejection, not a
 * client-side stub pretending to try.
 */
export const projectConfigFileWrite = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'project-config.write-file',
    method: 'files.write',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('project-config-file-write')
  })
)

/** Creates an empty file at a relative path. Also mobile-scope-allowed — this
 *  one the host does accept — but see project-config-file-error.ts: nothing
 *  can add content to it afterward, since `files.write` is blocked. */
export const projectConfigFileCreate = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'project-config.create-file',
    method: 'files.createFile',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('project-config-file-create')
  })
)

export { fileTabTextRead as projectConfigFileRead }
