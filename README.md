# 🔒 Stealth Notepad

A desktop notepad application that remains **invisible during screen sharing** - built with Electron and JavaScript.

## 🎯 Key Features

### ✨ Stealth Mode Technology
- **Invisible during screen sharing** on Zoom, Teams, Google Meet, etc.
- **Transparent overlay window** with blur effects
- **Platform-specific stealth implementations**:
  - **Windows**: Uses `WDA_EXCLUDEFROMCAPTURE` flag
  - **macOS**: `setContentProtection(true)` API
  - **Linux**: Always-on-top transparent window

### ⌨️ Keyboard-First Operation
No mouse clicks needed - complete stealth:
- `Ctrl+Shift+N` - Toggle show/hide
- `Ctrl+Shift+C` - Clear all text
- `Ctrl+Shift+S` - Save to clipboard
- `ESC` - Quick hide

### 💾 Auto-Save
Your notes are automatically saved locally (uses localStorage)

### 🎨 Beautiful UI
- Dark transparent theme with glassmorphism
- Draggable window
- Minimal and distraction-free

## 🚀 Installation & Setup

### Prerequisites
```bash
Node.js (v16 or higher)
npm or yarn
```

### Step 1: Install Dependencies
```bash
cd stealth-notepad
npm install
```

### Step 2: Run in Development
```bash
npm start
```

### Step 3: Build for Your Platform
```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

The built app will be in the `dist/` folder.

## 🔧 How It Works

### The Stealth Technology Explained

#### 1. **Transparent Overlay Window**
```javascript
transparent: true,
alwaysOnTop: true,
skipTaskbar: true,
frame: false
```

#### 2. **Platform-Specific Screen Capture Exclusion**

**macOS:**
```javascript
mainWindow.setContentProtection(true);
```
This uses Apple's Screen Recording API to mark the window as non-recordable.

**Windows:**
```javascript
SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
```
This Windows API call excludes the window from:
- Desktop Duplication API (used by most screen recorders)
- BitBlt/PrintWindow captures
- OBS, Zoom, Teams screen sharing

**Linux:**
```javascript
// Transparent window with always-on-top
// Not fully stealth but harder to detect
```

#### 3. **Global Keyboard Shortcuts**
Uses Electron's `globalShortcut` API to register system-wide hotkeys that work even when the window is hidden or unfocused.

#### 4. **No Taskbar/Dock Presence**
```javascript
skipTaskbar: true
```
Window doesn't appear in Alt+Tab or taskbar.

## 📋 Technical Architecture

```
stealth-notepad/
├── main.js              # Main Electron process (stealth logic)
├── renderer.js          # Renderer process (UI logic)
├── index.html           # UI interface
├── native-helper.js     # Native Windows API wrapper
├── package.json         # Dependencies & build config
└── entitlements.mac.plist  # macOS permissions
```

## 🔐 Stealth Mode Comparison

| Feature | Stealth Notepad | Regular Notepad | Parakeet AI |
|---------|----------------|-----------------|-------------|
| Invisible during screen share | ✅ | ❌ | ✅ |
| Keyboard shortcuts | ✅ | ❌ | ✅ |
| No taskbar presence | ✅ | ❌ | ✅ |
| Transparent overlay | ✅ | ❌ | ✅ |
| Auto-save | ✅ | ⚠️ | ✅ |
| AI-powered responses | ❌ | ❌ | ✅ |

## ⚠️ Important Notes

### Limitations
1. **Windows**: Requires Windows 10 build 2004+ for `WDA_EXCLUDEFROMCAPTURE`
2. **macOS**: Some screen recorders can still capture if user grants special permissions
3. **Zoom**: Update to latest version and enable "Advanced capture with window filtering"
4. **Not foolproof**: Sophisticated monitoring software may detect it

### Ethical Considerations
This tool is for **educational purposes** and legitimate use cases like:
- Personal productivity
- Privacy-focused note-taking
- Accessibility features
- Learning about Electron and native APIs

**Do NOT use** to:
- Cheat on exams or interviews
- Violate terms of service
- Bypass security monitoring in professional settings

## 🛠️ Advanced Customization

### Change Hotkeys
Edit `main.js` line 60-80:
```javascript
globalShortcut.register('YourCustomHotkey', () => {
  // Your action
});
```

### Adjust Transparency
Edit `index.html` line 34:
```css
background: rgba(0, 0, 0, 0.85); /* 0.85 = 85% opacity */
```

### Window Size
Edit `main.js` line 8-9:
```javascript
width: 600,  // Adjust width
height: 400, // Adjust height
```

## 🐛 Troubleshooting

### Window still visible in screen share?

**Zoom Users:**
1. Update Zoom to latest version
2. Settings → Share Screen → Advanced
3. Enable "Use advanced window filters"

**OBS Users:**
- OBS uses Desktop Duplication API (Windows) which is blocked
- If still visible, check OBS capture mode settings

**macOS Users:**
- Grant Screen Recording permissions in System Preferences
- Restart app after granting permissions

### Hotkeys not working?
- Check if another app is using the same hotkey
- Run with admin/root privileges
- Check console for errors

## 📦 Building from Source

### Windows
```bash
npm install --save-dev @electron/rebuild
npm install --save-dev windows-build-tools
npm run build:win
```

### macOS (Code Signing)
```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run build:mac
```

## 🤝 Contributing

This is an educational project. Contributions welcome for:
- Better cross-platform stealth implementations
- UI improvements
- Bug fixes
- Documentation

## 📄 License

MIT License - See LICENSE file

## ⚡ Tech Stack

- **Electron** 28.0+ - Desktop app framework
- **Node.js** - Runtime
- **JavaScript** - No frameworks, pure JS
- **HTML/CSS** - UI
- **Native APIs** - Windows/macOS screen capture exclusion

## 🎓 Learning Resources

Want to learn more about building stealth apps?

1. **Electron Documentation**: https://www.electronjs.org/docs
2. **Windows API**: SetWindowDisplayAffinity documentation
3. **macOS APIs**: NSWindow content protection
4. **Screen Capture APIs**: Understanding desktop duplication

---

**Built with JavaScript** - No need for native languages! 🚀

**Remember**: Use responsibly and ethically! 🔒
