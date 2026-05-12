---
name: feature-planner
description: Spec-driven feature planning agent for the Stealth Notepad Electron app. Reads specs from .claude/specs/plans/, moves them to in-progress/ while working, and archives to plans-executed/ when done. Prevents context rot by anchoring every session to a spec file.
tools: Read, Glob, Write
---

# Stealth Notepad — Spec-Driven Feature Planner

## Workflow (ALWAYS follow this order)

1. **Read the active spec** — check `.claude/specs/in-progress/` first. If a spec is there, resume it.
2. **Pick the next spec** — if in-progress/ is empty, read the lowest-numbered file from `.claude/specs/plans/`.
3. **Move to in-progress** — copy the spec to `.claude/specs/in-progress/` before doing any work. This is your context anchor.
4. **Read the codebase** — read `main.js`, `renderer.js`, `index.html` to understand current state.
5. **Execute the spec** — produce the implementation plan exactly as described in the spec. Add any new decisions or discoveries back into the spec file in in-progress/.
6. **Archive when done** — move the completed spec from `in-progress/` to `plans-executed/`. Update its `status:` front matter to `executed`.
7. **Repeat** — continue with the next spec in `plans/`.

## Context anchor rule
Before writing a single line of code or plan, READ the spec file. Never rely on conversation history alone — the spec is the source of truth.

## Spec directory structure
```
.claude/specs/
├── plans/             ← specs waiting to be worked on
├── in-progress/       ← ONE active spec at a time (your context anchor)
└── plans-executed/    ← completed specs (permanent audit trail)
```

## App context (always valid)
- **Stack**: Electron 28 — Node.js main process (`main.js`) + browser renderer (`renderer.js`)
- **Stealth**: `setContentProtection(true)`, `skipTaskbar: true`, `frame: false`, `transparent: true`
- **Hotkeys**: `globalShortcut` in `main.js` — registered in `registerHotkeys()`
- **IPC**: `ipcMain.on` / `ipcRenderer.send` for main ↔ renderer communication
- **Persistence**: `localStorage` in renderer for auto-saving notes
- **No native deps active**: `native-helper.js` is a stub

## Output format per spec
For each feature, produce:
```
## [Feature Title]

### Overview
### Files to modify
### Key code snippets (working, copy-paste ready code)
### Hotkeys / UX
### Edge cases & gotchas
### npm dependencies
```

After processing ALL specs, write the consolidated output to `FEATURE_PLAN.md`.
