import { z } from 'zod'

// The two session-search reads the history screen makes. Checked against Orca origin/main
// (2026-09-25): src/main/runtime/rpc/methods/ai-vault.ts (`aiVault.searchSessions`,
// `aiVault.searchStatus`), and the shapes in src/shared/ai-vault-search-contract.ts. The phone is a
// paired client, so both answer through the relay redaction in ai-vault-search-transport.ts: a hit's
// source is `{ presence }` only (no file path, no resume command) and every degraded root's reason
// is the fixed "Source root could not be verified.".
//
// Each reader checks what the panel reads and nothing else, and keeps the members that grow with
// every Orca release open. The vendored contract in src/shared is older than origin/main (no
// `messagesIndexed`, no `scope-unknown`), which is exactly why these are not its schemas: a newer
// host's reply must still read.

const count = z.number().int().nonnegative()

/**
 * One search hit.
 *
 * `agent` is an open string rather than the AI_VAULT_AGENTS enum: that vocabulary grows with every
 * agent CLI Orca learns to scan, and the enum would refuse a newer host's whole page over one row.
 * `presence` stays open for the same reason; only `'present'` is ever resumable, so an unknown value
 * reads as "not resumable", which is the safe side. `branch` is optional here although the host
 * always sends it, because nothing on the phone reads it.
 */
export const agentSessionSearchHitSchema = z.looseObject({
  agent: z.string().min(1),
  sessionId: z.string(),
  title: z.string(),
  cwd: z.string().nullable(),
  branch: z.string().nullable().optional(),
  updatedAt: z.string().nullable(),
  messageCount: count,
  score: z.number(),
  source: z.looseObject({ presence: z.string() }),
  evidence: z
    .looseObject({
      snippet: z.string(),
      role: z.string(),
      timestamp: z.string().nullable()
    })
    .nullable()
})

export type AgentSessionSearchHit = z.output<typeof agentSessionSearchHitSchema>

const resultsSchema = z.looseObject({
  kind: z.literal('results'),
  hits: z.array(agentSessionSearchHitSchema),
  page: z.looseObject({ cursor: z.string().nullable(), hasMore: z.boolean() }),
  generation: count,
  truncated: z.looseObject({
    candidates: z.boolean(),
    snippets: count,
    query: z.boolean(),
    freshness: z.boolean()
  })
})

/**
 * The search reply: a page of hits, or one of the three reasons there is no page.
 *
 * `unavailable.reason` is an open string. origin/main already has four (`disabled`, `not-ready`,
 * `no-service`, `scope-unknown`) where the vendored contract has three, so the next one is a
 * matter of time; the panel names an unknown reason rather than refusing the reply.
 */
export const agentSessionSearchResponseSchema = z.discriminatedUnion('kind', [
  resultsSchema,
  z.looseObject({ kind: z.literal('stale-cursor'), generation: count }),
  z.looseObject({ kind: z.literal('malformed-cursor') }),
  z.looseObject({ kind: z.literal('unavailable'), reason: z.string() })
])

export type AgentSessionSearchResponse = z.output<typeof agentSessionSearchResponseSchema>

/**
 * The index's own account of itself: on or off, what it is doing, and how far it has got.
 *
 * `phase` is open (the panel treats a phase it does not know as settled, so it never polls forever
 * on one). `messagesIndexed` is optional because a host older than it answers without it, and the
 * progress line then reads in sessions only.
 */
export const agentSessionSearchStatusSchema = z.looseObject({
  enabled: z.boolean(),
  phase: z.string(),
  filesIndexed: count,
  filesDue: count,
  filesFailed: count,
  messagesIndexed: count.optional(),
  degradedRoots: z.array(z.looseObject({ reason: z.string() })),
  generation: count
})

export type AgentSessionSearchStatus = z.output<typeof agentSessionSearchStatusSchema>
