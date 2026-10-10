# Sleep display on Windows: removed

On 2026-10-10 the user decided: "Completely remove Sleep display features from
Windows devices." A Windows host's sheet now offers **Lock PC** and
**Mute/Unmute PC** only, on every PC. The Mac keeps Sleep display and Wake
display, unchanged.

## What was tried

| Build / date | What Sleep display did on Windows | Result |
| --- | --- | --- |
| up to 2026-10-08 | SC_MONITORPOWER (display off) | Danny's Modern Standby laptop went to sleep and the phone lost it |
| 0.9.118 | the row hidden on Modern Standby PCs | no Sleep display on most laptops |
| 0.9.121 | a held system power request, then SC_MONITORPOWER | slept anyway (seen on 0.9.122) |
| 0.9.124 | hidden again on Modern Standby PCs | |
| 0.9.126 | display timeout (VIDEOIDLE) set to 1 s under a held request, so Windows' own idle route turned the display off | never confirmed on a device; a request lasts about 5 min on battery |
| win-dim (never released) | every screen dimmed to 0 (WMI, DDC/CI) and covered with a black topmost window, display held on | never run on a Windows machine |

The root problem: on a PC with Modern Standby (S0 Low Power Idle, most laptops
since about 2019) the display going off **is** the start of standby, and
Microsoft documents no supported way for a program to turn the display off
while keeping the PC awake on battery. The dim-and-cover route avoided turning
anything off, but it needed a hidden keeper process, a keyboard hook, brightness
writes that Windows may persist across a restart, and a compressed `iex`
payload to fit cmd.exe's 8,191-character limit. None of it was ever run on a
real PC.

## What was removed

- The Sleep display and Wake display actions for Windows (`WindowsHostAction`
  is now `lock | mute | unmute`), their scripts, the dim keeper
  (`windows-display-dim-keeper.ts`), the deflate-and-inflate command packing,
  the dim report and its toasts, and the `keepawake` / `nodim` refusals.
- The display state and Modern Standby reads in the Windows probe. It now
  prints `CUIWIN mute=<true|false|unknown> end`. The parser still accepts the
  old `… display=… standby=…` line for its mute alone, though the phone only
  reads the tab it opened with its own command, so it should never see one.
- `sleepsWithDisplay` on the host state.

## Leftovers on users' PCs

- **0.9.126's display timeout.** If its keeper was killed while waiting, the PC
  kept "Turn off display after" at 1 s. Wake display used to put a 1 s value
  back to Windows' defaults (10 min on AC, 5 on battery). That repair was
  **not** carried into the probe: it took the probe to 7,667 of cmd.exe's
  8,191 characters, it would make a read-only probe write the power plan on
  every open of the sheet, and its C# has never been compiled by Windows
  PowerShell 5.1. An affected PC is fixed in Settings → System → Power →
  Screen timeout.
- **win-dim** was never released, so no PC has its keeper, covers or dimmed
  brightness.
