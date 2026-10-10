import { encodePowerShellCommand } from '../session/agent-hud-launch-args'
import type { MacHostAction } from './mac-host-commands'

/**
 * The one-tap controls a Windows host gets: Lock PC and Mute/Unmute.
 *
 * Why no Unlock: Windows takes a password only on its own sign-in screen, from the
 * keyboard or from a sign-in component an administrator installed on the PC. Nothing
 * a program on the PC runs can type into it, so there is no zero-install Unlock, and
 * the sheet offers Lock PC alone, whatever state the PC is in (mac-host-sheet-actions.ts).
 *
 * Why no Sleep display or Wake display: removed by the user on 2026-10-10. On a PC
 * with Modern Standby the display going off starts standby, so Sleep display slept
 * laptops (2026-10-08, 0.9.122), and neither Windows' idle route (0.9.126) nor
 * dimming and covering the screens was ever confirmed on a PC. What was tried is in
 * docs/windows-sleep-display.md.
 */
export type WindowsHostAction = Exclude<MacHostAction, 'unlock' | 'sleep-display' | 'wake-display'>

export const WINDOWS_HOST_ACTIONS: readonly WindowsHostAction[] = ['lock', 'mute', 'unmute']

/** Whether a sheet row's action is one a Windows host runs. */
export function isWindowsHostAction(action: MacHostAction): action is WindowsHostAction {
  return (WINDOWS_HOST_ACTIONS as readonly MacHostAction[]).includes(action)
}

export const WINDOWS_HOST_ACTION_LABELS: Record<WindowsHostAction, string> = {
  lock: 'Lock PC',
  mute: 'Mute PC',
  unmute: 'Unmute PC'
}

export const WINDOWS_HOST_ACTION_PROGRESS: Record<WindowsHostAction, string> = {
  lock: 'Locking the PC…',
  mute: 'Muting the PC…',
  unmute: 'Unmuting the PC…'
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

const SCRIPTS: Record<WindowsHostAction, string[]> = {
  lock: [
    'Add-Type -IgnoreWarnings -Namespace CodeUI -Name Session -MemberDefinition ' +
      "'[DllImport(\"user32.dll\")] public static extern bool LockWorkStation();'",
    "if(-not [CodeUI.Session]::LockWorkStation()){throw 'LockWorkStation refused'}"
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
 * -NoProfile, -NonInteractive and -EncodedCommand. Every command stays under cmd.exe's
 * 8,191 characters (Microsoft KB830473; Orca offers cmd as a Windows shell), pinned
 * by the tests.
 */
export function buildWindowsHostCommand(action: WindowsHostAction): string {
  return `powershell -nop -noni -enc ${encodePowerShellCommand(windowsHostScript(action))}`
}
