---
id: 07-ai-analysis
status: executed
---

# Spec: AI Analysis via OpenRouter

## Overview
Add a third "AI" section to the companion panel inside the notepad window. Users can:
1. Analyze the current screenshot with AI (vision model) → answer shown in companion
2. Analyze the current audio transcript with AI → answer shown in companion
3. Analyze both screenshot + transcript together → combined AI answer
4. One global shortcut (Ctrl+Shift+A) to trigger analyze-and-answer

## API
- Provider: OpenRouter (https://openrouter.ai/api/v1) — OpenAI-compatible
- Auth: OPEN_ROUTER_KEY from .env file (already set)
- Vision model: anthropic/claude-opus-4 (supports images + text)
- SDK: use the `openai` npm package pointed at OpenRouter base URL
- Never hardcode the key

## Files to modify
| File | Change |
|---|---|
| `package.json` | Add `openai` npm dependency |
| `main.js` | Add Ctrl+Shift+A global shortcut, send 'trigger-ai-analyze' IPC to mainWindow |
| `index.html` | Add AI Answer section in companion panel (third section below transcript) |
| `renderer.js` | Add OpenRouter API call logic, button handlers, IPC listener for 'trigger-ai-analyze' |

---

## Feature: AI Answer Section

## UI changes (companion panel in index.html)
Add a third section below the transcript panel inside the existing companion panel:
- Section header: "AI Answer"
- Scrollable response area (`<div id="ai-answer-feed">`) displaying timestamped responses
- Three action buttons in the section header:
  - "Analyze Screen" — sends current screenshot to vision model
  - "Analyze Audio" — sends latest transcript text to AI
  - "Analyze Both" — sends screenshot + transcript together
- A loading spinner element (hidden by default, shown while request is in flight)
- A "Clear" button to wipe the AI answer area

Button styling should follow the existing companion panel palette using a new accent color for AI (e.g., `#f59e0b` amber) to visually distinguish from the screenshot (`#60a5fa`) and transcript (`#4ade80`) buttons.

---

## Keyboard shortcut
- Ctrl+Shift+A → triggers "Analyze Both" (screenshot + latest transcript text)
- Registered in `main.js` inside `registerHotkeys()`
- Sends `'trigger-ai-analyze'` IPC event to `mainWindow.webContents`
- `renderer.js` listens for `ipcRenderer.on('trigger-ai-analyze', ...)` and calls the analyzeAll handler

---

## Detailed implementation

### 1. package.json — add openai dependency

```json
"openai": "^4.0.0"
```

Run: `npm install openai`

The `openai` package is used pointed at OpenRouter's base URL. No new native addons — no rebuild step required.

---

### 2. main.js — Ctrl+Shift+A shortcut

Inside `registerHotkeys()`, add:

```js
// Ctrl+Shift+A — Trigger AI analysis (relayed to renderer)
globalShortcut.register('CommandOrControl+Shift+A', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('trigger-ai-analyze');
  }
});
```

No other changes to `main.js` — the AI call happens entirely in the renderer process where `process.env.OPEN_ROUTER_KEY` is accessible via `nodeIntegration: true`.

---

### 3. index.html — AI Answer section in companion panel

Locate the existing companion panel markup (the inline panel toggled via Ctrl+Shift+P). Add a third panel section after the transcript panel section:

```html
<!-- AI Answer panel -->
<div class="companion-section" id="ai-section">
  <div class="companion-section-header">
    <span style="color:#f59e0b;">AI Answer</span>
    <div style="display:flex;gap:6px;align-items:center;">
      <span id="ai-spinner" style="display:none;color:#f59e0b;font-size:11px;">analyzing...</span>
      <button class="action-btn btn-ai" id="ai-screen-btn">Analyze Screen</button>
      <button class="action-btn btn-ai" id="ai-audio-btn">Analyze Audio</button>
      <button class="action-btn btn-ai-both" id="ai-both-btn">Analyze Both</button>
      <button class="action-btn btn-ai-clear" id="ai-clear-btn">Clear</button>
    </div>
  </div>
  <div id="ai-answer-feed" class="companion-feed"></div>
</div>
```

Add the following CSS alongside the existing companion panel styles:

```css
.btn-ai {
  color: #f59e0b;
  border-color: #f59e0b;
}
.btn-ai-both {
  color: #fbbf24;
  border-color: #fbbf24;
  font-weight: 600;
}
.btn-ai-clear {
  color: rgba(255,255,255,0.4);
  border-color: rgba(255,255,255,0.2);
}
.btn-ai:disabled,
.btn-ai-both:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
#ai-answer-feed {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  font-size: 12px;
  color: rgba(255,255,255,0.85);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
```

---

### 4. renderer.js — OpenRouter API call logic

Add the following block to `renderer.js`. Place it after the existing companion-panel DOM refs and before the end of the DOMContentLoaded / init section.

#### 4a. DOM refs

```js
const aiScreenBtn   = document.getElementById('ai-screen-btn');
const aiAudioBtn    = document.getElementById('ai-audio-btn');
const aiBothBtn     = document.getElementById('ai-both-btn');
const aiClearBtn    = document.getElementById('ai-clear-btn');
const aiAnswerFeed  = document.getElementById('ai-answer-feed');
const aiSpinner     = document.getElementById('ai-spinner');
```

#### 4b. OpenAI client (pointed at OpenRouter)

```js
// Lazy-require openai so the app still loads if the package is missing
let _openaiClient = null;
function getOpenAIClient() {
  if (_openaiClient) return _openaiClient;
  const { OpenAI } = require('openai');
  _openaiClient = new OpenAI({
    apiKey: process.env.OPEN_ROUTER_KEY || '',
    baseURL: 'https://openrouter.ai/api/v1',
    dangerouslyAllowBrowser: true, // required in renderer context
    timeout: 30000,
  });
  return _openaiClient;
}
```

#### 4c. State helpers

```js
let aiLoading = false;

function setAiLoading(loading) {
  aiLoading = loading;
  aiSpinner.style.display  = loading ? 'inline' : 'none';
  aiScreenBtn.disabled     = loading;
  aiAudioBtn.disabled      = loading;
  aiBothBtn.disabled       = loading;
}

function appendAiAnswer(text) {
  const ts = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.style.cssText = 'margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:8px;';
  entry.textContent = `[${ts}]\n${text}`;
  aiAnswerFeed.appendChild(entry);
  aiAnswerFeed.scrollTop = aiAnswerFeed.scrollHeight;
}

function showAiError(msg) {
  appendAiAnswer(`Error: ${msg}`);
}
```

#### 4d. Core API call with model fallback

```js
const PRIMARY_MODEL  = 'anthropic/claude-opus-4';
const FALLBACK_MODEL = 'openai/gpt-4o';

async function callOpenRouter(messages, useModel) {
  const client = getOpenAIClient();
  try {
    const res = await client.chat.completions.create({
      model: useModel || PRIMARY_MODEL,
      messages,
      max_tokens: 1024,
    });
    return res.choices[0].message.content;
  } catch (err) {
    if (useModel !== FALLBACK_MODEL) {
      // First failure — retry with fallback model
      return callOpenRouter(messages, FALLBACK_MODEL);
    }
    throw err;
  }
}
```

#### 4e. Three analyze functions

```js
// Current screenshot data URL — kept in sync with the screenshot capture flow
// (assumes the existing screenshot capture code stores the last captured image here)
// If the companion panel already stores the last screenshot in a variable, reuse that.
// Otherwise declare: let lastScreenshotDataUrl = null; and update it on capture.

async function analyzeScreen() {
  if (!lastScreenshotDataUrl) {
    appendAiAnswer('No screenshot available. Capture a screenshot first.');
    return;
  }
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Analyze this screenshot and describe what you see. Provide any useful insights or observations.' },
        { type: 'image_url', image_url: { url: lastScreenshotDataUrl } },
      ],
    },
  ];
  return callOpenRouter(messages);
}

async function analyzeAudio() {
  const transcriptText = aiAnswerFeed
    ? (document.getElementById('transcript-feed') || {}).textContent || ''
    : '';
  const trimmed = transcriptText.trim();
  if (!trimmed) {
    appendAiAnswer('No transcript available. Start audio transcription first.');
    return null;
  }
  // Take the last 3000 characters to stay within token budget
  const context = trimmed.slice(-3000);
  const messages = [
    {
      role: 'user',
      content: `Analyze the following audio transcript and provide a concise summary, key points, and any action items:\n\n${context}`,
    },
  ];
  return callOpenRouter(messages);
}

async function analyzeBoth() {
  const transcriptText = (document.getElementById('transcript-feed') || {}).textContent || '';
  const trimmed = transcriptText.trim();
  const hasScreenshot  = !!lastScreenshotDataUrl;
  const hasTranscript  = !!trimmed;

  if (!hasScreenshot && !hasTranscript) {
    appendAiAnswer('No screenshot or transcript available. Capture a screenshot or start transcription first.');
    return null;
  }

  const content = [];

  if (hasTranscript) {
    const context = trimmed.slice(-3000);
    content.push({ type: 'text', text: `Audio transcript context:\n${context}\n\nNow analyze the screenshot below together with this transcript context. Provide a combined summary and key insights.` });
  } else {
    content.push({ type: 'text', text: 'Analyze this screenshot and describe what you see. Provide any useful insights or observations.' });
  }

  if (hasScreenshot) {
    content.push({ type: 'image_url', image_url: { url: lastScreenshotDataUrl } });
  }

  const messages = [{ role: 'user', content }];
  return callOpenRouter(messages);
}
```

#### 4f. Button event listeners

```js
async function runAnalysis(fn) {
  if (aiLoading) return;
  setAiLoading(true);
  try {
    const answer = await fn();
    if (answer) appendAiAnswer(answer);
  } catch (err) {
    showAiError(err.message || 'Unknown error');
  } finally {
    setAiLoading(false);
  }
}

aiScreenBtn.addEventListener('click', () => runAnalysis(analyzeScreen));
aiAudioBtn.addEventListener('click',  () => runAnalysis(analyzeAudio));
aiBothBtn.addEventListener('click',   () => runAnalysis(analyzeBoth));
aiClearBtn.addEventListener('click',  () => { aiAnswerFeed.innerHTML = ''; });
```

#### 4g. IPC listener for global hotkey

```js
// Ctrl+Shift+A relayed from main.js
ipcRenderer.on('trigger-ai-analyze', () => {
  runAnalysis(analyzeBoth);
});
```

#### 4h. lastScreenshotDataUrl variable integration

The existing screenshot capture code in `renderer.js` already sets a variable when a screenshot is taken (e.g., updating an `<img>` src). Add a module-level variable declaration:

```js
let lastScreenshotDataUrl = null;
```

And in the screenshot capture success callback, after setting the image src, also set:

```js
lastScreenshotDataUrl = dataUrl;
```

This ensures `analyzeScreen` and `analyzeBoth` always have access to the most recent capture.

---

## Hotkeys / UX

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+A` | Trigger "Analyze Both" (screenshot + transcript) |
| "Analyze Screen" button | Sends screenshot only to vision AI |
| "Analyze Audio" button | Sends transcript text only to AI |
| "Analyze Both" button | Sends screenshot + transcript to vision AI |
| "Clear" button | Wipes the AI answer feed |

- All three analyze buttons are disabled while a request is in flight (debounce).
- The spinner ("analyzing...") is shown inline next to the section header while loading.
- Each AI response is appended with a timestamp; the feed auto-scrolls to the latest.
- The "Clear" button is always enabled (it does not interact with the loading state).
- Buttons should follow the same disabled-when-not-in-room pattern as the existing capture and transcript buttons — if `inRoom` is false, disable them.

---

## Production-ready requirements (checklist)

- API key loaded from `process.env.OPEN_ROUTER_KEY` — never hardcoded.
- Graceful error handling: all errors caught in `runAnalysis`, displayed in the feed, never crash the app.
- Loading state: buttons disabled + spinner shown while request is in flight.
- Debounce: `aiLoading` flag prevents concurrent requests.
- Timeout: `timeout: 30000` set in the OpenAI client constructor.
- If no screenshot available: show a helpful message in the feed.
- If no transcript available: show a helpful message in the feed.
- Model fallback: `callOpenRouter` retries with `openai/gpt-4o` if `anthropic/claude-opus-4` fails.
- `require('openai')` is lazy — app still loads even if the package is not yet installed.

---

## Edge cases & gotchas

1. **Screenshot data URL size** — base64-encoded PNG for a 1280x800 capture is ~800 KB–1 MB. OpenRouter vision models accept this but it counts against token usage. If response times are slow, reduce thumbnail size to 960x600 or switch to JPEG via `thumbnail.toJPEG(70)`.

2. **OPEN_ROUTER_KEY not set** — the OpenAI client will send an empty `apiKey`. OpenRouter will reject with a 401. The error is caught and shown in the feed: "Error: 401 Unauthorized". Add a preflight check: if `!process.env.OPEN_ROUTER_KEY`, show "API key not configured" immediately.

3. **Transcript feed element ID** — the existing transcript section uses `id="transcript-feed"`. The AI functions reference it via `document.getElementById('transcript-feed')`. If this ID differs in the actual implementation, update accordingly.

4. **dangerouslyAllowBrowser: true** — required because the OpenAI SDK detects it is running in a browser context (Electron renderer). This is safe here because `nodeIntegration: true` means the key comes from `process.env`, not from user-supplied input.

5. **Model name validity** — `anthropic/claude-opus-4` is the OpenRouter model slug. Verify the exact slug at https://openrouter.ai/models before shipping. If the model is renamed, the 404 triggers the fallback to `openai/gpt-4o`.

6. **Companion panel visibility** — the AI section is always part of the companion panel DOM. If the companion panel is hidden (Ctrl+Shift+P toggled off), the hotkey Ctrl+Shift+A will still call `analyzeBoth` — the result is appended to the feed but not visible until the panel is re-opened. This is acceptable behavior.

7. **inRoom guard** — mirror the existing pattern: if `!inRoom`, disable all AI buttons and show a tooltip "Join a room first" or simply keep them disabled like the capture/transcript buttons.

8. **Large transcript truncation** — transcripts are truncated to the last 3000 characters before sending. This keeps requests within token limits. If the transcript is entirely within 3000 chars, the full text is sent.

9. **Concurrent hotkey + button press** — the `aiLoading` boolean prevents a second call from starting even if the user presses both the button and the hotkey simultaneously.

10. **npm install timing** — `openai` must be installed before the renderer tries to `require('openai')`. The lazy-require pattern returns a clear error message in the feed if the package is missing, rather than crashing on startup.

---

## npm dependencies

```
npm install openai
```

No native addons. No `electron-rebuild` step required. The `openai` package is pure JavaScript.

---

## Implementation steps (ordered)

1. Run `npm install openai` to add the dependency.
2. Add `'openai'` to `package.json` dependencies (npm install handles this).
3. Add `Ctrl+Shift+A` hotkey in `main.js` → `registerHotkeys()`.
4. Add the AI Answer section HTML to the companion panel in `index.html`.
5. Add AI Answer CSS to the companion panel styles in `index.html`.
6. Declare `lastScreenshotDataUrl = null` at module level in `renderer.js`.
7. Update the screenshot capture callback to set `lastScreenshotDataUrl = dataUrl`.
8. Add all AI renderer logic (DOM refs, client, state helpers, analyze functions, button listeners, IPC listener) to `renderer.js`.
9. Apply `inRoom` guard to disable AI buttons when not in a room.
10. Test: capture screenshot, record transcript, click each button, verify responses appear with timestamps.
11. Test: press Ctrl+Shift+A global hotkey, verify `analyzeBoth` fires.
12. Test: trigger when no screenshot / no transcript — verify helpful messages appear.
13. Test: simulate API error (bad key) — verify error shown in feed, app does not crash.
