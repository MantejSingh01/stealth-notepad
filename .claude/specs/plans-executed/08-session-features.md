---
id: 08-session-features
status: in-progress
---

# Session Features (ParakeetAI Parity)

## Features to implement

### 1. Session Context Modal
- On clicking "Start Session" button (or auto on first Transcribe click), show a modal overlay inside the notepad window
- Fields: Company (text), Role/Position (text), Language (dropdown: English, Hindi, Spanish, French, German, Portuguese, Arabic, Chinese, Japanese)
- "Start" button saves context, dismisses modal
- Context stored as: { company, role, language } in a sessionContext variable
- This context is injected as system prompt in ALL AI calls: "You are helping a {role} candidate interviewing at {company}. Answer concisely and professionally."
- Show a small "Session: {company} · {role}" badge in the companion header when active
- "Change Session" link to re-open modal

### 2. Answer Question button
- New amber button "💬 Answer Question" in the AI section alongside existing buttons
- Takes last 10 transcript lines → sends to AI with prompt: "From this transcript, identify the most recent interview question asked. First output 'Question: <clean question>' then output 'Answer: <structured answer tailored to the session context>'"
- Renders result with markdown (bold, bullets)
- Uses session context as system prompt if set

### 3. Markdown rendering in AI feed
- All AI responses rendered as markdown (not plain text)
- Use a simple markdown parser — implement a lightweight renderMarkdown(text) function that converts:
  - **bold** → <strong>bold</strong>
  - *italic* → <em>italic</em>
  - bullet lines starting with - or * or • → <ul><li>...</li></ul>
  - ### headings → <strong style="font-size:12px">
  - Numbered lists 1. 2. 3. → <ol><li>
  - Newlines → proper line breaks
- Apply to appendAiEntry() so all AI responses render markdown
- IMPORTANT: sanitize HTML to prevent XSS — only allow the above tags

### 4. Auto-scroll toggle
- Toggle button in the AI Answer section header: "Auto-scroll ●" (amber when on, dim when off)
- Default: ON
- When ON: AI feed scrolls to bottom on each new entry
- When OFF: feed stays at current scroll position

### 5. Session timer
- Shows in companion header next to session badge: "⏱ 00:00"
- Starts when user joins/creates a room OR starts transcribing (whichever comes first)
- Counts up every second
- Format: MM:SS, switches to HH:MM:SS after 1 hour
- Reset when leaving room

### 6. Collapse to bar mode
- New button in notepad title bar: a "—" collapse icon
- When clicked: window shrinks to 48px tall strip showing only: 🔒 icon + "Stealth Notepad" + expand button
- Click the strip to expand back to full size
- Stores previous size (with or without companion) to restore correctly
- IPC: ipcMain.on('collapse-to-bar') → mainWindow.setSize(600, 48), ipcMain.on('expand-from-bar') → restore previous size

### 7. Multiple languages for Whisper
- Language selector in transcript section (small dropdown): English, Hindi, Spanish, French, German, Auto-detect
- When transcribing, pass selected language to nodejs-whisper: whisperOptions.language = selectedLang code (en, hi, es, fr, de, or empty string for auto)
- Default: English

## Files to change
- main.js: collapse/expand IPC handlers
- index.html: session modal, Answer Question button, auto-scroll toggle, timer display, collapse button, language selector, markdown CSS
- renderer.js: all feature logic

## Key notes
- Session modal should be a dark-glass overlay matching app style
- All new UI elements match existing dark-glass aesthetic
- Answer Question button same amber color as other AI buttons
- Language codes for whisper: en, hi, es, fr, de, '' (auto)
