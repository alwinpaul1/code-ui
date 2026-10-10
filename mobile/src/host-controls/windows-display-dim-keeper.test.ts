import { describe, expect, it } from 'vitest'
import {
  DIM_READY_SEMAPHORE,
  DISPLAY_WAKE_EVENT,
  FALLBACK_BRIGHTNESS_PERCENT,
  HOLD_CAP_MS,
  IDLE_RESET_EVERY_MS,
  KEEPER_MUTEX,
  VCP_BRIGHTNESS,
  VIDEO_IDLE,
  VIDEO_IDLE_DEFAULT_AC_S,
  VIDEO_IDLE_DEFAULT_DC_S,
  VIDEO_SUBGROUP,
  WINDOWS_DISPLAY_DIM_KEEPER_MEMBERS,
  WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT,
  WINDOWS_DISPLAY_COVER_MEMBERS,
  WINDOWS_DISPLAY_COVER_STATEMENT,
  COVER_TICK_MS,
  COVER_INPUT_GRACE_MS,
  COVER_MOVE_PX,
  WINDOWS_DISPLAY_LIFT_SCRIPT,
  WINDOWS_MONITOR_MEMBERS,
  WINDOWS_VIDEO_IDLE_UNSTICK_MEMBERS
} from './windows-display-dim-keeper'

// These read the C# and PowerShell the keeper runs, which is generated text with no
// comments in it, so a match here is a match on code. The Win32 calls need Windows;
// the real-PowerShell suite in windows-host-commands.test.ts parses and compiles
// all of it, and drives the keeper's PowerShell half against stand-ins.
const code = WINDOWS_DISPLAY_DIM_KEEPER_MEMBERS
const script = WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT

/** The C# verbatim string literal for a named object, as the keeper writes it. */
const named = (name: string) => `@"${name}"`

function at(fragment: string, text = code, from = 0): number {
  const index = text.indexOf(fragment, from)
  expect(index, `missing: ${fragment}`).toBeGreaterThan(-1)
  return index
}

/** The body of one public static method of the keeper's C#. */
function method(name: string): string {
  const start = at(`public static ${name}`)
  const next = code.indexOf('public static ', start + 1)
  return code.slice(start, next === -1 ? undefined : next)
}

describe('the Modern Standby display-dim keeper', () => {
  // 2026-10-08 and 0.9.122: a display a program turns off starts Modern Standby,
  // held power request or not. 2026-10-10, the user: "dim the full Windows screen to
  // zero, and the external monitor connected too". A display that never turns off
  // never starts standby, on AC or on battery.
  it('never turns a display off: no SC_MONITORPOWER, no display timeout, no DDC/CI power mode', () => {
    for (const text of [code, script, WINDOWS_MONITOR_MEMBERS]) {
      expect(text).not.toContain('PostMessage')
      expect(text).not.toContain('0xF170')
      expect(text).not.toMatch(/ValueIndex|ActiveScheme|powercfg/i)
      expect(text).not.toContain(VIDEO_IDLE)
      // VCP 0xD6 is the monitor's power mode: standby or off on many monitors.
      expect(text).not.toMatch(/\b214\b|0xD6/i)
    }
  })

  // DisplayRequired + SystemRequired is Microsoft's documented pair for "the display
  // stays on and the system does not sleep". Held before anything is dimmed, so a
  // display Windows' own idle timeout would turn off later never starts standby.
  it('holds the display on and the PC awake before it dims anything', () => {
    const begin = method('bool Begin()')
    const create = at('PowerCreateRequest(ref r)', begin)
    const display = at('!PowerSetRequest(q,0)', begin)
    const system = at('!PowerSetRequest(q,1)', begin)
    expect(display).toBeGreaterThan(create)
    expect(system).toBeGreaterThan(display)
    // A refusal of either lets nothing be dimmed.
    expect(begin).toContain('if((long)q<1||!PowerSetRequest(q,0)||!PowerSetRequest(q,1))return false;')
    // The script dims only once Begin said yes.
    const gate = at('if([CodeUI.Keeper]::Begin()){', script)
    expect(at('WmiSetBrightness(1,0)', script)).toBeGreaterThan(gate)
    expect(at('[CodeUI.Keeper]::Hold($n)', script)).toBeGreaterThan(gate)
  })

  // Only while the sleep script is still waiting: once it has given up and refused,
  // nothing may be changed behind its back.
  it('dims nothing unless the sleep script is still waiting for it', () => {
    expect(method('bool Begin()')).toContain(`return Semaphore.TryOpenExisting(${named(DIM_READY_SEMAPHORE)},out y);`)
  })

  it('reads the built-in panel through WMI before it dims it to 0, and puts the reading back', () => {
    const read = at('-Class WmiMonitorBrightness|%{$o[$_.InstanceName]=$_.CurrentBrightness}', script)
    const methods = at('-Class WmiMonitorBrightnessMethods|?{$o.ContainsKey($_.InstanceName)}', script)
    const dim = at('[void]$i.WmiSetBrightness(1,0);$n++', script)
    const restore = at('}finally{foreach($i in $m){try{[void]$i.WmiSetBrightness(1,$o[$i.InstanceName])}catch{}}', script)
    expect(methods).toBeGreaterThan(read)
    expect(dim).toBeGreaterThan(methods)
    expect(restore).toBeGreaterThan(dim)
    expect(script).toContain('-Namespace root/WMI')
  })

  it('reads each external monitor over DDC/CI before it dims it to 0, and keeps the reading to put back', () => {
    expect(VCP_BRIGHTNESS).toBe(0x10)
    const dimmer = method('int Dim()')
    const read = at(`GetVCPFeatureAndVCPFeatureReply(h,${VCP_BRIGHTNESS},IntPtr.Zero,out v,out x)`, dimmer)
    const dim = at(`&&SetVCPFeature(h,${VCP_BRIGHTNESS},0)){o[h]=v;n++;}`, dimmer)
    expect(dim).toBeGreaterThan(read)
    expect(method('void Restore()')).toContain(`foreach(var e in o)if(!SetVCPFeature(e.Key,${VCP_BRIGHTNESS},e.Value))f=true;`)
    // Every monitor Windows knows, through its physical monitors; one that does
    // not answer DDC/CI is skipped and not counted.
    expect(WINDOWS_MONITOR_MEMBERS).toContain('EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,')
    expect(WINDOWS_MONITOR_MEMBERS).toContain('GetNumberOfPhysicalMonitorsFromHMONITOR(m,out n)&&n>0')
    expect(WINDOWS_MONITOR_MEMBERS).toContain('GetPhysicalMonitorsFromHMONITOR(m,n,b)')
    expect(code.startsWith(WINDOWS_MONITOR_MEMBERS)).toBe(true)
  })

  // The sleep script prints done only when something was dimmed, and says how many;
  // a PC where neither WMI nor DDC/CI dimmed anything is refused, and the keeper
  // does not stay to hold a PC it changed nothing on.
  // The count is 1 + 2 x dimmed + (1 when covered): one number carries both.
  it('tells the sleep script how many displays it dimmed, and holds nothing when that is none', () => {
    const hold = method('void Hold(int n)')
    const told = at('y.Release(n*2+1);y.Close();if(n<1)return;', hold)
    expect(hold.indexOf('w.WaitOne(')).toBeGreaterThan(told)
    // Both dims come before the cover and before the dim-only hold.
    const wmi = at('WmiSetBrightness(1,0)', script)
    const ddc = at('$n+=[CodeUI.Keeper]::Dim()', script)
    const cover = at(WINDOWS_DISPLAY_COVER_STATEMENT, script)
    const fallback = at('if(!$c){[CodeUI.Keeper]::Hold($n)}', script)
    expect(ddc).toBeGreaterThan(wmi)
    expect(cover).toBeGreaterThan(ddc)
    expect(fallback).toBeGreaterThan(cover)
  })

  it('puts every display back however the hold ends, even when it throws', () => {
    const hold = at('if(!$c){[CodeUI.Keeper]::Hold($n)}}finally{', script)
    const restore = at('[CodeUI.Keeper]::Restore()', script, hold)
    expect(restore).toBeGreaterThan(hold)
  })

  // Wake display sets the event; a touch at the PC changes GetLastInputInfo (the
  // display never went off, so there is no display-on to wait for, unlike the Mac);
  // 12 hours at most. Each ends Hold, and the script's finally puts back.
  it('ends the hold on Wake display, on a touch at the PC, and after 12 hours', () => {
    const hold = method('void Hold(int n)')
    const baseline = at('var l=new L{t=8};GetLastInputInfo(ref l);int s=l.c;', hold)
    const loop = at(
      `for(int j=0;j++<${HOLD_CAP_MS / IDLE_RESET_EVERY_MS}&&!w.WaitOne(${IDLE_RESET_EVERY_MS});){SetThreadExecutionState(1);if(GetLastInputInfo(ref l)&&l.c!=s)return;}`,
      hold
    )
    expect(loop).toBeGreaterThan(baseline)
    // The input baseline is taken after the dimming, so the dim itself is not a touch.
    expect(baseline).toBeGreaterThan(at('y.Release(', hold))
    expect(HOLD_CAP_MS).toBe(12 * 60 * 60 * 1000)
    expect(HOLD_CAP_MS % IDLE_RESET_EVERY_MS).toBe(0)
    expect(IDLE_RESET_EVERY_MS).toBeLessThanOrEqual(30_000)
  })

  it('resets only the system idle timer while it holds, never a continuous state', () => {
    const args = [...code.matchAll(/SetThreadExecutionState\(([^)]*)\)/g)]
      .map((match) => match[1] ?? '')
      .filter((arg) => !arg.startsWith('int '))
    expect(args.length).toBeGreaterThan(0)
    for (const arg of args) {
      expect(arg).toBe('1')
    }
  })

  // A second Sleep display while a keeper still holds: the new one signals the old
  // one to go (it puts its displays back), waits until it has let go, and clears the
  // signal for itself. The mutex lives in a static field: a local the GC finalised
  // would destroy the name, and two keepers would hold at once.
  it('retires a keeper already running before it holds the PC itself', () => {
    const begin = method('bool Begin()')
    const retire = at(`w=new EventWaitHandle(false,EventResetMode.ManualReset,${named(DISPLAY_WAKE_EVENT)});w.Set();`, begin)
    const one = at(`u=new Mutex(false,${named(KEEPER_MUTEX)});`, begin)
    const taken = at('try{if(!u.WaitOne(5000))return false;}catch(AbandonedMutexException){}', begin)
    const clear = at('w.Reset();', begin)
    expect(one).toBeGreaterThan(retire)
    expect(taken).toBeGreaterThan(one)
    expect(clear).toBeGreaterThan(taken)
    expect(clear).toBeLessThan(at('PowerCreateRequest(ref r)', begin))
    expect(code).toContain('static Mutex u;')
  })

  // Review, 2026-10-10: the semaphore outlived the report. A handle the keeper kept
  // for the whole hold left the count behind, and the next Sleep display read the
  // last run's answer at once and printed done after doing nothing. The keeper lets
  // go of it the moment it has told; the script's handle keeps it alive to be read.
  it('lets go of the ready semaphore as soon as it has told the sleep script', () => {
    expect(method('void Hold(int n)')).toContain('y.Release(n*2+1);y.Close();if(n<1)return;')
    expect(WINDOWS_DISPLAY_COVER_MEMBERS).toContain('y.Release(n*2+2);y.Close();')
  })

  // Review, 2026-10-10: after a topology change the physical monitor handles are
  // stale, a restore through them fails silently, and the monitor stays at 0 with no
  // keeper left for Wake display to tell. A failed restore lifts any monitor at 0.
  it('lifts a monitor still at 0 when putting a reading back failed', () => {
    const restore = method('void Restore()')
    expect(restore).toContain(`foreach(var e in o)if(!SetVCPFeature(e.Key,${VCP_BRIGHTNESS},e.Value))f=true;`)
    expect(restore).toContain(
      `if(f)foreach(var h in Monitors()){int v,x;if(GetVCPFeatureAndVCPFeatureReply(h,${VCP_BRIGHTNESS},IntPtr.Zero,out v,out x)&&v==0)SetVCPFeature(h,${VCP_BRIGHTNESS},(x>0?x:100)*${FALLBACK_BRIGHTNESS_PERCENT}/100);}`
    )
  })

  it('compiles its members from a single-quoted PowerShell string', () => {
    expect(code).not.toContain("'")
    expect(script.startsWith("$ErrorActionPreference='Stop'\nAdd-Type -IgnoreWarnings -Namespace CodeUI -Name Keeper ")).toBe(true)
    expect(script).toContain(`-MemberDefinition '${code}'`)
  })
})

// 2026-10-10, the user, to cover what dimming cannot: a faint backlight at
// brightness 0, and a monitor without DDC/CI staying lit. A black window over every
// screen; Windows still counts the display on, so still no Modern Standby.
describe('the black covers over every screen', () => {
  const cover = WINDOWS_DISPLAY_COVER_MEMBERS
  function body(name: string): string {
    const start = at(`static ${name}`, cover)
    const next = cover.indexOf('static ', start + 1)
    return cover.slice(start, next === -1 ? undefined : next)
  }

  it('puts one borderless, topmost, black window with no taskbar button on each screen, at its bounds', () => {
    const over = body('void Over()')
    expect(over).toContain('foreach(var s in Screen.AllScreens){var x=new Form();')
    for (const property of [
      'x.BackColor=Color.Black;',
      'x.FormBorderStyle=FormBorderStyle.None;',
      'x.TopMost=true;',
      'x.ShowInTaskbar=false;',
      'x.StartPosition=FormStartPosition.Manual;',
      'x.Bounds=s.Bounds;'
    ]) {
      expect(over).toContain(property)
    }
    // Shown before it is placed again: Show can move a window it has not placed itself.
    expect(at('x.Show();x.Bounds=s.Bounds;', over)).toBeGreaterThan(at('x.Bounds=s.Bounds;x.KeyPreview', over))
    // A re-cover closes the old windows first.
    expect(over.startsWith('static void Over(){Uncover();')).toBe(true)
  })

  it('hides the cursor while covered and shows it again however the hold ends', () => {
    const run = body('bool Run(')
    const hide = at('Cursor.Hide();', run)
    expect(hide).toBeGreaterThan(at('try{Over();}catch{Uncover();return false;}', run))
    expect(run).toMatch(/finally\{m\.Stop\(\);.*Uncover\(\);Cursor\.Show\(\);\}/)
  })

  it('ends on a key, a click, or a real mouse move on any cover, after the first half second', () => {
    const over = body('void Over()')
    expect(over).toContain('x.KeyPreview=true;')
    expect(over).toContain('x.KeyDown+=(o,e)=>Stop();x.MouseDown+=(o,e)=>Stop();')
    expect(over).toContain(
      `if(Environment.TickCount-t0>${COVER_INPUT_GRACE_MS}&&(Math.Abs(q.X-p.X)>${COVER_MOVE_PX}||Math.Abs(q.Y-p.Y)>${COVER_MOVE_PX}))Stop();`
    )
    expect(COVER_INPUT_GRACE_MS).toBe(500)
    expect(body('void Stop()')).toContain('a.ExitThread();')
  })

  it('ends on any input Windows saw after the first half second, on Wake display, and after 12 hours', () => {
    const run = body('bool Run(')
    expect(run).toContain(`if(w.WaitOne(0)||++k>${HOLD_CAP_MS / COVER_TICK_MS}){Stop();return;}`)
    expect(run).toContain(`GetLastInputInfo(ref l);if(Environment.TickCount-t0<${COVER_INPUT_GRACE_MS})s=l.c;else if(l.c!=s)Stop();`)
    expect(run).toContain(`m.Interval=${COVER_TICK_MS};`)
    expect(HOLD_CAP_MS % COVER_TICK_MS).toBe(0)
  })

  it('covers every screen again when a display is added or removed', () => {
    const run = body('bool Run(')
    expect(run).toContain('EventHandler h=(o,e)=>{d=true;};SystemEvents.DisplaySettingsChanged+=h;')
    expect(run).toContain('if(d){d=false;Over();}')
  })

  // Told "covered" only once a cover is up; a cover that cannot be shown tells
  // nothing and returns false, and the keeper dims only.
  it('tells the sleep script it covered only after the covers are up', () => {
    const run = body('bool Run(')
    expect(at('y.Release(n*2+2);y.Close();', run)).toBeGreaterThan(at('Cursor.Hide();', run))
    expect(at('if(f.Count<1)return false;', run)).toBeLessThan(at('y.Release(', run))
    expect(at('try{Application.Run(a);}catch{}', run)).toBeGreaterThan(at('y.Release(', run))
  })

  it('falls back to dimming only when WinForms will not load or show', () => {
    expect(WINDOWS_DISPLAY_COVER_STATEMENT.startsWith('try{Add-Type ')).toBe(true)
    expect(WINDOWS_DISPLAY_COVER_STATEMENT).toContain('-ReferencedAssemblies System.Windows.Forms,System.Drawing ')
    expect(WINDOWS_DISPLAY_COVER_STATEMENT.endsWith('$c=[CodeUI.Cover]::Run([CodeUI.Keeper]::w,[CodeUI.Keeper]::y,$n)}catch{}')).toBe(true)
    expect(script).toContain('$c=$false\n' + WINDOWS_DISPLAY_COVER_STATEMENT + '\nif(!$c){[CodeUI.Keeper]::Hold($n)}')
  })

  // Review, 2026-10-10: a hidden keeper is usually refused the foreground, so a key
  // pressed at the black screen reached the focused app underneath, often the
  // agent's composer. A low-level keyboard hook on the cover's own message loop
  // swallows every key while covered, and the first one ends the hold.
  it('swallows every key while covered, and ends the hold on the first', () => {
    const run = body('bool Run(')
    expect(cover).toContain('static K kb;static IntPtr hk;')
    expect(cover).toContain('kb=(c,w2,l2)=>{if(c>=0){Stop();return (IntPtr)1;}return CallNextHookEx(hk,c,w2,l2);};')
    expect(run).toContain('hk=SetWindowsHookEx(13,kb,GetModuleHandle(null),0);')
    expect(at('hk=SetWindowsHookEx(', run)).toBeLessThan(at('try{Application.Run(a);}', run))
    expect(run).toContain('if(hk!=IntPtr.Zero)UnhookWindowsHookEx(hk);')
  })

  // Review, 2026-10-10: a sign-out or restart mid-hold kills the keeper before its
  // finally, leaving the displays at 0 after the next sign-in. The session ending
  // ends the hold first, so the readings go back while there is still time.
  it('ends the hold when the Windows session is ending', () => {
    const run = body('bool Run(')
    expect(run).toContain('SessionEndingEventHandler se=(o,e)=>Stop();SystemEvents.SessionEnding+=se;')
    expect(run).toContain('SystemEvents.SessionEnding-=se;')
  })

  it('compiles from a single-quoted PowerShell string, and never turns a display off', () => {
    expect(cover).not.toContain("'")
    expect(cover).not.toMatch(/PostMessage|0xF170|SetDeviceGammaRamp|MagSet/)
    // System.Threading has a Timer too: the WinForms one is written in full.
    expect(cover).toContain('new System.Windows.Forms.Timer()')
  })
})

// Wake display on a Modern Standby PC with no keeper left to put the displays back
// (it was killed, or the PC restarted mid-hold): a display left at 0 comes back to
// 70%, and one the user set low on purpose is left alone.
describe('the brightness fallback Wake display runs when no keeper is there', () => {
  const lift = WINDOWS_DISPLAY_LIFT_SCRIPT

  it('lifts only a DDC/CI monitor that reads 0, to 70% of its own maximum', () => {
    expect(FALLBACK_BRIGHTNESS_PERCENT).toBe(70)
    expect(lift).toContain(WINDOWS_MONITOR_MEMBERS)
    expect(lift).toContain(
      `if(GetVCPFeatureAndVCPFeatureReply(h,${VCP_BRIGHTNESS},IntPtr.Zero,out v,out x)&&v==0)SetVCPFeature(h,${VCP_BRIGHTNESS},(x>0?x:100)*${FALLBACK_BRIGHTNESS_PERCENT}/100);`
    )
  })

  it('lifts only a built-in panel that reads 0, to 70%', () => {
    expect(lift).toContain('-Class WmiMonitorBrightness|?{$_.CurrentBrightness -eq 0}|%{$z[$_.InstanceName]=1}')
    expect(lift).toContain(`|?{$z.ContainsKey($_.InstanceName)}|%{[void]$_.WmiSetBrightness(1,${FALLBACK_BRIGHTNESS_PERCENT})}`)
  })

  it('can fail without stopping Wake display', () => {
    for (const line of lift.split('\n')) {
      expect(line.startsWith('try{')).toBe(true)
      expect(line.endsWith('}catch{}')).toBe(true)
    }
  })
})

// 0.9.126 set the display timeout to 1 s while its keeper waited for the display to
// go off. A keeper killed in that window left the PC at 1 s, and Wake display still
// repairs that, on every PC.
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
