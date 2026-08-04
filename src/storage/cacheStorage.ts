import * as vscode from "vscode";

const CACHE_NAMESPACE = "leetdock.cache.";
const CACHE_FORMAT_VERSION = 1;

interface CacheEntry<T> {
  readonly version: number;
  readonly storedAt: number;
  readonly expiresAt?: number;
  readonly value: T;
}

/** A namespaced, expiring cache backed by VS Code global state. */
export class CacheStorage {
  public constructor(private readonly state: vscode.Memento) {}

  public async get<T>(key: string): Promise<T | undefined> {
    const storageKey = this.storageKey(key);
    const entry = this.state.get<CacheEntry<T>>(storageKey);

    if (!this.isEntry(entry)) {
      if (entry !== undefined) {
        await this.state.update(storageKey, undefined);
      }
      return undefined;
    }

    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      await this.state.update(storageKey, undefined);
      return undefined;
    }

    return entry.value;
  }

  public async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
      throw new Error("Cache TTL must be a positive finite number.");
    }

    const storedAt = Date.now();
    const entry: CacheEntry<T> = {
      version: CACHE_FORMAT_VERSION,
      storedAt,
      ...(ttlMs === undefined ? {} : { expiresAt: storedAt + ttlMs }),
      value,
    };

    await this.state.update(this.storageKey(key), entry);
  }

  public async delete(key: string): Promise<void> {
    await this.state.update(this.storageKey(key), undefined);
  }

  public async clear(prefix = ""): Promise<void> {
    const fullPrefix = `${CACHE_NAMESPACE}${prefix}`;
    const keys = this.state.keys().filter((key) => key.startsWith(fullPrefix));
    await Promise.all(keys.map((key) => this.state.update(key, undefined)));
  }

  private storageKey(key: string): string {
    const normalized = key.trim();
    if (normalized.length === 0) {
      throw new Error("Cache key cannot be empty.");
    }
    return `${CACHE_NAMESPACE}${normalized}`;
  }

  private isEntry<T>(value: CacheEntry<T> | undefined): value is CacheEntry<T> {
    return (
      value !== undefined &&
      typeof value === "object" &&
      value.version === CACHE_FORMAT_VERSION &&
      typeof value.storedAt === "number" &&
      (value.expiresAt === undefined || typeof value.expiresAt === "number") &&
      Object.prototype.hasOwnProperty.call(value, "value")
    );
  }
}
