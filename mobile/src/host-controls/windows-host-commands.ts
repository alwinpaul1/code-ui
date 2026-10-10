import { deflateSync } from 'fflate'
import { encodePowerShellCommand } from '../session/agent-hud-launch-args'
import type { MacHostAction } from './mac-host-commands'
import {
  DIM_READY_SEMAPHORE,
  DISPLAY_WAKE_EVENT,
  USING_ALIASES,
  WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT,
  WINDOWS_DISPLAY_LIFT_SCRIPT,
  WINDOWS_VIDEO_IDLE_UNSTICK_MEMBERS
} from './windows-display-dim-keeper'

/**
 * The one-tap controls a Windows host gets: the Mac set without Unlock.
 *
 * Why no Unlock: Windows takes a password only on its own sign-in screen, from the
 * keyboard or from a sign-in component an administrator installed on the PC. Nothing
 * a program on the PC runs can type into it, so there is no zero-install Unlock, and
 * the sheet offers Lock PC alone, whatever state the PC is in (mac-host-sheet-actions.ts).
 */
export type WindowsHostAction = Exclude<MacHostAction, 'unlock'>

export const WINDOWS_HOST_ACTION_LABELS: Record<WindowsHostAction, string> = {
  lock: 'Lock PC',
  'sleep-display': 'Sleep display',
  'wake-display': 'Wake display',
  mute: 'Mute PC',
  unmute: 'Unmute PC'
}

export const WINDOWS_HOST_ACTION_PROGRESS: Record<WindowsHostAction, string> = {
  lock: 'Locking the PC…',
  'sleep-display': 'Putting the display to sleep…',
  'wake-display': 'Waking the display…',
  mute: 'Muting the PC…',
  unmute: 'Unmuting the PC…'
}

/** Sleep display's progress on a PC the last answer said has Modern Standby, where it
 *  dims and covers the screens instead of turning them off (windows-display-dim-keeper.ts). */
export const WINDOWS_DIM_PROGRESS = 'Dimming the displays…'

/** The progress line for a Windows action. `sleepsWithDisplay` is what the last probe
 *  said; the script itself asks the PC again, so a wrong guess only words the
 *  progress line, never what runs. */
export function windowsHostActionProgress(action: WindowsHostAction, sleepsWithDisplay: boolean): string {
  return action === 'sleep-display' && sleepsWithDisplay ? WINDOWS_DIM_PROGRESS : WINDOWS_HOST_ACTION_PROGRESS[action]
}

/** What the keeper did on a Modern Standby PC, as the sleep script reports it. */
export type WindowsDimReport = { dimmed: number; covered: boolean }

// Anchored, and built from parts in the script: its own text never matches.
const DIM_REPORT_PATTERN = /^CUIDIMMED (\d+) covered=([01])\b/

/** The dim report a Sleep display printed on a Modern Standby PC, or null. */
export function readWindowsDimReport(lines: string[]): WindowsDimReport | null {
  for (const line of lines) {
    const match = DIM_REPORT_PATTERN.exec(line)
    if (match) {
      return { dimmed: Number(match[1]), covered: match[2] === '1' }
    }
  }
  return null
}

/** The toast once Sleep display finished on a Modern Standby PC. Covered is the
 *  screens black; dimmed only is WinForms having failed, and says so. */
export function windowsDimDoneToast(report: WindowsDimReport): string {
  if (report.covered) {
    return 'Screens off. Tap Wake display or touch the PC to turn them back on.'
  }
  const displays = report.dimmed === 1 ? '1 display' : `${report.dimmed} displays`
  return `${displays} dimmed. Tap Wake display or touch the PC to restore.`
}

/**
 * The line each script ends on, the same marker the Mac commands print
 * (MAC_HOST_COMMAND_DONE_PATTERN). Built from two strings so the script's own text
 * never contains it — and the command line on the screen is base64, which cannot.
 * A script that throws stops before it, so a refusal reads as "did not finish"
 * rather than as success.
 */
const DONE = `'CUIDONE '+'ok'`

/**
 * Core Audio's default output endpoint, for mute and its state. The interface
 * layout is IAudioEndpointVolume's vtable up to GetMute; the eleven unnamed slots
 * are the methods before SetMute. Written as C# 5, which is what Windows
 * PowerShell 5.1's compiler takes. Output only, as on the Mac: the microphone is
 * left alone.
 */
export const WINDOWS_AUDIO_TYPE = [
  'using System;using System.Runtime.InteropServices;',
  'namespace CodeUI{',
  '[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'interface IAudioEndpointVolume{int f();int g();int h();int i();int j();int k();int l();int m();int n();int o();int p();',
  'int SetMute([MarshalAs(UnmanagedType.Bool)]bool mute,Guid context);int GetMute([MarshalAs(UnmanagedType.Bool)]out bool mute);}',
  '[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'interface IMMDevice{int Activate(ref Guid id,int context,int parameters,out IAudioEndpointVolume volume);}',
  '[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'interface IMMDeviceEnumerator{int f();int GetDefaultAudioEndpoint(int flow,int role,out IMMDevice device);}',
  '[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]class MMDeviceEnumerator{}',
  'public static class Audio{',
  'static IAudioEndpointVolume Endpoint(){IMMDevice device;',
  'Marshal.ThrowExceptionForHR(((IMMDeviceEnumerator)new MMDeviceEnumerator()).GetDefaultAudioEndpoint(0,1,out device));',
  'Guid id=typeof(IAudioEndpointVolume).GUID;IAudioEndpointVolume volume;',
  'Marshal.ThrowExceptionForHR(device.Activate(ref id,23,0,out volume));return volume;}',
  'public static void SetMute(bool mute){Marshal.ThrowExceptionForHR(Endpoint().SetMute(mute,Guid.Empty));}',
  'public static bool GetMute(){bool mute;Marshal.ThrowExceptionForHR(Endpoint().GetMute(out mute));return mute;}',
  '}}'
].join('')

// SC_MONITORPOWER over WM_SYSCOMMAND to every top-level window: 2 is off, -1 is on.
// PostMessage rather than SendMessage, which waits on every window and can hang on one
// that never answers. GetPwrCapabilities is for the Modern Standby check, in Sleep
// display and in Wake display's fallback. They are separate type names because the
// real-PowerShell test compiles both in one session.
/** How long Sleep display waits, on a Modern Standby PC, for the keeper to say what it
 *  dimmed and covered: a hidden powershell start, up to 5 s for an older keeper to
 *  put its displays back, two compiles (the keeper's and the covers', each a csc.exe
 *  start on Windows PowerShell 5.1), WMI and DDC/CI. Not timed on a real PC. Inside
 *  the phone's 15 s (WINDOWS_HOST_COMMAND_TIMEOUT_MS) with 3 s for this script's own
 *  start and compile. */
export const DIM_WAIT_MS = 12_000

const SLEEP_TYPE =
  "Add-Type -Ig -Names CodeUI -Name Display -M '[DllImport(\"user32\")]public static extern bool PostMessage(IntPtr h,int m,IntPtr w,IntPtr l);" +
  "[DllImport(\"powrprof\")]public static extern byte GetPwrCapabilities(byte[] c);'"
const WAKE_TYPE =
  'Add-Type -IgnoreWarnings -Namespace CodeUI -Name Wake -MemberDefinition ' +
  "'[DllImport(\"user32.dll\")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);" +
  ' [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' +
  ' [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);' +
  " [DllImport(\"powrprof.dll\")] public static extern byte GetPwrCapabilities(byte[] c);'"
// The stuck-timeout repair compiles on its own and may fail: it leans on the
// using-alias trick (USING_ALIASES), not yet run under Windows PowerShell 5.1, and a
// failed compile must never take Wake display's own calls down with it.
const UNSTICK =
  `try{Add-Type -IgnoreWarnings -Namespace CodeUI -Name Fix -UsingNamespace ${USING_ALIASES} -MemberDefinition ` +
  `'${WINDOWS_VIDEO_IDLE_UNSTICK_MEMBERS}';[CodeUI.Fix]::Unstick()}catch{}`

const SCRIPTS: Record<WindowsHostAction, string[]> = {
  lock: [
    'Add-Type -IgnoreWarnings -Namespace CodeUI -Name Session -MemberDefinition ' +
      "'[DllImport(\"user32.dll\")] public static extern bool LockWorkStation();'",
    "if(-not [CodeUI.Session]::LockWorkStation()){throw 'LockWorkStation refused'}"
  ],
  // Why the branch: on a PC with Modern Standby (S0 Low Power Idle, most laptops
  // since about 2019) the display going off IS the start of standby, so the post
  // put Danny's whole laptop to sleep (2026-10-08), and so did every display-off
  // since (0.9.122, a held request; 0.9.126, Windows' own idle route, unconfirmed).
  // 2026-10-10, the user: dim every screen instead, and cover each with black. A
  // display that never turns off never starts standby. AoAc is byte 20 of
  // SYSTEM_POWER_CAPABILITIES (76 bytes; the buffer is larger to spare).
  //
  // On such a PC the script posts nothing: it starts the keeper
  // (windows-display-dim-keeper.ts) hidden and detached, and waits on the ready
  // semaphore. The keeper releases 1 + 2 x dimmed + (1 when covered); the wait
  // takes one, and Release hands back the rest, so $t is 2 x dimmed + covered. Then:
  // $t > 0, done, with the report the phone words its toast from; $t = 0, nothing
  // could be dimmed or covered and the keeper changed nothing ('nodim'); no answer
  // in DIM_WAIT_MS, the keeper failed (a compile, the power request) or is slow,
  // and the script sets the wake event, which ends a keeper that got as far as
  // dimming and puts everything back, and refuses ('keepawake'). The semaphore is
  // closed before that signal (review, 2026-10-10): a keeper that has not opened it
  // yet then never can, and one that already has reset the wake event before this
  // sets it, so the signal cannot be lost to the keeper's own reset. A semaphore
  // this run did not create (createdNew false) belongs to a Sleep display still
  // running, and its count is not this run's answer: refused.
  //
  // The keeper rides to the hidden child in an environment variable, which the
  // child inherits (32,767 characters at most; nothing on disk), and runs as
  // `iex $env:CUIK` (review, 2026-10-10). Before, it went as -EncodedCommand, about
  // 13,000 characters, and Start-Process without redirection goes through
  // ShellExecuteEx, whose parameters Microsoft documents as limited to about
  // 2,048. `start` is Start-Process; -Win and -Args are -WindowStyle and
  // -ArgumentList; -nop, -noni and -c are powershell.exe's -NoProfile,
  // -NonInteractive and -Command.
  //
  // Every other PC (AoAc 0, or a call that returns 0) gets the post, unchanged: a
  // classic PC really turns its display off and stays awake. A call that throws
  // stops the script ('Stop'), which reads as "did not finish".
  // NOT YET RUN ON A WINDOWS MACHINE: off Windows the capability call throws.
  'sleep-display': [
    SLEEP_TYPE,
    '$c=New-Object byte[] 128;if([CodeUI.Display]::GetPwrCapabilities($c) -and $c[20]){' +
      `$n=$false;$r=[Threading.Semaphore]::new(0,99,'${DIM_READY_SEMAPHORE}',[ref]$n);if(!$n){'CUIREF'+'USED keepawake';exit}` +
      `$env:CUIK='${WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT.replace(/'/g, "''")}';` +
      "start powershell -Win Hidden -Args '-nop','-noni','-c','iex $env:CUIK';" +
      `if($r.WaitOne(${DIM_WAIT_MS})){$t=$r.Release();if($t){'CUIDIM'+"MED $(($t-$t%2)/2) covered=$($t%2)";${DONE}}else{'CUIREF'+'USED nodim'}}` +
      `else{$r.Close();$w=$null;if([Threading.EventWaitHandle]::TryOpenExisting('${DISPLAY_WAKE_EVENT}',[ref]$w)){[void]$w.Set()};'CUIREF'+'USED keepawake'};exit}`,
    "if(-not [CodeUI.Display]::PostMessage([IntPtr]0xFFFF,0x0112,[IntPtr]0xF170,[IntPtr]2)){throw 'PostMessage refused'}"
  ],
  // Monitor power on alone is unreliable since Windows 8, so the script also resets the
  // display idle timer (ES_DISPLAY_REQUIRED, as `caffeinate -u` does on the Mac) and
  // nudges the pointer one pixel and back, which any monitor treats as activity.
  // Unstick repairs a display timeout 0.9.126's keeper may have left at 1 s, on every
  // PC. Last, the keeper: a running one is told to stop through the wake event, and
  // it closes its covers and puts back every brightness it read. Last, not first:
  // the display is lit before anything lets go of the PC. With no keeper (none ran,
  // or it was killed and left the displays at 0), a Modern Standby PC lifts any
  // display that reads 0 to 70% (WINDOWS_DISPLAY_LIFT_SCRIPT); a classic PC never
  // dims, so a 0 there is the user's own, and is left alone.
  'wake-display': [
    WAKE_TYPE,
    '[void][CodeUI.Wake]::PostMessage([IntPtr]0xFFFF,0x0112,[IntPtr]0xF170,[IntPtr](-1))',
    '[void][CodeUI.Wake]::SetThreadExecutionState(2)',
    '[CodeUI.Wake]::mouse_event(1,1,0,0,[UIntPtr]::Zero)',
    '[CodeUI.Wake]::mouse_event(1,-1,0,0,[UIntPtr]::Zero)',
    UNSTICK,
    `$w=$null;if([Threading.EventWaitHandle]::TryOpenExisting('${DISPLAY_WAKE_EVENT}',[ref]$w)){[void]$w.Set()}` +
      'else{$c=New-Object byte[] 128;if([CodeUI.Wake]::GetPwrCapabilities($c) -and $c[20]){\n' +
      WINDOWS_DISPLAY_LIFT_SCRIPT +
      '\n}}'
  ],
  mute: [`Add-Type -IgnoreWarnings -TypeDefinition '${WINDOWS_AUDIO_TYPE}'`, '[CodeUI.Audio]::SetMute($true)'],
  unmute: [`Add-Type -IgnoreWarnings -TypeDefinition '${WINDOWS_AUDIO_TYPE}'`, '[CodeUI.Audio]::SetMute($false)']
}

/** The PowerShell each action runs, before encoding. Exposed for the tests that parse
 *  and compile it; the phone only ever sends buildWindowsHostCommand's output. */
export function windowsHostScript(action: WindowsHostAction): string {
  return ["$ErrorActionPreference='Stop'", ...SCRIPTS[action], DONE].join('\n')
}

/**
 * Why `powershell -EncodedCommand`: the PC's terminal may be PowerShell, cmd or a WSL
 * shell, and no quoting survives all three. Base64 of UTF-16LE has no quotes at all,
 * and `powershell` is Windows PowerShell 5.1, present on every Windows. The same form
 * as the HUD's Windows beacon (CLAUDE_HUD_WINDOWS_COMMAND). -nop, -noni and -enc are
 * -NoProfile, -NonInteractive and -EncodedCommand.
 *
 * Sleep display and Wake display carry the keeper, the covers and the DDC/CI code,
 * and base64 of UTF-16LE costs about 2.7 characters a character: plain, Sleep display
 * no longer fits cmd.exe's 8,191 (Microsoft KB830473; Orca offers cmd as a Windows
 * shell). So those two ship deflated: the script's UTF-8, raw DEFLATE (fflate, on
 * the phone), inside a one-line inflater that Invoke-Expressions it. Nothing is
 * written to the PC's disk; .NET's DeflateStream (System.dll, every Windows
 * PowerShell 5.1) reads the bytes back in memory.
 *
 * The deflated bytes ride as one character each, U+0100 + byte (Latin Extended-A
 * and -B: no quote, no surrogate, nothing PowerShell reads specially inside a
 * single-quoted string), not as base64: inside -EncodedCommand every character
 * costs two bytes of UTF-16 whatever it is, so a byte as one character costs 2.7
 * characters of the command line, and as base64 3.6. `$_-256` takes each back to
 * its byte (PowerShell does char minus int as numbers). The mode is cast, not
 * written as 0: DeflateStream also takes a CompressionLevel there, and PowerShell 7
 * calls a bare 0 ambiguous. An error inside the inflated script stops it as it
 * would plain, so a failure still prints no done marker.
 */
export const COMPRESSED_WINDOWS_ACTIONS: readonly WindowsHostAction[] = ['sleep-display', 'wake-display']

/** The first character of the byte-per-character packing: byte b rides as U+0100 + b. */
export const PACKED_BYTE_BASE = 0x100

/** The inflater around a deflated, packed script, as the PC runs it. */
export function inflatingPowerShell(packed: string): string {
  return `iex([IO.StreamReader]::new([IO.Compression.DeflateStream]::new([IO.MemoryStream][byte[]]('${packed}'.ToCharArray()|%{$_-${PACKED_BYTE_BASE}}),[IO.Compression.CompressionMode]0)).ReadToEnd())`
}

/** A script as raw DEFLATE of its UTF-8, one character per byte. */
export function deflatePowerShell(script: string): string {
  let packed = ''
  for (const byte of deflateSync(Buffer.from(script, 'utf8'), { level: 9 })) {
    packed += String.fromCharCode(PACKED_BYTE_BASE + byte)
  }
  return packed
}

const commandCache = new Map<WindowsHostAction, string>()

export function buildWindowsHostCommand(action: WindowsHostAction): string {
  const cached = commandCache.get(action)
  if (cached) {
    return cached
  }
  const script = windowsHostScript(action)
  const sent = COMPRESSED_WINDOWS_ACTIONS.includes(action) ? inflatingPowerShell(deflatePowerShell(script)) : script
  const command = `powershell -nop -noni -enc ${encodePowerShellCommand(sent)}`
  commandCache.set(action, command)
  return command
}
