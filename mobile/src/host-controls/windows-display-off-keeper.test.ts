import { describe, expect, it } from 'vitest'
import {
  DISPLAY_OFF_READY_EVENT,
  DISPLAY_WAKE_EVENT,
  HOLD_CAP_MS,
  IDLE_RESET_EVERY_MS,
  OFF_POLL_MS,
  OFF_WITHIN_MS,
  USING_ALIASES,
  VIDEO_IDLE,
  VIDEO_IDLE_DEFAULT_AC_S,
  VIDEO_IDLE_DEFAULT_DC_S,
  VIDEO_SUBGROUP,
  WINDOWS_DISPLAY_OFF_KEEPER_MEMBERS,
  WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT,
  WINDOWS_VIDEO_IDLE_UNSTICK_MEMBERS
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

/** The hold loop: the last statement of Run. */
function loop(): string {
  return code.slice(at('y.Set();y.Dispose();'))
}

/** The body of the helper that writes both display-idle timeouts and applies them. */
function writer(): string {
  const start = at('static void X(int a,int d){')
  return code.slice(start, code.indexOf('}', start))
}

describe('the Modern Standby display-off keeper', () => {
  // 0.9.122, 2026-10-10: an instant SC_MONITORPOWER off started standby on Danny's
  // laptop even with a system request held. 2026-10-10: back, through Windows' own
  // idle route, the one Microsoft documents a power request being honoured for.
  it('never posts SC_MONITORPOWER: Windows turns the display off by its own idle timeout', () => {
    expect(code).not.toContain('PostMessage')
    expect(code).not.toContain('0xF170')
    expect(code).not.toContain('274')
  })

  it('sets the display-idle timeout to 1 second on AC and on battery, in the active scheme, and applies it', () => {
    at(`b=new G("${VIDEO_SUBGROUP}")`)
    at(`n=new G("${VIDEO_IDLE}")`)
    expect(writer()).toContain('PowerWriteACValueIndex(z,s,ref b,ref n,a)')
    expect(writer()).toContain('PowerWriteDCValueIndex(z,s,ref b,ref n,d)')
    expect(writer().indexOf('PowerSetActiveScheme(z,s)')).toBeGreaterThan(writer().indexOf('PowerWriteDCValueIndex'))
    at('X(1,1);')
  })

  // The originals come from the scheme itself, through powrprof, never from
  // powercfg's localised text, and a failed read writes nothing at all.
  it('reads the original timeouts from the active scheme before it writes, and writes nothing when it cannot', () => {
    const scheme = at('PowerGetActiveScheme(z,out s)!=0')
    const ac = at('PowerReadACValueIndex(z,s,ref b,ref n,out a)!=0')
    const dc = at('PowerReadDCValueIndex(z,s,ref b,ref n,out d)!=0')
    const write = at('X(1,1);')
    expect(ac).toBeGreaterThan(scheme)
    expect(dc).toBeGreaterThan(ac)
    expect(code.indexOf(')return;', dc)).toBeLessThan(write)
    expect(code).not.toMatch(/powercfg/i)
  })

  it('holds the PC awake and listens for the display before it touches the timeout', () => {
    const create = at('PowerCreateRequest(ref r)')
    const hold = at('if((long)q<1||!PowerSetRequest(q,1))return;')
    const subscribe = at('PowerSettingRegisterNotification(ref g,2,ref p,out h)')
    // Only while the sleep script is still waiting: once it has given up and
    // refused, nothing may be changed behind its back.
    const waiting = at(`if(!EventWaitHandle.TryOpenExisting(${named(DISPLAY_OFF_READY_EVENT)},out y)||`)
    const write = at('X(1,1);')
    expect(hold).toBeGreaterThan(create)
    expect(subscribe).toBeGreaterThan(hold)
    expect(waiting).toBeGreaterThan(subscribe)
    expect(write).toBeGreaterThan(waiting)
    // Execution required is asked for too, and a refusal of it is not fatal.
    expect(code).toContain('return;PowerSetRequest(q,3);')
  })

  // The timeout is 1 s for as short a time as possible: from the write until the
  // display reports off (0), or the window runs out, or Wake display signals.
  // Then the originals go back whatever happened, and the scheme pointer is freed.
  it('puts the original timeouts back the moment the display is off, however the wait ends', () => {
    const write = at('try{X(1,1);')
    const wait = at(`for(int j=0;v!=0&&j++<${OFF_WITHIN_MS / OFF_POLL_MS}&&!y.WaitOne(${OFF_POLL_MS});){}`, write)
    const restore = at('}finally{X(a,d);}', wait)
    expect(wait).toBeGreaterThan(write)
    expect(restore).toBeGreaterThan(wait)
    expect(OFF_WITHIN_MS).toBeLessThanOrEqual(8_000)
    expect(OFF_WITHIN_MS % OFF_POLL_MS).toBe(0)
  })

  // A keeper that died between the write and the restore leaves the scheme at 1 s.
  // That 1 is ours (Windows offers nothing under a minute), so it is never saved as
  // the original: Windows' defaults go back instead.
  it('treats a timeout of 1 second as one a dead keeper left behind, and restores the defaults instead', () => {
    const stuck = at(`if(a==1)a=${VIDEO_IDLE_DEFAULT_AC_S};if(d==1)d=${VIDEO_IDLE_DEFAULT_DC_S};`)
    expect(stuck).toBeGreaterThan(at('out d)!=0'))
    expect(stuck).toBeLessThan(at('X(1,1);'))
    expect(VIDEO_IDLE_DEFAULT_AC_S).toBe(600)
    expect(VIDEO_IDLE_DEFAULT_DC_S).toBe(300)
  })

  // Review, 2026-10-10: a keeper slow to start could pass the still-waiting check
  // just before the script gave up, then turn the display off behind its refusal.
  // The script sets the ready event itself when it gives up, and the keeper's wait
  // for the display watches that event, so it puts the timeout back and stops.
  it('stops waiting for the display and puts the timeout back once the sleep script has given up', () => {
    const write = at('try{X(1,1);')
    expect(code.indexOf('&&!y.WaitOne(', write)).toBeGreaterThan(write)
    expect(code.indexOf('&&!y.WaitOne(', write)).toBeLessThan(at('}finally{X(a,d);}'))
  })

  // The sleep script prints done when the ready event is set, so it is set only
  // once the display has actually reported off, and closed at once so a later
  // Sleep display never finds it already set.
  it('says the display is off only after it reported off, and refuses otherwise', () => {
    const restore = at('}finally{X(a,d);}')
    const off = at('if(v!=0)return;', restore)
    const said = at('y.Set();y.Dispose();', off)
    expect(said).toBeGreaterThan(off)
    expect(code.indexOf('SetThreadExecutionState(1)')).toBeGreaterThan(said)
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
  it('resets the system idle timer at least every 30 seconds while it holds the PC', () => {
    expect(IDLE_RESET_EVERY_MS).toBeLessThanOrEqual(30_000)
    expect(loop()).toContain(`&&!w.WaitOne(${IDLE_RESET_EVERY_MS});)SetThreadExecutionState(1);`)
  })

  // 2026-10-10: "suddenly we open the sheet and do wake display too". The hold
  // waits on the wake event, so it ends the keeper at once. A Wake while the
  // keeper still waits for the display to go off turns it on and repairs the 1 s
  // timeout (Unstick) first; the wait then runs out and the originals go back.
  it('stops at once when Wake display signals while it holds the PC', () => {
    at(`var w=new EventWaitHandle(false,(EventResetMode)1,${named(DISPLAY_WAKE_EVENT)})`)
    expect(loop()).toContain('&&!w.WaitOne(')
  })

  it('stops when the display comes back on after going off, and after 12 hours at most', () => {
    expect(HOLD_CAP_MS).toBe(12 * 60 * 60 * 1000)
    expect(loop()).toContain(`for(int j=0;v!=1&&j++<${HOLD_CAP_MS / IDLE_RESET_EVERY_MS}&&!w.WaitOne(${IDLE_RESET_EVERY_MS});)`)
    expect(HOLD_CAP_MS % IDLE_RESET_EVERY_MS).toBe(0)
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
  })

  // The process exits when Run returns, and the exit closes the request handle,
  // which ends the request, so every return lets go of the PC. Nothing may keep
  // the process alive past the hold: Run is the script's last statement.
  it('lets go of the PC however it ends, by ending the process that holds it', () => {
    expect(WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT.endsWith('\n[CodeUI.Keeper]::Run()')).toBe(true)
    // An abandoned mutex (a keeper that exited without releasing it) is taken as acquired.
    expect(code).toContain('try{if(!m.WaitOne(5000))return;}catch(AbandonedMutexException){}')
  })

  it('compiles its members and runs them, from a single-quoted PowerShell string', () => {
    expect(code).not.toContain("'")
    expect(WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT).toBe(
      `Add-Type -Ig -Names CodeUI -Name Keeper -U System.Threading,${USING_ALIASES} -M '${code}'\n[CodeUI.Keeper]::Run()`
    )
  })
})

// Wake display runs this on every PC, so whatever a dead keeper left behind, Wake
// leaves the PC with a display that still turns off on its own.
describe('the stuck-timeout repair Wake display runs', () => {
  const fix = WINDOWS_VIDEO_IDLE_UNSTICK_MEMBERS

  it('puts a 1-second display timeout back to the Windows default, on AC and on battery, and applies it', () => {
    expect(fix).toContain(`new G("${VIDEO_SUBGROUP}")`)
    expect(fix).toContain(`new G("${VIDEO_IDLE}")`)
    const ac = fix.indexOf(
      `if(PowerReadACValueIndex(z,s,ref b,ref n,out v)==0&&v==1){PowerWriteACValueIndex(z,s,ref b,ref n,${VIDEO_IDLE_DEFAULT_AC_S});f=true;}`
    )
    const dc = fix.indexOf(
      `if(PowerReadDCValueIndex(z,s,ref b,ref n,out v)==0&&v==1){PowerWriteDCValueIndex(z,s,ref b,ref n,${VIDEO_IDLE_DEFAULT_DC_S});f=true;}`
    )
    // Applied only when something was repaired: re-applying an untouched scheme is
    // a change Wake has no reason to make.
    const apply = fix.indexOf('if(f)PowerSetActiveScheme(z,s);LocalFree(s);')
    expect(fix).toContain('bool f=false;')
    expect(ac).toBeGreaterThan(fix.indexOf('if(PowerGetActiveScheme(z,out s)!=0)return;'))
    expect(dc).toBeGreaterThan(ac)
    expect(apply).toBeGreaterThan(dc)
  })

  it('leaves any other timeout alone', () => {
    expect(fix.match(/PowerWrite[AD]CValueIndex\(z,/g)).toHaveLength(2)
    expect(fix).not.toContain("'")
  })
})
