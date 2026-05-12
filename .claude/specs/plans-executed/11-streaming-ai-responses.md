---
id: 11
title: Streaming AI Responses
status: planned
---

## Overview

Currently AI responses from OpenRouter arrive as a single completed payload after the full inference is done. This spec switches all AI calls to streaming mode so tokens appear in the UI as they are generated. A "thinking" animated indicator is shown before the first token arrives. Streaming applies to all four AI entry points: `analyzeScreen`, `analyzeAudio`, `analyzeBoth`, and `answerQuestion`.

## Files to modify

- `renderer.js` — rewrite the OpenRouter fetch calls to use `stream: true` and SSE parsing; add a "thinking" indicator; update all four AI functions

## Key code snippets

### 1. Core streaming fetch helper (renderer.js)

```js
/**
 * Calls OpenRouter with streaming and appends tokens to the AI feed as they arrive.
 * Returns the full assembled text when the stream ends.
 *
 * @param {object} payload - Full OpenRouter request body (without `stream` field)
 * @param {HTMLElement} feedEl - The feed element to append tokens into
 * @returns {Promise<string>} - Resolved with the full response text
 */
async function streamOpenRouter(payload, feedEl) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...payload, stream: true }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  }

  // Create the answer bubble with a thinking indicator
  const bubble = appendAiBubble(feedEl, '');
  const thinkingDot = appendThinkingIndicator(bubble);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let firstToken = true;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      let parsed;
      try { parsed = JSON.parse(data); } catch (_) { continue; }

      const token = parsed?.choices?.[0]?.delta?.content;
      if (!token) continue;

      if (firstToken) {
        thinkingDot.remove();
        firstToken = false;
      }

      fullText += token;
      bubble.textContent = fullText;
      feedEl.scrollTop = feedEl.scrollHeight;
    }
  }

  return fullText;
}
```

### 2. Thinking indicator helper (renderer.js)

```js
/**
 * Appends an animated thinking indicator inside a bubble element.
 * @param {HTMLElement} bubble
 * @returns {HTMLElement}
 */
function appendThinkingIndicator(bubble) {
  const dot = document.createElement('span');
  dot.className = 'thinking-dot';
  dot.textContent = '...';
  dot.style.cssText = 'opacity:0.5;animation:pulse 1s infinite;';
  bubble.appendChild(dot);
  return dot;
}
```

Add to `index.html` `<style>` block:
```css
@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.thinking-dot { font-style: italic; }
```

### 3. Bubble creation helper (renderer.js)

```js
/**
 * Creates a new AI answer bubble in the feed and returns it.
 * @param {HTMLElement} feedEl
 * @param {string} initialText
 * @returns {HTMLElement}
 */
function appendAiBubble(feedEl, initialText) {
  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble';
  bubble.textContent = initialText;
  feedEl.appendChild(bubble);
  feedEl.scrollTop = feedEl.scrollHeight;
  return bubble;
}
```

### 4. Update analyzeScreen to use streaming (renderer.js)

Replace the existing `analyzeScreen` fetch block:

```js
async function analyzeScreen() {
  if (aiLoading || !lastScreenshotDataUrl) return;
  aiLoading = true;
  setAiLoading(true);

  const aiFeed = document.getElementById('ai-feed');
  try {
    await streamOpenRouter({
      model: 'anthropic/claude-3.5-sonnet',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: lastScreenshotDataUrl } },
          { type: 'text', text: 'Analyze this screenshot. Identify the key question or task being presented.' },
        ],
      }],
    }, aiFeed);
  } catch (err) {
    appendAiBubble(aiFeed, `Error: ${err.message}`);
  } finally {
    aiLoading = false;
    setAiLoading(false);
  }
}
```

### 5. Update analyzeAudio, analyzeBoth, answerQuestion similarly

All four functions follow the same pattern: replace the one-shot `fetch` + `await res.json()` with `await streamOpenRouter(payload, aiFeed)`. The payload construction (model, messages, content) stays the same — only the response handling changes.

### 6. setAiLoading helper

```js
/**
 * Disables/enables AI action buttons and shows a loading state.
 * @param {boolean} loading
 */
function setAiLoading(loading) {
  [analyzeScreenBtn, analyzeAudioBtn, analyzeBothBtn].forEach((btn) => {
    if (btn) btn.disabled = loading;
  });
  const answerBtn = document.getElementById('answer-question-btn');
  if (answerBtn) answerBtn.disabled = loading;
}
```

## Hotkeys / UX

No hotkey changes. Visual changes:
- Before first token: animated "..." appears inside the answer bubble
- Tokens stream in left-to-right, bubble grows as text appends
- Feed auto-scrolls to bottom as tokens arrive
- All AI buttons disabled while a stream is in progress (`aiLoading = true`)
- Existing `setAiLoading` / `aiLoading` flag already exists — extend it rather than replace

## Edge cases & gotchas

- The SSE stream can include lines that are not `data:` prefixed (e.g., comments or empty lines). The parser must skip those silently.
- `[DONE]` sentinel signals end of stream. After seeing it, break out of the line loop but the outer `while` loop will also end on the next `reader.read()` returning `{ done: true }`.
- If the fetch response is not ok (4xx/5xx), the stream body may not be valid SSE. Read it as text and throw a descriptive error.
- If the user closes the companion panel mid-stream, the `reader` will still be consuming. Consider storing the reader reference and calling `reader.cancel()` in `toggleCompanion` when closing.
- `fetch` is available in Electron renderer without polyfills (Chromium built-in).
- The `process.env` values are accessible in renderer because `nodeIntegration: true` and `contextIsolation: false` are set.
- Do not use `TextDecoder` in stream mode if chunks can be split mid-JSON line. The `{ stream: true }` option to `decode()` handles this correctly by buffering partial sequences.

## npm dependencies

None. Uses native `fetch` and `ReadableStream` APIs already available in Electron's Chromium renderer.
