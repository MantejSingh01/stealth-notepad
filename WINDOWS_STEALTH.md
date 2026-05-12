# Advanced Windows Stealth Implementation

## The Problem

On Windows, Electron's built-in options aren't enough for complete stealth mode. We need to call native Windows APIs to truly exclude the window from screen capture.

## The Solution: Windows API Calls

### Key Windows API: SetWindowDisplayAffinity

```cpp
BOOL SetWindowDisplayAffinity(
  HWND hWnd,           // Window handle
  DWORD dwAffinity     // Display affinity setting
);
```

**Affinity Values:**
- `WDA_NONE` (0x00000000) - Normal window (capturable)
- `WDA_MONITOR` (0x00000001) - Exclude from capture
- `WDA_EXCLUDEFROMCAPTURE` (0x00000011) - **Best for stealth** (Windows 10 2004+)

## Implementation Options

### Option 1: Node-Addon (Best but Complex)

Create a C++ addon using node-gyp:

**binding.gyp:**
```json
{
  "targets": [{
    "target_name": "stealth_addon",
    "sources": ["stealth_addon.cc"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
  }]
}
```

**stealth_addon.cc:**
```cpp
#include <napi.h>
#include <windows.h>

Napi::Value SetWindowStealth(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Window handle required").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Get window handle from Electron
  HWND hwnd = (HWND)(info[0].As<Napi::Number>().Int64Value());
  
  // Set display affinity to exclude from capture
  BOOL result = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
  
  if (!result) {
    // Fallback to older method
    result = SetWindowDisplayAffinity(hwnd, WDA_MONITOR);
  }
  
  // Additional stealth: Set window as layered with transparency
  LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
  exStyle |= WS_EX_LAYERED | WS_EX_NOREDIRECTIONBITMAP;
  SetWindowLongPtr(hwnd, GWL_EXSTYLE, exStyle);
  
  return Napi::Boolean::New(env, result);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(
    Napi::String::New(env, "setWindowStealth"),
    Napi::Function::New(env, SetWindowStealth)
  );
  return exports;
}

NODE_API_MODULE(stealth_addon, Init)
```

**Usage in Electron:**
```javascript
const stealthAddon = require('./build/Release/stealth_addon.node');

// In createWindow()
const hwnd = mainWindow.getNativeWindowHandle();
stealthAddon.setWindowStealth(hwnd.readBigInt64LE(0));
```

### Option 2: PowerShell Bridge (Simpler, Less Reliable)

```javascript
const { exec } = require('child_process');

function setWindowStealth(windowTitle) {
  const psScript = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class WindowAPI {
        [DllImport("user32.dll")]
        public static extern IntPtr FindWindow(string className, string windowName);
        [DllImport("user32.dll")]
        public static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
      }
"@
    
    $hwnd = [WindowAPI]::FindWindow($null, "${windowTitle}")
    [WindowAPI]::SetWindowDisplayAffinity($hwnd, 0x00000011)
  `;
  
  exec(`powershell -Command "${psScript}"`, (error, stdout, stderr) => {
    if (error) console.error('Stealth mode failed:', error);
  });
}

// Usage
setWindowStealth('Stealth Notepad');
```

### Option 3: electron-affinity Package (Easiest)

```bash
npm install electron-affinity
```

```javascript
const { setWindowDisplayAffinity } = require('electron-affinity');

// In main.js after window creation
const hwnd = mainWindow.getNativeWindowHandle();
setWindowDisplayAffinity(hwnd, 0x00000011); // WDA_EXCLUDEFROMCAPTURE
```

## Complete Implementation Guide

### Step 1: Install Build Tools

```bash
npm install -g windows-build-tools
npm install node-gyp
npm install node-addon-api
```

### Step 2: Create binding.gyp

Save as `binding.gyp` in project root:
```json
{
  "targets": [{
    "target_name": "stealth",
    "sources": ["native/stealth.cc"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "msvs_settings": {
      "VCCLCompilerTool": {
        "ExceptionHandling": 1
      }
    }
  }]
}
```

### Step 3: Create C++ Addon

Create `native/stealth.cc` (full code above)

### Step 4: Build Addon

```bash
node-gyp configure
node-gyp build
```

### Step 5: Use in Electron

```javascript
// main.js
let stealthModule;
try {
  stealthModule = require('./build/Release/stealth.node');
} catch (e) {
  console.log('Native stealth module not available');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // ... your config
  });
  
  if (process.platform === 'win32' && stealthModule) {
    const hwnd = mainWindow.getNativeWindowHandle();
    const hwndBuffer = hwnd.readBigInt64LE(0);
    stealthModule.setWindowStealth(hwndBuffer);
    console.log('✅ Windows stealth mode activated');
  }
}
```

## Testing Stealth Mode

### Test 1: Screen Capture API Test
```javascript
// Test if window is excluded
navigator.mediaDevices.getDisplayMedia({ video: true })
  .then(stream => {
    // Stealth window should not appear in preview
  });
```

### Test 2: OBS Test
1. Open OBS
2. Add "Display Capture" source
3. Start recording
4. Open Stealth Notepad
5. Should NOT appear in recording

### Test 3: Zoom Test
1. Join Zoom meeting
2. Share screen
3. Open Stealth Notepad
4. Should be invisible to other participants

## Compatibility

| Windows Version | Support |
|----------------|---------|
| Windows 11 | ✅ Full support |
| Windows 10 (2004+) | ✅ WDA_EXCLUDEFROMCAPTURE |
| Windows 10 (older) | ⚠️ WDA_MONITOR only |
| Windows 8.1 | ⚠️ Limited |
| Windows 7 | ❌ No support |

## Troubleshooting

### "node-gyp not found"
```bash
npm install -g node-gyp
```

### "Python not found"
```bash
npm install --global windows-build-tools
```

### Still visible in screen share
- Check Windows version (must be 10 2004+)
- Verify build was successful
- Check console for errors
- Try running as Administrator

## Security Considerations

⚠️ **Important**: This is powerful technology. Use responsibly!

**Legitimate uses:**
- Privacy-focused applications
- Secure note-taking
- Password managers
- Confidential work

**Do NOT use for:**
- Cheating on exams
- Bypassing workplace monitoring
- Malicious purposes
- Violating terms of service

## Advanced: Multi-Monitor Support

```cpp
// Check if window is on a captured monitor
BOOL IsWindowOnCapturedMonitor(HWND hwnd) {
  HMONITOR hMonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  // Additional logic to detect if monitor is being captured
  return FALSE; // Return TRUE if detected
}
```

## Resources

- [Microsoft Docs - SetWindowDisplayAffinity](https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)
- [Node-Addon-API Documentation](https://github.com/nodejs/node-addon-api)
- [Electron Native Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

---

**Pro Tip**: Always test on multiple Windows versions and with different screen capture software!
