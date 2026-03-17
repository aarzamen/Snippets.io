import { useState, useEffect } from 'react';
import { Plus, Folder, Play, Save, Trash2, ChevronLeft, FileCode2, Monitor, Smartphone, Download, Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSnippets, saveSnippet, deleteSnippet, Snippet } from './store';
import { jsPDF } from 'jspdf';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';

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

function PasteScreen({ onPreview, onSave, theme, toggleTheme }: { onPreview: (c: string) => void, onSave: (t: string, c: string) => void, theme: 'light' | 'dark', toggleTheme: () => void }) {
  const [content, setContent] = useState('');
  const [debouncedContent, setDebouncedContent] = useState('');
  const [title, setTitle] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedContent(content), 500);
    return () => clearTimeout(timer);
  }, [content]);

  const handleSave = () => {
    if (!content.trim()) return;
    onSave(title, content);
    setContent('');
    setTitle('');
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 flex flex-col p-4 pt-safe pb-32 overflow-y-auto"
    >
      <div className="flex items-center justify-between mt-4 mb-6">
        <h1 className="text-3xl font-bold text-black dark:text-white tracking-tight">New Snippet</h1>
        <button onClick={toggleTheme} className="p-2 text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full active:scale-95 transition-transform">
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm overflow-hidden mb-6 border border-gray-100 dark:border-gray-800 flex-shrink-0 flex flex-col">
        <input
          type="text"
          placeholder="Title (optional)"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full px-4 py-4 border-b border-gray-100 dark:border-gray-800 text-lg focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 bg-transparent dark:text-white"
        />
        <div className="w-full h-64 overflow-y-auto bg-gray-50/50 dark:bg-gray-950/50">
          <Editor
            value={content}
            onValueChange={code => setContent(code)}
            highlight={code => Prism.highlight(code, Prism.languages.markup, 'html')}
            padding={16}
            placeholder="Paste HTML/JS code here...&#10;&#10;Tip: Ask the LLM for a single-file HTML with standalone React/Babel if using React."
            className="min-h-full text-sm font-mono text-gray-800 dark:text-gray-200"
            textareaClassName="focus:outline-none"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
          />
        </div>
      </div>

      {debouncedContent.trim() && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm overflow-hidden mb-6 border border-gray-100 dark:border-gray-800 flex-shrink-0 flex flex-col h-64 relative">
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
            <span>Live Preview</span>
            <span className="flex items-center text-[10px] text-gray-400 dark:text-gray-500 normal-case font-normal">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse"></span>
              Auto-updating
            </span>
          </div>
          <iframe
            srcDoc={injectMobileMeta(debouncedContent)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="w-full flex-1 border-none bg-white dark:bg-gray-900"
            title="Live Preview"
          />
        </div>
      )}

      <div className="flex gap-3 mt-auto flex-shrink-0">
        <button
          onClick={() => onPreview(content)}
          disabled={!content.trim()}
          className="flex-1 bg-white dark:bg-gray-800 text-[#007AFF] dark:text-blue-400 font-semibold py-3.5 rounded-xl shadow-sm disabled:opacity-50 flex items-center justify-center active:scale-[0.98] transition-transform border border-gray-100 dark:border-gray-700"
        >
          <Play className="w-5 h-5 mr-2" />
          Preview
        </button>
        <button
          onClick={handleSave}
          disabled={!content.trim()}
          className="flex-1 bg-[#007AFF] text-white font-semibold py-3.5 rounded-xl shadow-sm disabled:opacity-50 flex items-center justify-center active:scale-[0.98] transition-transform"
        >
          <Save className="w-5 h-5 mr-2" />
          Save
        </button>
      </div>
    </motion.div>
  );
}

function LibraryScreen({ snippets, onPreview, onDelete, onExport, theme, toggleTheme }: { snippets: Snippet[], onPreview: (c: string) => void, onDelete: (id: string) => void, onExport: (s: Snippet) => void, theme: 'light' | 'dark', toggleTheme: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex-1 flex flex-col p-4 pt-safe pb-32 overflow-y-auto"
    >
      <div className="flex items-center justify-between mt-4 mb-6">
        <h1 className="text-3xl font-bold text-black dark:text-white tracking-tight">Library</h1>
        <button onClick={toggleTheme} className="p-2 text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full active:scale-95 transition-transform">
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>

      {snippets.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-20 text-gray-400 dark:text-gray-500">
          <FileCode2 className="w-16 h-16 mb-4 opacity-20" />
          <p className="text-lg font-medium text-gray-500 dark:text-gray-400">No snippets saved</p>
          <p className="text-sm mt-1">Paste and save code to see it here.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-800">
          {snippets.map((snippet, index) => (
            <div key={snippet.id} className={`flex items-center justify-between p-4 ${index !== snippets.length - 1 ? 'border-b border-gray-100 dark:border-gray-800' : ''}`}>
              <div 
                className="w-16 h-16 rounded-xl overflow-hidden relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex-shrink-0 mr-4 cursor-pointer shadow-sm"
                onClick={() => onPreview(snippet.content)}
              >
                <iframe
                  srcDoc={injectMobileMeta(snippet.content)}
                  sandbox="allow-scripts allow-same-origin"
                  loading="lazy"
                  tabIndex={-1}
                  scrolling="no"
                  className="absolute top-0 left-0 w-[320px] h-[320px] origin-top-left scale-[0.2] pointer-events-none border-none bg-white dark:bg-gray-900"
                />
                {/* Invisible overlay to capture clicks and prevent iframe interaction */}
                <div className="absolute inset-0 z-10"></div>
              </div>
              <div
                className="flex-1 min-w-0 pr-4 cursor-pointer"
                onClick={() => onPreview(snippet.content)}
              >
                <h3 className="text-lg font-semibold text-black dark:text-white truncate tracking-tight">
                  {snippet.title}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {new Date(snippet.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} &middot; {(snippet.content.length / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onExport(snippet)}
                  className="p-2.5 text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
                  title="Export"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button
                  onClick={() => onPreview(snippet.content)}
                  className="p-2.5 text-[#007AFF] dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-full active:bg-blue-100 dark:active:bg-blue-900/50 transition-colors"
                >
                  <Play className="w-5 h-5 fill-current" />
                </button>
                <button
                  onClick={() => onDelete(snippet.id)}
                  className="p-2.5 text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-full active:bg-red-100 dark:active:bg-red-900/50 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function PreviewScreen({ content, onClose }: { content: string, onClose: () => void }) {
  const [viewMode, setViewMode] = useState<'portrait' | 'landscape' | 'desktop'>('portrait');
  const processedContent = injectMobileMeta(content);

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between px-4 py-3 pt-safe bg-white/70 dark:bg-gray-900/70 backdrop-blur-2xl border-b border-gray-200/80 dark:border-gray-800/80 shadow-sm z-10">
        <button onClick={onClose} className="text-[#007AFF] dark:text-blue-400 text-lg font-medium flex items-center active:opacity-70 transition-opacity w-20">
          <ChevronLeft className="w-6 h-6 -ml-2" />
          Back
        </button>
        
        <div className="flex bg-gray-100/80 dark:bg-gray-800/80 p-1 rounded-lg">
          <button 
            onClick={() => setViewMode('portrait')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center transition-all ${viewMode === 'portrait' ? 'bg-white dark:bg-gray-700 shadow-sm text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}
          >
            <Smartphone className="w-4 h-4 mr-1.5" />
            Portrait
          </button>
          <button 
            onClick={() => setViewMode('landscape')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center transition-all ${viewMode === 'landscape' ? 'bg-white dark:bg-gray-700 shadow-sm text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}
          >
            <Smartphone className="w-4 h-4 mr-1.5 -rotate-90" />
            Landscape
          </button>
          <button 
            onClick={() => setViewMode('desktop')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center transition-all ${viewMode === 'desktop' ? 'bg-white dark:bg-gray-700 shadow-sm text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}
          >
            <Monitor className="w-4 h-4 mr-1.5" />
            Desktop
          </button>
        </div>

        <div className="w-20"></div>
      </div>
      
      <div className={`flex-1 @container relative ${viewMode === 'desktop' ? 'overflow-auto bg-gray-100 dark:bg-gray-950 p-4 md:p-8' : 'overflow-hidden bg-white dark:bg-gray-900'}`}>
        <div className={`
          ${viewMode === 'portrait' ? 'w-full h-full' : ''}
          ${viewMode === 'landscape' ? 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 origin-center rotate-90 w-[100cqh] h-[100cqw]' : ''}
          ${viewMode === 'desktop' ? 'w-[1024px] min-h-[768px] h-full mx-auto bg-white shadow-xl border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden' : ''}
        `}>
          <iframe
            srcDoc={processedContent}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="w-full h-full border-none bg-white"
            title="Preview"
          />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [currentTab, setCurrentTab] = useState<'paste' | 'library'>('paste');
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [exportSheet, setExportSheet] = useState<Snippet | null>(null);
  const [exporting, setExporting] = useState<{ id: string, type: 'html' | 'image' | 'pdf' | 'markdown' } | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

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
    getSnippets().then(setSnippets);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleSave = async (title: string, content: string) => {
    const newSnippet: Snippet = {
      id: crypto.randomUUID(),
      title: title.trim() || 'Untitled Snippet',
      content,
      createdAt: Date.now()
    };
    await saveSnippet(newSnippet);
    setSnippets(await getSnippets());
    showToast('Saved to Library');
  };

  const handleDelete = async (id: string) => {
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
                  windowHeight: height
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
            pdf.addPage();
            pdf.addImage(imgData, 'JPEG', 0, -(pageHeight * pageIndex), imgWidth, imgHeight);
            heightLeft -= pageHeight;
          }

          pdf.save(`${snippet.title || 'snippet'}.pdf`);
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
                <PasteScreen key="paste" onPreview={setPreviewContent} onSave={handleSave} theme={theme} toggleTheme={toggleTheme} />
              ) : (
                <LibraryScreen key="library" snippets={snippets} onPreview={setPreviewContent} onDelete={handleDelete} onExport={setExportSheet} theme={theme} toggleTheme={toggleTheme} />
              )}
            </AnimatePresence>

            {/* iOS Bottom Tab Bar */}
            <div className="absolute bottom-0 left-0 right-0 bg-white/70 dark:bg-gray-900/70 backdrop-blur-2xl border-t border-gray-200/80 dark:border-gray-800/80 pb-safe pt-2 px-6 flex justify-around items-center z-40">
              <button
                onClick={() => setCurrentTab('paste')}
                className={`flex flex-col items-center p-2 w-20 active:scale-95 transition-transform ${currentTab === 'paste' ? 'text-[#007AFF] dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}
              >
                <Plus className={`w-6 h-6 mb-1 ${currentTab === 'paste' ? 'stroke-[2.5px]' : 'stroke-2'}`} />
                <span className="text-[10px] font-medium tracking-wide">Paste</span>
              </button>
              <button
                onClick={() => setCurrentTab('library')}
                className={`flex flex-col items-center p-2 w-20 active:scale-95 transition-transform ${currentTab === 'library' ? 'text-[#007AFF] dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}
              >
                <Folder className={`w-6 h-6 mb-1 ${currentTab === 'library' ? 'stroke-[2.5px] fill-blue-50 dark:fill-blue-900/30' : 'stroke-2'}`} />
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
              className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-3xl p-6 z-50 pb-safe"
            >
              <h3 className="text-lg font-semibold mb-4 text-center text-black dark:text-white">Export "{exportSheet.title}"</h3>
              <div className="space-y-3">
                <button
                  onClick={() => handleExport(exportSheet, 'html')}
                  className="w-full py-3.5 bg-gray-100 dark:bg-gray-800 rounded-xl font-medium text-black dark:text-white active:scale-95 transition-transform"
                >
                  Download HTML File
                </button>
                <button
                  onClick={() => handleExport(exportSheet, 'markdown')}
                  className="w-full py-3.5 bg-gray-100 dark:bg-gray-800 rounded-xl font-medium text-black dark:text-white active:scale-95 transition-transform"
                >
                  Download as Markdown (.md)
                </button>
                <button
                  onClick={() => handleExport(exportSheet, 'image')}
                  className="w-full py-3.5 bg-gray-100 dark:bg-gray-800 rounded-xl font-medium text-black dark:text-white active:scale-95 transition-transform"
                >
                  Save as Image (JPG)
                </button>
                <button
                  onClick={() => handleExport(exportSheet, 'pdf')}
                  className="w-full py-3.5 bg-gray-100 dark:bg-gray-800 rounded-xl font-medium text-black dark:text-white active:scale-95 transition-transform"
                >
                  Save as PDF (Multi-page)
                </button>
                <button
                  onClick={() => setExportSheet(null)}
                  className="w-full py-3.5 mt-2 bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 rounded-xl font-medium active:scale-95 transition-transform"
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
