# Snippets.io

## What This Is
A standalone progressive web app (PWA) for pasting, previewing, and managing HTML/JS code snippets with AI-powered tools. Originally prototyped in Google AI Studio, now an independent application deployed to Cloudflare Pages with its own Firebase backend.

**This is NOT an AI Studio applet anymore.** It is a self-contained app with its own repo, deployment, and infrastructure.

## Current State (March 2026)

### What Works
- Code editor with PrismJS syntax highlighting, undo/redo (50-step), file upload
- Live iframe preview with portrait/landscape/desktop modes and console interception
- AI toolbar: Optimize, Fix Bugs, Add Comments, Format (Standard/Tailwind/Bootstrap)
- Auto-naming via Gemini (generates snippet titles from code content)
- Token usage tracking (per-call and cumulative session badge)
- Google Sign-In via Firebase Auth (Google SSO)
- Firestore snippet persistence (per-user, security-rule isolated)
- Export: HTML, Markdown, Image (JPG via html2canvas), multi-page PDF (jsPDF)
- PWA: service worker, manifest, installable, offline-capable
- Dark mode with iOS-native design aesthetic
- API key encrypted with AES-GCM + PBKDF2 in localStorage (not plaintext)
- Graceful degradation when AI unavailable (auto-dismissing error, app still works)

### Known Issues / TODO
1. **Firebase config is hardcoded** — `firebase-applet-config.json` contains the original AI Studio project's config. Needs decision: keep using that Firebase project, or create a new standalone one.
2. **Firestore security rules** — need to verify/update rules on the Firebase project to match standalone deployment.
3. **No offline snippet storage** — currently requires Firebase auth + Firestore. If user is offline or not signed in, snippets only persist as a single draft in localStorage. Consider IndexedDB via `idb-keyval` (already in package.json but unused).
4. **PDF export relies on CDN** — html2canvas loaded from CloudFlare CDN at runtime inside a sandboxed iframe. Will fail without internet. Could bundle it.
5. **No tests** — visual test scripts exist (Playwright screenshots) but no unit or integration tests.
6. **Bundle size** — 1.5MB main chunk. Could code-split jsPDF, firebase, html2canvas.
7. **The `idb-keyval` package** is in dependencies but not imported anywhere. Was intended for local-first snippet storage.

## Tech Stack
- **Frontend**: React 19, TypeScript, Tailwind CSS 4, Vite 6
- **Backend**: Firebase Auth (Google SSO) + Firestore
- **AI**: Google Gemini API (`@google/genai`) — model: `gemini-2.0-flash-lite`
- **Hosting**: Cloudflare Pages (`wrangler.toml` in repo root)

## Project Structure
```
src/
  App.tsx       — Main app (~1200 lines, single-file SPA)
                  Components: PasteScreen, LibraryScreen, PreviewScreen, ApiKeyModal, TokenBadge
                  Helpers: getApiKey, encryptAndStore, decryptStored, injectMobileMeta, injectConsoleInterceptor
  main.tsx      — Entry point + service worker registration
  firebase.ts   — Firebase init (reads firebase-applet-config.json)
  store.ts      — Firestore CRUD: getSnippets, saveSnippet, deleteSnippet
  index.css     — Tailwind v4 import + dark mode variant + PrismJS dark overrides + iOS safe areas
public/
  manifest.json — PWA manifest (standalone, theme color #007AFF)
  sw.js         — Service worker: cache-first static, network-first API/Firestore/navigation
  icon.svg      — App icon (dark gradient with code brackets + indigo slash)
index.html      — Shell HTML with runtime PNG icon generation from SVG (for iOS)
wrangler.toml   — Cloudflare Pages config
scripts/
  test-pdf-export.mjs  — Node test that generates multi-page PDF to verify export
  visual-test.mjs      — Playwright screenshot tests
  generate-icons.js    — Icon generation helper
```

## Key Commands
```bash
npm run dev      # Dev server on port 3000
npm run build    # Production build → dist/
npm run lint     # TypeScript type check (tsc --noEmit)
```

## Architecture Decisions

### API Key Security
User-provided Gemini API keys are encrypted before localStorage storage:
1. A device fingerprint (user-agent + screen dimensions) is used as PBKDF2 passphrase
2. AES-GCM encryption with random salt + IV per storage operation
3. Legacy plaintext keys auto-migrated to encrypted format on first access
4. Key resolution chain: env var (`GEMINI_API_KEY`) → encrypted localStorage → prompt user modal

### AI Prompt Design
AI action prompts are structured for reliability with mid-tier models:
- Each prompt includes a PREAMBLE enforcing raw-code-only output
- Concrete checklists of what to look for (not vague instructions)
- Fix Bugs specifically checks: unclosed tags, missing brackets, broken attributes, invalid CSS
- Optimize targets: DOM caching, CSS transforms, debouncing, dead code removal
- Format includes framework CDN injection and responsive patterns
- Auto-title generation is non-critical and fails silently

### Graceful Degradation (AI)
- If no API key: "Add Key" badge shown in header, AI buttons visible but open key modal on click
- If key invalid/expired: one-time auto-dismissing error banner (5s), app continues working
- All non-AI features (editor, preview, save, export, library) work without any API key
- Console errors are debug-level, not error-level

### PDF Multi-Page Export
1. Content rendered in a hidden iframe at 390px width
2. html2canvas captures at 2x scale
3. Canvas sliced into 390x844px page chunks (iPhone 14 Pro portrait)
4. Each slice drawn onto a fresh canvas with white background fill
5. Slices assembled as JPEG images into jsPDF document
6. Each page is a self-contained image (no cross-page rendering artifacts)

### Firebase
- Config loaded from `firebase-applet-config.json` (not committed to git via .gitignore pattern, but currently tracked — needs cleanup)
- Firestore database ID: `ai-studio-cd13e509-b562-49e7-9aa8-82d4c58d9cc8`
- Auth: Google provider only, popup flow
- Store: `snippets` collection, documents keyed by UUID, filtered by `userId`

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | No | Gemini API key. If unset, users provide their own via Settings tab |

## Deployment
```bash
# Cloudflare Pages
npm run build
wrangler pages deploy dist/ --project-name snippets-io

# Or connect GitHub repo to Cloudflare Pages dashboard
# Build command: npm run build
# Output directory: dist
```

## Decision Points for Next Session
1. **Firebase vs local-first**: Keep Firebase for persistence, or switch to IndexedDB-only with optional Firebase sync?
2. **Firebase project**: Keep the AI Studio Firebase project, or create a dedicated one?
3. **OpenRouter support**: Should AI features support alternative providers beyond Gemini?
4. **Bundle optimization**: Code-split the 1.5MB main chunk?
5. **Testing**: Add Vitest unit tests for encryption, export, store logic?
