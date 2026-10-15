import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  WORKING_MARK,
  WORKING_MARK_CLIPS,
  WORKING_MARK_GROW,
  easeInOut,
  loopExitAfter,
  retargetWorkingMark,
  workingMarkFadeIn,
  workingMarkFrameAt,
  workingMarkFrameColor,
  workingMarkKindForTool,
  workingMarkPosition,
  workingMarkShapes,
  workingMarkStillFrame,
  type WorkingMarkKind
} from './claude-working-mark'
import { WORKING_MARK_STRIPS } from './claude-working-mark-data'
import { workingMarkKindFromTranscript } from './claude-working-mark-kind'

/**
 * The dots beside the working footer, as the Claude app 1.261013.20 plays them (`zq20`, `tr20`,
 * `vq20`, `aa10` case 10; claude-working-mark.ts). The recording of 2026-10-15 showed dots in a
 * row ("• •", "• • •") where Code UI drew the old 16 dp asterisk sprite, which this build of the
 * app no longer ships.
 */

const F = WORKING_MARK.frameMs
const KINDS: WorkingMarkKind[] = ['think', 'generic', 'search', 'read', 'code', 'write', 'waitingForUser']

describe('the working mark frames, as the app ships them', () => {
  it('each kind\'s opening, loop and closing tile its strip exactly, as vq20 lays them out', () => {
    for (const kind of KINDS) {
      const { opening, loop, closing } = WORKING_MARK_CLIPS[kind]
      expect(opening.strip).toBe(loop.strip)
      expect(closing.strip).toBe(loop.strip)
      expect(opening.start).toBe(0)
      expect(loop.start).toBe(opening.length)
      expect(closing.start).toBe(loop.start + loop.length)
      expect(closing.start + closing.length).toBe(loop.strip.offsets.length - 1)
    }
    expect(WORKING_MARK_GROW.length).toBe(WORKING_MARK_STRIPS.grow.offsets.length - 1)
  })

  it('every strip holds six numbers per shape and only the three shape kinds the app draws', () => {
    for (const strip of Object.values(WORKING_MARK_STRIPS)) {
      expect(strip.shapes.length).toBe(strip.offsets.at(-1)! * 6)
      for (let i = 0; i < strip.shapes.length; i += 6) {
        expect([0, 1, 2]).toContain(strip.shapes[i])
      }
      if (strip.colors !== null) {
        expect(strip.colors.length).toBe(strip.offsets.length - 1)
      }
    }
  })

  it('decodes a frame into circles in thousandths of the 20 dp box', () => {
    // The search loop's first frame: five dots across the middle, the shape the recording shows.
    const shapes = workingMarkShapes({ strip: WORKING_MARK_STRIPS.search, index: 0 })
    expect(shapes).toEqual([{ kind: 'dot', cx: 498, cy: 501, r: 58 }])
    expect(WORKING_MARK.size).toBe(20)
  })

  it('carries the waiting mark\'s own colour and leaves the others to the footer\'s clay', () => {
    expect(workingMarkFrameColor({ strip: WORKING_MARK_STRIPS.think, index: 0 })).toBeNull()
    expect(workingMarkFrameColor({ strip: WORKING_MARK_STRIPS.waitingForUser, index: 61 })).toBe('#D97757')
  })
})

describe('the working mark player', () => {
  it('grows for 10 frames at 30 a second, then opens the kind and loops it for ever', () => {
    const { player } = retargetWorkingMark(null, 'think', 0)
    expect(workingMarkPosition(player, 0)).toMatchObject({ stage: { type: 'grow' }, frame: 0 })
    expect(workingMarkPosition(player, 9 * F + 1)).toMatchObject({ stage: { type: 'grow' }, frame: 9 })
    expect(workingMarkPosition(player, 10 * F + 1)).toMatchObject({ stage: { type: 'opening', kind: 'think' }, frame: 0 })
    const loopStart = (10 + 16) * F
    expect(workingMarkPosition(player, loopStart + 1)).toMatchObject({ stage: { type: 'looping', kind: 'think', end: 'forever' }, frame: 0 })
    // 110 loop frames, then frame 0 again, for as long as the turn works.
    expect(workingMarkPosition(player, loopStart + 110 * F + 1)).toMatchObject({ frame: 0 })
    expect(workingMarkPosition(player, loopStart + 1000 * 110 * F + 5 * F + 1)).toMatchObject({ frame: 5 })
  })

  it('a new kind plays the running loop on to its next exit, closes it, then opens the new one', () => {
    const { player } = retargetWorkingMark(null, 'think', 0)
    const loopStart = (10 + 16) * F
    const now = loopStart + 30 * F + 1
    const turned = retargetWorkingMark(player, 'code', now)
    expect(turned.player.target).toBe('code')
    // Think's only exit is frame 54 (`ar20` {54}).
    expect(workingMarkPosition(turned.player, now)).toMatchObject({ stage: { type: 'looping', kind: 'think', end: 54 }, frame: 30 })
    expect(workingMarkPosition(turned.player, loopStart + 54 * F + 1)).toMatchObject({ stage: { type: 'closing', kind: 'think' }, frame: 0 })
    const codeOpens = loopStart + (54 + 15) * F + 1
    expect(workingMarkPosition(turned.player, codeOpens)).toMatchObject({ stage: { type: 'opening', kind: 'code' }, frame: 0 })
    expect(workingMarkPosition(turned.player, codeOpens + 16 * F)).toMatchObject({ stage: { type: 'looping', kind: 'code', end: 'forever' } })
  })

  it('a loop with no exit frames runs to its end before it closes', () => {
    expect(loopExitAfter(WORKING_MARK_CLIPS.generic.loop, 3)).toBe(40)
    expect(loopExitAfter(WORKING_MARK_CLIPS.code.loop, 18)).toBe(37)
    expect(loopExitAfter(WORKING_MARK_CLIPS.code.loop, 56)).toBe(75)
  })

  it('waiting for the user does not wait more than 1.5 s for an exit: it jumps to 20 frames before the loop ends', () => {
    const { player } = retargetWorkingMark(null, 'read', 0)
    const loopStart = (10 + 21) * F
    const now = loopStart + 2 * F + 1 // 58 frames from the read loop's end: about 1.9 s
    const turned = retargetWorkingMark(player, 'waitingForUser', now)
    expect(workingMarkPosition(turned.player, now)).toMatchObject({ stage: { type: 'looping', kind: 'read', end: 60 }, frame: 40 })
  })

  it('the same kind again changes nothing and fades nothing', () => {
    const first = retargetWorkingMark(null, 'write', 0)
    const again = retargetWorkingMark(first.player, 'write', 500)
    expect(again.player).toBe(first.player)
    expect(again.fade).toBeNull()
  })

  it('cross-fades for 300 ms, eased in and out, when a change moves the frame on screen', () => {
    const { player } = retargetWorkingMark(null, 'think', 0)
    // Mid-opening: the stage stays, the frame does not jump, so nothing fades.
    expect(retargetWorkingMark(player, 'code', 12 * F + 1).fade).toBeNull()
    const fade = { from: workingMarkFrameAt(player, 0), startedAt: 1000 }
    expect(workingMarkFadeIn(fade, 1000)).toBeCloseTo(0, 9)
    expect(workingMarkFadeIn(fade, 1150)).toBeCloseTo(0.5, 5)
    expect(workingMarkFadeIn(fade, 1300)).toBeNull()
    expect(easeInOut(0.25)).toBeLessThan(0.25)
  })

  it('under reduced motion shows each kind\'s resting loop frame', () => {
    expect(workingMarkStillFrame('think')).toEqual({ strip: WORKING_MARK_STRIPS.think, index: 16 + 95 })
    expect(workingMarkStillFrame('waitingForUser')).toEqual({ strip: WORKING_MARK_STRIPS.waitingForUser, index: 16 })
  })
})

describe('which mark the turn draws', () => {
  const prompt = (id: string): NativeChatMessage => ({ id, role: 'user', blocks: [{ type: 'text', text: 'go' }], timestamp: 0, source: 'transcript' })
  const call = (id: string, name: string, callId?: string): NativeChatMessage => ({
    id,
    role: 'assistant',
    blocks: [{ type: 'tool-call', name, input: {}, callId }],
    timestamp: 0,
    source: 'transcript'
  })
  const result = (id: string, callId?: string): NativeChatMessage => ({
    id,
    role: 'user',
    blocks: [{ type: 'tool-result', output: 'ok', callId }],
    timestamp: 0,
    source: 'transcript'
  })

  it('maps tools to kinds as the app does (d1x.a)', () => {
    expect(workingMarkKindForTool('Read')).toBe('read')
    expect(workingMarkKindForTool('Grep')).toBe('read')
    expect(workingMarkKindForTool('Edit')).toBe('write')
    expect(workingMarkKindForTool('TodoWrite')).toBe('write')
    expect(workingMarkKindForTool('Bash')).toBe('code')
    expect(workingMarkKindForTool('mcp__git__git_status')).toBe('code')
    expect(workingMarkKindForTool('WebSearch')).toBe('search')
    expect(workingMarkKindForTool('Task')).toBe('generic')
    expect(workingMarkKindForTool('mcp__other__tool')).toBe('generic')
  })

  it('thinks on an empty transcript and on a turn with no tools', () => {
    expect(workingMarkKindFromTranscript([], false)).toBe('think')
    expect(workingMarkKindFromTranscript([prompt('p')], false)).toBe('think')
  })

  it('follows the running tool, else the last tool, and thinks while thinking with none running', () => {
    expect(workingMarkKindFromTranscript([prompt('p'), call('a', 'Read', 'r1'), result('b', 'r1'), call('c', 'Bash', 'r2')], false)).toBe('code')
    expect(workingMarkKindFromTranscript([prompt('p'), call('a', 'Read', 'r1'), result('b', 'r1')], false)).toBe('read')
    expect(workingMarkKindFromTranscript([prompt('p'), call('a', 'Read', 'r1'), result('b', 'r1')], true)).toBe('think')
    // Tools from the turn before this prompt do not count.
    expect(workingMarkKindFromTranscript([prompt('p0'), call('a', 'Bash'), prompt('p1')], false)).toBe('think')
    // Pairing by position when no ids are given.
    expect(workingMarkKindFromTranscript([prompt('p'), call('a', 'Read'), result('b'), call('c', 'WebFetch')], true)).toBe('search')
  })
})
