# Lampyris

[Русский](README.md) | **English**

An unofficial [Lampa](https://github.com/yumata/lampa) client for macOS (Apple Silicon and Intel) and Windows (x64 and arm64; an Android version for tablets, phones and TV boxes, ARM32/ARM64, currently a Preview: [android/README.md](android/README.md); Rust, WebView2, libmpv — see [docs/ARCHITECTURE-windows.md](docs/ARCHITECTURE-windows.md), in Russian). Lampa is a project of its own authors; Lampyris is not affiliated with it and is not supported by it. The app is written in Swift/AppKit, with a WKWebView and playback through libmpv.

## Why Lampyris
- **A real mpv player instead of a browser player.** Hardware decoding (VideoToolbox on macOS, D3D11VA on Windows), AC3/DTS and 4K/HDR without transcoding and without the stutter of a web player.
- **Picture quality for your task.** Seven built-in profiles (`balanced`, `quality`, `fast`, `hdr-sdr`, `smooth`, `anime`, `night`) with descriptions in the picker: switch them during playback with `P`, the choice is remembered. Add your own profiles to `mpv.conf`; they override the built-in ones.
- **A "Picture" panel (`C` key).** Sliders for gamma, brightness, contrast and saturation for manual tuning (for example, a dark video) and "SDR auto-correction": lifts shadows and colour on SDR video only, HDR is left alone.
- **Your own `mpv.conf` with an editor and safeguards.** Options that run code or read other files are disabled; profiles are chosen from the settings.
- **The same features on macOS and Windows.** Shared pages and bridge for both platforms. On Windows there is an installer, a regular portable `.zip` and a fully portable build (everything in a folder next to the exe).
- **Safe updates.** Automatic check, Ed25519 signature, checksum verification; settings and the Lampa login are kept across updates.
- **Settings backup** in one file shared by macOS and Windows.
- **Russian and English interface**, switched from the menu.

## Features
- Resume playback, per-series memory of audio and subtitle tracks, automatic retry on network drops.
- Skipping intros and credits using TheIntroDB timestamps, subtitles from the internet (Russian and English).
- Player hotkeys (help on `H`), statistics (`I`), screenshot (`S`), media keys and "Now Playing".
- Window state restore, app menu, error page, log.
- On Windows: full screen (`F11`), media keys and "Now Playing" through the system Windows controls.

## mpv profiles and the Picture panel
The built-in profiles are always there: pick one in Settings → MPV → mpv profile or press `P` during playback. Each profile's description is shown in the picker. To change a built-in profile, add a section with the same name to `mpv.conf`: it replaces the built-in one entirely.

The `C` key opens the Picture panel: four manual sliders (gamma, brightness, contrast, saturation, as adjustments on top of the profile) and "SDR auto-correction" with its own gamma and saturation. The values are remembered and applied whenever a video opens; "Reset all" brings back the profile's values. The result is the profile + auto-correction (SDR only) + the manual adjustment.

On macOS the renderer is `gpu` (OpenGL 4.1): options that exist only for `gpu-next` have no effect, and `hdr-compute-peak` does nothing without compute shaders. On Windows the renderer is `gpu-next` and they work.

## Installation
Two builds (both require macOS 13 or later): `Lampyris-<version>-arm64` for Apple Silicon Macs and `Lampyris-<version>-intel` for Intel Macs. Open the .dmg and drag Lampyris to Applications.

The build is ad-hoc signed (without an Apple developer certificate), so on first launch macOS may say it cannot verify the app. Open "System Settings → Privacy & Security" and click "Open Anyway", or run this in Terminal: `xattr -dr com.apple.quarantine /Applications/Lampyris.app`.

## Building the .app
```
scripts/build-app.sh arm64      # Apple Silicon
scripts/build-app.sh x86_64     # Intel
```
The script downloads prebuilt IINA mpv libraries for the target architecture and verifies their checksums, builds the app, produces `dist/<arch>/Lampyris.app`, checks its contents (`scripts/verify-bundle.sh`), signs it ad-hoc and packs `.zip` and `.dmg` into `dist/`. You need Xcode or Command Line Tools with Swift 6; Homebrew and mpv are not needed to build the `.app`.

## Running from source
```
brew install mpv        # library for swift run; Homebrew is not needed to build the .app
cd lampyris && swift run
```
The Lampa server address is taken from `LAMPA_URL`, then from settings, otherwise you will be asked for it. App internals, debug variables and limitations are described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (in Russian).

## Tests and checks
```
scripts/check.sh        # syntax of shell scripts and injected JS, ban on multi-argument append
swift test              # mpv.conf parsing and URL shortening in the log (LampyrisCore target)
```
`swift test` builds the whole package, so the mpv libraries must be available: either Homebrew (`brew install mpv`) or `LAMPA_LIBS=<directory with dylibs>` (for example, after `scripts/fetch-libs.sh arm64`: `LAMPA_LIBS=$PWD/build/libs/arm64`).

## Continuous integration and releases
`.github/workflows/ci.yml` (GitHub Actions) on every push to `main` and every pull request:
1. runs checks and tests on macOS (Apple Silicon);
2. builds `Lampyris.app` for arm64 (Apple Silicon) and x86_64 (a real Intel runner, `macos-26-intel`), verifies the bundle contents and does a smoke run (playing a test video);
3. saves the `.dmg` and `.zip` of each build as run artifacts.

To publish a release, bump the number in `scripts/VERSION`, commit and push a tag like `v0.1.0`: CI builds both variants and publishes a release with `.dmg`, `.zip` and `SHA256SUMS.txt`. To push workflow files via `gh`, the token needs the `workflow` scope (`gh auth refresh -h github.com -s workflow`).

## License
GNU GPL version 3 or later (GPL-3.0-or-later), see [LICENSE](LICENSE). Information about third-party components and services is in [THIRD-PARTY.md](THIRD-PARTY.md).
