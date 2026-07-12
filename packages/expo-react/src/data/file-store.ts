// The on-disk half of the expo local store: where decrypted `files/` CONTENT
// lives (db.ts header — file bytes never enter SQLite or the JS heap;
// BraceFileCrypto decrypts ciphertext path-to-path and expo-image renders the
// plaintext file:// URI directly). This module owns the directory and the
// path↔location mapping so every consumer derives locations one way; the
// materialize/read helpers arrive with the sync-engine port.
//
// Locations are DERIVED, never persisted: iOS moves the app container between
// app updates, so a stored absolute file:// URI goes stale (db.ts). Only the
// relative layout below is stable.

import { Directory, File, Paths } from 'expo-file-system';

// All plaintext blobs live under one directory in the app's document storage
// (survives relaunches; not the cache dir, which the OS may purge — a purge
// would silently re-break "already downloaded" bookkeeping in `items`).
const DATA_FILES_DIR = 'brace-files';

function dataFilesDir(): Directory {
  return new Directory(Paths.document, DATA_FILES_DIR);
}

// The on-disk location for an `items` path (`files/f_abc.enc`). Paths are flat
// random-id names within their namespace, so encoding the ONE separator keeps
// the mapping bijective without nested directories.
export function dataFileFor(path: string): File {
  return new File(dataFilesDir(), path.replaceAll('/', '%2F'));
}

// Remove every decrypted blob — the file-system half of the `items` wipe, called
// by clear-data (sign-out) and delete-all-data. Recursive delete of the whole
// directory; recreated lazily by the next materialize.
export function clearDataFiles(): void {
  const dir = dataFilesDir();
  if (dir.exists) dir.delete();
}
