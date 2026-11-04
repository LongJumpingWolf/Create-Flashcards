const DATABASE_NAME = 'anki-studio-pdf-resume';
const DATABASE_VERSION = 1;
const LAST_DOCUMENT_KEY = 'last-opened';

let databasePromise;

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('This browser does not support local PDF storage.'));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('documents')) database.createObjectStore('documents', { keyPath: 'key' });
        if (!database.objectStoreNames.contains('progress')) database.createObjectStore('progress', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local PDF storage.'));
      request.onblocked = () => reject(new Error('Local PDF storage is busy in another tab. Close the other app tab and try again.'));
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export async function hasSavedPdf() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('documents', 'readonly');
    const request = transaction.objectStore('documents').get(LAST_DOCUMENT_KEY);
    let found = false;
    request.onsuccess = () => { found = Boolean(request.result?.file); };
    transaction.oncomplete = () => resolve(found);
    transaction.onerror = () => reject(transaction.error || new Error('Could not check saved PDF.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not check saved PDF.'));
  });
}

export async function readSavedPdf() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['documents', 'progress'], 'readonly');
    const documentRequest = transaction.objectStore('documents').get(LAST_DOCUMENT_KEY);
    const progressRequest = transaction.objectStore('progress').get(LAST_DOCUMENT_KEY);
    let savedDocument;
    let savedProgress;
    documentRequest.onsuccess = () => { savedDocument = documentRequest.result; };
    progressRequest.onsuccess = () => { savedProgress = progressRequest.result; };
    transaction.oncomplete = () => resolve(savedDocument ? { ...savedDocument, ...savedProgress } : null);
    transaction.onerror = () => reject(transaction.error || new Error('Could not restore the saved PDF.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not restore the saved PDF.'));
  });
}

export async function rememberPdf(file, { pageNumber = 1, zoom = 1 } = {}) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['documents', 'progress'], 'readwrite');
    transaction.objectStore('documents').put({
      key: LAST_DOCUMENT_KEY,
      file,
      name: file.name || 'Study PDF',
      type: file.type || 'application/pdf',
      size: file.size,
      lastModified: file.lastModified || Date.now(),
      savedAt: Date.now(),
    });
    transaction.objectStore('progress').put({ key: LAST_DOCUMENT_KEY, pageNumber, zoom, updatedAt: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not save this PDF on the device.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not save this PDF on the device.'));
  });
}

export async function savePdfProgress(pageNumber, zoom) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('progress', 'readwrite');
    transaction.objectStore('progress').put({ key: LAST_DOCUMENT_KEY, pageNumber, zoom, updatedAt: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not save PDF position.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not save PDF position.'));
  });
}

export async function forgetSavedPdf() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['documents', 'progress'], 'readwrite');
    transaction.objectStore('documents').delete(LAST_DOCUMENT_KEY);
    transaction.objectStore('progress').delete(LAST_DOCUMENT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not forget the saved PDF.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not forget the saved PDF.'));
  });
}
