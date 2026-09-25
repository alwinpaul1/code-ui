import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'
import {
  agentSessionSearchResponseSchema,
  agentSessionSearchStatusSchema
} from './agent-history-search-reply-schema'

// The history screen's session search: the query itself and the index status the panel reads to
// say whether search is off, still building, or ready. Both raise the host's message on a refusal,
// and the callers look at the raw reply first for the two refusals that mean "this host has no
// such method" (method_not_found from an Orca older than search, the mobile-scope gate from one
// whose allowlist predates it), which read as unsupported rather than as an error.
//
// Neither sends `aiVault.setSearchEnabled` and nothing here writes a setting: turning indexing on
// is the desktop owner's choice, and stock Orca keeps it off the mobile allowlist
// (runtime-rpc-mobile-method-allowlist.ts) and out of the client-writable settings
// (runtime-client-settings.ts) on purpose.

export const agentSessionSearch = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'aiVault.session-search',
    method: 'aiVault.searchSessions',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('session-search', agentSessionSearchResponseSchema)
  })
)

export const agentSessionSearchStatusRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'aiVault.search-status',
    method: 'aiVault.searchStatus',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('session-search-status', agentSessionSearchStatusSchema)
  })
)
