import { get, set } from 'idb-keyval';

export interface Snippet {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

const STORE_KEY = 'html_snippets';

export async function getSnippets(): Promise<Snippet[]> {
  const data = await get(STORE_KEY);
  return data || [];
}

export async function saveSnippet(snippet: Snippet): Promise<void> {
  const snippets = await getSnippets();
  await set(STORE_KEY, [snippet, ...snippets]);
}

export async function deleteSnippet(id: string): Promise<void> {
  const snippets = await getSnippets();
  await set(STORE_KEY, snippets.filter(s => s.id !== id));
}
