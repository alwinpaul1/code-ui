import { describe, expect, it } from 'vitest'
import {
  DISPLAY_OFF_READY_EVENT,
  DISPLAY_WAKE_EVENT,
  HOLD_CAP_MS,
  IDLE_RESET_EVERY_MS,
  OFF_WITHIN_MS,
  WINDOWS_DISPLAY_OFF_KEEPER_MEMBERS,
  WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT
} from './windows-display-off-keeper'

// These read the C# the keeper compiles, which is generated text with no comments
// in it, so a match here is a match on code. The calls need Windows; the
// real-PowerShell suite in windows-host-commands.test.ts parses and compiles it.
const code = WINDOWS_DISPLAY_OFF_KEEPER_MEMBERS

/** The C# verbatim string literal for a named event, as the keeper writes it. */
const named = (name: string) => `@"${name}"`

function at(fragment: string, from = 0): number {
  const index = code.indexOf(fragment, from)
  expect(index, `missing from the keeper: ${fragment}`).toBeGreaterThan(-1)
  return index
}

/** The wait loop, from its `for` to the end of the try it sits in. */
function loop(): string {
  const start = at('for(int i=1;i!=0;)')
  return code.slice(start, code.indexOf('}finally{', start))
}

describe('the Modern Standby display-off keeper', () => {
  // 2026-10-10, Danny: the display must go off at once and the PC must stay up.
  // The request is held and the display state subscribed before the ready event,
  // and the display is turned off only after that, so a refused request never
  // leaves a display off over a PC going to sleep.
  it('turns the display off only after it holds the PC awake and has said so', () => {
    const create = at('PowerCreateRequest(ref r)')
    const hold = at('if(!PowerSetRequest(q,1))return;')
    const subscribe = at('PowerSettingRegisterNotification(ref g,2,ref p,out h)')
    const ready = at(`EventWaitHandle.TryOpenExisting(${named(DISPLAY_OFF_READY_EVENT)},out y)`)
    const said = at('y.Set()', ready)
    // WM_SYSCOMMAND (274), SC_MONITORPOWER (0xF170), 2: off.
    const off = at('PostMessage((IntPtr)0xFFFF,274,(IntPtr)0xF170,(IntPtr)2)')
    expect(hold).toBeGreaterThan(create)
    expect(subscribe).toBeGreaterThan(hold)
    expect(ready).toBeGreaterThan(subscribe)
    expect(said).toBeGreaterThan(ready)
    expect(off).toBeGreaterThan(said)
    // Execution required is asked for too, and a refusal of it is not fatal.
    expect(code).toContain('return;PowerSetRequest(q,3);')
  })

  it('holds the PC with a system power request, and resets only the system idle timer', () => {
    expect(code).toContain('PowerSetRequest(q,1)')
    expect(code).not.toMatch(/PowerSetRequest\(q,0\)/)
    const args = [...code.matchAll(/SetThreadExecutionState\(([^)]*)\)/g)]
      .map((match) => match[1] ?? '')
      .filter((arg) => !arg.startsWith('int '))
    expect(args.length).toBeGreaterThan(0)
    for (const arg of args) {
      // ES_SYSTEM_REQUIRED alone: no ES_CONTINUOUS (0x80000000), no ES_DISPLAY_REQUIRED (2).
      expect(arg).toBe('1')
    }
    expect(code).not.toMatch(/0x80000000|2147483648/)
  })

  // On battery, Modern Standby drops a system request five minutes after the
  // system sleep timeout expires; the timeout counts from the last system
  // activity, so the keeper resets it on every turn of a loop that turns at least
  // every 30 seconds.
  it('resets the system idle timer at least every 30 seconds while it waits', () => {
    const body = loop()
    expect(body).toContain('SetThreadExecutionState(1);')
    expect(IDLE_RESET_EVERY_MS).toBeLessThanOrEqual(30_000)
    expect(body).toContain(`i=WaitHandle.WaitAny(new WaitHandle[]{w,e},(int)Math.Min(t,${IDLE_RESET_EVERY_MS}))`)
    expect(body.indexOf('SetThreadExecutionState(1);')).toBeLessThan(body.indexOf('WaitAny'))
  })

  // 2026-10-10: "suddenly we open the sheet and do wake display too". Index 0 of
  // the wait is the wake event, and the loop runs only while i is not 0.
  it('stops at once when Wake display signals, whether or not the display said it went off', () => {
    at(`var w=new EventWaitHandle(false,EventResetMode.ManualReset,${named(DISPLAY_WAKE_EVENT)})`)
    expect(loop()).toMatch(/^for\(int i=1;i!=0;\)/)
    expect(loop()).toContain('WaitAny(new WaitHandle[]{w,e}')
  })

  it('stops when the display comes back on after going off, and after 12 hours at most', () => {
    expect(code).toContain('if(v!=1)o=true;')
    expect(loop()).toContain('if(i==1&&o&&v==1)break;')
    expect(HOLD_CAP_MS).toBe(12 * 60 * 60 * 1000)
    // A display that never reports off is not held for 12 hours.
    expect(loop()).toContain(`long t=(o?${HOLD_CAP_MS}:${OFF_WITHIN_MS})-c.ElapsedMilliseconds;if(t<1)break;`)
  })

  // A second Sleep display while a keeper still holds the PC: the new one signals
  // the old one to go, waits until it has let go, and clears the signal for itself.
  it('retires a keeper already running before it holds the PC itself', () => {
    const retire = at('w.Set();')
    const one = at('m.WaitOne(')
    const clear = at('w.Reset();')
    expect(one).toBeGreaterThan(retire)
    expect(clear).toBeGreaterThan(one)
    expect(clear).toBeLessThan(at('PowerCreateRequest(ref r)'))
    expect(code).toContain('finally{m.ReleaseMutex();}')
  })

  it('lets go of the request and the subscription however it ends', () => {
    expect(code).toContain('finally{PowerSettingUnregisterNotification(h);}')
    expect(code).toContain('finally{PowerClearRequest(q,1);PowerClearRequest(q,3);}')
  })

  it('compiles its members and runs them, from a single-quoted PowerShell string', () => {
    expect(code).not.toContain("'")
    expect(WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT).toBe(
      `Add-Type -IgnoreWarnings -Namespace CodeUI -Name Keeper -UsingNamespace System.Threading -MemberDefinition '${code}'\n[CodeUI.Keeper]::Run()`
    )
  })
})
