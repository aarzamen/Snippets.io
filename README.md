# Snippets.io

A progressive web app for pasting, previewing, and managing HTML/JS code snippets with AI-powered tools.

## Features

- **Code Editor** — Syntax-highlighted editor with undo/redo, file upload, and auto-save drafts
- **Live Preview** — Instant iframe preview with portrait/landscape/desktop modes and built-in console
- **AI Tools** — Optimize, fix bugs, add comments, and format code (Standard, Tailwind CSS, Bootstrap) powered by Google Gemini
- **Auto-Naming** — AI generates descriptive titles from your code
- **Library** — Save, browse, edit, and export snippets (HTML, Markdown, Image, PDF)
- **Google Sign-In** — Firebase Auth with Firestore for persistent, private snippet storage
- **PWA** — Install on any device, works offline with service worker caching
- **Dark Mode** — iOS-native aesthetic with smooth light/dark transitions

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS 4, Vite 6
- **Backend**: Firebase Auth (Google SSO) + Firestore
- **AI**: Google Gemini API (`@google/genai`) — model: `gemini-2.0-flash-lite`
- **Hosting**: Cloudflare Pages (or any static host)

## Quick Start

```bash
npm install
npm run dev      # Dev server on port 3000
```

## Build & Deploy

```bash
npm run build    # Production build to dist/
npm run lint     # TypeScript type check
```

**Cloudflare Pages:**
```bash
npm install -g wrangler
wrangler login
npm run build
wrangler pages deploy dist/ --project-name snippets-io
```

## AI API Key

The app needs a Gemini API key for AI features. Three resolution paths:

1. **Environment variable**: Set `GEMINI_API_KEY` in `.env` (injected at build time)
2. **User-provided**: Enter via Settings tab — encrypted and stored locally, never transmitted
3. **No key**: App works fully without AI — features gracefully degrade with a subtle indicator

Get a free key at [Google AI Studio](https://aistudio.google.com/apikey).

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
```

## Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Gemini API key (optional — users can provide their own) |

## License

MIT
