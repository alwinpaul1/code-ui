// CODE UI HAND-KEPT (Orca #26579, bb44f74d00): the boundary type and its guard only.
// Upstream's `activeProviderContext` reads `providerContextBoundary` on the session record, a
// host-only field this fork's `agent-session-record.ts` does not carry, so it is left out.
// See src/shared/LOCAL-FILES.md.

export type AgentSessionProviderContextBoundary = {
  operationId: string
  afterFence: number
  clearedAt: number
}

export function isAgentSessionProviderContextBoundary(
  value: unknown
): value is AgentSessionProviderContextBoundary {
  return (
    typeof value === 'object' &&
    value !== null &&
    'operationId' in value &&
    typeof value.operationId === 'string' &&
    value.operationId.length > 0 &&
    value.operationId.length <= 512 &&
    'afterFence' in value &&
    typeof value.afterFence === 'number' &&
    Number.isSafeInteger(value.afterFence) &&
    value.afterFence >= 0 &&
    'clearedAt' in value &&
    typeof value.clearedAt === 'number' &&
    Number.isSafeInteger(value.clearedAt) &&
    value.clearedAt >= 0
  )
}
