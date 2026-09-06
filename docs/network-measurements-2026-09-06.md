# Physical-device network measurements — 6 September 2026

Measured Code UI 0.2.26 (Android versionCode 28) on a Samsung Galaxy S23 Ultra
against its existing paired Orca desktop. No desktop configuration was added.
Android's active default transport was verified for each settled sample. All
connections used the relay; direct LAN connectivity was unavailable.

## Fresh connections

Each sample force-stopped and reopened the installed release app. Times below are
the app's reported relay dial/handshake duration, **not** total launch-to-interactive
time. The diagnostic screen was captured after connection establishment.

| Network | Sample 1 | Sample 2 | Sample 3 | Median | Successes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Wi-Fi | 2.3 s | 2.6 s | 2.4 s | 2.4 s | 3/3 |
| Cellular | 2.5 s | 2.6 s | 2.5 s | 2.5 s | 3/3 |

## Live network changes

| Change | Network-change event to relay migration | New relay handshake | Result |
| --- | ---: | ---: | --- |
| Wi-Fi → cellular | approximately 3 s | 2.4 s | Automatically recovered after a transient failed attempt |
| Cellular → Wi-Fi | approximately 5 s | 2.8 s | Automatically recovered after the previous socket closed |

Recovery intervals use event timestamps from the same diagnostic capture, rounded
to seconds. They do not measure exact visible UI interruption. Both switches closed
the previous relay socket with code 1006. The Wi-Fi-to-cellular transition also
reported an initial network-request failure. No manual reconnect was needed.

Wi-Fi and mobile data were both enabled before testing and were restored/verified
enabled afterward; the final default transport was Wi-Fi.

## Evidence and limits

App diagnostics were read from physical-device screenshots with local OCR. The
first Wi-Fi XML-based capture was stale and discarded; a fresh screenshot verified
the 2.3 s result. Screenshots and OCR records are retained locally under
`/tmp/codeui-network-measurements/`; the first Wi-Fi verification is
`/tmp/codeui-measure-screen.png`.

This is six fresh connections and one handoff in each direction on one phone,
one Wi-Fi network and one cellular connection. It is not a long-duration reliability
test or evidence for all users, carriers, locations or signal strengths. Model-list
latency, approval-response latency, streaming performance and total launch time were
not measured. There is no equivalent before-change measurement for comparison.
