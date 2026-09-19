// Orca #21087: the approval card draws the harness's own presentation — why
// the request was raised, not only what it was. The journal item carries the
// SDK's title, displayName, description, decisionReason, blockedPath and
// matchedAskRule; the projection has to hand every one of them to the card.

import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import { projectStructuredPermission } from './mobile-structured-agent-prompts'

function approval(body: Record<string, unknown>) {
  return {
    itemId: 'approval-1',
    revision: 3,
    sequence: 1,
    observedAt: 1,
    body: {
      kind: 'approval',
      title: 'Claude wants to read secrets.txt',
      detail: null,
      options: [{ id: 'allow', label: 'Allow' }],
      resolution: { state: 'pending' },
      ...body
    }
  } as unknown as AgentJournalRenderItem
}

describe('the approval card reads the harness presentation off the journal', () => {
  it('carries every presentation field the host recorded, and the prompt identity', () => {
    const projected = projectStructuredPermission(
      approval({
        displayName: 'Read',
        description: 'Workspace access outside the allowed root',
        decisionReason: 'Outside the allowed root',
        blockedPath: '/repo/secrets.txt',
        matchedAskRule: { source: 'project', toolName: 'Read', ruleContent: '/repo/**' }
      })
    )
    expect(projected).toMatchObject({
      title: 'Claude wants to read secrets.txt',
      prompt: { itemId: 'approval-1', expectedRevision: 3 },
      displayName: 'Read',
      description: 'Workspace access outside the allowed root',
      decisionReason: 'Outside the allowed root',
      blockedPath: '/repo/secrets.txt',
      matchedAskRule: { source: 'project', toolName: 'Read', ruleContent: '/repo/**' }
    })
  })

  it('carries a plan subject (Orca #21090) so the card can draw it as a plan', () => {
    const projected = projectStructuredPermission(
      approval({ subject: { kind: 'plan', text: '# Plan\n\n- step', filePath: '/repo/PLAN.md' } })
    )
    expect(projected?.subject).toEqual({
      kind: 'plan',
      text: '# Plan\n\n- step',
      filePath: '/repo/PLAN.md'
    })
  })

  it('carries nothing extra for an older host that records only the title', () => {
    const projected = projectStructuredPermission(approval({}))
    expect(projected).not.toBeNull()
    for (const key of [
      'displayName',
      'description',
      'decisionReason',
      'blockedPath',
      'matchedAskRule',
      'subject'
    ]) {
      expect(projected).not.toHaveProperty(key)
    }
  })
})
