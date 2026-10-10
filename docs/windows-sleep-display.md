# Sleep display on Windows

Status: **not yet run on a Windows machine.** Everything below is checked under
PowerShell 7.4 on macOS (scripts parse, C# compiles, the inflater round-trips,
the keeper's PowerShell half and the black covers run against stand-ins). WMI,
DDC/CI, the power request, real windows and Windows PowerShell 5.1's compiler
have not seen any of it.

Code: `mobile/src/host-controls/windows-host-commands.ts` (the scripts the phone
sends) and `windows-display-dim-keeper.ts` (the keeper and the covers).

## Two kinds of PC

The sleep script asks `GetPwrCapabilities` for AoAc (byte 20 of
SYSTEM_POWER_CAPABILITIES) every time it runs.

- **Classic PC (no Modern Standby): unchanged.** It posts SC_MONITORPOWER (off).
  The display really turns off and the PC stays awake.
- **Modern Standby PC (S0 Low Power Idle, most laptops since about 2019):** the
  display is never turned off. Microsoft documents that such a PC enters standby
  whenever its display turns off. On AC a power request holds the "NoCS" phase
  indefinitely, but on battery only for about five minutes.

## History on Modern Standby

| Build / date | What Sleep display did | Result |
| --- | --- | --- |
| up to 2026-10-08 | SC_MONITORPOWER | Danny's laptop went to sleep and the phone lost it |
| 0.9.122 | system request held, then SC_MONITORPOWER | slept anyway |
| 0.9.126 | display timeout (VIDEOIDLE) set to 1 s under a held request | never confirmed on a device; drops after ~5 min on battery |
| 2026-10-10 | dim every screen to 0 and cover each with black, display held on | this document |

The user asked on 2026-10-10: "dim the full Windows screen to zero, and the
external monitor connected too", and then asked for black covers too, because
many panels still glow faintly at brightness 0 and monitors without DDC/CI stay
lit. A display that never turns off never starts Modern Standby, on AC or on
battery.

## What the keeper does

The sleep script starts the keeper as a hidden, detached `powershell` and waits
on a named semaphore (`Local\CUIDim`) for up to 12 s. The keeper's text reaches
the child in an environment variable (`CUIK`, run as `iex $env:CUIK`), not on its
command line: Start-Process goes through ShellExecuteEx, whose parameters are
documented as limited to about 2,048 characters. Nothing is written to the PC's
disk or registry by the phone's code (but see the doubts on brightness below).

1. It retires any keeper still running (`Local\CUIWake`, mutex `Local\CUIKeep`).
2. It holds a power request with **PowerRequestDisplayRequired and
   PowerRequestSystemRequired**. This is Microsoft's documented pair for "the
   display stays on and the system does not sleep", and it also stops Windows'
   own display timeout from turning the display off later.
3. It reads the built-in panel's brightness through WMI
   (`root/WMI WmiMonitorBrightness`), then sets it to 0 (`WmiSetBrightness`).
4. It reads each external monitor's VCP 0x10 (luminance) over DDC/CI through
   dxva2, then sets it to 0. A monitor that does not answer DDC/CI is skipped.
5. It puts a borderless, topmost, black WinForms window on every screen and hides
   the cursor, and installs a low-level keyboard hook that swallows every key
   while covered (otherwise a key pressed at the black screen would reach the
   focused app, often the agent's composer). If WinForms will not load or show,
   it dims only.
6. It tells the script what it did: the semaphore count encodes how many
   displays were dimmed and whether the screens were covered.
7. It holds until Wake display, a touch at the PC (a key, a click, a mouse move
   of more than 8 px, or `GetLastInputInfo` advancing after the first 500 ms),
   the Windows session ending (sign-out, restart), or 12 hours. A display added
   or removed while covered is covered again.
8. On exit (always, in a `finally`) it closes the covers, shows the cursor, puts
   back every brightness it read, and exits. The exit ends the power request. If
   putting a DDC/CI reading back fails (stale handles after a topology change),
   it enumerates the monitors again and lifts any still at 0 to 70%.

The phone's toasts:

- Covered: "Screens off. Tap Wake display or touch the PC to turn them back on."
- Dimmed only (no WinForms): "N display(s) dimmed. Tap Wake display or touch the
  PC to restore."
- Neither worked: "This PC's displays can't be dimmed from here, so nothing was
  changed."
- The keeper never answered: the script signals the wake event (so a keeper that
  got as far as dimming puts everything back) and refuses with "The PC did not
  turn its screens off, so nothing was changed."

While a keeper runs, the probe reports `display=off` (it checks whether the
mutex exists), so the sheet offers Wake display.

## Wake display

Wake display turns the display on as before (SC_MONITORPOWER on,
ES_DISPLAY_REQUIRED, a one-pixel mouse nudge). It repairs a display timeout that
0.9.126 may have left at 1 s, on every PC, and then:

- if a keeper is running, it sets the wake event, and the keeper restores the
  exact readings it took;
- if no keeper is running on a Modern Standby PC (it was killed, or the PC
  restarted mid-hold), it lifts any display that **reads 0** to 70%: 70% of a
  DDC/CI monitor's own maximum, and 70 on the built-in panel's scale. A display
  the user set low on purpose is left alone, and so is everything on a classic
  PC, where nothing is ever dimmed.

## Length

cmd.exe refuses a command line longer than 8,191 characters, and the command is
base64 of UTF-16LE, which costs about 2.7 characters per character. Sleep
display and Wake display are sent as raw DEFLATE of the script (fflate, on the
phone). Each byte rides as one character, U+0100 + byte, inside a one-line
`iex(...DeflateStream...)` inflater. Base64 would cost 3.6 command-line
characters per byte, and this costs 2.7. On 2026-10-10 Sleep display was 7,395
characters and Wake display 4,143; a test pins both below 8,191. The probe is
not compressed and is 8,179 (its flags and `-Ig` were shortened to make room for
the keeper check).

## Rejected

- **DDC/CI VCP 0xD6 (power mode):** some monitors do not wake from software once
  in standby, and some firmware hangs on it.
- **SetDeviceGammaRamp to black:** Windows silently rejects near-black ramps, and
  resets the ramp on any display change.
- **Magnification API full-screen colour effect:** it does not catch input, so
  clicks land blindly in the apps underneath.

## Known doubts

- A built-in panel at WMI brightness 0 often still has a faint backlight. The
  covers are what makes it black.
- DDC/CI support varies by monitor, and some docks and adapters do not pass it
  through. Monitors without it rely on the covers alone.
- The hidden keeper may be refused the foreground, so a cover is not guaranteed
  keyboard focus. The low-level keyboard hook is what swallows keys; if Windows
  refuses the hook, a key reaches the app underneath (it still ends the hold).
  A click always lands on a cover. A keyboard hook in a hidden PowerShell is also
  a shape endpoint security may flag.
- WMI brightness is likely saved by Windows in the power scheme and DDC/CI
  brightness in the monitor. A keeper killed without warning (power loss, a
  crash, Task Manager) leaves them at 0 across a restart, until Wake display's
  fallback lifts them. A normal sign-out or restart ends the hold first.
- Windows may raise the panel's brightness itself during the hold (adaptive
  brightness, plugging into AC). The covers hide that; dim-only mode does not.
- 12 s for the keeper to answer is not timed on a real PC: two csc.exe compiles on
  a cold Windows PowerShell 5.1 can be slow.
- After Wake display, the keeper's mutex lives until it has restored (DDC/CI can
  take a second or two). A probe in that window still reads the screens as off.
- With the display held on, Windows never reaches "turn off display" or the
  sign-in it may require after that. A covered PC stays unlocked until it is
  touched. Lock PC is the separate row for that.
- `iex` over a deflated payload is a shape that endpoint security sometimes
  flags. AMSI sees the inflated script, which is plain.
- Any input-injecting software on the PC (a mouse jiggler, remote-control tools)
  ends the hold early.
