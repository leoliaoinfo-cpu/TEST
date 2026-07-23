// ── Durable auto-backup via the File System Access API ───────────────────────
// The app keeps a live copy of ALL data in a real file on the user's disk.
// After linking a file once, every data change is written to it automatically —
// no manual export needed. Because the file lives on disk (and can sit inside a
// Google Drive / OneDrive / Dropbox synced folder), it survives even a full
// browser-data wipe. Chromium-only (Chrome/Edge); gracefully absent elsewhere.

export function fsSupported() {
  return typeof window !== 'undefined'
    && 'showSaveFilePicker' in window
    && 'showOpenFilePicker' in window;
}

// ── Persistent storage (anti-eviction) ───────────────────────────────────────
// Asks the browser not to auto-evict our IndexedDB/localStorage under pressure.
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && await navigator.storage.persisted()) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* not supported */ }
  return false;
}

export async function isStoragePersisted() {
  try { return (await navigator.storage?.persisted?.()) || false; }
  catch { return false; }
}

// ── File pickers ─────────────────────────────────────────────────────────────
const JSON_TYPES = [{ description: 'JSON 備份', accept: { 'application/json': ['.json'] } }];

export async function pickBackupFile() {
  return window.showSaveFilePicker({
    suggestedName: '業務系統-自動備份.json',
    types: JSON_TYPES,
  });
}

export async function pickRestoreFile() {
  const [handle] = await window.showOpenFilePicker({ types: JSON_TYPES, multiple: false });
  return handle;
}

// ── Permissions ──────────────────────────────────────────────────────────────
export async function queryPermissionState(handle, readWrite = true) {
  try { return await handle.queryPermission({ mode: readWrite ? 'readwrite' : 'read' }); }
  catch { return 'denied'; }
}

// Must be called from a user gesture when state is 'prompt'.
export async function ensurePermission(handle, readWrite = true) {
  const opts = { mode: readWrite ? 'readwrite' : 'read' };
  try {
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
  } catch { /* denied / revoked */ }
  return false;
}

// ── Read / write ─────────────────────────────────────────────────────────────
export async function writeFileHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function readFileHandle(handle) {
  const file = await handle.getFile();
  return file.text();
}
