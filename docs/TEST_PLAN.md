# Stealth Notepad test plan

This plan is against `develop` at `29e5445` (PRs #1–#3 merged). It covers note save/load, the main-process stealth and storage behavior, and the room server. It does not cover answer generation or screen analysis.

`npm test` runs the suite. Tests that describe a bug still present on `develop` use Vitest `test.fails`: the assertion is the behavior we want, it fails on this tree, and Vitest counts that as a pass so the command exits 0. When the bug is fixed, that test fails with "Expect test to fail" until `.fails` is removed. The custom reporter lists those tests at the end of the run.

The opt-in Electron smoke check is separate and is not part of `npm test`:

```bash
node tests/e2e/content-protection.smoke.mjs
RUN_ELECTRON_SMOKE=1 node tests/e2e/content-protection.smoke.mjs
```

Without `RUN_ELECTRON_SMOKE=1` it prints SKIP and exits 0. The live form needs a display, the Electron binary, and Playwright installed separately. It only asks the window whether Electron thinks content protection is on. It registers a global Escape shortcut while it runs and, in an unpackaged dev launch, can bind port 4444. Do not treat a green smoke result as proof the window is absent from a capture.

## What the automated suite locks in

| Area | Where | What a passing test means |
| --- | --- | --- |
| Note restore, unicode, empty note, 300k characters, clear, room typing isolated from the private note | `tests/note-storage.test.mjs` | The real `renderer.js` reads and writes `localStorage` key `notepad-content`. |
| Transcript text is text, not HTML | same | A remote transcript payload cannot create an element. |
| Settings save handles a rejected IPC call | same | A thrown `save-api-key` does not become an unhandled rejection. |
| Screenshot preview and the Notes button | same | `openModal` shows the preview; `#notepad-tab-btn` opens the overlay. |
| Linux stealth copy | same | After startup on Linux the toggle does not say the window is hidden from screen share. |
| Microphone prompt | same | Startup calls `populateAudioDevices()` with permission deferred. |
| Content protection on Windows and macOS, no call on Linux | `tests/main-process.test.mjs` | `setContentProtection` runs for `win32` and `darwin` only. |
| Show reapplies protection; Escape only while visible | same | Showing the window calls `setContentProtection(true)` again; Escape is not registered while hidden. |
| Shortcut return value, navigation guards, loopback collab child | same | Source checks for the `develop` implementations. |
| API key round-trip, corrupt file, validation, encryption required, ENOSPC, mode `0600` | same | `save-api-key` / `load-api-key` against a fake `safeStorage`. |
| Capture failure returns null | same | `getSources` throwing does not reject the IPC handler. |
| Frame check | same | A handler call without the main-window sender is `unauthorized` and writes nothing. |
| Entitlements path and microphone | same | `package.json` points at `entitlements.mac.plist`, and `audio-input` is true. |
| Health, unicode relay, outsider blocked, leave count, second create leaves the first room, 404, listen error, missing ack | `tests/collab-server.test.mjs` | A real `server.js` child on `127.0.0.1`. |

These tests load the real `main.js`, `renderer.js`, and `server.js` with fakes for Electron and jsdom. They do not launch Electron and they do not prove pixels.

## Known bugs the suite still expects

Each row is a `test.fails` case. The assertion is the fix; it fails on this tree.

| Test | Why it is still open |
| --- | --- |
| the window is created hidden | `BrowserWindow` is constructed without `show: false` (`main.js` `createWindow`). |
| content protection is applied before the window is shown | `showWindow` calls `show()` and then `setContentProtection`. |
| the renderer is sandboxed | `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`. |
| a second instance is refused | No `requestSingleInstanceLock`. |
| quit flushes note storage | No `session.flushStorageData` on quit or close. |
| API key writes are atomic | `writeFileSync(KEY_FILE)` with no temp file and rename. |
| screenshot capture uses the display the window is on | `capture-screenshot` returns `sources[0]`. |
| typing still saves when localStorage throws | The notepad `input` handler does not catch `setItem`. |
| clear does not destroy a note the user cannot see | `clear-text` always removes `notepad-content`. |
| shared room text is saved locally | Room notepad input is socket-only. |
| macOS stealth copy does not promise invisibility to ScreenCaptureKit | Darwin aria-label says "hidden from screen share". |
| the collab server rejects a client with no credential | Any socket can `create-room` / `join-room`. |
| a missing Origin is not treated as allowed | `isAllowedOrigin` returns true when `Origin` is absent. |
| room ids are not biased by modulo against the alphabet | `makeId` uses `byte % 36`. |

## Bugs that were on `main` and are already fixed on `develop`

Do not refile these. They were true on `main` (`112da6e`) and the current tests lock the fix.

- Windows never called `setContentProtection`. `applyContentProtection` now calls it on `win32` and `darwin`, and logs build `>= 19041` versus `WDA_MONITOR`.
- Linux UI always claimed stealth was on. The renderer now has an unsupported state and does not claim "hidden from screen share" on Linux. Main correctly skips `setContentProtection` on Linux.
- Escape was registered for the whole process lifetime. It is registered only while the window is visible.
- `globalShortcut.register` return value was ignored. `registerShortcut` checks it and try/catches.
- No `will-navigate` / `setWindowOpenHandler` / `will-redirect` / webview guard.
- DevTools stayed available in packaged builds. `devTools` is `!app.isPackaged`.
- API key could be written as plaintext, a non-string threw, a full disk threw, and the file mode was not `0600`. Save now rejects bad input, refuses to write when encryption is unavailable, returns `write-failed`, and chmod `0600`.
- Settings save could surface an unhandled rejection. The renderer reads the IPC ack inside try/catch.
- `entitlements.mac.plist` path did not exist and `audio-input` was false. The file exists and the microphone entitlement is true.
- The collab child was spawned without `ELECTRON_RUN_AS_NODE`, without `HOST=127.0.0.1`, and inherited API key env vars.
- `capture-screenshot` / `get-screen-source-id` could reject when `getSources` threw. Both return null.
- A missing socket ack crashed the room process. `ack()` no-ops unless the callback is a function, and handlers try/catch.
- The HTTP server had no listen error handler and non-`/health` requests could hang. Unknown routes are 404 and `httpServer.on('error')` exits.
- CORS was `origin: *`. Origins are checked. Room ids come from `crypto.randomBytes`, not `Math.random`.
- Creating a second room left the socket in the first. `leaveRoom` runs first, and empty rooms are deleted.
- Clients could supply `senderId`. The server sets `socket.id`. Text, transcript, and image size are capped.
- Transcript entries were assigned with `innerHTML`. They use `textContent`.
- `#notepad-tab-btn` was missing. It is in `index.html` and opens the overlay.
- Startup called `getUserMedia` immediately. Device listing is deferred; permission is requested when recording starts.
- A recorder failure left `isTranscribing` true. The `startTranscription` catch sets it back to false.
- The screenshot modal never became visible. `showScreenshot` calls `openModal`.

## Capture matrix (manual)

Pixel proof needs a real OS, a real capture client, and a screenshot of the result. The suite cannot see the compositor. `setContentProtection` also does not report whether the OS honored it.

Pass means the notepad window is absent from the recording or screenshot. On Windows builds older than 10.0.19041, a black rectangle where the window sits is the documented `WDA_MONITOR` result, not a failure of the call, and not the same as exclusion. Fail means the notepad's text or chrome is readable in the capture. Record OS build, app version, monitor, scaling, and whether stealth was toggled off.

### Windows

| Case | Automatable? | Why |
| --- | --- | --- |
| Windows 10 2004+ / Windows 11 (build >= 19041), stealth on, `WDA_EXCLUDEFROMCAPTURE` | Manual | Needs a real DWM composition and a capture client. |
| Windows 10 before 2004, stealth on, black `WDA_MONITOR` box | Manual | Same, and the build must be below 19041. |
| Stealth toggled off | Manual | The window must appear. Confirms the toggle is wired. |
| Show, hide, show again | Manual | Protection has to be reapplied after `show`. The unit test only sees the fake call order. |
| Minimize / restore, fullscreen other app, sleep/wake | Manual | OS window-state transitions drop affinity on some builds. |
| Two monitors, window snapped to the secondary | Manual | Capture and snap both currently use the first / primary display in code; the capture client must be aimed at the monitor under the window. |
| DPI 100%, 150%, 200% | Manual | Affinity is per HWND, but thumbnail scaling has mis-cropped captures. |
| Win+Shift+S, Snipping Tool, Print Screen, Xbox Game Bar | Manual | OS tools do not all use the same capture API. |

### macOS

| Case | Automatable? | Why |
| --- | --- | --- |
| macOS 12.3–14, stealth on, legacy capture honors `NSWindowSharingNone` | Manual | Needs Screen Recording permission and a compositor. |
| macOS 15.4+, ScreenCaptureKit (screenshot toolbar, Screen Recording apps) | Manual | Electron and Apple DTS: ScreenCaptureKit ignores `sharingType none`. Expect the window to be visible. The UI currently still says "hidden from screen share", which is the known-bug test above. |
| Stealth toggled off | Manual | Window must appear on versions that otherwise honor sharing none. |
| Mission Control, fullscreen Space, sleep/wake, display reconnect | Manual | `setVisibleOnAllWorkspaces` plus protection is OS-specific. |
| Retina vs non-Retina, Sidecar / second display | Manual | Same as the Windows multi-monitor row. |
| Cmd+Shift+3, Cmd+Shift+4, Cmd+Shift+5, Screenshot app | Manual | OS tools. |

### Linux

| Case | Automatable? | Why |
| --- | --- | --- |
| X11, any capture | Manual | Electron's `setContentProtection` is a no-op on Linux. Expect the window to be visible. The UI must keep saying capture blocking is unavailable. |
| Wayland (GNOME, KDE, wlroots) | Manual | Same no-op, plus `setPosition` / `setAlwaysOnTop` / raise can fail silently. |
| Portal screenshot, `grim`, OBS PipeWire | Manual | OS and compositor capture. |

`skipTaskbar` has been a no-op on Linux since Electron 20. The window can still show in the taskbar. That is manual.

### Meeting and capture apps

Run each client twice: stealth on, and stealth off. Stealth off must show the window, or the "hidden" result is a false pass (the window was never on that display).

| Client | Modes | Pass / fail | Automatable? |
| --- | --- | --- | --- |
| Zoom | Share screen, advanced capture with window filtering; then the same without filtering. Window share of another app. Meeting recording. | Filtering on recent Zoom can exclude `WDA_EXCLUDEFROMCAPTURE` windows on Windows 10 2004+. Without filtering, or on macOS 15.4+, expect the window to show. A black box on older Windows is `WDA_MONITOR`. | Manual. Zoom's capture path is not scriptable from this repo. |
| Google Meet | A browser tab, a single window, and entire screen. Meeting recording if the host has it. | Tab and window share are Meet UI filters. They are not a stealth pass unless the shared surface is the one that should have included the notepad. Entire screen is the real check. | Manual. |
| Microsoft Teams | Desktop app and the browser. Full screen, a single window, and meeting recording. | Teams desktop uses WebView2. Treat it as its own client, not as Zoom. | Manual. |
| OBS | Display capture, window capture, game capture. | Display and window capture are the checks. Game capture not seeing the notepad is not a pass. | Manual. |
| OS screenshot / recording | The tools listed per OS above. | The notepad text must not be readable when stealth is on and the OS claims to honor exclusion. | Manual. |

## Functional cases

| Case | Automatable? | Why |
| --- | --- | --- |
| Unicode note save and restore | Automated | `note-storage.test.mjs`. |
| Large note (300k) under the usual quota | Automated | Same. |
| Empty note, clear, clipboard copy | Automated | Same. |
| Quota exceeded, read-only profile, disk full while typing | Partly | The known-bug test forces `setItem` to throw. A real full disk or a read-only Chromium profile still needs a manual or VM run. There is no user-visible "not saved" state today. |
| API key disk full, corrupt file, encryption unavailable | Automated | Fake `safeStorage` and a thrown `writeFileSync`. |
| Crash or quit before `localStorage` flushes | Manual, bug still open | No `flushStorageData`. Kill the process from Task Manager / `kill -9` after a burst of typing and relaunch. |
| Two instances | Manual, bug still open | No single-instance lock. Both share the LevelDB under `userData` and the same hotkeys. Expect hotkey conflict and possible note corruption. |
| Ctrl+Shift+C while the Notes overlay is closed | Automated as a known bug | The shortcut still sends `clear-text` whenever the window is visible, and the handler deletes the saved note with no undo. |
| Room text survives refresh | Automated as a known bug | Room text is not written to `localStorage`. Last writer replaces the whole buffer for everyone in the room. |
| Multi-monitor snap | Manual | `snapTo` uses `getPrimaryDisplay` only (`main.js` `snapTo`). |
| Minimize, restore, fullscreen, sleep, DPI | Manual | See the capture matrix. The unit test cannot composite a frame. |
| Startup flash | Partly | The known-bug test asserts `show: false` is absent. Confirming a visible frame needs a high-speed recording of launch. |
| Read-only `userData` for the API key | Automated for the throw path | `write-failed` is returned. Confirming the settings dialog copy needs the running app. |

## What cannot be automated here

- Whether a capture client actually omitted the window. Electron does not return success from `setContentProtection`, and this environment has no Zoom, Meet, Teams, or OBS.
- macOS 15.4 ScreenCaptureKit behavior, Windows build-specific `WDA_*`, and Linux X11 versus Wayland.
- One-frame gaps at show, restore, and first paint.
- LevelDB flush on crash, two real processes on one profile, and OS permission prompts.
- The smoke script. It is opt-in, it steals Escape, and on Linux a "protected" flag would still be a lie because the API is a no-op.

## CI

`.github/workflows/ci.yml` has a `test` job on `ubuntu-latest`: checkout, Node from `.node-version`, `npm ci`, and one `npm test` step. It is not inside the Windows/macOS/Linux package matrix, and it is not on the lockfile-only audit job. `package.json` script:

```json
"test": "vitest run --config vitest.config.mjs"
```

Dev dependencies: `vitest@3.2.4`, `jsdom@26.1.0`. The builder `files` list excludes those packages so the package job does not ship them.
