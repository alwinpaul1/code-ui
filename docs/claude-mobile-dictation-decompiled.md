# Claude Mobile Dictation — Decompiled Reference

Source: Claude Android 1.261009.20 (decompiled October 2026).

## Flow diagram

```
hold mic ──► pick engine ──┬─► ON-DEVICE: Android SpeechRecognizer ──► partial text ──► composer
                           │        (no text heard? → switch to server)
                           └─► SERVER:
                                AudioRecord (mono, AEC + noise suppressor)
                                  ──► Opus encoder (in-process)
                                  ──► WebSocket  ws/speech_to_text/voice_stream
                                  ◄── TranscriptInterim / TranscriptText  (live)
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
  partial results on.  Each partial result updates the composer live.
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
  `TranscriptText` while the user speaks, and the composer shows the
  latest one.  `TranscriptEmpty` means nothing was heard.
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

## Comparison with Claude Code CLI

| | Claude mobile | Claude Code CLI |
|---|---|---|
| Mic | Phone AudioRecord | Mac default input, native addon |
| Audio sent | Opus | Raw 16 kHz PCM (linear16) |
| Endpoint | `/api/ws/speech_to_text/voice_stream` | Same |
| Live text | Interims into the composer | Interims spliced into the prompt |
| Fallback | On-device recognizer first | None, server only |
| Auth | App's own OAuth session | CLI's own OAuth session |

## Credential location (macOS)

Reference only: where the CLI keeps its own token. Code UI does **not** read it. Until
2026-10-14 the phone fell back to opening a hidden desktop terminal to run the command below
when nobody was signed in on the phone; the voice server rejected that token ("unstructured
server error") and CLAUDE.md forbids opening a terminal on the user's machine to read files. The
reader was removed: signing in on the phone (Voice settings) is mandatory, and a signed-out mic
tap opens Voice settings.

```
Service:  "Claude Code-credentials"
Account:  $(whoami)
Store:    macOS Keychain (login.keychain-db)
Content:  JSON with claudeAiOauth.accessToken (sk-ant-oat01-…)
Command:  security find-generic-password -s "Claude Code-credentials" -a "$(whoami)" -w
```
