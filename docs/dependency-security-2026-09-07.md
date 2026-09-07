# Dependency security update — 2026-09-07

The affected packages use their latest npm releases at verification time:

| Package | Version | Change |
| --- | --- | --- |
| `decode-uri-component` | 0.5.0 | Fixes malformed percent-encoding denial of service. |
| `@xmldom/xmldom` | 0.9.12 | Fixes entity-reference injection in well-formed serialization. Replaces both vulnerable dependency copies. |
| `image-size` | 2.0.2 | Latest release remains vulnerable; a checked-in pnpm patch fixes the reported loops. |
| `query-string` | 9.5.1 | Updates the decoder's caller to its compatible ESM API. |
| `@expo/plist` | 0.8.1 | Updates Expo's plist caller; a compatibility patch supplies the MIME type required by xmldom 0.9. |

The image-size patch validates ICNS entry lengths and file bounds. ISO BMFF box
lengths must advance the reader, with zero interpreted as extending to the end
of the input. This prevents the matching `jxlp` and `ispe` box loops while
preserving valid size-zero HEIF data. The package bundles these implementations
into multiple entry points, so the patch covers the CommonJS and ESM bundles,
including format-specific exports.

Both patches are registered in `mobile/pnpm-workspace.yaml` and hashed in the
lockfile. They apply automatically during normal installation and CI; users
do not configure anything on their desktop.

## Verification

- Regression tests reproduce ICNS and JXL failures before the image patch.
- Fourteen tests cover malformed ICNS/JXL/HEIF data, valid ICNS/PNG/HEIF
  dimensions, malformed URI decoding, query-string Unicode and round trips,
  Expo plist parsing/serialization, and rejection of injected entity names.
- Hostile parser inputs run in memory-limited subprocesses with deadlines.
- Full suite: 556 files passed; 4,389 tests passed and 3 skipped.
- Type checking and lint passed.
- Android release build passed for 0.2.47 (versionCode 49).

## GitHub alerts

The decoder and XML upgrades address alerts #3, #4, and #5 through patched
upstream versions. Alerts #1 and #2 concern image-size, for which GitHub lists
no patched upstream release. Version-only scanners still flag 2.0.2 even with
our patch. Those alerts can be dismissed as inaccurate for this patched
dependency, with a comment linking this fix and its regression tests. Do not
remove the image-size patch until an upstream fix replaces it and the tests
pass without it.

Advisories: [URI decoder](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr),
[XML serializer](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6),
[ICNS parser](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr),
[JXL/HEIF parsers](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq).

## Correction, 2026-09-08: the patch does not cover every copy

A review flagged an unpatched `image-size@1.2.1` in the tree. Checked: it is
real and it is reachable, but not for the reason given — a clean
`pnpm install --frozen-lockfile` does not remove it, because the lockfile itself
declares a bare `metro@0.83.7` alongside the patched
`metro@0.83.7(supports-color@8.1.1)`. Three packages resolve through the bare
one, `@react-native/community-cli-plugin` among them, and it depends on
`image-size@1.x`. `patchedDependencies` pins `image-size@2.0.2`, so a 1.x copy
cannot receive that patch.

Not fixed here, deliberately. `image-size` is Metro build tooling: it runs in the
bundler on the developer's machine and is never shipped in the app, so the
exposure is a hang in a dev or CI Metro process fed a hostile image, not
anything reachable on a phone. Closing it properly means either authoring a
second patch against the 1.x source layout, or forcing `image-size` to 2.x for
Metro — a major bump to a dependency of the bundler, which needs a real bundling
test rather than a lockfile edit. Recorded so the next person does not read
"patched" as covering the whole tree.
