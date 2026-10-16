/**
 * The Claude app's session bar outputs control (com.anthropic.claude 1.261013.20).
 *
 * The bar (`u8z.e`, u8z.java:643-690) draws ONE control for a session's outputs, last after Diff,
 * Local changes and Create PR. Its kind is `os30.q` (os30.java:687-711): count which of pull
 * requests (> 0), artifacts (> 0) and a plan are present; two or more is Mixed, else the one that
 * is. Mixed reads "%d output(s)" (`ccr_thread_header_outputs`) counting pull requests + artifacts
 * + 1 for a plan (`ns30.H`, ns30.java:637-660), and is described "Open outputs" when there is a
 * plan, else "Open pull requests and artifacts" (`ns30.G`, ns30.java:610-631: the field the
 * description switches on is `hasPlan`, per `c6z.toString`).
 *
 * Nothing for a session with none of them: the app builds no control (ds8.java:267-268).
 */
export type SessionOutputsInput = {
  pullRequests: number
  artifacts: number
  plan: boolean
}

export type SessionOutputsControl =
  | { kind: 'pull-requests' }
  | { kind: 'artifacts' }
  | { kind: 'plan' }
  | { kind: 'mixed'; count: number; label: string; accessibilityLabel: string }

export function sessionOutputsLabel(count: number): string {
  return count === 1 ? '1 output' : `${count} outputs`
}

export function sessionOutputsControl(input: SessionOutputsInput): SessionOutputsControl | null {
  const present = [input.plan, input.pullRequests > 0, input.artifacts > 0].filter(Boolean).length
  if (present > 1) {
    const count = input.pullRequests + input.artifacts + (input.plan ? 1 : 0)
    return {
      kind: 'mixed',
      count,
      label: sessionOutputsLabel(count),
      accessibilityLabel: input.plan ? 'Open outputs' : 'Open pull requests and artifacts'
    }
  }
  if (input.pullRequests > 0) {
    return { kind: 'pull-requests' }
  }
  if (input.artifacts > 0) {
    return { kind: 'artifacts' }
  }
  return input.plan ? { kind: 'plan' } : null
}
