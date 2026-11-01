// Field screens run entirely from IndexedDB: client-only, so the service worker
// can serve one cached shell for every /f/** URL while offline.
export const ssr = false;
