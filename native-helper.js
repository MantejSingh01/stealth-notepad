'use strict';

/**
 * Optional native capture-exclusion addon.
 *
 * There is no compiled addon in this repo. Electron already performs the
 * platform call from BrowserWindow.setContentProtection:
 *   - Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE), which older
 *     Windows builds honor as WDA_MONITOR (the capture shows a black window).
 *   - macOS: NSWindow.sharingType = NSWindowSharingNone.
 *   - Linux: not implemented by Electron.
 *
 * `setWindowExStyle` stays null so older callers cannot mistake a missing
 * addon for a successful native call.
 */

function applyWindowDisplayAffinity() {
  return {
    ok: false,
    available: false,
    reason: 'native-addon-not-built',
  };
}

module.exports = {
  applyWindowDisplayAffinity,
  setWindowExStyle: null,
};
