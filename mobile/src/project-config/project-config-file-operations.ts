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
 * other operation, but Orca 1.4.205's mobile-scope RPC allowlist does not
 * include `files.write` (confirmed against the bundle — see
 * project-config-file-error.ts), so the three screens ask the host first
 * (`useHostMobileCapability(hostId, 'files.write')`, transport/
 * host-mobile-capabilities.ts) and show no Save until it says the call gets
 * through. The operation stays real and typed for the host that allows it;
 * the probe is what makes the button appear there.
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

/** Creates an empty file at a relative path. Mobile-scope-allowed — this one
 *  the 1.4.205 host does accept — so the create flow stays even where the
 *  screen is read-only; on such a host nothing can add content to the file
 *  afterward from the phone, and the screen says so. */
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
