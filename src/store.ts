import { get, set } from 'idb-keyval';

export interface Snippet {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

const STORE_KEY = 'html_snippets';

export async function getSnippets(): Promise<Snippet[]> {
  const data = await get<Snippet[]>(STORE_KEY);
  if (!data) return [];
  
  // Deduplicate by ID, keeping the most recent one (first occurrence)
  const uniqueSnippets: Snippet[] = [];
  const seenIds = new Set<string>();
  for (const snippet of data) {
    if (!seenIds.has(snippet.id)) {
      uniqueSnippets.push(snippet);
      seenIds.add(snippet.id);
    }
  }
  return uniqueSnippets;
}

export async function saveSnippet(snippet: Snippet): Promise<void> {
  const snippets = await getSnippets();
  const existingIndex = snippets.findIndex(s => s.id === snippet.id);
  
  if (existingIndex >= 0) {
    snippets[existingIndex] = snippet;
    await set(STORE_KEY, snippets);
  } else {
    await set(STORE_KEY, [snippet, ...snippets]);
  }
}

export async function deleteSnippet(id: string): Promise<void> {
  const snippets = await getSnippets();
  await set(STORE_KEY, snippets.filter(s => s.id !== id));
}
