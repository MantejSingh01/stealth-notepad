---
id: 09
title: Remove AI Room Gate
status: planned
---

## Overview

AI features (analyze screen, analyze audio, analyze both, answer question) are currently gated behind joining a collab room. The `updateCompanionStatus` function disables these buttons when `roomId` is null. This spec removes that restriction so AI works fully in solo mode with no room membership required.

## Problem

In `renderer.js`, `updateCompanionStatus(roomId)` sets `disabled = !roomId` on:
- `analyzeScreenBtn`
- `analyzeAudioBtn`
- `analyzeBothBtn`

This means users cannot use any AI features unless they are in a room. The AI pipeline itself (OpenRouter calls, screenshot capture, audio transcription) has no dependency on the room or socket. The gate is purely a UI restriction with no functional basis.

## Files to modify

- `renderer.js` — remove the AI button disabling lines from `updateCompanionStatus`

## Key code snippets

### Current code (lines ~180-185 in renderer.js)

```js
function updateCompanionStatus(roomId) {
  if (companionStatus) {
    companionStatus.textContent = roomId ? `Room: ${roomId}` : 'Not in a room';
  }
  if (captureBtn)        captureBtn.disabled        = !roomId;
  if (transcriptBtn)     transcriptBtn.disabled     = !roomId;
  if (analyzeScreenBtn)  analyzeScreenBtn.disabled  = !roomId;  // REMOVE
  if (analyzeAudioBtn)   analyzeAudioBtn.disabled   = !roomId;  // REMOVE
  if (analyzeBothBtn)    analyzeBothBtn.disabled    = !roomId;  // REMOVE
}
```

### Target code

```js
function updateCompanionStatus(roomId) {
  if (companionStatus) {
    companionStatus.textContent = roomId ? `Room: ${roomId}` : 'Not in a room';
  }
  if (captureBtn)    captureBtn.disabled    = !roomId;
  if (transcriptBtn) transcriptBtn.disabled = !roomId;
  // AI buttons are always enabled — no room required
}
```

Note: `captureBtn` and `transcriptBtn` remain gated because sharing screenshots and transcripts to a room requires an active socket connection. The AI analysis buttons only need local data (screenshot data URL or audio recording) and call OpenRouter directly — no room or socket involved.

### Also check index.html

If any AI button has `disabled` set as an HTML attribute in `index.html`, remove those attributes so the buttons start enabled on load without waiting for a room join event.

## Hotkeys / UX

No hotkey changes. AI buttons should be visually enabled (not greyed out) as soon as the companion panel opens, regardless of room state.

## Edge cases & gotchas

- `answerQuestion` button (if it exists as a separate element) must also be checked and kept enabled.
- On initial page load `updateCompanionStatus` is not called, so if the buttons are not disabled in HTML they will be enabled by default. Verify `index.html` does not have `disabled` attributes on these buttons.
- The change does not affect screenshot sharing or text syncing — those still require a room.
- If a future spec adds an `answerQuestionBtn` DOM ref, make sure it is not added to the `updateCompanionStatus` disable list.

## npm dependencies

None.
