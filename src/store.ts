import { collection, doc, setDoc, deleteDoc, getDocs, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebase';

export interface Snippet {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  userId: string;
}

const COLLECTION_NAME = 'snippets';

export async function getSnippets(): Promise<Snippet[]> {
  if (!auth.currentUser) return [];
  
  const q = query(
    collection(db, COLLECTION_NAME),
    where('userId', '==', auth.currentUser.uid),
    orderBy('createdAt', 'desc')
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Snippet);
}

export async function saveSnippet(snippet: Snippet): Promise<void> {
  if (!auth.currentUser) throw new Error('User must be logged in to save snippets');
  
  const snippetWithUser = {
    ...snippet,
    userId: auth.currentUser.uid
  };
  
  await setDoc(doc(db, COLLECTION_NAME, snippet.id), snippetWithUser);
}

export async function deleteSnippet(id: string): Promise<void> {
  if (!auth.currentUser) throw new Error('User must be logged in to delete snippets');
  
  await deleteDoc(doc(db, COLLECTION_NAME, id));
}

