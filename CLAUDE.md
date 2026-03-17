# Snippets.io

## Overview
A PWA for pasting, previewing, and managing HTML/JS code snippets with AI-powered tools. Runs on Google Cloud Run with Firebase backend.

## Tech Stack
- **Frontend**: React 19, TypeScript, Tailwind CSS 4, Vite 6
- **Backend**: Firebase Auth (Google SSO) + Firestore
- **AI**: Google Gemini API (`@google/genai`) — model: `gemini-2.0-flash-lite`
- **Hosting**: Google Cloud Run

## Project Structure
```
src/
  App.tsx       — Main app (PasteScreen, LibraryScreen, PreviewScreen, ApiKeyModal, TokenBadge)
  main.tsx      — Entry point + service worker registration
  firebase.ts   — Firebase init
  store.ts      — Firestore CRUD for snippets
  index.css     — Tailwind + dark mode + PrismJS overrides
public/
  manifest.json — PWA manifest
  sw.js         — Service worker (cache-first static, network-first API)
  icon.svg      — App icon
scripts/
  visual-test.mjs — Playwright screenshot tests
screenshots/   — Visual test output
```

## Key Commands
```bash
npm run dev      # Start dev server on port 3000
npm run build    # Production build to dist/
npm run lint     # TypeScript type check (tsc --noEmit)
```

## AI API Key Management
1. **Cloud Run / AI Studio**: Key injected via `GEMINI_API_KEY` env var at build time (Vite `process.env.GEMINI_API_KEY`)
2. **User fallback**: If no env key, users can enter their own Gemini API key via Settings tab — stored in `localStorage` (`gemini_api_key`), never transmitted to our servers
3. Key resolution order: env var → localStorage → prompt user

## AI Features (Pared Back)
- **Auto-naming**: Generates snippet titles from code content automatically
- **Optimize**: Improves code performance and readability
- **Fix Bugs**: Finds and fixes syntax/logic errors
- **Add Comments**: Annotates code with explanations
- **Format**: Standard, Tailwind CSS, or Bootstrap formatting
- Removed: Explain, Tests (over-engineering for a snippet tool)

## Token Usage Tracking
After each AI call, a small non-intrusive badge appears above the tab bar showing:
- Last call: prompt→completion tokens + model name
- Session cumulative: total tokens + call count

## PWA
- Service worker (`public/sw.js`): caches static assets, network-first for API/navigation
- Manifest with SVG icon (dynamically generates PNG for iOS at runtime via `index.html`)
- `apple-mobile-web-app-capable` for iOS standalone mode

## Design Philosophy
- iOS-native aesthetic (SF Pro typography, system colors, backdrop blur, rounded cards)
- Minimal chrome — content-first layout
- Light/dark mode with smooth transitions
- Accessible touch targets (44pt minimum)

## Environment Variables
```
GEMINI_API_KEY  — Gemini API key (injected by AI Studio or set in .env)
DISABLE_HMR     — Set to "true" to disable Vite HMR (used in AI Studio)
```

## Notes
- Firebase config loaded from `firebase-applet-config.json` (not committed)
- The `key` prop on PasteScreen/LibraryScreen uses explicit interface types (React 19 compat)
- `iframe.srcdoc` used for programmatic iframes (lowercase per DOM spec)
