import test from "node:test";
import assert from "node:assert/strict";
import { openIndexedDBVersionSafe } from "../src/indexeddb-safe-open.js";

function versionError(message = "requested version is lower") {
  const error = new Error(message);
  error.name = "VersionError";
  return error;
}

class FakeDB {
  constructor(factory) {
    this.factory = factory;
    this.version = factory.version;
    this.closed = false;
    this.onversionchange = null;
  }
  close() { this.closed = true; }
}

class FakeIndexedDB {
  constructor(version = 1) {
    this.version = version;
    this.calls = [];
  }
  open(_name, requestedVersion) {
    this.calls.push(requestedVersion);
    const request = { result:null, error:null, transaction:{}, onsuccess:null, onerror:null, onblocked:null, onupgradeneeded:null };
    queueMicrotask(() => {
      if (requestedVersion !== undefined && requestedVersion < this.version) {
        request.error = versionError();
        request.onerror?.({ target:request });
        return;
      }
      const oldVersion = this.version;
      if (requestedVersion !== undefined && requestedVersion > this.version) {
        this.version = requestedVersion;
        request.result = new FakeDB(this);
        request.onupgradeneeded?.({ oldVersion, newVersion:requestedVersion, target:request });
      } else {
        request.result = new FakeDB(this);
      }
      request.result.version = this.version;
      request.onsuccess?.({ target:request });
    });
    return request;
  }
}

test("existing IndexedDB v3 is opened safely when this build only targets v2", async () => {
  const factory = new FakeIndexedDB(3);
  const result = await openIndexedDBVersionSafe({ name:"app", targetVersion:2, indexedDBFactory:factory });
  assert.equal(result.version, 3);
  assert.equal(result.newerThanTarget, true);
  assert.deepEqual(factory.calls, [undefined], "must never issue indexedDB.open(name, 2) against existing v3");
});

test("older IndexedDB is upgraded only after probing the current version", async () => {
  const factory = new FakeIndexedDB(1);
  const upgrades = [];
  const result = await openIndexedDBVersionSafe({
    name:"app",
    targetVersion:3,
    indexedDBFactory:factory,
    onUpgrade: ({oldVersion,newVersion}) => upgrades.push([oldVersion,newVersion]),
  });
  assert.equal(result.version, 3);
  assert.equal(result.upgraded, true);
  assert.deepEqual(factory.calls, [undefined, 3]);
  assert.deepEqual(upgrades, [[1,3]]);
});

test("VersionError race is recovered by reopening without an explicit version", async () => {
  const factory = new FakeIndexedDB(1);
  let explicitCalls = 0;
  const baseOpen = factory.open.bind(factory);
  factory.open = (name, requestedVersion) => {
    if (requestedVersion !== undefined) {
      explicitCalls += 1;
      if (explicitCalls === 1) {
        // Simulate another tab upgrading from 1 to 4 after our initial probe.
        factory.version = 4;
      }
    }
    return baseOpen(name, requestedVersion);
  };
  const result = await openIndexedDBVersionSafe({ name:"app", targetVersion:3, indexedDBFactory:factory });
  assert.equal(result.version, 4);
  assert.equal(result.recoveredFromVersionRace, true);
  assert.deepEqual(factory.calls, [undefined, 3, undefined]);
});
