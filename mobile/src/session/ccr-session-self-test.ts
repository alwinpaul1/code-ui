import {
  ccrSelfTestContext,
  forgetCcrMapping,
  maskId,
  refreshCcrModel,
  runCcrImagePipeline,
  type CcrPipelineDeps,
  type CcrStage,
  type CcrStageReport
} from './ccr-session-pipeline'

/**
 * The one-tap check ("Check session images", the session's … menu): runs the
 * whole path against the chat on screen, matching it afresh, and says what
 * each stage found, so what only a live call can show (the token accepted,
 * the tab's ids in the session's events, pictures in them, the model the
 * session reports) is read off the device rather than guessed.
 */

const LABELS: Record<CcrStage, string> = {
  'sign-in': 'Anthropic sign-in',
  org: 'Organization',
  sessions: 'Remote Control sessions',
  match: 'This tab’s session',
  model: 'Model and effort',
  images: 'Pictures'
}

export type CcrSelfTestLine = { ok: boolean; label: string; detail: string }

export function ccrSelfTestLines(stages: readonly CcrStageReport[]): CcrSelfTestLine[] {
  return stages.map((stage) => ({ ok: stage.ok, label: LABELS[stage.stage], detail: stage.detail }))
}

/** The report as text: one line per stage, ✓ or ✗, then what it found. */
export function formatCcrSelfTest(lines: readonly CcrSelfTestLine[]): string {
  return lines.map((line) => `${line.ok ? '✓' : '✗'} ${line.label}: ${line.detail}`).join('\n')
}

export async function runCcrSelfTest(deps: CcrPipelineDeps): Promise<CcrSelfTestLine[]> {
  const context = ccrSelfTestContext()
  if (!context) {
    return [{ ok: false, label: 'Chat', detail: 'open a Claude chat first; the check runs against the chat on screen' }]
  }
  const agentSessionId = context.agentSessionId ?? null
  forgetCcrMapping(context.tabId, agentSessionId)
  const result = await runCcrImagePipeline(
    { tabId: context.tabId, epoch: context.epoch, agentSessionId, configDir: context.configDir ?? null, messageIds: context.messageIds, wanted: context.wanted },
    deps
  )
  const stages = [...result.stages]
  if (result.sessionId && !stages.some((stage) => stage.stage === 'model')) {
    const model = await refreshCcrModel(context.tabId, context.epoch, deps, agentSessionId)
    if (model) {
      stages.push(model)
    }
  }
  return [
    { ok: true, label: 'Chat', detail: `tab ${maskId(context.tabId)}, ${context.messageIds.length} messages, ${context.wanted.toolUseIds.length} Read pictures and ${context.wanted.userMessageIds.length} pasted messages to look for` },
    ...ccrSelfTestLines(stages)
  ]
}
