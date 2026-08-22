/**
 * Opens IndexedDB without ever requesting a version lower than the version that
 * already exists on the device.
 *
 * Why this exists: `indexedDB.open(name, 2)` MUST fail with VersionError if the
 * same origin already has `name` at version 3. That is exactly what happens
 * after a user has run a newer build and then opens an older/cached build.
 *
 * The safe sequence is:
 *   1. open without a version to discover/use the current DB version;
 *   2. only request targetVersion when an upgrade is actually needed;
 *   3. if another tab races us and upgrades first, reopen the current version.
 */
export async function openIndexedDBVersionSafe({
  name,
  targetVersion = 1,
  indexedDBFactory = globalThis.indexedDB,
  onUpgrade = null,
} = {}) {
  if (!name) throw new TypeError("IndexedDB name is required.");
  if (!indexedDBFactory?.open) throw new Error("IndexedDB is unavailable in this environment.");
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new TypeError("targetVersion must be an integer >= 1.");
  }

  const current = await openRequest(indexedDBFactory.open(name), null);
  const currentVersion = Number(current.version) || 1;

  // A newer schema is already installed. Never downgrade it and never request
  // the lower target version; just use the current connection as specified by
  // IndexedDB when open() is called without a version.
  if (currentVersion >= targetVersion) {
    installVersionChangeAutoClose(current);
    return {
      db: current,
      version: currentVersion,
      targetVersion,
      upgraded: false,
      newerThanTarget: currentVersion > targetVersion,
    };
  }

  current.close?.();
  try {
    const upgraded = await openRequest(indexedDBFactory.open(name, targetVersion), onUpgrade);
    installVersionChangeAutoClose(upgraded);
    return {
      db: upgraded,
      version: Number(upgraded.version) || targetVersion,
      targetVersion,
      upgraded: true,
      newerThanTarget: false,
    };
  } catch (error) {
    // Another context may have upgraded the DB between our probe and requested
    // upgrade. A VersionError here is recoverable: reopen without a version and
    // accept the now-current schema rather than crashing startup.
    if (error?.name !== "VersionError") throw error;
    const raced = await openRequest(indexedDBFactory.open(name), null);
    installVersionChangeAutoClose(raced);
    return {
      db: raced,
      version: Number(raced.version) || targetVersion,
      targetVersion,
      upgraded: false,
      newerThanTarget: Number(raced.version) > targetVersion,
      recoveredFromVersionRace: true,
    };
  }
}

function openRequest(request, onUpgrade) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    request.onblocked = () => {
      // Keep waiting: the caller gets a deterministic result once other tabs
      // close. Applications can additionally surface their own blocked UI.
    };
    request.onupgradeneeded = (event) => {
      if (typeof onUpgrade === "function") {
        onUpgrade({
          db: request.result,
          transaction: request.transaction,
          oldVersion: event.oldVersion,
          newVersion: event.newVersion,
          event,
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function installVersionChangeAutoClose(db) {
  if (!db) return;
  const previous = db.onversionchange;
  db.onversionchange = (event) => {
    try { previous?.call(db, event); } finally { db.close?.(); }
  };
}
