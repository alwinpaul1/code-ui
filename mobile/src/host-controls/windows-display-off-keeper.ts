/**
 * Sleep display on a Windows PC with Modern Standby (S0 Low Power Idle), where the
 * display going off is otherwise the start of standby.
 *
 * Why it exists: on 2026-10-08 Sleep display put Danny's whole laptop to sleep and
 * the phone lost it. Microsoft documents that an AoAc system "will automatically
 * enter modern standby when the display goes off", and SC_MONITORPOWER is what
 * turned it off. On 2026-10-10 Danny asked for it back: "keep the display off, not
 * the Windows system off ... same like Mac". 0.9.121 held a power request and then
 * posted SC_MONITORPOWER, and on 0.9.122 his laptop slept anyway: there, a display
 * a program turns off starts standby whatever is held.
 *
 * So the display now goes off by Windows' own idle route, the one Microsoft
 * documents a power request being honoured for (a request keeps the system in S0
 * when the display goes off by idle timeout; it is dropped on user-initiated sleep:
 * lid, power button, Start > Sleep, which still sleep the PC as they should). The
 * same route as github.com/itsnateai/displayoff and
 * github.com/QXiaoLingShang/win-monitor-off, the second of which holds the same
 * PowerRequestSystemRequired so the idle display-off does not become standby.
 *
 * How: the sleep script (windows-host-commands.ts) starts this keeper as a hidden,
 * detached `powershell`. The keeper
 *   1. signals any keeper still running to stop (the wake event), and waits for it
 *      to let go of the single-instance mutex, so keepers never stack;
 *   2. holds a power request: PowerCreateRequest + PowerSetRequest
 *      (PowerRequestSystemRequired = 1; PowerRequestExecutionRequired = 3 as well,
 *      best effort, a refusal of it is not fatal);
 *   3. subscribes to GUID_CONSOLE_DISPLAY_STATE (the same callback subscription as
 *      the probe's WINDOWS_DISPLAY_NAMESPACE, windows-host-state.ts);
 *   4. checks the sleep script is still waiting (it opens the ready event, which is
 *      gone once the script has given up and refused), so nothing is changed behind
 *      a refusal;
 *   5. reads the active scheme's display-idle timeout (VIDEOIDLE in SUB_VIDEO), AC
 *      and DC, through powrprof (locale-free; powercfg's text is never parsed),
 *      writes 1 second to both and applies the scheme;
 *   6. waits until the display reports off (0), at most OFF_WITHIN_MS, or until the
 *      sleep script gives up (it sets the ready event itself then: review,
 *      2026-10-10, a keeper slow to start could otherwise turn the display off
 *      behind the script's refusal); then ALWAYS writes the originals back and
 *      applies them (a finally). A dimmed display (2) is not off: putting the
 *      timeout back then would leave it dimmed and never off. A Wake display in
 *      this wait turns the display on and repairs the 1 s timeout (Unstick), and
 *      the wait runs out;
 *   7. sets the ready event only if the display did report off, so the sleep script
 *      prints done only then; otherwise it exits and the script refuses (keepawake:
 *      "The display did not turn off, so nothing was changed.");
 *   8. holds the PC until whichever comes first: the wake event (Wake display sets
 *      it after it turns the display on), the display reporting on (Wake display, or
 *      mouse or keyboard at the PC, as on the Mac), or 12 hours; then exits, and
 *      the exit ends the request and the subscription (see the members' note).
 *
 * A dead keeper: one killed between step 5 and step 6 leaves the scheme at 1 s, and
 * the display would go off a second after every touch. 1 s is never a user's value
 * (Windows offers nothing under a minute), so a keeper that reads 1 does not save it
 * as the original: it restores Windows' defaults instead, 10 minutes on AC and 5 on
 * battery (VIDEO_IDLE_DEFAULT_*). Wake display repairs a stuck 1 s the same way on
 * every PC (WINDOWS_VIDEO_IDLE_UNSTICK_MEMBERS), so Wake always leaves the PC sane.
 *
 * On battery: PowerSetRequest's documentation says that on Modern Standby on DC,
 * system and execution requests are terminated five minutes after the system sleep
 * timeout expires. That timeout counts from the last system activity, so the hold
 * loop calls SetThreadExecutionState(ES_SYSTEM_REQUIRED) every second, without
 * ES_CONTINUOUS: a one-shot reset of the system idle timer, which never lets the
 * sleep timeout expire, so the termination clock never starts. It leaves the display
 * idle timer alone (no ES_DISPLAY_REQUIRED), so the display stays off. It is not a
 * substitute for the request: on its own it reportedly does not keep S0 out of
 * standby with the display off (PowerToys #48965).
 *
 * NOT YET RUN ON A WINDOWS MACHINE. PowerShell 7 on macOS parses the keeper and
 * compiles its type; named events, the power request, the scheme and the display
 * subscription need Windows. Whether a held request keeps Danny's laptop in S0
 * through an idle display-off is what Microsoft documents, not what anyone has seen.
 */

// The names are short for the 8,191 budget (2026-10-10; they were CUIDisplayReady,
// CUIDisplayWake and CUIDisplayKeeper). A keeper an older build started does not
// hear the new wake event, and ends when the display comes on, as it always did.
/** Set by the keeper once the display has reported off; the sleep script creates it and waits. */
export const DISPLAY_OFF_READY_EVENT = 'Local\\CUIOff'
/** Set by Wake display (and by a new keeper) to end a running keeper at once. */
export const DISPLAY_WAKE_EVENT = 'Local\\CUIWake'
const KEEPER_MUTEX = 'Local\\CUIKeep'
/** How often the keeper looks at the display state while it waits for it to go off. */
export const OFF_POLL_MS = 250
/** How long the display gets to report off once its timeout is 1 s; after that the
 *  original timeout goes back and the sleep script refuses. */
export const OFF_WITHIN_MS = 6_000
/** How often the hold loop looks at the display state and resets the system idle
 *  timer (the battery rule above). A poll, not a wait on a callback event: it is
 *  the shorter code, and a second's lag letting go of the PC costs nothing. */
export const IDLE_RESET_EVERY_MS = 1_000
/** The longest the keeper holds the PC: 12 hours, counted in turns of the hold loop
 *  (each at least IDLE_RESET_EVERY_MS), which is shorter code than a clock and can
 *  only run a little long, never short. */
export const HOLD_CAP_MS = 12 * 60 * 60 * 1000
/** GUID_VIDEO_SUBGROUP and GUID_VIDEO_POWERDOWN_TIMEOUT ("Turn off display after"). */
export const VIDEO_SUBGROUP = '7516b95f-f776-4464-8c53-06167f40cc99'
export const VIDEO_IDLE = '3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e'
/** Windows' default "Turn off display after", in seconds: 10 min on AC, 5 on battery.
 *  What a stuck 1 s timeout (a keeper that died before restoring) goes back to. */
export const VIDEO_IDLE_DEFAULT_AC_S = 600
export const VIDEO_IDLE_DEFAULT_DC_S = 300

/** powrprof's scheme calls, as both the keeper and Wake display's repair declare
 *  them. r is always NULL (the root power key); s is the scheme from
 *  PowerGetActiveScheme. I and G are IntPtr and Guid (USING_ALIASES). z is never
 *  assigned (it is NULL); public, because the compiler warns about a private field
 *  never assigned, and a warning is noise in every compile log. */
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
 * C# using aliases, I for IntPtr and G for Guid, passed through Add-Type
 * -UsingNamespace, which writes each entry as `using <entry>;` above the members:
 * IntPtr alone is written 20-odd times, and every character of the keeper costs
 * about 2.7 in the sleep command (the budget below). Checked under PowerShell 7.4;
 * Windows PowerShell 5.1 writes the same `using {0};` line, not yet run there. A
 * compile that fails sets no ready event, so the sleep script refuses and nothing
 * is changed.
 */
export const USING_ALIASES = 'I=System.IntPtr,G=System.Guid'

/**
 * The keeper's C# members, for Add-Type -MemberDefinition (which supplies the class,
 * CodeUI.Keeper, and the System and InteropServices usings; System.Threading and
 * the aliases come from -UsingNamespace). C# 5 for Windows PowerShell 5.1, free of
 * single quotes: it sits inside one, and the whole keeper again inside the sleep
 * script's. Terse because it rides inside the sleep command, base64 of UTF-16LE at
 * about 2.7 characters a character, under cmd.exe's 8,191.
 *
 * R is REASON_CONTEXT with POWER_REQUEST_CONTEXT_SIMPLE_STRING (flag 1): a version,
 * flags, then the string pointer, which sequential layout puts at offset 8 on both
 * x86 and x64. A handle below 1 is a failed create (NULL or INVALID_HANDLE_VALUE).
 * C, P and O are the probe's display subscription (windows-host-state.ts); v is the
 * display state (0 off, 1 on, 2 dimmed). X writes both display-idle timeouts and
 * applies them; a and d are the originals. Event names are C# verbatim strings, so
 * `\` needs no escape.
 *
 * Nothing is released by hand except the timeout: Run returns and the process exits
 * at once, and the exit closes the request handle (which ends the request), the
 * display subscription, the scheme pointer and the mutex. A mutex left that way is
 * abandoned, which the next keeper's WaitOne takes as acquired (the catch).
 */
export const WINDOWS_DISPLAY_OFF_KEEPER_MEMBERS = [
  'struct R{public int v,f;[MarshalAs(UnmanagedType.LPWStr)]public string s;}',
  'delegate int C(I c,int t,I s);struct P{public C c;public I x;}',
  'const string K="kernel32",W="powrprof";',
  '[DllImport(K)]static extern I PowerCreateRequest(ref R r);',
  '[DllImport(K)]static extern bool PowerSetRequest(I h,int t);',
  '[DllImport(K)]static extern int SetThreadExecutionState(int f);',
  '[DllImport(W)]static extern int PowerSettingRegisterNotification(ref G g,int f,ref P p,out I h);',
  SCHEME_IMPORTS,
  'static void X(int a,int d){PowerWriteACValueIndex(z,s,ref b,ref n,a);PowerWriteDCValueIndex(z,s,ref b,ref n,d);PowerSetActiveScheme(z,s);}',
  'static int v=-1;static C k;',
  'static int O(I c,int t,I p){if(p!=z)v=Marshal.ReadInt32(p,20);return 0;}',
  'public static void Run(){',
  `var w=new EventWaitHandle(false,(EventResetMode)1,@"${DISPLAY_WAKE_EVENT}");w.Set();`,
  `var m=new Mutex(false,@"${KEEPER_MUTEX}");`,
  'try{if(!m.WaitOne(5000))return;}catch(AbandonedMutexException){}',
  'w.Reset();',
  'var r=new R{f=1,s="Code UI"};',
  'I q=PowerCreateRequest(ref r);if((long)q<1||!PowerSetRequest(q,1))return;PowerSetRequest(q,3);',
  'var g=new G("6FE69556-704A-47A0-8F24-C28D936FDA47");var p=new P{c=k=O};I h;',
  'if(PowerSettingRegisterNotification(ref g,2,ref p,out h)!=0)return;',
  'EventWaitHandle y;int a,d;',
  `if(!EventWaitHandle.TryOpenExisting(@"${DISPLAY_OFF_READY_EVENT}",out y)`,
  '||PowerGetActiveScheme(z,out s)!=0||PowerReadACValueIndex(z,s,ref b,ref n,out a)!=0||PowerReadDCValueIndex(z,s,ref b,ref n,out d)!=0)return;',
  `if(a==1)a=${VIDEO_IDLE_DEFAULT_AC_S};if(d==1)d=${VIDEO_IDLE_DEFAULT_DC_S};`,
  `try{X(1,1);for(int j=0;v!=0&&j++<${OFF_WITHIN_MS / OFF_POLL_MS}&&!y.WaitOne(${OFF_POLL_MS});){}}finally{X(a,d);}`,
  'if(v!=0)return;y.Set();y.Dispose();',
  `for(int j=0;v!=1&&j++<${HOLD_CAP_MS / IDLE_RESET_EVERY_MS}&&!w.WaitOne(${IDLE_RESET_EVERY_MS});)SetThreadExecutionState(1);}`
].join('')

/** The keeper as the hidden `powershell` runs it. Its `Run` blocks until the display
 *  comes back on (or a cap), so the process lives exactly as long as the hold.
 *  Parameter names are cut to their unambiguous prefixes (-IgnoreWarnings,
 *  -Namespace, -UsingNamespace, -MemberDefinition) for the 8,191 budget. */
export const WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT = `Add-Type -Ig -Names CodeUI -Name Keeper -U System.Threading,${USING_ALIASES} -M '${WINDOWS_DISPLAY_OFF_KEEPER_MEMBERS}'\n[CodeUI.Keeper]::Run()`

/**
 * Wake display's repair of a stuck display-idle timeout, as -MemberDefinition
 * members of CodeUI.Fix (its own compile in Wake display): a value of exactly 1 s
 * (only a keeper that died before restoring writes that) goes back to Windows' default, on AC and on DC, and the
 * scheme is applied. Any other value is left alone, and a scheme with nothing to
 * repair is not applied again either. Return codes, not exceptions: a failed call
 * changes nothing and never stops the wake.
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
