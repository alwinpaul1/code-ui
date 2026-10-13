# Claude Code CLI — voice_stream Client Reference

Extracted from Claude Code 2.1.296 binary (October 2026).

## Connection

```
URL:     wss://api.anthropic.com/api/ws/speech_to_text/voice_stream
Headers: Authorization: Bearer <token>
         User-Agent: <cli-user-agent>
         x-app: cli
         anthropic-client-platform: <platform>
         x-config-keyterms: <comma-list>   (optional)

Query params:
  encoding=linear16
  sample_rate=16000
  channels=1
  endpointing_ms=300
  utterance_end_ms=1000
  language=en
  use_conversation_engine=true
  forward_interims=typed              (when feature flag is on)
```

## Lifecycle

1. **Open** → log "WebSocket connected"
2. **Send initial KeepAlive** → `{"type":"KeepAlive"}`
3. **Start periodic KeepAlive** → every 8000 ms
4. **Stream audio** → `Buffer.from(pcmChunk)`, logged per chunk
5. **Finalize** (on release):
   - Set CloseStream-sent flag
   - Send `{"type":"CloseStream"}`
   - Start two timers:
     - **safety timeout** = 5000 ms (absolute maximum wait)
     - **noData timeout** = 1500 ms (reset on any message after CloseStream)
   - Resolve via: `post_closestream_endpoint`, `ws_close`,
     `safety_timeout`, `no_data_timeout`, or `ws_already_closed`
6. **On resolve**: if unreported interim exists, promote it to final
7. **Close** → clear KeepAlive interval, close socket

## Message handling

### TranscriptInterim AND TranscriptText — handled identically

Both set the "latest text" variable and call `onTranscript(text, false)`.
Neither is treated as "final" on its own. The `data` field holds the text.

The noData timeout is reset when either arrives after CloseStream.

### TranscriptEndpoint

1. Take the current latest-text variable.
2. Clear it.
3. If text exists, call `onTranscript(text, true)` — this is the ONLY
   place `isFinal=true` is set during normal flow.
4. If CloseStream was sent, resolve the finalize promise.

### TranscriptError

1. Promote any unreported interim to final.
2. Call `onError(description)` unless already finalizing.

### error (unstructured)

Same as TranscriptError but reads `message` field.

## Interim promotion

The client tracks one variable: the last text from any Interim or Text
message. When the stream ends for any reason (endpoint, close, error,
timeout), that variable is promoted to `onTranscript(text, true)`.

This means:
- The consumer sees `onTranscript(text, false)` on every partial update.
- The consumer sees `onTranscript(text, true)` exactly once when done.
- There is no segment accumulation. The server sends the full transcript
  each time, and the client just tracks the latest one.

## Error handling

- **Connect failure**: socket never reached OPEN. Error includes
  `connectFailureCode` (e.g. `upgrade_rejected_401`, `ws_error_econnrefused`).
- **Runtime failure**: socket was OPEN, then closed abnormally. No
  `connectFailureCode`.
- **CF mitigation**: checks `cf-mitigated` header on rejected upgrades.
- **Normal close**: codes 1000 and 1005 do not trigger onError.

## Differences from our Code UI implementation

| Aspect | Claude Code CLI | Code UI (before fix) |
|--------|----------------|---------------------|
| KeepAlive | Initial + periodic every 8 s | Initial only |
| Finalize | Two timers (5 s safety, 1.5 s noData) | One timer (2.5 s) |
| noData reset | Reset on any message after CloseStream | No reset |
| Interim/Text | Handled identically, both `isFinal=false` | Separate callbacks |
| Segment accumulation | None — server sends full text each time | Joins segments |
| Final delivery | Only on TranscriptEndpoint or timeout | On TranscriptText after CloseStream |
| TranscriptError | Handled, promotes interim | Not handled |
| Query params | `endpointing_ms`, `utterance_end_ms`, `use_conversation_engine` | Missing |
| Periodic KeepAlive | Every 8 s | None |
| Error detail | Connect vs runtime failure | Generic error |
