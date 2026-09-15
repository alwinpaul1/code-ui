import { describe, expect, it } from 'vitest'
import { reportedModelPair } from './mobile-chat-reported-model'

// "The user can use Opus 4.8.5 or Sonnet or any model with any effort, so you
// should exactly show what model the user is using" (2026-09-15).
//
// The Claude catalog holds four generic entries — fable, opus, sonnet, haiku,
// labelled "Fable"/"Opus"/"Sonnet"/"Haiku" — with no versions in it. The beacon
// states the agent's OWN name for what is running ("name=Opus%204.8.5"), and
// that name was thrown away: only the coarse family id survived the hold, so
// the pill could never say anything but "Opus".
//
// The label now travels with the id, so a caller can state what is running
// instead of the family it collapses to.
describe('the name the pill can state', () => {
  it('carries the agent’s own name beside the family id', () => {
    const pair = reportedModelPair({ model: 'opus', label: 'Opus 4.8.5', effort: 'xhigh' })
    expect(pair).toMatchObject({ model: 'opus', label: 'Opus 4.8.5', effort: 'xhigh', source: 'live' })
  })

  it('reports no name when the agent stated none', () => {
    const pair = reportedModelPair({ model: 'opus', label: null, effort: 'high' })
    expect(pair.label).toBe(null)
    expect(pair.model).toBe('opus')
  })

  it('still reports nothing at all before the agent speaks', () => {
    expect(reportedModelPair({ model: null, label: null, effort: null })).toMatchObject({
      model: null,
      label: null,
      effort: null,
      source: 'launch'
    })
  })

  it('never carries a name with no model behind it', () => {
    // A label alone is not a statement about this session's model.
    const pair = reportedModelPair({ model: null, label: 'Sonnet 4.5', effort: null })
    expect(pair.model).toBe(null)
    expect(pair.label).toBe(null)
  })
})
