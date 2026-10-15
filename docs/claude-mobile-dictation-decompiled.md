# Claude Mobile Dictation — Decompiled Reference

Source: Claude Android 1.261009.20 (decompiled October 2026).

## Flow diagram

```
hold mic ──► pick engine ──┬─► ON-DEVICE: Android SpeechRecognizer ──► partial text ──► caption
                           │        (no text heard? → switch to server)
                           └─► SERVER:
                                AudioRecord (mono, AEC + noise suppressor)
                                  ──► Opus encoder (in-process)
                                  ──► WebSocket  ws/speech_to_text/voice_stream
                                  ◄── TranscriptInterim / TranscriptText  (live, caption)
                                  ──► CloseStream on release
                                  ◄── final text ──► composer
```

## 1. Trigger

Press and hold the mic in the composer ("Hold to speak, release to send").
The widget also has a "Dictation" button (toggle mode).

## 2. Engine choice  (a6r.java:139)

The app uses on-device transcription only when ALL of these hold:

- The server flag `client_transcription_enabled` is on.
- An OS version check passes.
- `SpeechRecognizer.isOnDeviceRecognitionAvailable()` returns true.

Otherwise the app uses Anthropic's server.

## 3. On-device path  (pm0.java, e5.java:226)

- Runs `createOnDeviceSpeechRecognizer` with the free-form model and
  partial results on.  Each partial result revises the caption above the
  speech toolbar; the composer is not touched until the take ends.
- The language comes from the user's setting, falling back to the
  phone's locale.
- **Efficacy latch:** if the engine starts but produces no text, the app
  logs "latching to server path" and switches to the server path.
- **On release:** keeps listening about 500 ms more, then waits up to
  2.5 s for the final text.

## 4. Server path  (col.java, iru.java:680)

- **Capture:** `AudioRecord` in mono, with `AcousticEchoCanceler` and
  `NoiseSuppressor` attached.  A server-side list turns the noise
  suppressor off on specific phone makers and models.
- **Encode:** Opus, done inside the app
  (flag `android_in_process_opus_codec_dictation`).
- **Stream:** a WebSocket to
  `.../api/ws/speech_to_text/voice_stream` with these query parameters:
  - `encoding=opus`
  - `sample_rate`, `channels`, `language`
  - `forward_interims=typed`
  - `organization_uuid`, plus an optional `conversation_uuid`
- **Live text:** the server sends `TranscriptInterim` and
  `TranscriptText` while the user speaks, and the caption shows the
  latest one (it replaces the last, it is not appended).  `TranscriptEmpty` means nothing was heard.
- **Release:** the app sends `CloseStream`, the server returns the
  final text, and it lands in the composer.
- **Auth:** `Authorization: Bearer <OAuth-access-token>` header on the
  WebSocket upgrade.

## 5. Concurrency  (iru.java)

Four jobs run at the same time:

1. Feed the mic into the encoder.
2. Send encoded audio to the socket.
3. Receive transcripts from the socket.
4. Supervise the other three — a failure in one stops them all.

## 6. Protocol messages

### Client → server

| Type | Payload | When |
|------|---------|------|
| binary frame | raw audio (Opus or linear16 PCM) | every capture chunk |
| `{ "type": "KeepAlive" }` | none | after connect |
| `{ "type": "CloseStream" }` | none | user releases the mic |

### Server → client

| Type | Fields | Meaning |
|------|--------|---------|
| `TranscriptInterim` | `data` | partial (open phrase) |
| `TranscriptText` | `data` | final segment |
| `TranscriptEmpty` | — | nothing heard |
| `TranscriptEndpoint` | — | server finished, close the socket |

## 7. Where the words go

The user, 2026-10-15: "When audio is transcribed live, it's edited live there itself until the
mic is on, and then only it moves to composer." The decompile agrees (1.261009.20, `claude-apk/out`).

**While the mic is on, the words are a caption, not the draft.**

- The caption is `etq.R`, called from `yv8.java:2257` with padding `rrb.P(29, 8)`, so 29 dp at the
  sides and 8 dp above and below. It is fed `al4` case 2, which carries the take's transcript while
  the speech toolbar is up (`rs8.n3()`, which means `S4` is non-null) and is null when the transcript
  is blank.
- `etq.S` (etq.java:3546-3626) draws it in the composer's text style (`jn7.B`) in italic (`ygf(1)`),
  in the secondary colour `pl7.P`, from the start edge. The box is a fixed four lines: two full,
  one fading at the top and one of air below. The text grows upward under a top fade.
- A `dictation-caption-scrim` in the screen colour sits behind it (`etq.h0`).
- Committed and interim words are one string, so each result replaces the caption. Nothing is
  appended to it.
- The text field folds away while the toolbar is up (`dx0` case 11, `fb8` case 0) and keeps
  whatever it held.
- The Code session composer draws the same caption (`g96.java:415`, padding 8 dp).

**At the end of the take, the result goes in once** (`k35` case 2, over `edw`):

- `ddw` Finished(text, sendRequested): `rs8.z(text)`. A blank text adds nothing (`u1x.q0`). An empty
  draft takes the text alone. A draft that ends in whitespace (`xap.L`) gets the text appended
  directly. Any other draft gets `draft + " " + text`. In the chat screen it always goes at the
  END of the draft. The Code session composer (`qb6.b1` → `qb6.n2`) instead puts it at the selection
  saved when the take began. `ox20.e` adds a space before the text when the character before it is
  not whitespace, and one after it when the next character is not whitespace and not one of
  `,.;:!?)]}`.
- Send dictation sets `sendRequested`. After the insert, the app sends only when the draft still
  equals the one saved at the start (`rs8.a5` saves `U4`) and the text is not blank.
- `cdw` Error(partialText): `rs8.z(partialText)`. The words heard before the failure still go in,
  and the error is shown.
- `bdw` Cancelled (the X): nothing is inserted, and the draft is left as it was.
- Between Stop and the final text, the toolbar shows "Transcribing…" (`stt_input_transcribing`).
- An empty result has its own error string, "Sorry, we didn't catch that. Please try again."
  (`stt_error_transcription_empty`).

**What Code UI does** (`mobile/src/session/use-mobile-session-native-chat-dictation.ts`, from
2026-10-15):

- A chat take's partials only update `dictationCaption`, which `MobileNativeChatDictationCaption`
  draws.
- The draft is written once, when the final transcript arrives, with `paintSpokenAtCursor` at the
  caret the take began from. That is the Code session composer's `ox20.e` join.
- An engine error mid-take commits the words heard so far.
- Cancel writes nothing. A final that lands after a Cancel is dropped.
- Send dictation waits for the take to end (`use-composer-dictation-row.ts`). It sends the draft
  the final transcript was written into in the same callback.
- Tests: `mobile/src/session/native-chat-dictation-words-move-in-on-stop.test.tsx`.
- Not matched yet: Code UI sends even if the draft changed during the take, though the field is
  folded away so it cannot be typed into. Code UI also shows no "didn't catch that" error for an
  empty take: the composer simply stays as it was.

## Comparison with Claude Code CLI

| | Claude mobile | Claude Code CLI |
|---|---|---|
| Mic | Phone AudioRecord | Mac default input, native addon |
| Audio sent | Opus | Raw 16 kHz PCM (linear16) |
| Endpoint | `/api/ws/speech_to_text/voice_stream` | Same |
| Live text | Interims in a caption, draft written at the end | Interims spliced into the prompt |
| Fallback | On-device recognizer first | None, server only |
| Auth | App's own OAuth session | CLI's own OAuth session |

## Credential location (macOS)

Reference only: where the CLI keeps its own token. Code UI does **not** read it. Until
2026-10-14 the phone fell back to opening a hidden desktop terminal to run the command below
when nobody was signed in on the phone; the voice server rejected that token ("unstructured
server error") and CLAUDE.md forbids opening a terminal on the user's machine to read files. The
reader was removed: signing in on the phone (Settings, Anthropic accounts) is mandatory, and a signed-out mic
tap opens Anthropic accounts.

```
Service:  "Claude Code-credentials"
Account:  $(whoami)
Store:    macOS Keychain (login.keychain-db)
Content:  JSON with claudeAiOauth.accessToken (sk-ant-oat01-…)
Command:  security find-generic-password -s "Claude Code-credentials" -a "$(whoami)" -w
```
