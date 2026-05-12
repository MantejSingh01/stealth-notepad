# 🚀 Quick Start Guide

## Installation (5 minutes)

### 1. Install Node.js
Download from: https://nodejs.org/
(Choose LTS version - Long Term Support)

### 2. Open Terminal/Command Prompt
- **Windows**: Press `Win + R`, type `cmd`, press Enter
- **macOS**: Press `Cmd + Space`, type `Terminal`, press Enter
- **Linux**: Press `Ctrl + Alt + T`

### 3. Navigate to Project Folder
```bash
cd path/to/stealth-notepad
```

### 4. Install Dependencies
```bash
npm install
```

Wait 2-3 minutes for installation to complete.

### 5. Run the App
```bash
npm start
```

## 🎯 First Time Usage

### Launch
- The app starts **hidden** by default
- You won't see it immediately - this is normal!

### Show the Notepad
Press: `Ctrl + Shift + N` (Windows/Linux) or `Cmd + Shift + N` (macOS)

### Start Typing
- Window is draggable - click and drag the title bar
- Type anything you want
- It auto-saves automatically!

### Hide Quickly
Press: `ESC` key

## ⌨️ Keyboard Shortcuts Cheat Sheet

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+N` | Show/Hide window |
| `Ctrl+Shift+C` | Clear all text |
| `Ctrl+Shift+S` | Copy to clipboard |
| `ESC` | Quick hide |

> **Tip**: Use `Cmd` instead of `Ctrl` on macOS

## 🔒 Using During Screen Share

### Before Screen Sharing:
1. Open the app (`Ctrl+Shift+N`)
2. Position it somewhere convenient
3. Start your screen share

### During Screen Share:
- The notepad window should be invisible to others
- Toggle visibility with `Ctrl+Shift+N`
- Take notes freely!

### Zoom Users - IMPORTANT:
1. Update Zoom to latest version
2. Go to: Settings → Share Screen → Advanced
3. Enable: "Use advanced window filters"
4. Restart Zoom

## 🎨 Customization

### Change Window Size:
1. Open `main.js` in any text editor
2. Find line 8-9:
```javascript
width: 600,  // Change this number
height: 400, // Change this number
```
3. Save and restart app

### Change Transparency:
1. Open `index.html`
2. Find line ~34:
```css
background: rgba(0, 0, 0, 0.85);
```
3. Change `0.85` to any value between 0 (fully transparent) and 1 (opaque)
4. Save and refresh

## 🐛 Common Issues

### "npm: command not found"
→ Node.js not installed. Go back to Step 1.

### Hotkeys not working
→ Try running with admin/sudo privileges:
```bash
sudo npm start  # macOS/Linux
# Run as Administrator on Windows
```

### Still visible during screen share
→ Check platform-specific fixes in README.md

### App won't start
→ Check console for errors:
```bash
npm start 2>&1 | tee debug.log
```

## 📦 Building Standalone App

Want an .exe or .app file? Build it:

**Windows:**
```bash
npm run build:win
```
Find in: `dist/Stealth Notepad Setup.exe`

**macOS:**
```bash
npm run build:mac
```
Find in: `dist/Stealth Notepad.dmg`

**Linux:**
```bash
npm run build:linux
```
Find in: `dist/Stealth Notepad.AppImage`

## ✅ Testing Stealth Mode

### Test 1: Screen Share Test
1. Open Zoom/Teams/Meet
2. Start a test meeting
3. Share your screen
4. Open Stealth Notepad (`Ctrl+Shift+N`)
5. Check if visible to others

### Test 2: Screenshot Test
1. Open Stealth Notepad
2. Take a screenshot (PrtScn/Cmd+Shift+4)
3. Check if notepad appears in screenshot

### Test 3: Screen Recording
1. Start OBS/QuickTime screen recording
2. Open Stealth Notepad
3. Stop recording and review
4. Notepad should NOT appear

## 💡 Pro Tips

1. **Remember the shortcut**: `Ctrl+Shift+N` - Practice it a few times!
2. **Position strategically**: Place window where your eyes naturally look
3. **Use ESC for quick hide**: Fastest way to hide in emergencies
4. **Auto-save is your friend**: Never worry about losing notes
5. **Clipboard shortcut**: `Ctrl+Shift+S` copies everything instantly

## 🎓 Next Steps

- Read full `README.md` for technical details
- Customize hotkeys in `main.js`
- Adjust UI styling in `index.html`
- Build standalone executable
- Star the repo if you find it useful! ⭐

---

**Need Help?** Open an issue on GitHub or check the main README.md

**Happy Stealthy Note-Taking!** 🎉
