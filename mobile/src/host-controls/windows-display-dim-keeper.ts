/**
 * Sleep display on a Windows PC with Modern Standby (S0 Low Power Idle), where the
 * display turning off IS the start of standby.
 *
 * History. On 2026-10-08 Sleep display (SC_MONITORPOWER) put Danny's whole laptop
 * to sleep and the phone lost it: Microsoft documents that a Modern Standby PC
 * enters standby whenever the display turns off. 0.9.122 held a system power
 * request first and the laptop slept anyway. 0.9.126 turned the display off by
 * Windows' own idle route (display timeout set to 1 s under a held request); a
 * request holds the "NoCS" phase indefinitely on AC but only about five minutes on
 * battery, and that build was never confirmed on a device.
 *
 * 2026-10-10, the user: "dim the full Windows screen to zero, and the external
 * monitor connected too". A display that never turns off never starts Modern
 * Standby, on AC or on battery. So on such a PC Sleep display no longer turns
 * anything off. Then, the same day, to cover the two limits of dimming (many panels
 * still glow faintly at brightness 0, and a monitor without DDC/CI stays lit): a
 * black window over every screen as well.
 *
 * What the keeper does, started hidden and detached by the sleep script
 * (windows-host-commands.ts):
 *   1. Begin: signals a keeper still running to stop (the wake event) and waits for
 *      it to let go of the single-instance mutex; holds a power request with
 *      PowerRequestDisplayRequired (0) AND PowerRequestSystemRequired (1), the pair
 *      Microsoft documents for "the display stays on and the system does not
 *      sleep", so Windows' own display timeout cannot turn the display off later
 *      and start standby; and checks the sleep script is still waiting (it opens
 *      the ready semaphore, gone once the script has given up and refused).
 *   2. Reads, then dims to 0, the built-in panel through WMI (root/WMI
 *      WmiMonitorBrightness.CurrentBrightness, then
 *      WmiMonitorBrightnessMethods.WmiSetBrightness), in PowerShell.
 *   3. Dim: reads, then dims to 0, every external monitor over DDC/CI (VCP 0x10,
 *      luminance, through dxva2: EnumDisplayMonitors, then each HMONITOR's
 *      physical monitors). A monitor that does not answer DDC/CI is skipped and
 *      not counted. The readings stay in memory, never on disk.
 *   4. Cover (its own compile, WINDOWS_DISPLAY_COVER_MEMBERS): a borderless, topmost,
 *      black window on every screen, cursor hidden, keys swallowed by a low-level
 *      keyboard hook, on a WinForms message loop. If
 *      WinForms will not load or show, the keeper dims only, and says so.
 *   5. Tells the sleep script what it did through the ready semaphore: it releases
 *      1 + 2 x (displays dimmed) + (1 when covered), so the script reads the count
 *      and the cover from one number. 0 dimmed and no cover: the script refuses
 *      ("can't be dimmed from here") and the keeper exits, having changed nothing.
 *   6. Holds until the first of: Wake display (the wake event), the user touching
 *      the PC (a key or click on a cover, the mouse moving more than a few pixels,
 *      or GetLastInputInfo advancing; the display never went off, so unlike the Mac
 *      there is no display-on to wait for), the Windows session ending, or 12 hours. A display added or removed
 *      while covered is covered again.
 *   7. Then ALWAYS (a finally) closes the covers, shows the cursor, and puts every
 *      brightness it read back, and exits; the exit ends the power request.
 *
 * Classic PCs (no Modern Standby) are not touched by any of this: they keep the
 * SC_MONITORPOWER post, where the display really turns off.
 *
 * Rejected, with reasons:
 *   - DDC/CI VCP 0xD6 (power mode): some monitors do not wake from software once in
 *     standby, and some firmware hangs on it.
 *   - SetDeviceGammaRamp to black: Windows silently rejects near-black ramps, and
 *     resets the ramp on any display change.
 *   - The Magnification API's full-screen colour effect: it does not catch input,
 *     so clicks land blindly in the apps underneath.
 *
 * A dead keeper (killed mid-hold) leaves the displays at 0 and the covers gone with
 * its process. Wake display then lifts a display that reads 0 to 70%
 * (WINDOWS_DISPLAY_LIFT_SCRIPT), and leaves one the user set low on purpose alone.
 *
 * NOT YET RUN ON A WINDOWS MACHINE. PowerShell 7 on macOS parses every script and
 * compiles the C# (the cover against WinForms stand-ins, since WinForms does not
 * exist there); WMI, DDC/CI, the power request, the windows and the input reads
 * need Windows, and Windows PowerShell 5.1's older compiler has not seen any of it.
 */

/** Released by the keeper once it has dimmed and covered what it could; the sleep
 *  script creates it and waits. A semaphore, not an event, because its count
 *  carries the answer (step 5 above). A new name: 0.9.126's ready object was an
 *  event called Local\CUIOff, and a name of another kind cannot be reopened. */
export const DIM_READY_SEMAPHORE = 'Local\\CUIDim'
/** Set by Wake display (and by a new keeper, and by a sleep script giving up) to end
 *  a running keeper at once. 0.9.126's keeper listens to the same name, so a new
 *  keeper retires one of those too. */
export const DISPLAY_WAKE_EVENT = 'Local\\CUIWake'
/** Held by a running keeper for its whole life; the probe reads its existence as
 *  "the screens are off" (windows-host-state.ts). */
export const KEEPER_MUTEX = 'Local\\CUIKeep'
/** How often the dim-only hold loop looks for Wake display and a touch, and resets
 *  the system idle timer. A second's lag letting go costs nothing. */
export const IDLE_RESET_EVERY_MS = 1_000
/** How often the covered hold's WinForms timer does the same. */
export const COVER_TICK_MS = 250
/** Input in the first half second of the covers is not a touch: Windows sends a
 *  MouseMove to a window that appears under the cursor. */
export const COVER_INPUT_GRACE_MS = 500
/** How far the mouse must move, in pixels on either axis, to count as a touch. */
export const COVER_MOVE_PX = 8
/** The longest the keeper holds, counted in turns of its loop (each at least the
 *  loop's interval), which can only run a little long, never short. */
export const HOLD_CAP_MS = 12 * 60 * 60 * 1000
/** VCP code 0x10, luminance (brightness), in the MCCS standard. */
export const VCP_BRIGHTNESS = 0x10
/** What Wake display lifts a display left at 0 to, with no keeper to put back the
 *  reading: 70% of the monitor's own maximum, or 70 on the built-in panel's scale. */
export const FALLBACK_BRIGHTNESS_PERCENT = 70

/**
 * The physical monitors behind every display Windows knows, through dxva2, shared
 * by the keeper and Wake display's fallback. -MemberDefinition members (the class
 * and the System and InteropServices usings come from Add-Type; List from
 * -UsingNamespace System.Collections.Generic). C# 5 for Windows PowerShell 5.1, free
 * of single quotes: it sits inside one.
 *
 * M is PHYSICAL_MONITOR: a HANDLE and WCHAR[128], declared pack(1) in the header
 * but with no padding to remove on either x86 (260 bytes) or x64 (264); the
 * description is carried as 64 ints because it is never read. The lambda is
 * MONITORENUMPROC, called synchronously inside EnumDisplayMonitors, so the
 * marshalled delegate lives as long as it is needed. The physical monitor handles
 * are never destroyed by hand: the keeper needs them until it puts the readings
 * back, and the process exit releases them.
 */
export const WINDOWS_MONITOR_MEMBERS = [
  'public struct M{public IntPtr h;[MarshalAs(UnmanagedType.ByValArray,SizeConst=64)]public int[] d;}',
  'delegate bool E(IntPtr m,IntPtr d,IntPtr r,IntPtr p);',
  '[DllImport("user32")]static extern bool EnumDisplayMonitors(IntPtr d,IntPtr c,E f,IntPtr p);',
  '[DllImport("dxva2")]static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr m,out int n);',
  '[DllImport("dxva2")]static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr m,int n,[Out]M[] a);',
  '[DllImport("dxva2")]static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr h,byte c,IntPtr t,out int v,out int x);',
  '[DllImport("dxva2")]static extern bool SetVCPFeature(IntPtr h,byte c,int v);',
  'static List<IntPtr> Monitors(){var a=new List<IntPtr>();',
  'EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,(m,d,r,p)=>{int n;if(GetNumberOfPhysicalMonitorsFromHMONITOR(m,out n)&&n>0){var b=new M[n];if(GetPhysicalMonitorsFromHMONITOR(m,n,b))foreach(var x in b)a.Add(x.h);}return true;},IntPtr.Zero);',
  'return a;}'
].join('')

/**
 * The keeper's core C#, CodeUI.Keeper: the power request, DDC/CI, and the dim-only
 * hold. R is REASON_CONTEXT with POWER_REQUEST_CONTEXT_SIMPLE_STRING (flag 1); a
 * request handle below 1 is a failed create (NULL or INVALID_HANDLE_VALUE). L is
 * LASTINPUTINFO (cbSize 8, then the tick of the last input). o holds each dimmed
 * monitor's reading. w, y and u live in static fields so nothing the GC finalises
 * closes them mid-hold: a closed mutex handle would let a second keeper start, and
 * the probe would read the screens as on. w and y are public so the script can hand
 * them to the cover, a separate compile that cannot see this type. y is closed the
 * moment the keeper has released it (review, 2026-10-10): a handle kept for the
 * hold kept the count alive, and the next Sleep display read this run's answer at
 * once and printed done after doing nothing. The script's own handle keeps the
 * semaphore alive until it has read it.
 *
 * Restore (review, 2026-10-10): after a topology change mid-hold the physical
 * monitor handles are stale and a restore through them fails silently, with no
 * keeper left for Wake display to tell. So a failed restore enumerates the monitors
 * again and lifts any still at 0 to 70%, as Wake display's fallback does.
 *
 * Nothing is released by hand: the script returns, the process exits, and the exit
 * closes the request handle (ending the request) and the mutex. A mutex left that
 * way is abandoned, which the next keeper's WaitOne takes as acquired (the catch).
 */
export const WINDOWS_DISPLAY_DIM_KEEPER_MEMBERS = [
  WINDOWS_MONITOR_MEMBERS,
  'struct R{public int v,f;[MarshalAs(UnmanagedType.LPWStr)]public string s;}',
  'struct L{public int t,c;}',
  '[DllImport("kernel32")]static extern IntPtr PowerCreateRequest(ref R r);',
  '[DllImport("kernel32")]static extern bool PowerSetRequest(IntPtr h,int t);',
  '[DllImport("kernel32")]static extern int SetThreadExecutionState(int f);',
  '[DllImport("user32")]static extern bool GetLastInputInfo(ref L l);',
  'public static EventWaitHandle w;public static Semaphore y;static Mutex u;',
  'static Dictionary<IntPtr,int> o=new Dictionary<IntPtr,int>();',
  'public static bool Begin(){',
  `w=new EventWaitHandle(false,EventResetMode.ManualReset,@"${DISPLAY_WAKE_EVENT}");w.Set();`,
  `u=new Mutex(false,@"${KEEPER_MUTEX}");`,
  'try{if(!u.WaitOne(5000))return false;}catch(AbandonedMutexException){}',
  'w.Reset();',
  'var r=new R{f=1,s="Code UI"};var q=PowerCreateRequest(ref r);',
  'if((long)q<1||!PowerSetRequest(q,0)||!PowerSetRequest(q,1))return false;',
  `return Semaphore.TryOpenExisting(@"${DIM_READY_SEMAPHORE}",out y);}`,
  'public static int Dim(){int n=0;',
  `foreach(var h in Monitors()){int v,x;if(GetVCPFeatureAndVCPFeatureReply(h,${VCP_BRIGHTNESS},IntPtr.Zero,out v,out x)&&SetVCPFeature(h,${VCP_BRIGHTNESS},0)){o[h]=v;n++;}}`,
  'return n;}',
  'public static void Hold(int n){',
  'y.Release(n*2+1);y.Close();if(n<1)return;',
  'var l=new L{t=8};GetLastInputInfo(ref l);int s=l.c;',
  `for(int j=0;j++<${HOLD_CAP_MS / IDLE_RESET_EVERY_MS}&&!w.WaitOne(${IDLE_RESET_EVERY_MS});){SetThreadExecutionState(1);if(GetLastInputInfo(ref l)&&l.c!=s)return;}}`,
  `public static void Restore(){bool f=false;foreach(var e in o)if(!SetVCPFeature(e.Key,${VCP_BRIGHTNESS},e.Value))f=true;`,
  `if(f)foreach(var h in Monitors()){int v,x;if(GetVCPFeatureAndVCPFeatureReply(h,${VCP_BRIGHTNESS},IntPtr.Zero,out v,out x)&&v==0)SetVCPFeature(h,${VCP_BRIGHTNESS},(x>0?x:100)*${FALLBACK_BRIGHTNESS_PERCENT}/100);}}`
].join('')

/**
 * The black covers, CodeUI.Cover, compiled on their own with WinForms referenced, so
 * a PC (or a compiler) that refuses WinForms costs the covers alone, never the dim.
 *
 * Run(w, y, n) covers every screen, hides the cursor, tells the sleep script (the
 * semaphore's count carries "covered": n x 2 + 2), and runs a message loop until a
 * touch, the wake event, or the cap; then closes the covers and shows the cursor
 * (a finally), and returns true. It returns false only when no cover could be
 * shown, having told the script nothing, so the keeper falls back to the dim-only
 * hold. An exception inside the loop still returns true: the script has been told
 * "covered", and holding dim-only after that would leave the phone's toast wrong.
 *
 * Input: KeyDown (KeyPreview, so any control's key counts) and MouseDown on any
 * cover, MouseMove more than COVER_MOVE_PX from where the cursor was, and the timer
 * reading GetLastInputInfo, whose value in the first COVER_INPUT_GRACE_MS is the
 * baseline. The last also catches a key that went to another window: a hidden,
 * detached process may be refused the foreground, so a cover is not guaranteed the
 * keyboard focus (the key then reaches the app below; the touch still ends it).
 * The wake event and the cap are polled by a WinForms timer on the loop's own
 * thread, so nothing is marshalled. DisplaySettingsChanged may arrive on
 * SystemEvents' own thread, so it only raises a flag the timer acts on.
 * System.Windows.Forms.Timer is written in full: System.Threading has a Timer too.
 * The timer also resets the system idle timer, as the dim-only hold does.
 *
 * Keys (review, 2026-10-10): a low-level keyboard hook (WH_KEYBOARD_LL, 13) on this
 * thread, whose message loop is what calls it, swallows every key while covered
 * (returns 1) and the first ends the hold. Without it a key pressed at the black
 * screen went to whatever app kept the focus, often the agent's composer. kb lives
 * in a static field so the GC never collects the delegate Windows holds; the hook
 * is removed in the finally (and with the process, whatever happens). The lambda's
 * parameters are not w and l: C# 5 refuses a lambda parameter that shadows Run's w.
 * Mouse clicks need no hook: they land on the topmost cover.
 *
 * Session end (review, 2026-10-10): a sign-out or restart mid-hold would kill the
 * keeper before its finally and leave the displays at 0 after the next sign-in.
 * SessionEnding ends the hold first, so the readings go back while there is time.
 */
export const WINDOWS_DISPLAY_COVER_MEMBERS = [
  'struct L{public int t,c;}',
  'public delegate IntPtr K(int c,IntPtr w,IntPtr l);',
  '[DllImport("kernel32")]static extern int SetThreadExecutionState(int f);',
  '[DllImport("user32")]static extern bool GetLastInputInfo(ref L l);',
  '[DllImport("user32")]static extern IntPtr SetWindowsHookEx(int i,K f,IntPtr m,int t);',
  '[DllImport("user32")]static extern bool UnhookWindowsHookEx(IntPtr h);',
  '[DllImport("user32")]static extern IntPtr CallNextHookEx(IntPtr h,int c,IntPtr w,IntPtr l);',
  '[DllImport("kernel32")]static extern IntPtr GetModuleHandle(string n);',
  'static K kb;static IntPtr hk;',
  'static List<Form> f=new List<Form>();static ApplicationContext a;static bool d;static Point p;static int t0;',
  'static void Stop(){if(a!=null)a.ExitThread();}',
  'static void Uncover(){foreach(var x in f)x.Close();f.Clear();}',
  'static void Over(){Uncover();foreach(var s in Screen.AllScreens){var x=new Form();',
  'x.BackColor=Color.Black;x.FormBorderStyle=FormBorderStyle.None;x.TopMost=true;x.ShowInTaskbar=false;',
  'x.StartPosition=FormStartPosition.Manual;x.Bounds=s.Bounds;x.KeyPreview=true;',
  'x.KeyDown+=(o,e)=>Stop();x.MouseDown+=(o,e)=>Stop();',
  `x.MouseMove+=(o,e)=>{var q=Cursor.Position;if(Environment.TickCount-t0>${COVER_INPUT_GRACE_MS}&&(Math.Abs(q.X-p.X)>${COVER_MOVE_PX}||Math.Abs(q.Y-p.Y)>${COVER_MOVE_PX}))Stop();};`,
  'f.Add(x);x.Show();x.Bounds=s.Bounds;}',
  'if(f.Count>0)f[0].Activate();}',
  'public static bool Run(EventWaitHandle w,Semaphore y,int n){a=new ApplicationContext();',
  'try{Over();}catch{Uncover();return false;}',
  'if(f.Count<1)return false;',
  'Cursor.Hide();p=Cursor.Position;t0=Environment.TickCount;',
  'var l=new L{t=8};int s=0;int k=0;',
  `var m=new System.Windows.Forms.Timer();m.Interval=${COVER_TICK_MS};`,
  'm.Tick+=(o,e)=>{SetThreadExecutionState(1);',
  `if(w.WaitOne(0)||++k>${HOLD_CAP_MS / COVER_TICK_MS}){Stop();return;}`,
  'if(d){d=false;Over();}',
  `GetLastInputInfo(ref l);if(Environment.TickCount-t0<${COVER_INPUT_GRACE_MS})s=l.c;else if(l.c!=s)Stop();};`,
  'EventHandler h=(o,e)=>{d=true;};SystemEvents.DisplaySettingsChanged+=h;',
  'SessionEndingEventHandler se=(o,e)=>Stop();SystemEvents.SessionEnding+=se;',
  'kb=(c,w2,l2)=>{if(c>=0){Stop();return (IntPtr)1;}return CallNextHookEx(hk,c,w2,l2);};',
  'hk=SetWindowsHookEx(13,kb,GetModuleHandle(null),0);',
  'y.Release(n*2+2);y.Close();m.Start();',
  'try{Application.Run(a);}catch{}finally{m.Stop();if(hk!=IntPtr.Zero)UnhookWindowsHookEx(hk);',
  'SystemEvents.DisplaySettingsChanged-=h;SystemEvents.SessionEnding-=se;Uncover();Cursor.Show();}',
  'return true;}'
].join('')

/** The cover's compile and run, as one keeper statement whose failure (WinForms
 *  absent, a compile error, a throw) leaves $c false, which falls back to dimming
 *  only. Exported so the real-PowerShell tests can stand WinForms in for it. */
export const WINDOWS_DISPLAY_COVER_STATEMENT =
  'try{Add-Type -IgnoreWarnings -ReferencedAssemblies System.Windows.Forms,System.Drawing -Namespace CodeUI -Name Cover ' +
  '-UsingNamespace System.Threading,System.Collections.Generic,System.Windows.Forms,System.Drawing,Microsoft.Win32 ' +
  `-MemberDefinition '${WINDOWS_DISPLAY_COVER_MEMBERS}';$c=[CodeUI.Cover]::Run([CodeUI.Keeper]::w,[CodeUI.Keeper]::y,$n)}catch{}`

/** The keeper's core compile, as its own line, for the same reason. */
export const WINDOWS_DISPLAY_KEEPER_TYPE =
  'Add-Type -IgnoreWarnings -Namespace CodeUI -Name Keeper -UsingNamespace System.Threading,System.Collections.Generic ' +
  `-MemberDefinition '${WINDOWS_DISPLAY_DIM_KEEPER_MEMBERS}'`

/**
 * The keeper as the hidden `powershell` runs it. WMI is PowerShell's Get-WmiObject
 * (Windows PowerShell 5.1 has it; C# would need System.Management referenced): the
 * readings by InstanceName, then only the methods objects with a reading, so each
 * dimmed panel has a value to go back to. A PC with no WMI brightness (most desktops)
 * throws there, which the try swallows. The finally puts every panel it read back,
 * then every DDC/CI monitor, however the hold ended. 'Stop', so a compile failure of
 * the core ends the keeper before anything is changed, and the sleep script, told
 * nothing, refuses.
 */
export const WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  WINDOWS_DISPLAY_KEEPER_TYPE,
  'if([CodeUI.Keeper]::Begin()){$o=@{};$m=@();try{',
  'try{Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness|%{$o[$_.InstanceName]=$_.CurrentBrightness};' +
    '$m=@(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods|?{$o.ContainsKey($_.InstanceName)})}catch{}',
  '$n=0;foreach($i in $m){try{[void]$i.WmiSetBrightness(1,0);$n++}catch{}}',
  '$n+=[CodeUI.Keeper]::Dim();$c=$false',
  WINDOWS_DISPLAY_COVER_STATEMENT,
  'if(!$c){[CodeUI.Keeper]::Hold($n)}}finally{foreach($i in $m){try{[void]$i.WmiSetBrightness(1,$o[$i.InstanceName])}catch{}};[CodeUI.Keeper]::Restore()}}'
].join('\n')

/**
 * Wake display's fallback when no keeper is running on a Modern Standby PC: a
 * DDC/CI monitor that reads 0 goes to 70% of its own maximum (100 when it reports
 * none), a built-in panel that reads 0 goes to 70, and anything else is left alone,
 * so a display the user set low on purpose is never brightened. Each line is its
 * own try: a failure here must never stop Wake display.
 */
export const WINDOWS_DISPLAY_LIFT_SCRIPT = [
  'try{Add-Type -IgnoreWarnings -Namespace CodeUI -Name Lift -UsingNamespace System.Collections.Generic -MemberDefinition ' +
    `'${WINDOWS_MONITOR_MEMBERS}public static void Run(){foreach(var h in Monitors()){int v,x;` +
    `if(GetVCPFeatureAndVCPFeatureReply(h,${VCP_BRIGHTNESS},IntPtr.Zero,out v,out x)&&v==0)SetVCPFeature(h,${VCP_BRIGHTNESS},(x>0?x:100)*${FALLBACK_BRIGHTNESS_PERCENT}/100);}}';` +
    '[CodeUI.Lift]::Run()}catch{}',
  'try{$z=@{};Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness|?{$_.CurrentBrightness -eq 0}|%{$z[$_.InstanceName]=1};' +
    `Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods|?{$z.ContainsKey($_.InstanceName)}|%{[void]$_.WmiSetBrightness(1,${FALLBACK_BRIGHTNESS_PERCENT})}}catch{}`
].join('\n')

// ─── 0.9.126's display timeout, repaired by Wake display ─────────────────────
// 0.9.126 set "Turn off display after" to 1 s while its keeper waited for the
// display to go off. A keeper killed in that window left the PC at 1 s, and the
// display went off a second after every touch. 1 s is never a user's value (Windows
// offers nothing under a minute), so Wake display still puts a 1 s timeout back to
// Windows' default, on every PC, for as long as PCs that ran that build exist.

/** GUID_VIDEO_SUBGROUP and GUID_VIDEO_POWERDOWN_TIMEOUT ("Turn off display after"). */
export const VIDEO_SUBGROUP = '7516b95f-f776-4464-8c53-06167f40cc99'
export const VIDEO_IDLE = '3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e'
/** Windows' default "Turn off display after", in seconds: 10 min on AC, 5 on battery. */
export const VIDEO_IDLE_DEFAULT_AC_S = 600
export const VIDEO_IDLE_DEFAULT_DC_S = 300

/**
 * C# using aliases, I for IntPtr and G for Guid, passed through Add-Type
 * -UsingNamespace, which writes each entry as `using <entry>;` above the members.
 * Checked under PowerShell 7.4; not yet run under Windows PowerShell 5.1, which is
 * why the repair compiles inside a try of its own.
 */
export const USING_ALIASES = 'I=System.IntPtr,G=System.Guid'

/** powrprof's scheme calls. r is always NULL (the root power key); s is the scheme
 *  from PowerGetActiveScheme. z is never assigned (NULL); public, because the
 *  compiler warns about a private field never assigned. */
const SCHEME_IMPORTS = [
  '[DllImport(W)]static extern int PowerGetActiveScheme(I r,out I s);',
  '[DllImport(W)]static extern int PowerSetActiveScheme(I r,I s);',
  ...['AC', 'DC'].flatMap((power) => [
    `[DllImport(W)]static extern int PowerRead${power}ValueIndex(I r,I s,ref G b,ref G g,out int v);`,
    `[DllImport(W)]static extern int PowerWrite${power}ValueIndex(I r,I s,ref G b,ref G g,int v);`
  ]),
  `public static I z,s;static G b=new G("${VIDEO_SUBGROUP}"),n=new G("${VIDEO_IDLE}");`
].join('')

/**
 * The repair, as -MemberDefinition members of CodeUI.Fix: a value of exactly 1 s
 * goes back to Windows' default, on AC and on DC, and the scheme is applied. Any
 * other value is left alone, and a scheme with nothing to repair is not applied
 * again either. Return codes, not exceptions: a failed call changes nothing.
 */
export const WINDOWS_VIDEO_IDLE_UNSTICK_MEMBERS = [
  'const string K="kernel32",W="powrprof";',
  '[DllImport(K)]static extern I LocalFree(I p);',
  SCHEME_IMPORTS,
  'public static void Unstick(){int v;bool f=false;if(PowerGetActiveScheme(z,out s)!=0)return;',
  `if(PowerReadACValueIndex(z,s,ref b,ref n,out v)==0&&v==1){PowerWriteACValueIndex(z,s,ref b,ref n,${VIDEO_IDLE_DEFAULT_AC_S});f=true;}`,
  `if(PowerReadDCValueIndex(z,s,ref b,ref n,out v)==0&&v==1){PowerWriteDCValueIndex(z,s,ref b,ref n,${VIDEO_IDLE_DEFAULT_DC_S});f=true;}`,
  'if(f)PowerSetActiveScheme(z,s);LocalFree(s);}'
].join('')
