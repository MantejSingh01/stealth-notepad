#!/usr/bin/env node
/**
 * Opt-in smoke check for the real Electron window.
 *
 * Pixel proof against Zoom, Meet, Teams, and OBS cannot be done here.
 * This only asks the live window whether Electron thinks content
 * protection is on. It is manual-only: launching the app registers a
 * global Escape shortcut and, in dev, may bind port 4444.
 *
 *   node tests/e2e/content-protection.smoke.mjs
 *   RUN_ELECTRON_SMOKE=1 node tests/e2e/content-protection.smoke.mjs
 *
 * The second form needs a display, the electron package (its install
 * script must have downloaded the binary), and playwright:
 *   npm install --no-save --package-lock=false playwright
 */

if (process.env.RUN_ELECTRON_SMOKE !== '1') {
  console.log('SKIP content-protection smoke. Set RUN_ELECTRON_SMOKE=1 on a machine with a display. See docs/TEST_PLAN.md.');
  process.exit(0);
}

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.log('SKIP content-protection smoke. No DISPLAY or WAYLAND_DISPLAY.');
  process.exit(0);
}

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);

let electronPath;
try {
  electronPath = require('electron');
} catch {
  console.log('SKIP content-protection smoke. The electron package is not installed.');
  process.exit(0);
}

let electron;
try {
  ({ _electron: electron } = await import('playwright'));
} catch {
  console.log('SKIP content-protection smoke. playwright is not installed.');
  process.exit(0);
}

const app = await electron.launch({
  executablePath: electronPath,
  args: ['.'],
});

try {
  const report = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return { error: 'no window' };
    let protectedNow = null;
    let readError = null;
    try {
      protectedNow = typeof win.isContentProtected === 'function'
        ? win.isContentProtected()
        : null;
    } catch (err) {
      readError = err.message;
    }
    return { protectedNow, readError, platform: process.platform };
  });
  console.log(JSON.stringify(report));
  if (report.platform === 'linux') {
    console.log('Linux has no Electron content-protection API. A null or false result is the current product bug, not a harness failure.');
    process.exit(0);
  }
  if (report.protectedNow !== true) {
    console.error('Content protection is not reported on. See main.js applyStealthMode.');
    process.exit(1);
  }
} finally {
  await app.close();
}
