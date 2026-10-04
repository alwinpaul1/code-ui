import {
  AGENT_SESSION_PENDING_SEND_RESULT_RUNTIME_CAPABILITY,
  BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
  BROWSER_CLIENT_PAGE_METADATA_RUNTIME_CAPABILITY,
  NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES,
  WORKTREE_BACKGROUND_REMOVAL_RUNTIME_CAPABILITY
} from './protocol-version'

// CODE UI LOCAL HUNK: v1.4.220's list also advertises AGENT_SESSION_ACCEPTED_SEND and
// SESSION_TABS_RETIREMENT_PROOF_DELTA, which protocol-version.ts here does not define (this fork
// does not take them). The list is not read by anything on the phone. See src/shared/LOCAL-FILES.md.

// Electron clients can decode client-hosted page placement; becoming a page
// host still requires the separate authenticated browser-client lease.
export const ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES = [
  ...NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES,
  AGENT_SESSION_PENDING_SEND_RESULT_RUNTIME_CAPABILITY,
  BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
  BROWSER_CLIENT_PAGE_METADATA_RUNTIME_CAPABILITY,
  // Only the renderer shows Deleting for a `removing` row; CLI and mobile get those rows omitted.
  WORKTREE_BACKGROUND_REMOVAL_RUNTIME_CAPABILITY
] as const
