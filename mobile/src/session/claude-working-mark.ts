import { WORKING_MARK_STRIPS, type WorkingMarkStrip } from './claude-working-mark-data'

// The Claude app's working mark: the dots beside "Clauding... · 1 running task" (com.anthropic.claude
// 1.261013.20, jadx 2026-10-15). It replaced the 84-frame `cc_spinner_sprite` of 1.261009.20,
// which the build installed on the user's phone no longer ships. Where each piece comes from:
//
//   drawing        zq20.a          a 20 dp canvas (`pmw.p(.., 20f)`), the frame drawn centred
//                  zq20.b          shapes in thousandths of the box: 0 a filled circle, 1 a stroked
//                                  circle, 2 an ellipse turned about its centre
//                  uc case 11      a change of frame mid-play cross-fades for 300 ms, eased with
//                                  `jfd.c` = cubic-bezier(0.42, 0, 0.58, 1)
//   kinds          rq20            Think, Generic, Search, Read, Code, Write, WaitingForUser
//   clips          vq20            per kind an opening, a loop with exit frames and a resting frame,
//                                  and a closing; "grow" (10 frames) opens the first one
//   player         tr20.a          30 frames a second (33 333 333 ns a frame); grow, then the
//                                  target's opening, then its loop for ever
//   retarget       aa10 case 10    a new kind lets the running loop play on to its next exit frame,
//                                  close, and open the new kind; WaitingForUser more than 1.5 s
//                                  from an exit jumps to 20 frames before the loop's end instead
//   kind           zr8 case 18     while working: the turn's running tool, else (with no thinking
//                                  stats) its last tool, else Think; d1x.a maps a tool to a kind
//   still          zq20.a          under reduced motion (or a preview) the loop's resting frame
//   colour         zq20.a          the footer's clay; the waiting mark carries its own per frame

export type WorkingMarkKind = 'think' | 'generic' | 'search' | 'read' | 'code' | 'write' | 'waitingForUser'

type Clip = { strip: WorkingMarkStrip; start: number; length: number }
type LoopClip = Clip & { exits: readonly number[]; rest: number }
type KindClips = { opening: Clip; loop: LoopClip; closing: Clip }

const S = WORKING_MARK_STRIPS

/** vq20 <clinit>: (strip, start, length), loop exit frames and resting frame (`ar20`). */
export const WORKING_MARK_CLIPS: Record<WorkingMarkKind, KindClips> = {
  think: {
    opening: { strip: S.think, start: 0, length: 16 },
    loop: { strip: S.think, start: 16, length: 110, exits: [54], rest: 95 },
    closing: { strip: S.think, start: 126, length: 15 }
  },
  generic: {
    opening: { strip: S.generic, start: 0, length: 16 },
    loop: { strip: S.generic, start: 16, length: 40, exits: [], rest: 38 },
    closing: { strip: S.generic, start: 56, length: 14 }
  },
  search: {
    opening: { strip: S.search, start: 0, length: 16 },
    loop: { strip: S.search, start: 16, length: 20, exits: [], rest: 4 },
    closing: { strip: S.search, start: 36, length: 14 }
  },
  read: {
    opening: { strip: S.read, start: 0, length: 21 },
    loop: { strip: S.read, start: 21, length: 60, exits: [], rest: 44 },
    closing: { strip: S.read, start: 81, length: 19 }
  },
  code: {
    opening: { strip: S.code, start: 0, length: 16 },
    loop: { strip: S.code, start: 16, length: 75, exits: [18, 37, 56], rest: 74 },
    closing: { strip: S.code, start: 91, length: 9 }
  },
  write: {
    opening: { strip: S.write, start: 0, length: 31 },
    loop: { strip: S.write, start: 31, length: 60, exits: [], rest: 36 },
    closing: { strip: S.write, start: 91, length: 14 }
  },
  waitingForUser: {
    opening: { strip: S.waitingForUser, start: 0, length: 16 },
    loop: { strip: S.waitingForUser, start: 16, length: 30, exits: [], rest: 0 },
    closing: { strip: S.waitingForUser, start: 46, length: 16 }
  }
}

/** `vq20.a`, the "grow" that opens the first kind. */
export const WORKING_MARK_GROW: Clip = { strip: S.grow, start: 0, length: 10 }

export const WORKING_MARK = {
  /** Drawn size, dp, both ways (`zq20.a`). */
  size: 20,
  /** 30 frames a second (`tr20.a`: 33 333 333 ns). */
  frameMs: 1000 / 30,
  /** The cross-fade between two frames when the kind changes (`ir20.c`: 3e8 ns). */
  crossfadeMs: 300,
  /** WaitingForUser waits for a loop exit only this long (`aa10` case 10: 1.5e9 ns). */
  waitLimitMs: 1500
} as const

/** `ar20.a`: the first exit frame after `frame`, or the loop's length. */
export function loopExitAfter(loop: LoopClip, frame: number): number {
  for (const exit of loop.exits) {
    if (exit > frame) {
      return exit
    }
  }
  return loop.length
}

export type WorkingMarkStage =
  | { type: 'grow' }
  | { type: 'opening'; kind: WorkingMarkKind }
  | { type: 'looping'; kind: WorkingMarkKind; end: number | 'forever' }
  | { type: 'closing'; kind: WorkingMarkKind }

/** `tr20`: the target kind, the stage playing, and when that stage began (ms). */
export type WorkingMarkPlayer = { target: WorkingMarkKind; stage: WorkingMarkStage; stageStart: number }

/** `nr20`: where a player stands at a moment. */
export type WorkingMarkPosition = { stage: WorkingMarkStage; frame: number; stageStart: number }

function sameStage(a: WorkingMarkStage, b: WorkingMarkStage): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The clip a stage draws from (`sr20.a`). */
export function stageClip(stage: WorkingMarkStage): Clip {
  switch (stage.type) {
    case 'grow':
      return WORKING_MARK_GROW
    case 'opening':
      return WORKING_MARK_CLIPS[stage.kind].opening
    case 'looping':
      return WORKING_MARK_CLIPS[stage.kind].loop
    case 'closing':
      return WORKING_MARK_CLIPS[stage.kind].closing
    default: {
      const unknown: never = stage
      throw new Error(`unknown working-mark stage ${JSON.stringify(unknown)}`)
    }
  }
}

/** Whole frames between two moments, as the app's integer division of nanoseconds. */
function framesBetween(from: number, to: number): number {
  return Math.floor(((to - from) * 30) / 1000 + 1e-9)
}

/** `tr20.a`: the stage and frame a player shows at `now`. */
export function workingMarkPosition(player: WorkingMarkPlayer, now: number): WorkingMarkPosition {
  let stage = player.stage
  let start = player.stageStart
  // Each pass either answers or moves to a later stage; a few dozen passes cover any gap.
  for (let guard = 0; guard < 10_000; guard++) {
    let length: number
    let next: WorkingMarkStage
    switch (stage.type) {
      case 'grow':
        length = WORKING_MARK_GROW.length
        next = { type: 'opening', kind: player.target }
        break
      case 'opening': {
        const clips = WORKING_MARK_CLIPS[stage.kind]
        length = clips.opening.length
        next = {
          type: 'looping',
          kind: stage.kind,
          end: stage.kind === player.target ? 'forever' : loopExitAfter(clips.loop, 0)
        }
        break
      }
      case 'looping':
        if (stage.end === 'forever') {
          length = WORKING_MARK_CLIPS[stage.kind].loop.length
          next = stage
        } else {
          length = stage.end
          next = { type: 'closing', kind: stage.kind }
        }
        break
      case 'closing':
        length = WORKING_MARK_CLIPS[stage.kind].closing.length
        next = { type: 'opening', kind: player.target }
        break
      default: {
        const unknown: never = stage
        throw new Error(`unknown working-mark stage ${JSON.stringify(unknown)}`)
      }
    }
    const frames = Math.max(0, framesBetween(start, now))
    if (sameStage(next, stage)) {
      const laps = Math.floor(frames / length)
      return { stage, frame: frames % length, stageStart: start + laps * length * WORKING_MARK.frameMs }
    }
    if (frames < length) {
      return { stage, frame: frames, stageStart: start }
    }
    start += length * WORKING_MARK.frameMs
    stage = next
  }
  return { stage, frame: 0, stageStart: start }
}

/** `uq20`: one frame of one strip. */
export type WorkingMarkFrame = { strip: WorkingMarkStrip; index: number }

export function workingMarkFrameAt(player: WorkingMarkPlayer, now: number): WorkingMarkFrame {
  const position = workingMarkPosition(player, now)
  const clip = stageClip(position.stage)
  return { strip: clip.strip, index: clip.start + position.frame }
}

/** The frame drawn under reduced motion: the kind's resting loop frame (`zq20.a`, `ar20.c`). */
export function workingMarkStillFrame(kind: WorkingMarkKind): WorkingMarkFrame {
  const loop = WORKING_MARK_CLIPS[kind].loop
  return { strip: loop.strip, index: loop.start + loop.rest }
}

function sameFrame(a: WorkingMarkFrame, b: WorkingMarkFrame): boolean {
  return a.strip === b.strip && a.index === b.index
}

/** `tq20`: the frame faded out since `startedAt`. */
export type WorkingMarkFade = { from: WorkingMarkFrame; startedAt: number }

/** `aa10` case 10: aim a player at `kind` at `now`. Returns the player and, when the frame on
 *  screen changes because of it, the fade from the old one. */
export function retargetWorkingMark(
  player: WorkingMarkPlayer | null,
  kind: WorkingMarkKind,
  now: number
): { player: WorkingMarkPlayer; fade: WorkingMarkFade | null } {
  if (player === null) {
    return { player: { target: kind, stage: { type: 'grow' }, stageStart: now }, fade: null }
  }
  if (player.target === kind) {
    return { player, fade: null }
  }
  const position = workingMarkPosition(player, now)
  let next: WorkingMarkPlayer
  if (position.stage.type === 'looping') {
    const running = position.stage.kind
    const loop = WORKING_MARK_CLIPS[running].loop
    const exit = loopExitAfter(loop, position.frame)
    const waitMs = (exit - position.frame) * WORKING_MARK.frameMs
    if (kind !== 'waitingForUser' || running === kind || waitMs <= WORKING_MARK.waitLimitMs) {
      next = {
        target: kind,
        stage: { type: 'looping', kind: running, end: running === kind ? 'forever' : exit },
        stageStart: position.stageStart
      }
    } else {
      next = {
        target: kind,
        stage: { type: 'looping', kind: running, end: loop.length },
        stageStart: now - (loop.length - 20) * WORKING_MARK.frameMs
      }
    }
  } else {
    next = { target: kind, stage: position.stage, stageStart: position.stageStart }
  }
  const before = workingMarkFrameAt(player, now)
  const after = workingMarkFrameAt(next, now)
  return { player: next, fade: sameFrame(before, after) ? null : { from: before, startedAt: now } }
}

/** `jfd.c`: cubic-bezier(0.42, 0, 0.58, 1), solved for y at x. */
export function easeInOut(x: number): number {
  const t0 = Math.min(1, Math.max(0, x))
  const bez = (t: number, p1: number, p2: number) => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (bez(mid, 0.42, 0.58) < t0) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return bez((lo + hi) / 2, 0, 1)
}

/** How far the new frame has faded in (0..1), or null when the fade is over (`ir20.c`). */
export function workingMarkFadeIn(fade: WorkingMarkFade | null, now: number): number | null {
  if (fade === null) {
    return null
  }
  const progress = Math.min(1, Math.max(0, (now - fade.startedAt) / WORKING_MARK.crossfadeMs))
  return progress >= 1 ? null : easeInOut(progress)
}

/** One shape of a frame, in thousandths of the box. */
export type WorkingMarkShape =
  | { kind: 'dot'; cx: number; cy: number; r: number }
  | { kind: 'ring'; cx: number; cy: number; r: number; width: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; degrees: number }

/** `zq20.b`: the shapes of a frame. */
export function workingMarkShapes(frame: WorkingMarkFrame): WorkingMarkShape[] {
  const { offsets, shapes } = frame.strip
  const out: WorkingMarkShape[] = []
  for (let i = offsets[frame.index]!; i < offsets[frame.index + 1]!; i++) {
    const [kind, cx, cy, r, a, b] = shapes.slice(i * 6, i * 6 + 6) as [number, number, number, number, number, number]
    if (kind === 0) {
      out.push({ kind: 'dot', cx, cy, r })
    } else if (kind === 1) {
      out.push({ kind: 'ring', cx, cy, r, width: a })
    } else if (kind === 2) {
      out.push({ kind: 'ellipse', cx, cy, rx: r, ry: a, degrees: b })
    } else {
      throw new Error(`unknown shape kind ${kind} in frame ${frame.index}`)
    }
  }
  return out
}

/** The colour a frame carries of its own (the waiting mark), as #RRGGBB, else null. */
export function workingMarkFrameColor(frame: WorkingMarkFrame): string | null {
  const colors = frame.strip.colors
  if (colors === null) {
    return null
  }
  return `#${(colors[frame.index]! & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`
}

// d1x.a over hqz.e: the kind a tool's name draws. MCP resource tools read; messages to the user
// write; Bash (and git over MCP) codes; web tools search; Task, Agent, ExitPlanMode, slash commands
// and anything else are generic.
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'ListMcpResourcesTool', 'ReadMcpResourceTool'])
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'TodoWrite', 'SendMessage', 'SendUserMessage', 'SendUserFile'])
const CODE_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell', 'KillBash'])
const SEARCH_TOOLS = new Set(['WebFetch', 'WebSearch'])

export function workingMarkKindForTool(name: string): WorkingMarkKind {
  if (READ_TOOLS.has(name)) {
    return 'read'
  }
  if (WRITE_TOOLS.has(name)) {
    return 'write'
  }
  if (CODE_TOOLS.has(name) || name.startsWith('mcp__git__git_')) {
    return 'code'
  }
  if (SEARCH_TOOLS.has(name)) {
    return 'search'
  }
  return 'generic'
}
