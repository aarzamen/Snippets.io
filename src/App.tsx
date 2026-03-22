import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Folder, Play, Save, Trash2, ChevronLeft, ChevronDown, FileCode2, Monitor, Smartphone, Download, Sun, Moon, ChevronRight, Sparkles, Loader2, Wand2, Bug, MessageSquare, Undo, Redo, Terminal, Copy, Check, AlignLeft, Upload, LogIn, LogOut, Settings, X, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSnippets, saveSnippet, deleteSnippet, Snippet } from './store';
import { jsPDF } from 'jspdf';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import { GoogleGenAI } from '@google/genai';
import { auth } from './firebase';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

// ─── Token Usage Tracking ────────────────────────────────────────────
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  timestamp: number;
}

interface CumulativeUsage {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  callCount: number;
}

// ─── API Key Management (encrypted localStorage) ────────────────────
// Uses SubtleCrypto AES-GCM with a device-derived key so the raw API key
// is never stored as plaintext. The encryption key is derived from a
// stable device fingerprint via PBKDF2, making it non-transferable and
// opaque to casual inspection of localStorage / DevTools.

const STORAGE_KEY = 'gemini_api_key_enc';
const SALT_KEY = 'gemini_api_key_salt';

async function deriveEncryptionKey(salt: Uint8Array): Promise<CryptoKey> {
  // Use a stable device fingerprint as the passphrase — not perfect security
  // (it's client-side after all) but prevents plaintext exposure in localStorage
  const fingerprint = `snippets.io:${navigator.userAgent}:${screen.width}x${screen.height}`;
  const raw = new TextEncoder().encode(fingerprint);
  const baseKey = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptAndStore(plainKey: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encKey = await deriveEncryptionKey(salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encKey,
    new TextEncoder().encode(plainKey)
  );
  // Store salt, iv, and ciphertext as base64
  const payload = JSON.stringify({
    s: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  });
  localStorage.setItem(STORAGE_KEY, payload);
  // Remove any legacy plaintext key
  localStorage.removeItem('gemini_api_key');
}

async function decryptStored(): Promise<string | null> {
  // Migrate legacy plaintext key if present
  const legacy = localStorage.getItem('gemini_api_key');
  if (legacy && legacy.length > 10) {
    await encryptAndStore(legacy);
    localStorage.removeItem('gemini_api_key');
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const { s, iv, ct } = JSON.parse(raw);
    const salt = Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(ct), c => c.charCodeAt(0));
    const encKey = await deriveEncryptionKey(salt);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, encKey, ciphertext);
    return new TextDecoder().decode(plainBuf);
  } catch {
    return null;
  }
}

function getApiKeySync(): string | null {
  // Fast synchronous check — env var only (used for initial render state)
  const envKey = process.env.GEMINI_API_KEY;
  if (envKey && envKey !== 'MY_GEMINI_API_KEY' && envKey.length > 10) return envKey;
  // Check for presence of encrypted key (can't decrypt synchronously)
  return localStorage.getItem(STORAGE_KEY) ? '__encrypted_present__' : null;
}

async function getApiKey(): Promise<string | null> {
  // 1. Build-time env var
  const envKey = process.env.GEMINI_API_KEY;
  if (envKey && envKey !== 'MY_GEMINI_API_KEY' && envKey.length > 10) return envKey;
  // 2. Encrypted user-provided key
  return decryptStored();
}

async function setStoredApiKey(key: string) {
  await encryptAndStore(key);
}

function clearStoredApiKey() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('gemini_api_key');
}

// ─── Helpers ─────────────────────────────────────────────────────────
function injectMobileMeta(html: string) {
  let cleanHtml = html.replace(/<meta[^>]*name=["']viewport["'][^>]*>/gi, '');
  const meta = `
<meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=5.0, user-scalable=yes">
<style>html, body { overscroll-behavior: none !important; }</style>
`;
  if (cleanHtml.includes('<head>')) {
    return cleanHtml.replace('<head>', '<head>\n' + meta);
  } else if (cleanHtml.includes('<html>')) {
    return cleanHtml.replace('<html>', '<html>\n<head>\n' + meta + '</head>\n');
  }
  return meta + cleanHtml;
}

function injectConsoleInterceptor(html: string) {
  const script = `
<script>
  (function() {
    const oc = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
    function send(type, args) {
      try {
        const s = Array.from(args).map(a => {
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === 'object') { try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); } }
          return String(a);
        });
        window.parent.postMessage({ type: 'CONSOLE_LOG', level: type, args: s }, '*');
      } catch(e) {}
    }
    console.log = function() { oc.log.apply(console, arguments); send('log', arguments); };
    console.error = function() { oc.error.apply(console, arguments); send('error', arguments); };
    console.warn = function() { oc.warn.apply(console, arguments); send('warn', arguments); };
    console.info = function() { oc.info.apply(console, arguments); send('info', arguments); };
    console.debug = function() { oc.debug.apply(console, arguments); send('debug', arguments); };
    window.addEventListener('error', function(e) { send('error', [e.error ? (e.error.stack || e.error.message) : e.message]); });
    window.addEventListener('unhandledrejection', function(e) { send('error', ['Unhandled rejection:', e.reason ? (e.reason.stack || e.reason.message || e.reason) : 'Unknown']); });
  })();
</script>
`;
  if (html.includes('<head>')) return html.replace('<head>', '<head>\n' + script);
  if (html.includes('<html>')) return html.replace('<html>', '<html>\n<head>\n' + script + '</head>\n');
  return script + html;
}

// ─── Token Usage Badge ───────────────────────────────────────────────
function TokenBadge({ lastUsage, cumulative }: { lastUsage: TokenUsage | null; cumulative: CumulativeUsage }) {
  if (!lastUsage && cumulative.callCount === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-mono tracking-wide"
    >
      {lastUsage && (
        <span className="text-indigo-400/70 dark:text-indigo-300/50">
          last: {lastUsage.promptTokens}→{lastUsage.completionTokens} tok · {lastUsage.model}
        </span>
      )}
      {cumulative.callCount > 0 && (
        <span className="text-gray-400/60 dark:text-gray-500/50">
          session: {cumulative.totalTokens.toLocaleString()} tok · {cumulative.callCount} calls
        </span>
      )}
    </motion.div>
  );
}

// ─── API Key Modal ───────────────────────────────────────────────────
function ApiKeyModal({ isOpen, onClose, onSave }: { isOpen: boolean; onClose: () => void; onSave: (key: string) => void }) {
  const [keyInput, setKeyInput] = useState('');
  const hasExisting = !!(localStorage.getItem(STORAGE_KEY) || localStorage.getItem('gemini_api_key'));

  if (!isOpen) return null;

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 dark:bg-black/60 z-[80]" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="fixed inset-x-4 top-1/3 -translate-y-1/3 z-[81] max-w-sm mx-auto"
      >
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl overflow-hidden border border-gray-200/50 dark:border-[#38383A]">
          <div className="px-6 pt-6 pb-2">
            <div className="flex items-center gap-2 mb-1">
              <Key className="w-5 h-5 text-indigo-500" />
              <h3 className="text-[17px] font-semibold text-black dark:text-white">Gemini API Key</h3>
            </div>
            <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed mt-1">
              Get a free key from{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline">
                Google AI Studio
              </a>
              . Your key stays in this browser only.
            </p>
          </div>
          <div className="px-6 py-4">
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="AIza..."
              autoFocus
              className="w-full px-4 py-3 bg-[#F2F2F7] dark:bg-black/30 rounded-xl text-[15px] font-mono text-black dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 border border-gray-200/50 dark:border-[#38383A]"
            />
          </div>
          <div className="flex border-t border-gray-200/50 dark:border-[#38383A]">
            {hasExisting && (
              <button
                onClick={() => { clearStoredApiKey(); onClose(); }}
                className="flex-1 py-3.5 text-[15px] text-red-500 font-medium border-r border-gray-200/50 dark:border-[#38383A] active:bg-gray-100 dark:active:bg-[#2C2C2E] transition-colors"
              >
                Remove
              </button>
            )}
            <button onClick={onClose} className="flex-1 py-3.5 text-[15px] text-gray-500 dark:text-gray-400 font-medium border-r border-gray-200/50 dark:border-[#38383A] active:bg-gray-100 dark:active:bg-[#2C2C2E] transition-colors">
              Cancel
            </button>
            <button
              onClick={() => { if (keyInput.trim()) { onSave(keyInput.trim()); setKeyInput(''); } }}
              disabled={!keyInput.trim()}
              className="flex-1 py-3.5 text-[15px] text-indigo-500 font-semibold active:bg-gray-100 dark:active:bg-[#2C2C2E] transition-colors disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ─── PasteScreen ─────────────────────────────────────────────────────
interface PasteScreenProps {
  key?: string;
  snippetToEdit: Snippet | null; onPreview: (c: string) => void; onSave: (t: string, c: string) => void; onUpdate: (s: Snippet) => void; onAutoSave: (s: Snippet) => void; onCancelEdit: () => void; theme: 'light' | 'dark'; toggleTheme: () => void; existingTitles: string[]; user: FirebaseUser | null; onLogin: () => void; onLogout: () => void; onTokenUsage: (u: TokenUsage) => void; apiKeyAvailable: boolean; onRequestApiKey: () => void;
}

function PasteScreen({ snippetToEdit, onPreview, onSave, onUpdate, onAutoSave, onCancelEdit, theme, toggleTheme, existingTitles, user, onLogin, onLogout, onTokenUsage, apiKeyAvailable, onRequestApiKey }: PasteScreenProps) {
  const [content, setContent] = useState('');
  const [debouncedContent, setDebouncedContent] = useState('');
  const [title, setTitle] = useState('');
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isManuallyEditedTitle, setIsManuallyEditedTitle] = useState(false);
  const [lastSavedContent, setLastSavedContent] = useState('');
  const [lastSavedTitle, setLastSavedTitle] = useState('');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiAction, setAiAction] = useState<string | null>(null);
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const skipHistoryRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: import('react').ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === 'string') {
        setContent(text);
        setDebouncedContent(text);
        if (!title.trim() && !isManuallyEditedTitle) {
          setTitle(file.name);
          setIsManuallyEditedTitle(true);
        }
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    if (snippetToEdit) {
      setContent(snippetToEdit.content);
      setTitle(snippetToEdit.title || '');
      setLastSavedContent(snippetToEdit.content);
      setLastSavedTitle(snippetToEdit.title || '');
      setIsManuallyEditedTitle(true);
      setHistory([snippetToEdit.content]);
      setHistoryIndex(0);
      setDebouncedContent(snippetToEdit.content);
      skipHistoryRef.current = true;
    } else {
      const draft = localStorage.getItem('snippet_draft');
      if (draft) {
        try {
          const parsed = JSON.parse(draft);
          const draftContent = parsed.content || '';
          setContent(draftContent);
          setTitle(parsed.title || '');
          if (parsed.title) setIsManuallyEditedTitle(true);
          setHistory([draftContent]);
          setHistoryIndex(0);
          setDebouncedContent(draftContent);
          skipHistoryRef.current = true;
        } catch {
          setContent(''); setTitle(''); setHistory(['']); setHistoryIndex(0); setDebouncedContent(''); skipHistoryRef.current = true;
        }
      } else {
        setContent(''); setTitle(''); setIsManuallyEditedTitle(false); setHistory(['']); setHistoryIndex(0); setDebouncedContent(''); skipHistoryRef.current = true;
      }
    }
  }, [snippetToEdit]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedContent(content), 1000);
    return () => clearTimeout(timer);
  }, [content]);

  useEffect(() => {
    if (skipHistoryRef.current) { skipHistoryRef.current = false; return; }
    if (debouncedContent !== history[historyIndex]) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(debouncedContent);
      if (newHistory.length > 50) newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  }, [debouncedContent]);

  // Auto-save draft for new snippets
  useEffect(() => {
    if (!snippetToEdit) {
      if (debouncedContent.trim() || title.trim()) {
        localStorage.setItem('snippet_draft', JSON.stringify({ title, content: debouncedContent }));
        setLastSaved(new Date());
      } else {
        localStorage.removeItem('snippet_draft');
      }
    }
  }, [debouncedContent, title, snippetToEdit]);

  // Auto-save for existing snippets
  useEffect(() => {
    if (snippetToEdit && (content !== lastSavedContent || title !== lastSavedTitle)) {
      const timer = setTimeout(() => {
        onAutoSave({ ...snippetToEdit, title, content });
        setLastSavedContent(content);
        setLastSavedTitle(title);
        setLastSaved(new Date());
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [content, title, snippetToEdit, lastSavedContent, lastSavedTitle, onAutoSave]);

  useEffect(() => {
    if (!content.trim() && !snippetToEdit) { setIsManuallyEditedTitle(false); setTitle(''); }
  }, [content, snippetToEdit]);

  // Auto-title generation
  useEffect(() => {
    if (!debouncedContent.trim() || isManuallyEditedTitle || snippetToEdit) return;

    let isMounted = true;
    const generateTitle = async () => {
      const apiKey = await getApiKey();
      if (!apiKey || !isMounted) return;
      setIsGeneratingTitle(true);
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Generate a brief, descriptive title (2-5 words) for the following web code snippet. Do not use quotes or markdown. It must be unique and NOT be any of: ${existingTitles.join(', ')}.\n\nCode:\n${debouncedContent.substring(0, 3000)}`;
        const response = await ai.models.generateContent({ model: 'gemini-2.0-flash-lite', contents: prompt });
        if (isMounted && response.text) {
          setTitle(response.text.trim().replace(/^["']|["']$/g, ''));
        }
        if (response.usageMetadata) {
          onTokenUsage({
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
            model: 'gemini-2.0-flash-lite',
            timestamp: Date.now(),
          });
        }
      } catch (error: any) {
        // Silently skip — title generation is non-critical
        console.debug('Title generation skipped:', error?.message);
      } finally {
        if (isMounted) setIsGeneratingTitle(false);
      }
    };
    generateTitle();
    return () => { isMounted = false; };
  }, [debouncedContent, isManuallyEditedTitle, snippetToEdit, existingTitles]);

  const handleAiAction = async (action: 'optimize' | 'fix' | 'comments' | 'format', framework?: string) => {
    if (!content.trim()) return;
    const apiKey = await getApiKey();
    if (!apiKey) {
      onRequestApiKey();
      return;
    }
    setIsAiProcessing(true);
    setAiAction(framework ? `format-${framework}` : action);
    setAiError(null);
    try {
      const ai = new GoogleGenAI({ apiKey });
      // Structured prompts designed to work reliably with both state-of-the-art
      // and mid-tier models (e.g. via OpenRouter). Each prompt:
      // 1. States the EXACT task with concrete examples of what to look for
      // 2. Specifies output format constraints (raw code, no markdown)
      // 3. Includes guardrails against common model failure modes
      const PREAMBLE = `You are a code assistant. You MUST return ONLY the modified code — no explanations, no markdown fences (\`\`\`), no commentary before or after. Output the complete file exactly as it should appear.`;
      let prompt = '';
      if (action === 'optimize') {
        prompt = `${PREAMBLE}

TASK: Optimize this web code. Specifically:
- Remove redundant DOM queries and cache element references
- Replace inefficient selectors (e.g. universal *, deep nesting)
- Debounce or throttle event handlers that fire rapidly (scroll, resize, input)
- Use CSS transforms/opacity for animations instead of layout-triggering properties
- Replace inline styles with CSS classes where repeated
- Use semantic HTML elements (nav, main, section, article) where appropriate
- Minimize reflows: batch DOM reads and writes separately
- Use const/let instead of var; prefer template literals over string concatenation
- Remove dead code and unused variables
Do NOT change the visible behavior or appearance. Preserve all functionality.

CODE:
${content}`;
      } else if (action === 'fix') {
        prompt = `${PREAMBLE}

TASK: Fix bugs in this web code. Check for and fix ALL of the following:
- Unclosed HTML tags (div, span, p, ul, li, table, etc.) — close them
- Missing closing brackets, braces, or parentheses in JS/CSS
- Mismatched quotes (single/double) in attributes and strings
- Broken attribute syntax (missing =, missing quotes around values)
- Invalid CSS (missing semicolons, unclosed rules, typos in property names)
- JS errors: undefined variables, missing function arguments, wrong method names
- Event listeners referencing elements that don't exist (wrong IDs/classes)
- Missing DOCTYPE, html, head, or body tags if partial HTML
- Broken links or src attributes pointing to obviously wrong paths
Fix each issue. Do NOT add new features or change the design. Only fix what is broken.

CODE:
${content}`;
      } else if (action === 'comments') {
        prompt = `${PREAMBLE}

TASK: Add inline comments to explain this web code. Guidelines:
- Add a comment above each function explaining what it does and its parameters
- Add comments for non-obvious logic (regex patterns, bitwise ops, complex conditions)
- Label major HTML sections (header, navigation, main content, sidebar, footer)
- Explain CSS tricks (flexbox patterns, grid layouts, z-index stacking, animations)
- Note any browser compatibility considerations
- Keep comments concise — one line preferred, two lines maximum
- Do NOT add comments for self-explanatory code (variable declarations, simple assignments)
- Use // for JS, <!-- --> for HTML, /* */ for CSS

CODE:
${content}`;
      } else if (action === 'format') {
        if (framework) {
          prompt = `${PREAMBLE}

TASK: Format and enhance this web code using ${framework}. Specifically:
- Apply consistent 2-space indentation throughout
- Add ${framework} utility classes for layout, spacing, typography, and colors
- Make the layout responsive (mobile-first, breakpoints for tablet and desktop)
- Ensure proper ${framework} CDN link is included in <head> if not present
- Use ${framework} component patterns (cards, buttons, grids, navbars) where appropriate
- Preserve ALL existing content, text, and functionality — only enhance styling
- Remove conflicting inline styles that ${framework} classes replace

CODE:
${content}`;
        } else {
          prompt = `${PREAMBLE}

TASK: Format this web code with clean, consistent styling:
- Apply consistent 2-space indentation for all HTML, CSS, and JS
- Normalize attribute quoting (use double quotes consistently)
- Sort CSS properties in logical groups (layout → box model → typography → visual)
- Add reasonable spacing between logical sections
- Ensure responsive design basics: viewport meta, relative units, flexible layouts
- Apply modern CSS defaults: box-sizing border-box, system font stack, sensible resets
- Preserve ALL existing content and functionality — only improve formatting and style

CODE:
${content}`;
        }
      }

      const response = await ai.models.generateContent({ model: 'gemini-2.0-flash-lite', contents: prompt });

      // Track token usage
      if (response.usageMetadata) {
        onTokenUsage({
          promptTokens: response.usageMetadata.promptTokenCount || 0,
          completionTokens: response.usageMetadata.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata.totalTokenCount || 0,
          model: 'gemini-2.0-flash-lite',
          timestamp: Date.now(),
        });
      }

      if (response.text) {
        let newContent = response.text.trim();
        if (newContent.startsWith('```')) {
          const lines = newContent.split('\n');
          if (lines[0].startsWith('```')) lines.shift();
          if (lines[lines.length - 1].startsWith('```')) lines.pop();
          newContent = lines.join('\n');
        }
        const newHistory = history.slice(0, historyIndex + 1);
        if (content !== history[historyIndex]) newHistory.push(content);
        newHistory.push(newContent);
        if (newHistory.length > 50) newHistory.splice(0, newHistory.length - 50);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        skipHistoryRef.current = true;
        setContent(newContent);
        setDebouncedContent(newContent);
      }
    } catch (error: any) {
      console.debug('AI action failed:', error);
      const msg = error?.message || String(error);
      if (msg.includes('API key') || msg.includes('401') || msg.includes('403')) {
        setAiError('API key invalid or expired — update in Settings.');
      } else if (msg.includes('429') || msg.includes('quota')) {
        setAiError('Rate limited — try again in a moment.');
      } else if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')) {
        setAiError('Network error — check your connection.');
      } else {
        setAiError('AI unavailable — app works fine without it.');
      }
      // Auto-dismiss after 5 seconds
      setTimeout(() => setAiError(null), 5000);
    } finally {
      setIsAiProcessing(false);
      setAiAction(null);
    }
  };

  const handleUndo = () => {
    if (content !== history[historyIndex]) {
      skipHistoryRef.current = true;
      setContent(history[historyIndex]);
      setDebouncedContent(history[historyIndex]);
    } else if (historyIndex > 0) {
      skipHistoryRef.current = true;
      setContent(history[historyIndex - 1]);
      setDebouncedContent(history[historyIndex - 1]);
      setHistoryIndex(historyIndex - 1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      skipHistoryRef.current = true;
      setContent(history[historyIndex + 1]);
      setDebouncedContent(history[historyIndex + 1]);
      setHistoryIndex(historyIndex + 1);
    }
  };

  const handleSave = () => {
    if (!content.trim()) return;
    if (snippetToEdit) {
      onUpdate({ ...snippetToEdit, title, content });
    } else {
      onSave(title, content);
      setContent(''); setTitle(''); setIsManuallyEditedTitle(false);
      localStorage.removeItem('snippet_draft');
      setLastSaved(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 flex flex-col p-4 pt-safe pb-32 overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between mt-4 mb-6">
        <div className="flex items-center gap-2">
          {snippetToEdit && (
            <button onClick={onCancelEdit} className="p-2 -ml-2 text-[#007AFF] dark:text-[#0A84FF] active:opacity-70 transition-opacity">
              <ChevronLeft className="w-7 h-7" />
            </button>
          )}
          <h1 className="text-[34px] font-bold text-black dark:text-white tracking-tight">
            {snippetToEdit ? 'Edit' : 'New'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {!apiKeyAvailable && (
            <button onClick={onRequestApiKey} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 rounded-full active:scale-95 transition-transform">
              <Key className="w-3 h-3" />
              Add Key
            </button>
          )}
          {user ? (
            <div className="flex items-center gap-2">
              {user.photoURL && <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full border border-gray-200/80 dark:border-[#38383A]" referrerPolicy="no-referrer" />}
              <button onClick={onLogout} className="p-2 text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-[#2C2C2E] rounded-full active:scale-95 transition-transform" title="Sign Out">
                <LogOut className="w-4.5 h-4.5" />
              </button>
            </div>
          ) : (
            <button onClick={onLogin} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold text-white bg-[#007AFF] dark:bg-[#0A84FF] rounded-full active:scale-95 transition-transform">
              <LogIn className="w-3.5 h-3.5" />
              Sign In
            </button>
          )}
          <button onClick={toggleTheme} className="p-2 text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-[#2C2C2E] rounded-full active:scale-95 transition-transform">
            {theme === 'dark' ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
          </button>
        </div>
      </div>

      {/* Editor Card */}
      <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm overflow-hidden mb-4 border border-gray-200/30 dark:border-[#2C2C2E] flex-shrink-0 flex flex-col">
        {/* Title Input */}
        <div className="relative flex items-center border-b border-gray-100 dark:border-[#2C2C2E]">
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={e => { setTitle(e.target.value); setIsManuallyEditedTitle(true); }}
            className="w-full px-4 py-3 text-[17px] font-medium focus:outline-none placeholder-gray-300 dark:placeholder-gray-600 bg-transparent dark:text-white pr-10"
          />
          <div className="absolute right-3 flex items-center pointer-events-none">
            {isGeneratingTitle ? (
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
            ) : (!isManuallyEditedTitle && title && !snippetToEdit) ? (
              <Sparkles className="w-4 h-4 text-indigo-400" />
            ) : null}
          </div>
        </div>

        {/* AI Toolbar */}
        <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50/80 dark:bg-black/20 border-b border-gray-100 dark:border-[#2C2C2E] overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <button onClick={() => handleAiAction('optimize')} disabled={isAiProcessing || !content.trim()} className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[11px] font-semibold text-indigo-500 dark:text-indigo-400 shadow-sm border border-gray-100 dark:border-[#38383A] active:scale-95 transition-all disabled:opacity-40">
            {isAiProcessing && aiAction === 'optimize' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            Optimize
          </button>
          <button onClick={() => handleAiAction('fix')} disabled={isAiProcessing || !content.trim()} className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[11px] font-semibold text-amber-500 dark:text-amber-400 shadow-sm border border-gray-100 dark:border-[#38383A] active:scale-95 transition-all disabled:opacity-40">
            {isAiProcessing && aiAction === 'fix' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bug className="w-3 h-3" />}
            Fix Bugs
          </button>
          <button onClick={() => handleAiAction('comments')} disabled={isAiProcessing || !content.trim()} className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[11px] font-semibold text-emerald-500 dark:text-emerald-400 shadow-sm border border-gray-100 dark:border-[#38383A] active:scale-95 transition-all disabled:opacity-40">
            {isAiProcessing && aiAction === 'comments' ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
            Comments
          </button>

          {/* Format dropdown */}
          <div className="relative flex-shrink-0">
            <button onClick={() => setIsFormatMenuOpen(!isFormatMenuOpen)} disabled={isAiProcessing || !content.trim()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[11px] font-semibold text-purple-500 dark:text-purple-400 shadow-sm border border-gray-100 dark:border-[#38383A] active:scale-95 transition-all disabled:opacity-40">
              {isAiProcessing && aiAction?.startsWith('format') ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlignLeft className="w-3 h-3" />}
              Format
              <ChevronDown className="w-2.5 h-2.5 opacity-60" />
            </button>
            <AnimatePresence>
              {isFormatMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsFormatMenuOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.96 }}
                    transition={{ duration: 0.12 }}
                    className="absolute top-full left-0 mt-1 w-36 bg-white dark:bg-[#2C2C2E] rounded-xl shadow-lg border border-gray-100 dark:border-[#38383A] overflow-hidden z-20"
                  >
                    {[
                      { label: 'Standard', fw: undefined, color: '' },
                      { label: 'Tailwind CSS', fw: 'Tailwind CSS', color: 'text-sky-500' },
                      { label: 'Bootstrap', fw: 'Bootstrap', color: 'text-violet-500' },
                    ].map(opt => (
                      <button
                        key={opt.label}
                        onClick={() => { handleAiAction('format', opt.fw); setIsFormatMenuOpen(false); }}
                        className={`w-full text-left px-3 py-2.5 text-[13px] ${opt.color || 'text-gray-700 dark:text-gray-200'} hover:bg-gray-50 dark:hover:bg-[#38383A] transition-colors font-medium`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5 flex-shrink-0" />

          <button onClick={handleUndo} disabled={historyIndex === 0 && content === history[0]} className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-[#38383A] disabled:opacity-20 transition-colors" title="Undo">
            <Undo className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-[#38383A] disabled:opacity-20 transition-colors" title="Redo">
            <Redo className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5 flex-shrink-0" />

          <button onClick={() => fileInputRef.current?.click()} className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[11px] font-semibold text-gray-500 dark:text-gray-400 shadow-sm border border-gray-100 dark:border-[#38383A] active:scale-95 transition-all" title="Upload">
            <Upload className="w-3 h-3" />
            Upload
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".html,.css,.js,.ts,.jsx,.tsx,.txt,.json,.md,.xml,.svg" />

          <div className="flex-1 min-w-[12px]" />
          {lastSaved && (
            <span className="text-[9px] text-gray-400 dark:text-gray-600 whitespace-nowrap flex-shrink-0 tabular-nums">
              {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* AI Error */}
        <AnimatePresence>
          {aiError && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2 bg-red-50 dark:bg-red-900/20 text-[12px] text-red-600 dark:text-red-400">
                <span>{aiError}</span>
                <button onClick={() => setAiError(null)} className="ml-2 p-0.5"><X className="w-3 h-3" /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Code Editor */}
        <div className="w-full h-64 overflow-y-auto bg-gray-50/50 dark:bg-black/30">
          <Editor
            value={content}
            onValueChange={code => setContent(code)}
            highlight={code => Prism.highlight(code, Prism.languages.markup, 'html')}
            padding={16}
            placeholder="Paste HTML/JS code here..."
            className="min-h-full text-[14px] font-mono text-gray-800 dark:text-gray-200"
            textareaClassName="focus:outline-none"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
          />
        </div>
      </div>

      {/* Live Preview */}
      {debouncedContent.trim() && (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm overflow-hidden mb-4 border border-gray-200/30 dark:border-[#2C2C2E] flex-shrink-0 flex flex-col h-56 relative">
          <div className="px-4 py-1.5 bg-gray-50/80 dark:bg-[#2C2C2E]/60 border-b border-gray-100 dark:border-[#2C2C2E] text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest flex items-center justify-between">
            <span>Preview</span>
            <span className="flex items-center text-[9px] normal-case font-normal tracking-normal">
              <span className="w-1 h-1 rounded-full bg-emerald-400 mr-1 animate-pulse" />
              Live
            </span>
          </div>
          <iframe
            srcDoc={injectMobileMeta(debouncedContent)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="w-full flex-1 border-none bg-white dark:bg-black"
            title="Live Preview"
          />
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 mt-auto flex-shrink-0">
        <button
          onClick={() => onPreview(content)}
          disabled={!content.trim()}
          className="flex-1 bg-gray-100 dark:bg-[#2C2C2E] text-[#007AFF] dark:text-[#0A84FF] font-semibold py-3.5 rounded-2xl disabled:opacity-40 flex items-center justify-center active:scale-[0.98] transition-transform text-[16px]"
        >
          <Play className="w-4.5 h-4.5 mr-2 fill-current" />
          Preview
        </button>
        <button
          onClick={handleSave}
          disabled={!content.trim()}
          className="flex-1 bg-[#007AFF] dark:bg-[#0A84FF] text-white font-semibold py-3.5 rounded-2xl shadow-sm shadow-blue-500/20 disabled:opacity-40 flex items-center justify-center active:scale-[0.98] transition-transform text-[16px]"
        >
          <Save className="w-4.5 h-4.5 mr-2" />
          {snippetToEdit ? 'Update' : 'Save'}
        </button>
      </div>
    </motion.div>
  );
}

// ─── LibraryScreen ───────────────────────────────────────────────────
interface LibraryScreenProps {
  key?: string;
  snippets: Snippet[]; onPreview: (c: string) => void; onEdit: (s: Snippet) => void; onDelete: (id: string) => void; onExport: (s: Snippet) => void; theme: 'light' | 'dark'; toggleTheme: () => void; user: FirebaseUser | null; onLogin: () => void; onLogout: () => void;
}

function LibraryScreen({ snippets, onPreview, onEdit, onDelete, onExport, theme, toggleTheme, user, onLogin, onLogout }: LibraryScreenProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex-1 flex flex-col p-4 pt-safe pb-32 overflow-y-auto"
    >
      <div className="flex items-center justify-between mt-4 mb-6">
        <h1 className="text-[34px] font-bold text-black dark:text-white tracking-tight">Library</h1>
        <div className="flex items-center gap-2">
          {user ? (
            <div className="flex items-center gap-2">
              {user.photoURL && <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full border border-gray-200/80 dark:border-[#38383A]" referrerPolicy="no-referrer" />}
              <button onClick={onLogout} className="p-2 text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-[#2C2C2E] rounded-full active:scale-95 transition-transform" title="Sign Out">
                <LogOut className="w-4.5 h-4.5" />
              </button>
            </div>
          ) : (
            <button onClick={onLogin} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold text-white bg-[#007AFF] dark:bg-[#0A84FF] rounded-full active:scale-95 transition-transform">
              <LogIn className="w-3.5 h-3.5" />
              Sign In
            </button>
          )}
          <button onClick={toggleTheme} className="p-2 text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-[#2C2C2E] rounded-full active:scale-95 transition-transform">
            {theme === 'dark' ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
          </button>
        </div>
      </div>

      {snippets.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-20 text-gray-400 dark:text-gray-500">
          <FileCode2 className="w-14 h-14 mb-4 opacity-15" />
          <p className="text-[16px] font-medium text-gray-400 dark:text-gray-500">No snippets yet</p>
          <p className="text-[14px] mt-1 text-gray-300 dark:text-gray-600">Save code to see it here</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm overflow-hidden border border-gray-200/30 dark:border-[#2C2C2E]">
          {snippets.map((snippet, index) => (
            <div key={snippet.id} className={`flex items-center justify-between p-3.5 ${index !== snippets.length - 1 ? 'border-b border-gray-100 dark:border-[#2C2C2E]' : ''}`}>
              <div
                className="w-14 h-14 rounded-xl overflow-hidden relative bg-white dark:bg-black border border-gray-100 dark:border-[#2C2C2E] flex-shrink-0 mr-3 cursor-pointer"
                onClick={() => onPreview(snippet.content)}
              >
                <iframe
                  srcDoc={injectMobileMeta(snippet.content)}
                  sandbox="allow-scripts allow-same-origin"
                  loading="lazy"
                  tabIndex={-1}
                  scrolling="no"
                  className="absolute top-0 left-0 w-[280px] h-[280px] origin-top-left scale-[0.05] pointer-events-none border-none bg-white dark:bg-black"
                />
                <div className="absolute inset-0 z-10" />
              </div>
              <div className="flex-1 min-w-0 pr-2 cursor-pointer" onClick={() => onEdit(snippet)}>
                <h3 className="text-[15px] font-semibold text-black dark:text-white truncate">{snippet.title}</h3>
                <p className="text-[12px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                  {new Date(snippet.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {(snippet.content.length / 1024).toFixed(1)}KB
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => onPreview(snippet.content)} className="p-2 text-emerald-500 rounded-full active:opacity-70 transition-opacity" title="Preview">
                  <Play className="w-4 h-4 fill-current" />
                </button>
                <button onClick={() => handleCopy(snippet.id, snippet.content)} className="p-2 text-indigo-500 rounded-full active:opacity-70 transition-opacity" title="Copy">
                  {copiedId === snippet.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
                <button onClick={() => onExport(snippet)} className="p-2 text-[#007AFF] dark:text-[#0A84FF] rounded-full active:opacity-70 transition-opacity" title="Export">
                  <Download className="w-4 h-4" />
                </button>
                <button onClick={() => onDelete(snippet.id)} className="p-2 text-red-400 rounded-full active:opacity-70 transition-opacity" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── PreviewScreen ───────────────────────────────────────────────────
interface LogEntry { id: string; level: string; args: string[]; timestamp: number; }

function PreviewScreen({ content, onClose }: { content: string; onClose: () => void }) {
  const [viewMode, setViewMode] = useState<'portrait' | 'landscape' | 'desktop'>('portrait');
  const [showConsole, setShowConsole] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'log' | 'warn' | 'error'>('all');

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CONSOLE_LOG') {
        setLogs(prev => [...prev, { id: Math.random().toString(36).substring(2, 9), level: event.data.level, args: event.data.args, timestamp: Date.now() }]);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const processedContent = injectConsoleInterceptor(injectMobileMeta(content));
  const filteredLogs = logs.filter(log => logFilter === 'all' || log.level === logFilter || (logFilter === 'log' && (log.level === 'info' || log.level === 'debug')));

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-black">
      <div className="flex items-center justify-between px-4 py-2.5 pt-safe bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-2xl border-b border-gray-200/30 dark:border-[#2C2C2E] z-10">
        <button onClick={onClose} className="text-[#007AFF] dark:text-[#0A84FF] text-[15px] font-medium flex items-center active:opacity-70 transition-opacity w-16">
          <ChevronLeft className="w-5 h-5 -ml-1" />
          Back
        </button>
        <div className="flex bg-gray-100 dark:bg-[#2C2C2E] p-0.5 rounded-lg">
          {(['portrait', 'landscape', 'desktop'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center transition-all ${viewMode === mode ? 'bg-white dark:bg-[#48484A] shadow-sm text-black dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}
            >
              {mode === 'portrait' && <Smartphone className="w-3 h-3 mr-1" />}
              {mode === 'landscape' && <Smartphone className="w-3 h-3 mr-1 -rotate-90" />}
              {mode === 'desktop' && <Monitor className="w-3 h-3 mr-1" />}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
        <div className="w-16 flex justify-end">
          <button
            onClick={() => setShowConsole(!showConsole)}
            className={`p-1.5 rounded-full transition-colors ${showConsole ? 'bg-indigo-50 text-indigo-500 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500'}`}
          >
            <Terminal className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className={`flex-1 @container relative ${viewMode === 'desktop' ? 'overflow-auto bg-gray-50 dark:bg-black p-4 md:p-8' : 'overflow-hidden bg-white dark:bg-black'}`}>
        <div className={`
          ${viewMode === 'portrait' ? 'w-full h-full' : ''}
          ${viewMode === 'landscape' ? 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 origin-center rotate-90 w-[100cqh] h-[100cqw]' : ''}
          ${viewMode === 'desktop' ? 'w-[1024px] min-h-[768px] h-full mx-auto bg-white dark:bg-black shadow-xl border border-gray-200/30 dark:border-[#2C2C2E] rounded-lg overflow-hidden' : ''}
        `}>
          <iframe
            srcDoc={processedContent}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="w-full h-full border-none bg-white dark:bg-black"
            title="Preview"
          />
        </div>

        {showConsole && (
          <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-xl border-t border-gray-200/30 dark:border-[#2C2C2E] flex flex-col z-20">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 dark:border-[#2C2C2E] bg-gray-50/50 dark:bg-[#2C2C2E]/50">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Console</span>
                <div className="flex bg-gray-100 dark:bg-[#38383A]/50 rounded p-0.5">
                  {(['all', 'log', 'warn', 'error'] as const).map(f => (
                    <button key={f} onClick={() => setLogFilter(f)} className={`px-1.5 py-0.5 text-[9px] uppercase font-semibold rounded transition-colors ${logFilter === f ? 'bg-white dark:bg-[#48484A] text-black dark:text-white shadow-sm' : 'text-gray-400 dark:text-gray-500'}`}>{f}</button>
                  ))}
                </div>
              </div>
              <button onClick={() => setLogs([])} className="text-[11px] text-[#007AFF] dark:text-[#0A84FF] font-medium">Clear</button>
            </div>
            <div className="flex-1 overflow-auto p-2 font-mono text-[10px] leading-relaxed">
              {filteredLogs.length === 0 ? (
                <div className="text-gray-300 dark:text-gray-600 italic p-2">No logs...</div>
              ) : (
                filteredLogs.map(log => (
                  <div key={log.id} className={`py-0.5 px-2 mb-0.5 rounded border-l-2 ${
                    log.level === 'error' ? 'bg-red-50 dark:bg-red-900/10 text-red-500 border-red-400' :
                    log.level === 'warn' ? 'bg-amber-50 dark:bg-amber-900/10 text-amber-500 border-amber-400' :
                    'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
                  }`}>
                    <span className="opacity-40 mr-1.5">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    {log.args.join(' ')}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────
export default function App() {
  const [currentTab, setCurrentTab] = useState<'paste' | 'library'>('paste');
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [exportSheet, setExportSheet] = useState<Snippet | null>(null);
  const [exporting, setExporting] = useState<{ id: string; type: 'html' | 'image' | 'pdf' | 'markdown' } | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyAvailable, setApiKeyAvailable] = useState(!!getApiKeySync());

  // Resolve encrypted key availability on mount
  useEffect(() => {
    getApiKey().then(k => setApiKeyAvailable(!!k));
  }, []);

  // Token usage tracking
  const [lastTokenUsage, setLastTokenUsage] = useState<TokenUsage | null>(null);
  const [cumulativeUsage, setCumulativeUsage] = useState<CumulativeUsage>({ totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, callCount: 0 });

  const handleTokenUsage = useCallback((usage: TokenUsage) => {
    setLastTokenUsage(usage);
    setCumulativeUsage(prev => ({
      totalPromptTokens: prev.totalPromptTokens + usage.promptTokens,
      totalCompletionTokens: prev.totalCompletionTokens + usage.completionTokens,
      totalTokens: prev.totalTokens + usage.totalTokens,
      callCount: prev.callCount + 1,
    }));
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  useEffect(() => {
    if (user) getSnippets().then(setSnippets);
    else setSnippets([]);
  }, [user]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      console.error('Login error:', error);
      showToast('Failed to sign in');
    }
  };

  const handleLogout = async () => {
    try { await signOut(auth); setSnippets([]); } catch (error) { console.error('Logout error:', error); }
  };

  const handleSave = async (title: string, content: string) => {
    if (!user) { showToast('Please sign in to save'); return; }
    const newSnippet: Snippet = { id: crypto.randomUUID(), title: title.trim() || 'Untitled Snippet', content, createdAt: Date.now(), userId: user.uid };
    await saveSnippet(newSnippet);
    setSnippets(await getSnippets());
    showToast('Saved');
  };

  const handleUpdate = async (updatedSnippet: Snippet) => {
    if (!user) return;
    await saveSnippet(updatedSnippet);
    setSnippets(await getSnippets());
    showToast('Updated');
    setEditingSnippet(null);
    setCurrentTab('library');
  };

  const handleAutoSave = useCallback(async (updatedSnippet: Snippet) => {
    if (!user) return;
    await saveSnippet(updatedSnippet);
    setSnippets(await getSnippets());
  }, [user]);

  const handleEdit = (snippet: Snippet) => { setEditingSnippet(snippet); setCurrentTab('paste'); };
  const handleCancelEdit = () => { setEditingSnippet(null); setCurrentTab('library'); };

  const handleDelete = async (id: string) => {
    if (!user) return;
    if (window.confirm('Delete this snippet?')) {
      await deleteSnippet(id);
      setSnippets(await getSnippets());
      showToast('Deleted');
    }
  };

  const handleExport = (snippet: Snippet, type: 'html' | 'image' | 'pdf' | 'markdown') => {
    setExportSheet(null);

    if (type === 'html') {
      const blob = new Blob([snippet.content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${snippet.title || 'snippet'}.html`; a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (type === 'markdown') {
      const md = `# ${snippet.title || 'Untitled'}\n\n\`\`\`html\n${snippet.content}\n\`\`\``;
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${snippet.title || 'snippet'}.md`; a.click();
      URL.revokeObjectURL(url);
      return;
    }

    setExporting({ id: snippet.id, type });

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:390px;height:844px;opacity:0';
    iframe.sandbox = 'allow-scripts allow-same-origin' as any;

    // iPhone aspect ratio: 390x844 (logical), captured at 2x scale
    const PAGE_W = 390;
    const PAGE_H = 844;
    const SCALE = 2;

    const captureScript = `
      <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
      <script>
        window.onload = () => {
          setTimeout(async () => {
            try {
              const h = Math.max(document.body.scrollHeight, document.body.offsetHeight, document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight);
              window.parent.postMessage({ type: 'RESIZE', height: h }, '*');
              setTimeout(async () => {
                const canvas = await html2canvas(document.body, { useCORS: true, scale: ${SCALE}, windowWidth: ${PAGE_W}, windowHeight: h, backgroundColor: '#ffffff' });
                // Send individual page slices for reliable multi-page PDF
                const pageH = ${PAGE_H} * ${SCALE};
                const pageW = ${PAGE_W} * ${SCALE};
                const totalPages = Math.max(1, Math.ceil(canvas.height / pageH));
                const pages = [];
                for (let i = 0; i < totalPages; i++) {
                  const sliceH = Math.min(pageH, canvas.height - i * pageH);
                  const pageCanvas = document.createElement('canvas');
                  pageCanvas.width = pageW;
                  pageCanvas.height = pageH; // always full page height for consistent PDF pages
                  const ctx = pageCanvas.getContext('2d');
                  ctx.fillStyle = '#ffffff';
                  ctx.fillRect(0, 0, pageW, pageH);
                  ctx.drawImage(canvas, 0, i * pageH, pageW, sliceH, 0, 0, pageW, sliceH);
                  pages.push(pageCanvas.toDataURL('image/jpeg', 0.85));
                }
                window.parent.postMessage({ type: 'CAPTURED', pages: pages, fullImage: canvas.toDataURL('image/jpeg', 0.8), height: h }, '*');
              }, 500);
            } catch (e) { window.parent.postMessage({ type: 'ERROR', error: e.message }, '*'); }
          }, 1000);
        };
      </script>`;

    iframe.srcdoc = snippet.content + captureScript;
    document.body.appendChild(iframe);

    const listener = (e: MessageEvent) => {
      if (e.data.type === 'RESIZE') { iframe.style.height = `${e.data.height}px`; }
      else if (e.data.type === 'CAPTURED') {
        window.removeEventListener('message', listener);
        document.body.removeChild(iframe);
        setExporting(null);
        const { pages, fullImage } = e.data;
        if (type === 'image') {
          const a = document.createElement('a'); a.href = fullImage; a.download = `${snippet.title || 'snippet'}.jpg`; a.click();
        } else if (type === 'pdf') {
          try {
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [PAGE_W, PAGE_H] });
            for (let i = 0; i < pages.length; i++) {
              if (i > 0) pdf.addPage([PAGE_W, PAGE_H], 'portrait');
              pdf.addImage(pages[i], 'JPEG', 0, 0, PAGE_W, PAGE_H);
            }
            pdf.save(`${snippet.title || 'snippet'}.pdf`);
          } catch (err: any) { console.error('PDF error:', err); showToast('PDF export failed'); }
        }
      } else if (e.data.type === 'ERROR') {
        window.removeEventListener('message', listener);
        document.body.removeChild(iframe);
        setExporting(null);
        showToast('Export failed');
      }
    };
    window.addEventListener('message', listener);
  };

  const handleApiKeySave = async (key: string) => {
    await setStoredApiKey(key);
    setApiKeyAvailable(true);
    setShowApiKeyModal(false);
    showToast('API key saved (encrypted)');
  };

  return (
    <div className="h-screen w-full bg-[#F2F2F7] dark:bg-black overflow-hidden flex flex-col font-sans selection:bg-indigo-100 dark:selection:bg-indigo-900/40 relative">
      <AnimatePresence mode="wait">
        {previewContent !== null ? (
          <motion.div
            key="preview"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute inset-0 z-50 bg-white dark:bg-black flex flex-col"
          >
            <PreviewScreen content={previewContent} onClose={() => setPreviewContent(null)} />
          </motion.div>
        ) : (
          <motion.div key="main" className="flex-1 flex flex-col h-full relative">
            <AnimatePresence mode="wait">
              {currentTab === 'paste' ? (
                <PasteScreen
                  key="paste"
                  snippetToEdit={editingSnippet}
                  onPreview={setPreviewContent}
                  onSave={handleSave}
                  onUpdate={handleUpdate}
                  onAutoSave={handleAutoSave}
                  onCancelEdit={handleCancelEdit}
                  theme={theme}
                  toggleTheme={toggleTheme}
                  existingTitles={snippets.map(s => s.title)}
                  user={user}
                  onLogin={handleLogin}
                  onLogout={handleLogout}
                  onTokenUsage={handleTokenUsage}
                  apiKeyAvailable={apiKeyAvailable}
                  onRequestApiKey={() => setShowApiKeyModal(true)}
                />
              ) : (
                <LibraryScreen
                  key="library"
                  snippets={snippets}
                  onPreview={setPreviewContent}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onExport={setExportSheet}
                  theme={theme}
                  toggleTheme={toggleTheme}
                  user={user}
                  onLogin={handleLogin}
                  onLogout={handleLogout}
                />
              )}
            </AnimatePresence>

            {/* Token Usage Badge - above tab bar */}
            <div className="absolute bottom-[calc(env(safe-area-inset-bottom,24px)+52px)] left-0 right-0 flex justify-center z-30 pointer-events-none">
              <TokenBadge lastUsage={lastTokenUsage} cumulative={cumulativeUsage} />
            </div>

            {/* Tab Bar */}
            <div className="absolute bottom-0 left-0 right-0 bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-2xl border-t border-gray-200/30 dark:border-[#2C2C2E] pb-safe pt-2 px-6 flex justify-around items-center z-40">
              <button
                onClick={() => { setEditingSnippet(null); setCurrentTab('paste'); }}
                className={`flex flex-col items-center p-2 w-20 active:scale-95 transition-transform ${currentTab === 'paste' && !editingSnippet ? 'text-[#007AFF] dark:text-[#0A84FF]' : 'text-gray-300 dark:text-gray-600'}`}
              >
                <Plus className={`w-6 h-6 mb-0.5 ${currentTab === 'paste' && !editingSnippet ? 'stroke-[2.5px]' : 'stroke-[1.5px]'}`} />
                <span className="text-[10px] font-medium">New</span>
              </button>
              <button
                onClick={() => { setEditingSnippet(null); setCurrentTab('library'); }}
                className={`flex flex-col items-center p-2 w-20 active:scale-95 transition-transform ${currentTab === 'library' || editingSnippet ? 'text-[#007AFF] dark:text-[#0A84FF]' : 'text-gray-300 dark:text-gray-600'}`}
              >
                <Folder className={`w-6 h-6 mb-0.5 ${currentTab === 'library' || editingSnippet ? 'stroke-[2.5px] fill-current' : 'stroke-[1.5px]'}`} />
                <span className="text-[10px] font-medium">Library</span>
              </button>
              <button
                onClick={() => setShowApiKeyModal(true)}
                className={`flex flex-col items-center p-2 w-20 active:scale-95 transition-transform ${apiKeyAvailable ? 'text-gray-300 dark:text-gray-600' : 'text-amber-400 dark:text-amber-500'}`}
              >
                <Settings className={`w-5 h-5 mb-1 stroke-[1.5px]`} />
                <span className="text-[10px] font-medium">Settings</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="absolute top-[calc(env(safe-area-inset-top,48px)+12px)] left-1/2 -translate-x-1/2 bg-gray-800/90 dark:bg-gray-100/90 backdrop-blur-md text-white dark:text-black px-5 py-2 rounded-full shadow-lg z-[60] text-[13px] font-medium"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Export Sheet */}
      <AnimatePresence>
        {exportSheet && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/30 dark:bg-black/50 z-50" onClick={() => setExportSheet(null)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 p-4 z-50 pb-safe"
            >
              <div className="bg-white/90 dark:bg-[#2C2C2E]/90 backdrop-blur-xl rounded-2xl overflow-hidden mb-2">
                <div className="py-3 border-b border-gray-100 dark:border-gray-700/30">
                  <h3 className="text-[12px] font-semibold text-center text-gray-400 dark:text-gray-500">Export "{exportSheet.title}"</h3>
                </div>
                {[
                  { label: 'HTML File', type: 'html' as const },
                  { label: 'Markdown', type: 'markdown' as const },
                  { label: 'Image (JPG)', type: 'image' as const },
                  { label: 'PDF', type: 'pdf' as const },
                ].map((opt, i, arr) => (
                  <button
                    key={opt.type}
                    onClick={() => handleExport(exportSheet, opt.type)}
                    className={`w-full py-3.5 text-[16px] text-[#007AFF] dark:text-[#0A84FF] active:bg-gray-100 dark:active:bg-gray-700/30 transition-colors ${i < arr.length - 1 ? 'border-b border-gray-100 dark:border-gray-700/30' : ''}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="bg-white/90 dark:bg-[#2C2C2E]/90 backdrop-blur-xl rounded-2xl overflow-hidden">
                <button onClick={() => setExportSheet(null)} className="w-full py-3.5 text-[16px] font-semibold text-[#007AFF] dark:text-[#0A84FF] active:bg-gray-100 dark:active:bg-gray-700/30 transition-colors">
                  Cancel
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Export Loading */}
      <AnimatePresence>
        {exporting && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm z-[70] flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-3 border-[#007AFF] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400">Generating {exporting.type}...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* API Key Modal */}
      <AnimatePresence>
        <ApiKeyModal
          isOpen={showApiKeyModal}
          onClose={() => setShowApiKeyModal(false)}
          onSave={handleApiKeySave}
        />
      </AnimatePresence>
    </div>
  );
}
