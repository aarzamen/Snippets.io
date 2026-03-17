import { useState, useEffect, useRef } from 'react';
import { Plus, Folder, Play, Save, Trash2, ChevronLeft, ChevronDown, FileCode2, Monitor, Smartphone, Download, Sun, Moon, ChevronRight, Sparkles, Loader2, Wand2, Bug, MessageSquare, Undo, Redo, Terminal, Copy, Check, AlignLeft, HelpCircle, TestTube, Upload, LogIn, LogOut, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSnippets, saveSnippet, deleteSnippet, Snippet } from './store';
import { jsPDF } from 'jspdf';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import { GoogleGenAI } from '@google/genai';
import { auth } from './firebase';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

function injectMobileMeta(html: string) {
  // Remove any existing viewport tags to prevent conflicts
  let cleanHtml = html.replace(/<meta[^>]*name=["']viewport["'][^>]*>/gi, '');
  
  const meta = `
<meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=5.0, user-scalable=yes">
<style>
  html, body {
    overscroll-behavior: none !important;
  }
</style>
`;
  if (cleanHtml.includes('<head>')) {
    return cleanHtml.replace('<head>', '<head>\n' + meta);
  } else if (cleanHtml.includes('<html>')) {
    return cleanHtml.replace('<html>', '<html>\n<head>\n' + meta + '</head>\n');
  } else {
    return meta + cleanHtml;
  }
}

function PasteScreen({ snippetToEdit, onPreview, onSave, onUpdate, onAutoSave, onCancelEdit, theme, toggleTheme, existingTitles, user, onLogin, onLogout }: { snippetToEdit: Snippet | null, onPreview: (c: string) => void, onSave: (t: string, c: string) => void, onUpdate: (s: Snippet) => void, onAutoSave: (s: Snippet) => void, onCancelEdit: () => void, theme: 'light' | 'dark', toggleTheme: () => void, existingTitles: string[], user: FirebaseUser | null, onLogin: () => void, onLogout: () => void }) {
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

  const [history, setHistory] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const skipHistoryRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
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
    
    // Reset the input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
        } catch (e) {
          setContent('');
          setTitle('');
          setHistory(['']);
          setHistoryIndex(0);
          setDebouncedContent('');
          skipHistoryRef.current = true;
        }
      } else {
        setContent('');
        setTitle('');
        setIsManuallyEditedTitle(false);
        setHistory(['']);
        setHistoryIndex(0);
        setDebouncedContent('');
        skipHistoryRef.current = true;
      }
    }
  }, [snippetToEdit]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedContent(content), 1000);
    return () => clearTimeout(timer);
  }, [content]);

  useEffect(() => {
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    if (debouncedContent !== history[historyIndex]) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(debouncedContent);
      if (newHistory.length > 50) newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  }, [debouncedContent, history, historyIndex]);

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
    if (!content.trim() && !snippetToEdit) {
      setIsManuallyEditedTitle(false);
      setTitle('');
    }
  }, [content, snippetToEdit]);

  useEffect(() => {
    if (!debouncedContent.trim() || isManuallyEditedTitle || snippetToEdit) return;

    let isMounted = true;
    const generateTitle = async () => {
      setIsGeneratingTitle(true);
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `Generate a brief, descriptive title (2-5 words) for the following web code snippet. 
        Do not use quotes. Do not use markdown.
        It must be unique and NOT be any of the following existing titles: ${existingTitles.join(', ')}.
        
        Code:
        ${debouncedContent.substring(0, 3000)}`;
        
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
        });
        
        if (isMounted && response.text) {
          setTitle(response.text.trim().replace(/^["']|["']$/g, ''));
        }
      } catch (error) {
        console.error("Failed to generate title:", error);
      } finally {
        if (isMounted) setIsGeneratingTitle(false);
      }
    };
    
    generateTitle();
    
    return () => { isMounted = false; };
  }, [debouncedContent, isManuallyEditedTitle, snippetToEdit, existingTitles]);

  const handleAiAction = async (action: 'optimize' | 'fix' | 'comments' | 'format' | 'explain' | 'tests', framework?: string) => {
    if (!content.trim()) return;
    setIsAiProcessing(true);
    setAiAction(framework ? `format-${framework}` : action);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      let prompt = '';
      if (action === 'optimize') {
        prompt = `Optimize the following web code for performance, readability, and best practices. Return ONLY the raw code, no markdown formatting. Code:\n\n${content}`;
      } else if (action === 'fix') {
        prompt = `Fix any bugs, syntax errors, or logical issues in the following web code. Return ONLY the raw code, no markdown formatting. Code:\n\n${content}`;
      } else if (action === 'comments') {
        prompt = `Add helpful, concise comments explaining the following web code. Return ONLY the raw code, no markdown formatting. Code:\n\n${content}`;
      } else if (action === 'format') {
        if (framework) {
          prompt = `Format the following web code with proper indentation and consistent style. Additionally, enhance its user interface, appearance, and formatting by applying ${framework} classes and best practices. Make it look modern, beautiful, and fully responsive using ${framework}. Return ONLY the raw code, no markdown formatting. Code:\n\n${content}`;
        } else {
          prompt = `Format the following web code with proper indentation and consistent style. Additionally, enhance its user interface, appearance, and formatting by improving CSS properties like self padding, UI colors, color schemes, font sizes, relative placement, and absolute placement of elements to make it look modern and beautiful. Return ONLY the raw code, no markdown formatting. Code:\n\n${content}`;
        }
      } else if (action === 'explain') {
        prompt = `Explain the following web code. Instead of just a code comment, prepend your explanation as a beautifully styled, absolutely positioned HTML overlay or card (using nice UI colors, color schemes, font sizes, self padding, and relative/absolute placement) that visually explains the code to the user directly on the page. Return ONLY the raw code, no markdown formatting. Code:\n\n${content}`;
      } else if (action === 'tests') {
        prompt = `Generate tests for the following web code. Append the tests to the bottom of the code, and build a visually appealing test runner UI (using absolute placement, nice UI colors, color schemes, font sizes, and self padding) to display the test results directly on the page instead of just the console. Return ONLY the raw code, no markdown formatting. Code:\n\n${content}`;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
        contents: prompt,
      });

      if (response.text) {
        let newContent = response.text.trim();
        if (newContent.startsWith('\`\`\`')) {
          const lines = newContent.split('\n');
          if (lines[0].startsWith('\`\`\`')) lines.shift();
          if (lines[lines.length - 1].startsWith('\`\`\`')) lines.pop();
          newContent = lines.join('\n');
        }
        
        if (content !== history[historyIndex]) {
          const newHistory = history.slice(0, historyIndex + 1);
          newHistory.push(content);
          newHistory.push(newContent);
          if (newHistory.length > 50) newHistory.splice(0, newHistory.length - 50);
          setHistory(newHistory);
          setHistoryIndex(newHistory.length - 1);
        } else {
          const newHistory = history.slice(0, historyIndex + 1);
          newHistory.push(newContent);
          if (newHistory.length > 50) newHistory.shift();
          setHistory(newHistory);
          setHistoryIndex(newHistory.length - 1);
        }
        
        skipHistoryRef.current = true;
        setContent(newContent);
        setDebouncedContent(newContent);
      }
    } catch (error) {
      console.error("AI action failed:", error);
      alert("Failed to process code with AI.");
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
      const prevContent = history[historyIndex - 1];
      setContent(prevContent);
      setDebouncedContent(prevContent);
      setHistoryIndex(historyIndex - 1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      skipHistoryRef.current = true;
      const nextContent = history[historyIndex + 1];
      setContent(nextContent);
      setDebouncedContent(nextContent);
      setHistoryIndex(historyIndex + 1);
    }
  };

  const handleSave = () => {
    if (!content.trim()) return;
    if (snippetToEdit) {
      onUpdate({ ...snippetToEdit, title, content });
    } else {
      onSave(title, content);
      setContent('');
      setTitle('');
      setIsManuallyEditedTitle(false);
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
      <div className="flex items-center justify-between mt-4 mb-6">
        <div className="flex items-center gap-2">
          {snippetToEdit && (
            <button onClick={onCancelEdit} className="p-2 -ml-2 text-[#007AFF] dark:text-[#0A84FF] active:opacity-70 transition-opacity">
              <ChevronLeft className="w-7 h-7" />
            </button>
          )}
          <h1 className="text-[34px] font-bold text-black dark:text-white tracking-tight">
            {snippetToEdit ? 'Edit Snippet' : 'New Snippet'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2">
              {user.photoURL && <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700" referrerPolicy="no-referrer" />}
              <button onClick={onLogout} className="p-2 text-gray-500 dark:text-gray-400 bg-gray-200/50 dark:bg-[#2C2C2E] rounded-full active:scale-95 transition-transform" title="Sign Out">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button onClick={onLogin} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#007AFF] dark:bg-[#0A84FF] rounded-full active:scale-95 transition-transform" title="Sign In with Google">
              <LogIn className="w-4 h-4" />
              Sign In
            </button>
          )}
          <button onClick={toggleTheme} className="p-2 text-gray-500 dark:text-gray-400 bg-gray-200/50 dark:bg-[#2C2C2E] rounded-full active:scale-95 transition-transform">
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm overflow-hidden mb-6 border border-gray-200/50 dark:border-[#38383A] flex-shrink-0 flex flex-col">
        <div className="relative flex items-center border-b border-gray-200/50 dark:border-[#38383A]">
          <input
            type="text"
            placeholder="Title (optional)"
            value={title}
            onChange={e => {
              setTitle(e.target.value);
              setIsManuallyEditedTitle(true);
            }}
            className="w-full px-4 py-3.5 text-[17px] focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 bg-transparent dark:text-white pr-10"
          />
          <div className="absolute right-3 flex items-center pointer-events-none">
            {isGeneratingTitle ? (
              <Loader2 className="w-5 h-5 text-[#007AFF] dark:text-[#0A84FF] animate-spin" />
            ) : (!isManuallyEditedTitle && title && !snippetToEdit) ? (
              <Sparkles className="w-5 h-5 text-[#007AFF] dark:text-[#0A84FF]" />
            ) : null}
          </div>
        </div>
        
        <div className="flex items-center gap-2 px-4 py-2 bg-[#F2F2F7]/50 dark:bg-black/20 border-b border-gray-200/50 dark:border-[#38383A] overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mr-1 flex-shrink-0">AI Tools</span>
          <button onClick={() => handleAiAction('optimize')} disabled={isAiProcessing || !content.trim()} className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[12px] font-medium text-[#007AFF] dark:text-[#0A84FF] shadow-sm border border-gray-200/50 dark:border-[#38383A] active:scale-95 transition-all disabled:opacity-50">
            {isAiProcessing && aiAction === 'optimize' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            Optimize
          </button>
          <button onClick={() => handleAiAction('fix')} disabled={isAiProcessing || !content.trim()} className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[12px] font-medium text-[#FF9500] dark:text-[#FF9F0A] shadow-sm border border-gray-200/50 dark:border-[#38383A] active:scale-95 transition-all disabled:opacity-50">
            {isAiProcessing && aiAction === 'fix' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bug className="w-3.5 h-3.5" />}
            Fix Bugs
          </button>
          <button onClick={() => handleAiAction('comments')} disabled={isAiProcessing || !content.trim()} className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[12px] font-medium text-[#34C759] dark:text-[#32D74B] shadow-sm border border-gray-200/50 dark:border-[#38383A] active:scale-95 transition-all disabled:opacity-50">
            {isAiProcessing && aiAction === 'comments' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
            Add Comments
          </button>
          <div className="relative flex-shrink-0">
            <button onClick={() => setIsFormatMenuOpen(!isFormatMenuOpen)} disabled={isAiProcessing || !content.trim()} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[12px] font-medium text-[#AF52DE] dark:text-[#BF5AF2] shadow-sm border border-gray-200/50 dark:border-[#38383A] active:scale-95 transition-all disabled:opacity-50">
              {isAiProcessing && aiAction?.startsWith('format') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlignLeft className="w-3.5 h-3.5" />}
              Format
              <ChevronDown className="w-3 h-3 ml-0.5 opacity-70" />
            </button>
            
            <AnimatePresence>
              {isFormatMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsFormatMenuOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 5, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-1.5 w-40 bg-white dark:bg-[#2C2C2E] rounded-xl shadow-lg border border-gray-200/50 dark:border-[#38383A] overflow-hidden z-20"
                  >
                    <div className="py-1">
                      <button
                        onClick={() => { handleAiAction('format'); setIsFormatMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-[13px] text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#38383A] transition-colors"
                      >
                        Standard
                      </button>
                      <button
                        onClick={() => { handleAiAction('format', 'Tailwind CSS'); setIsFormatMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-[13px] text-[#38BDF8] hover:bg-gray-100 dark:hover:bg-[#38383A] transition-colors font-medium"
                      >
                        Tailwind CSS
                      </button>
                      <button
                        onClick={() => { handleAiAction('format', 'Bootstrap'); setIsFormatMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-[13px] text-[#7952B3] hover:bg-gray-100 dark:hover:bg-[#38383A] transition-colors font-medium"
                      >
                        Bootstrap
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <button onClick={() => handleAiAction('explain')} disabled={isAiProcessing || !content.trim()} className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[12px] font-medium text-[#5856D6] dark:text-[#5E5CE6] shadow-sm border border-gray-200/50 dark:border-[#38383A] active:scale-95 transition-all disabled:opacity-50">
            {isAiProcessing && aiAction === 'explain' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HelpCircle className="w-3.5 h-3.5" />}
            Explain
          </button>
          <button onClick={() => handleAiAction('tests')} disabled={isAiProcessing || !content.trim()} className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[12px] font-medium text-[#FF2D55] dark:text-[#FF375F] shadow-sm border border-gray-200/50 dark:border-[#38383A] active:scale-95 transition-all disabled:opacity-50">
            {isAiProcessing && aiAction === 'tests' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TestTube className="w-3.5 h-3.5" />}
            Tests
          </button>
          
          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1 flex-shrink-0"></div>
          
          <button onClick={handleUndo} disabled={historyIndex === 0 && content === history[0]} className="flex-shrink-0 p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-[#38383A] disabled:opacity-30 transition-colors" title="Undo">
            <Undo className="w-4 h-4" />
          </button>
          <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="flex-shrink-0 p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-[#38383A] disabled:opacity-30 transition-colors" title="Redo">
            <Redo className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1 flex-shrink-0"></div>

          <button onClick={() => fileInputRef.current?.click()} className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2C2E] text-[12px] font-medium text-gray-700 dark:text-gray-300 shadow-sm border border-gray-200/50 dark:border-[#38383A] active:scale-95 transition-all" title="Upload File">
            <Upload className="w-3.5 h-3.5" />
            Upload
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept=".html,.css,.js,.ts,.jsx,.tsx,.txt,.json,.md,.xml,.svg"
          />

          <div className="flex-1 min-w-[20px]"></div>
          {lastSaved && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap flex-shrink-0">
              Auto-saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        <div className="w-full h-64 overflow-y-auto bg-[#F2F2F7]/50 dark:bg-black/30">
          <Editor
            value={content}
            onValueChange={code => setContent(code)}
            highlight={code => Prism.highlight(code, Prism.languages.markup, 'html')}
            padding={16}
            placeholder="Paste HTML/JS code here...&#10;&#10;Tip: Ask the LLM for a single-file HTML with standalone React/Babel if using React."
            className="min-h-full text-[15px] font-mono text-gray-800 dark:text-gray-200"
            textareaClassName="focus:outline-none"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
          />
        </div>
      </div>

      {debouncedContent.trim() && (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm overflow-hidden mb-6 border border-gray-200/50 dark:border-[#38383A] flex-shrink-0 flex flex-col h-64 relative">
          <div className="px-4 py-2 bg-[#F2F2F7]/80 dark:bg-[#2C2C2E]/80 border-b border-gray-200/50 dark:border-[#38383A] text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
            <span>Live Preview</span>
            <span className="flex items-center text-[10px] text-gray-400 dark:text-gray-500 normal-case font-normal">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34C759] mr-1.5 animate-pulse"></span>
              Auto-updating
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

      <div className="flex gap-3 mt-auto flex-shrink-0">
        <button
          onClick={() => onPreview(content)}
          disabled={!content.trim()}
          className="flex-1 bg-[#E5E5EA] dark:bg-[#2C2C2E] text-[#007AFF] dark:text-[#0A84FF] font-semibold py-3.5 rounded-xl disabled:opacity-50 flex items-center justify-center active:scale-[0.98] transition-transform text-[17px]"
        >
          <Play className="w-5 h-5 mr-2 fill-current" />
          Preview
        </button>
        <button
          onClick={handleSave}
          disabled={!content.trim()}
          className="flex-1 bg-[#007AFF] dark:bg-[#0A84FF] text-white font-semibold py-3.5 rounded-xl shadow-sm disabled:opacity-50 flex items-center justify-center active:scale-[0.98] transition-transform text-[17px]"
        >
          <Save className="w-5 h-5 mr-2" />
          {snippetToEdit ? 'Update' : 'Save'}
        </button>
      </div>
    </motion.div>
  );
}

function LibraryScreen({ snippets, onPreview, onEdit, onDelete, onExport, theme, toggleTheme, user, onLogin, onLogout }: { snippets: Snippet[], onPreview: (c: string) => void, onEdit: (s: Snippet) => void, onDelete: (id: string) => void, onExport: (s: Snippet) => void, theme: 'light' | 'dark', toggleTheme: () => void, user: FirebaseUser | null, onLogin: () => void, onLogout: () => void }) {
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
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2">
              {user.photoURL && <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700" referrerPolicy="no-referrer" />}
              <button onClick={onLogout} className="p-2 text-gray-500 dark:text-gray-400 bg-gray-200/50 dark:bg-[#2C2C2E] rounded-full active:scale-95 transition-transform" title="Sign Out">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button onClick={onLogin} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#007AFF] dark:bg-[#0A84FF] rounded-full active:scale-95 transition-transform" title="Sign In with Google">
              <LogIn className="w-4 h-4" />
              Sign In
            </button>
          )}
          <button onClick={toggleTheme} className="p-2 text-gray-500 dark:text-gray-400 bg-gray-200/50 dark:bg-[#2C2C2E] rounded-full active:scale-95 transition-transform">
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {snippets.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-20 text-gray-400 dark:text-gray-500">
          <FileCode2 className="w-16 h-16 mb-4 opacity-20" />
          <p className="text-[17px] font-medium text-gray-500 dark:text-gray-400">No snippets saved</p>
          <p className="text-[15px] mt-1">Paste and save code to see it here.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm overflow-hidden border border-gray-200/50 dark:border-[#38383A]">
          {snippets.map((snippet, index) => (
            <div key={snippet.id} className={`flex items-center justify-between p-4 ${index !== snippets.length - 1 ? 'border-b border-gray-200/50 dark:border-[#38383A]' : ''}`}>
              <div 
                className="w-16 h-16 rounded-xl overflow-hidden relative bg-white dark:bg-black border border-gray-200/80 dark:border-[#38383A] flex-shrink-0 mr-4 cursor-pointer shadow-sm"
                onClick={() => onPreview(snippet.content)}
              >
                <iframe
                  srcDoc={injectMobileMeta(snippet.content)}
                  sandbox="allow-scripts allow-same-origin"
                  loading="lazy"
                  tabIndex={-1}
                  scrolling="no"
                  className="absolute top-0 left-0 w-[320px] h-[320px] origin-top-left scale-[0.2] pointer-events-none border-none bg-white dark:bg-black"
                />
                {/* Invisible overlay to capture clicks and prevent iframe interaction */}
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/0 hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
                  <Play className="w-6 h-6 text-white opacity-0 hover:opacity-100 drop-shadow-md fill-current" />
                </div>
              </div>
              <div
                className="flex-1 min-w-0 pr-2 cursor-pointer"
                onClick={() => onEdit(snippet)}
              >
                <h3 className="text-[17px] font-semibold text-black dark:text-white truncate tracking-tight">
                  {snippet.title}
                </h3>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {new Date(snippet.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} &middot; {(snippet.content.length / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onPreview(snippet.content)}
                  className="p-2 text-[#34C759] dark:text-[#32D74B] bg-[#34C759]/10 dark:bg-[#32D74B]/20 rounded-full active:opacity-70 transition-opacity"
                  title="Preview"
                >
                  <Play className="w-4 h-4 fill-current" />
                </button>
                <button
                  onClick={() => handleCopy(snippet.id, snippet.content)}
                  className="p-2 text-[#5856D6] dark:text-[#5E5CE6] bg-[#5856D6]/10 dark:bg-[#5E5CE6]/20 rounded-full active:opacity-70 transition-opacity"
                  title="Copy Code"
                >
                  {copiedId === snippet.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => onExport(snippet)}
                  className="p-2 text-[#007AFF] dark:text-[#0A84FF] bg-[#E5E5EA] dark:bg-[#2C2C2E] rounded-full active:opacity-70 transition-opacity"
                  title="Export"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDelete(snippet.id)}
                  className="p-2 text-[#FF3B30] dark:text-[#FF453A] bg-[#FF3B30]/10 dark:bg-[#FF453A]/20 rounded-full active:opacity-70 transition-opacity"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 ml-1" />
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function injectConsoleInterceptor(html: string) {
  const script = `
<script>
  (function() {
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug
    };
    
    function sendLog(type, args) {
      try {
        const serializedArgs = Array.from(args).map(arg => {
          if (arg instanceof Error) return arg.stack || arg.message;
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch (e) {
              return String(arg);
            }
          }
          return String(arg);
        });
        window.parent.postMessage({ type: 'CONSOLE_LOG', level: type, args: serializedArgs }, '*');
      } catch (e) {
        // Ignore serialization errors
      }
    }

    console.log = function() { originalConsole.log.apply(console, arguments); sendLog('log', arguments); };
    console.error = function() { originalConsole.error.apply(console, arguments); sendLog('error', arguments); };
    console.warn = function() { originalConsole.warn.apply(console, arguments); sendLog('warn', arguments); };
    console.info = function() { originalConsole.info.apply(console, arguments); sendLog('info', arguments); };
    console.debug = function() { originalConsole.debug.apply(console, arguments); sendLog('debug', arguments); };
    
    window.addEventListener('error', function(event) {
      sendLog('error', [event.error ? (event.error.stack || event.error.message) : event.message]);
    });
    
    window.addEventListener('unhandledrejection', function(event) {
      sendLog('error', ['Unhandled promise rejection:', event.reason ? (event.reason.stack || event.reason.message || event.reason) : 'Unknown reason']);
    });
  })();
</script>
`;
  if (html.includes('<head>')) {
    return html.replace('<head>', '<head>\n' + script);
  } else if (html.includes('<html>')) {
    return html.replace('<html>', '<html>\n<head>\n' + script + '</head>\n');
  } else {
    return script + html;
  }
}

interface LogEntry {
  id: string;
  level: string;
  args: string[];
  timestamp: number;
}

function PreviewScreen({ content, onClose }: { content: string, onClose: () => void }) {
  const [viewMode, setViewMode] = useState<'portrait' | 'landscape' | 'desktop'>('portrait');
  const [showConsole, setShowConsole] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'log' | 'warn' | 'error'>('all');
  
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'CONSOLE_LOG') {
        setLogs(prev => [...prev, {
          id: Math.random().toString(36).substring(2, 9),
          level: event.data.level,
          args: event.data.args,
          timestamp: Date.now()
        }]);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const processedContent = injectConsoleInterceptor(injectMobileMeta(content));
  const filteredLogs = logs.filter(log => logFilter === 'all' || log.level === logFilter || (logFilter === 'log' && (log.level === 'info' || log.level === 'debug')));

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-black">
      <div className="flex items-center justify-between px-4 py-3 pt-safe bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-2xl border-b border-gray-200/50 dark:border-[#38383A]/80 shadow-sm z-10">
        <button onClick={onClose} className="text-[#007AFF] dark:text-[#0A84FF] text-[17px] flex items-center active:opacity-70 transition-opacity w-20">
          <ChevronLeft className="w-6 h-6 -ml-2" />
          Back
        </button>
        
        <div className="flex bg-[#E3E3E8] dark:bg-[#38383A] p-0.5 rounded-[9px]">
          <button 
            onClick={() => setViewMode('portrait')}
            className={`px-3 py-1 rounded-[7px] text-[13px] font-medium flex items-center transition-all ${viewMode === 'portrait' ? 'bg-white dark:bg-[#636366] shadow-sm text-black dark:text-white' : 'text-gray-500 dark:text-gray-300'}`}
          >
            <Smartphone className="w-3.5 h-3.5 mr-1.5" />
            Portrait
          </button>
          <button 
            onClick={() => setViewMode('landscape')}
            className={`px-3 py-1 rounded-[7px] text-[13px] font-medium flex items-center transition-all ${viewMode === 'landscape' ? 'bg-white dark:bg-[#636366] shadow-sm text-black dark:text-white' : 'text-gray-500 dark:text-gray-300'}`}
          >
            <Smartphone className="w-3.5 h-3.5 mr-1.5 -rotate-90" />
            Landscape
          </button>
          <button 
            onClick={() => setViewMode('desktop')}
            className={`px-3 py-1 rounded-[7px] text-[13px] font-medium flex items-center transition-all ${viewMode === 'desktop' ? 'bg-white dark:bg-[#636366] shadow-sm text-black dark:text-white' : 'text-gray-500 dark:text-gray-300'}`}
          >
            <Monitor className="w-3.5 h-3.5 mr-1.5" />
            Desktop
          </button>
        </div>

        <div className="w-20 flex justify-end">
          <button
            onClick={() => setShowConsole(!showConsole)}
            className={`p-2 rounded-full transition-colors ${showConsole ? 'bg-[#007AFF]/10 text-[#007AFF] dark:bg-[#0A84FF]/20 dark:text-[#0A84FF]' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2C2C2E]'}`}
            title="Toggle Developer Console"
          >
            <Terminal className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      <div className={`flex-1 @container relative ${viewMode === 'desktop' ? 'overflow-auto bg-[#F2F2F7] dark:bg-black p-4 md:p-8' : 'overflow-hidden bg-white dark:bg-black'}`}>
        <div className={`
          ${viewMode === 'portrait' ? 'w-full h-full' : ''}
          ${viewMode === 'landscape' ? 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 origin-center rotate-90 w-[100cqh] h-[100cqw]' : ''}
          ${viewMode === 'desktop' ? 'w-[1024px] min-h-[768px] h-full mx-auto bg-white dark:bg-black shadow-xl border border-gray-200/50 dark:border-[#38383A] rounded-lg overflow-hidden' : ''}
        `}>
          <iframe
            srcDoc={processedContent}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="w-full h-full border-none bg-white dark:bg-black"
            title="Preview"
          />
        </div>
        
        {showConsole && (
          <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-xl border-t border-gray-200/50 dark:border-[#38383A]/80 shadow-2xl flex flex-col z-20">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200/50 dark:border-[#38383A]/80 bg-gray-50/50 dark:bg-[#2C2C2E]/50">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Console</span>
                <div className="flex bg-gray-200/50 dark:bg-[#38383A]/50 rounded-md p-0.5">
                  <button onClick={() => setLogFilter('all')} className={`px-2 py-0.5 text-[10px] uppercase font-medium rounded-sm transition-colors ${logFilter === 'all' ? 'bg-white dark:bg-[#636366] text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>All</button>
                  <button onClick={() => setLogFilter('log')} className={`px-2 py-0.5 text-[10px] uppercase font-medium rounded-sm transition-colors ${logFilter === 'log' ? 'bg-white dark:bg-[#636366] text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>Logs</button>
                  <button onClick={() => setLogFilter('warn')} className={`px-2 py-0.5 text-[10px] uppercase font-medium rounded-sm transition-colors ${logFilter === 'warn' ? 'bg-white dark:bg-[#636366] text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>Warn</button>
                  <button onClick={() => setLogFilter('error')} className={`px-2 py-0.5 text-[10px] uppercase font-medium rounded-sm transition-colors ${logFilter === 'error' ? 'bg-white dark:bg-[#636366] text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>Error</button>
                </div>
              </div>
              <button onClick={() => setLogs([])} className="text-xs text-[#007AFF] dark:text-[#0A84FF] hover:opacity-80 font-medium">Clear</button>
            </div>
            <div className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
              {filteredLogs.length === 0 ? (
                <div className="text-gray-400 dark:text-gray-500 italic p-2">No logs to display...</div>
              ) : (
                filteredLogs.map(log => (
                  <div key={log.id} className={`py-1 px-2 mb-0.5 rounded border-l-2 ${
                    log.level === 'error' ? 'bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 border-red-500' :
                    log.level === 'warn' ? 'bg-yellow-50 dark:bg-yellow-900/10 text-yellow-600 dark:text-yellow-400 border-yellow-500' :
                    log.level === 'info' ? 'text-blue-600 dark:text-blue-400 border-blue-500' :
                    'text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600'
                  }`}>
                    <span className="opacity-50 mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
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

export default function App() {
  const [currentTab, setCurrentTab] = useState<'paste' | 'library'>('paste');
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [exportSheet, setExportSheet] = useState<Snippet | null>(null);
  const [exporting, setExporting] = useState<{ id: string, type: 'html' | 'image' | 'pdf' | 'markdown' } | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    if (user) {
      getSnippets().then(setSnippets);
    } else {
      setSnippets([]);
    }
  }, [user]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error);
      showToast('Failed to sign in');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSnippets([]);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleSave = async (title: string, content: string) => {
    if (!user) {
      showToast('Please sign in to save snippets');
      return;
    }
    const newSnippet: Snippet = {
      id: crypto.randomUUID(),
      title: title.trim() || 'Untitled Snippet',
      content,
      createdAt: Date.now(),
      userId: user.uid
    };
    await saveSnippet(newSnippet);
    setSnippets(await getSnippets());
    showToast('Saved to Library');
  };

  const handleUpdate = async (updatedSnippet: Snippet) => {
    if (!user) return;
    await saveSnippet(updatedSnippet);
    setSnippets(await getSnippets());
    showToast('Snippet updated');
    setEditingSnippet(null);
    setCurrentTab('library');
  };

  const handleAutoSave = async (updatedSnippet: Snippet) => {
    if (!user) return;
    await saveSnippet(updatedSnippet);
    setSnippets(await getSnippets());
  };

  const handleEdit = (snippet: Snippet) => {
    setEditingSnippet(snippet);
    setCurrentTab('paste');
  };

  const handleCancelEdit = () => {
    setEditingSnippet(null);
    setCurrentTab('library');
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    if (window.confirm('Delete this snippet?')) {
      await deleteSnippet(id);
      setSnippets(await getSnippets());
      showToast('Snippet deleted');
    }
  };

  const handleExport = (snippet: Snippet, type: 'html' | 'image' | 'pdf' | 'markdown') => {
    setExportSheet(null);
    
    if (type === 'html') {
      const blob = new Blob([snippet.content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${snippet.title || 'snippet'}.html`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (type === 'markdown') {
      const mdContent = `# ${snippet.title || 'Untitled Snippet'}\n\n\`\`\`html\n${snippet.content}\n\`\`\``;
      const blob = new Blob([mdContent], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${snippet.title || 'snippet'}.md`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    setExporting({ id: snippet.id, type });
    
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.width = '390px'; // iPhone width
    iframe.style.height = '844px'; // iPhone height
    iframe.style.opacity = '0';
    iframe.sandbox = 'allow-scripts allow-same-origin';

    const captureScript = `
      <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
      <script>
        window.onload = () => {
          setTimeout(async () => {
            try {
              const body = document.body;
              const html = document.documentElement;
              const height = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);
              
              window.parent.postMessage({ type: 'RESIZE', height }, '*');

              setTimeout(async () => {
                const canvas = await html2canvas(document.body, { 
                  useCORS: true,
                  scale: 2,
                  windowWidth: 390,
                  windowHeight: height,
                  backgroundColor: '#ffffff'
                });
                const imgData = canvas.toDataURL('image/jpeg', 0.8);
                window.parent.postMessage({ type: 'CAPTURED', imgData, height }, '*');
              }, 500);
            } catch (e) {
              window.parent.postMessage({ type: 'ERROR', error: e.message }, '*');
            }
          }, 1000);
        };
      </script>
    `;

    const finalContent = snippet.content + captureScript;
    iframe.srcDoc = finalContent;
    document.body.appendChild(iframe);

    const listener = async (e: MessageEvent) => {
      if (e.data.type === 'RESIZE') {
        iframe.style.height = `${e.data.height}px`;
      } else if (e.data.type === 'CAPTURED') {
        window.removeEventListener('message', listener);
        document.body.removeChild(iframe);
        setExporting(null);

        const { imgData, height } = e.data;

        if (type === 'image') {
          const a = document.createElement('a');
          a.href = imgData;
          a.download = `${snippet.title || 'snippet'}.jpg`;
          a.click();
        } else if (type === 'pdf') {
          try {
            const pageHeight = 844;
            const imgWidth = 390;
            const imgHeight = height;
            
            const pdf = new jsPDF({
              orientation: 'portrait',
              unit: 'px',
              format: [imgWidth, pageHeight]
            });
            
            let heightLeft = imgHeight;
            let pageIndex = 0;

            pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
            heightLeft -= pageHeight;

            while (heightLeft > 0) {
              pageIndex++;
              pdf.addPage([imgWidth, pageHeight], 'portrait');
              pdf.addImage(imgData, 'JPEG', 0, -(pageHeight * pageIndex), imgWidth, imgHeight);
              heightLeft -= pageHeight;
            }

            pdf.save(`${snippet.title || 'snippet'}.pdf`);
          } catch (err: any) {
            console.error('PDF generation error:', err);
            alert('Failed to generate PDF: ' + (err.message || String(err)));
          }
        }
      } else if (e.data.type === 'ERROR') {
        window.removeEventListener('message', listener);
        document.body.removeChild(iframe);
        setExporting(null);
        alert('Failed to capture snippet: ' + e.data.error);
      }
    };

    window.addEventListener('message', listener);
  };

  return (
    <div className="h-screen w-full bg-[#F2F2F7] dark:bg-black overflow-hidden flex flex-col font-sans selection:bg-blue-200 dark:selection:bg-blue-900 relative">
      <AnimatePresence mode="wait">
        {previewContent !== null ? (
          <motion.div
            key="preview"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute inset-0 z-50 bg-white dark:bg-gray-900 flex flex-col"
          >
            <PreviewScreen content={previewContent} onClose={() => setPreviewContent(null)} />
          </motion.div>
        ) : (
          <motion.div key="main" className="flex-1 flex flex-col h-full relative">
            <AnimatePresence mode="wait">
              {currentTab === 'paste' ? (
                <PasteScreen key="paste" snippetToEdit={editingSnippet} onPreview={setPreviewContent} onSave={handleSave} onUpdate={handleUpdate} onAutoSave={handleAutoSave} onCancelEdit={handleCancelEdit} theme={theme} toggleTheme={toggleTheme} existingTitles={snippets.map(s => s.title)} user={user} onLogin={handleLogin} onLogout={handleLogout} />
              ) : (
                <LibraryScreen key="library" snippets={snippets} onPreview={setPreviewContent} onEdit={handleEdit} onDelete={handleDelete} onExport={setExportSheet} theme={theme} toggleTheme={toggleTheme} user={user} onLogin={handleLogin} onLogout={handleLogout} />
              )}
            </AnimatePresence>

            {/* iOS Bottom Tab Bar */}
            <div className="absolute bottom-0 left-0 right-0 bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-2xl border-t border-gray-200/50 dark:border-[#38383A]/80 pb-safe pt-2 px-6 flex justify-around items-center z-40">
              <button
                onClick={() => {
                  setEditingSnippet(null);
                  setCurrentTab('paste');
                }}
                className={`flex flex-col items-center p-2 w-20 active:scale-95 transition-transform ${currentTab === 'paste' && !editingSnippet ? 'text-[#007AFF] dark:text-[#0A84FF]' : 'text-[#999999] dark:text-[#98989D]'}`}
              >
                <Plus className={`w-6 h-6 mb-1 ${currentTab === 'paste' && !editingSnippet ? 'stroke-[2.5px]' : 'stroke-2'}`} />
                <span className="text-[10px] font-medium tracking-wide">New</span>
              </button>
              <button
                onClick={() => {
                  setEditingSnippet(null);
                  setCurrentTab('library');
                }}
                className={`flex flex-col items-center p-2 w-20 active:scale-95 transition-transform ${currentTab === 'library' || editingSnippet ? 'text-[#007AFF] dark:text-[#0A84FF]' : 'text-[#999999] dark:text-[#98989D]'}`}
              >
                <Folder className={`w-6 h-6 mb-1 ${currentTab === 'library' || editingSnippet ? 'stroke-[2.5px] fill-current' : 'stroke-2'}`} />
                <span className="text-[10px] font-medium tracking-wide">Library</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="absolute top-[calc(env(safe-area-inset-top,48px)+12px)] left-1/2 -translate-x-1/2 bg-gray-800/90 dark:bg-gray-200/90 backdrop-blur-md text-white dark:text-black px-5 py-2.5 rounded-full shadow-lg z-[60] text-sm font-medium tracking-wide"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Export Action Sheet */}
      <AnimatePresence>
        {exportSheet && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50"
              onClick={() => setExportSheet(null)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 p-4 z-50 pb-safe"
            >
              <div className="bg-white/90 dark:bg-[#2C2C2E]/90 backdrop-blur-xl rounded-[14px] overflow-hidden mb-2">
                <div className="py-3.5 border-b border-gray-200/50 dark:border-gray-700/50">
                  <h3 className="text-[13px] font-semibold text-center text-gray-500 dark:text-gray-400">Export "{exportSheet.title}"</h3>
                </div>
                <button
                  onClick={() => handleExport(exportSheet, 'html')}
                  className="w-full py-4 border-b border-gray-200/50 dark:border-gray-700/50 text-[17px] text-[#007AFF] dark:text-[#0A84FF] active:bg-gray-200/50 dark:active:bg-gray-700/50 transition-colors"
                >
                  Download HTML File
                </button>
                <button
                  onClick={() => handleExport(exportSheet, 'markdown')}
                  className="w-full py-4 border-b border-gray-200/50 dark:border-gray-700/50 text-[17px] text-[#007AFF] dark:text-[#0A84FF] active:bg-gray-200/50 dark:active:bg-gray-700/50 transition-colors"
                >
                  Download as Markdown (.md)
                </button>
                <button
                  onClick={() => handleExport(exportSheet, 'image')}
                  className="w-full py-4 border-b border-gray-200/50 dark:border-gray-700/50 text-[17px] text-[#007AFF] dark:text-[#0A84FF] active:bg-gray-200/50 dark:active:bg-gray-700/50 transition-colors"
                >
                  Save as Image (JPG)
                </button>
                <button
                  onClick={() => handleExport(exportSheet, 'pdf')}
                  className="w-full py-4 text-[17px] text-[#007AFF] dark:text-[#0A84FF] active:bg-gray-200/50 dark:active:bg-gray-700/50 transition-colors"
                >
                  Save as PDF (Multi-page)
                </button>
              </div>
              <div className="bg-white/90 dark:bg-[#2C2C2E]/90 backdrop-blur-xl rounded-[14px] overflow-hidden">
                <button
                  onClick={() => setExportSheet(null)}
                  className="w-full py-4 text-[17px] font-semibold text-[#007AFF] dark:text-[#0A84FF] active:bg-gray-200/50 dark:active:bg-gray-700/50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Loading Overlay */}
      <AnimatePresence>
        {exporting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-[70] flex flex-col items-center justify-center"
          >
            <div className="w-10 h-10 border-4 border-[#007AFF] dark:border-blue-400 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="font-medium text-gray-700 dark:text-gray-300">Generating {exporting.type.toUpperCase()}...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
