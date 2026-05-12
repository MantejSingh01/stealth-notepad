---
id: 12
title: Auto-Answer Trigger
status: planned
---

## Overview

After each Whisper transcription chunk is processed and appended to the transcript feed, the app should automatically detect if the spoken text contains a question and, if so, call `answerQuestion()` without any user interaction. A toggle in the UI lets the user disable this behaviour. A debounce guard prevents triggering while a prior AI response is still loading.

## Files to modify

- `renderer.js` — add question detection heuristic, auto-trigger call, debounce guard, "Auto-answer" toggle wiring
- `index.html` — add "Auto-answer" toggle checkbox/button in the companion/AI panel

## Key code snippets

### 1. Question detection heuristic (renderer.js)

```js
/**
 * Returns true if the transcript text appears to contain a question.
 * Checks for a trailing "?" or common interview question openers near the end.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeQuestion(text) {
  const t = text.trim().toLowerCase();
  if (t.endsWith('?')) return true;

  // Check last 120 characters for question-like phrases
  const tail = t.slice(-120);
  const patterns = [
    'can you', 'could you', 'how would', 'how do', 'how does',
    'tell me', 'explain', 'what is', 'what are', 'what would',
    'describe', 'walk me through', 'why would', 'why do',
    'have you', 'do you', 'did you',
  ];
  return patterns.some((p) => tail.includes(p));
}
```

### 2. Auto-answer state (renderer.js)

```js
let autoAnswerEnabled = true; // default on
```

### 3. Toggle wiring (renderer.js)

```js
window.addEventListener('DOMContentLoaded', () => {
  // ...existing saved content restore...
  const autoAnswerToggle = /** @type {HTMLInputElement} */ (
    document.getElementById('auto-answer-toggle')
  );
  if (autoAnswerToggle) {
    autoAnswerToggle.checked = autoAnswerEnabled;
    autoAnswerToggle.addEventListener('change', () => {
      autoAnswerEnabled = autoAnswerToggle.checked;
    });
  }
});
```

### 4. Hook into processChunk (renderer.js)

After a transcription result is appended to the transcript feed, add the auto-trigger call. Locate the `processChunk` function (or wherever `appendTranscript` is called with the Whisper result) and add:

```js
async function processChunk() {
  // ...existing blob-to-file, whisper call, appendTranscript logic...

  const transcriptText = /* the text returned by whisper */;
  appendTranscript(transcriptText, 'local');

  // Auto-answer trigger
  if (autoAnswerEnabled && !aiLoading && looksLikeQuestion(transcriptText)) {
    showAnalyzingState();
    await answerQuestion();
  }
}
```

### 5. showAnalyzingState helper (renderer.js)

```js
function showAnalyzingState() {
  const aiFeed = document.getElementById('ai-feed');
  if (!aiFeed) return;
  const el = document.createElement('div');
  el.className = 'ai-status-line';
  el.textContent = 'Analyzing...';
  el.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);font-style:italic;padding:2px 0;';
  aiFeed.appendChild(el);
  aiFeed.scrollTop = aiFeed.scrollHeight;
  // Remove after a short delay or when actual answer starts streaming in
  setTimeout(() => el.remove(), 3000);
}
```

### 6. HTML additions (index.html)

Inside the companion panel, near the transcript controls:

```html
<label id="auto-answer-label" style="display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(255,255,255,0.6);cursor:pointer;padding:4px 8px;-webkit-app-region:no-drag;">
  <input type="checkbox" id="auto-answer-toggle" checked style="cursor:pointer;" />
  Auto-answer
</label>
```

## Hotkeys / UX

No new global hotkeys. The toggle is purely in-panel. State is not persisted across restarts (always defaults to on).

If desired in a future iteration, persist to `localStorage`:
```js
autoAnswerEnabled = localStorage.getItem('auto-answer') !== 'false';
```
That is out of scope for this spec.

## Edge cases & gotchas

- **Debounce guard**: the `if (!aiLoading)` check is critical. Without it, every chunk while an AI response is streaming would queue another call. The `aiLoading` flag is already maintained by the AI functions — do not bypass it.
- **Short fragments**: Whisper sometimes emits short filler fragments ("uh", "so", "okay"). These will not match any question pattern, so they will not trigger auto-answer. No special handling needed.
- **False positives**: phrases like "can you hear me?" during setup will trigger auto-answer. This is acceptable and the user can disable the toggle if it becomes noisy.
- **answerQuestion availability**: `answerQuestion` must be callable without arguments (it reads from the current transcript feed state internally). If that function does not exist yet (it may be added by spec 07), this spec depends on it being present or stubs it.
- **Async ordering**: `processChunk` is already async. The auto-trigger `await answerQuestion()` will block `recordChunk` from starting the next chunk until the answer completes. If that is undesirable, use `answerQuestion()` without `await` and rely on `aiLoading` to prevent stacking.
- The `showAnalyzingState` element uses `setTimeout` to self-remove. If streaming is implemented (spec 11), the "Analyzing..." line will disappear before the first token of the streamed answer, which is the correct visual sequence.

## npm dependencies

None.
