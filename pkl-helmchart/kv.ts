// Reads a value from Deno KV, tolerating corrupted or incompatible entries.
//
// Deno KV stores values using V8 serialization, so an entry written by an incompatible
// Deno/V8 version reads back as `RangeError: could not deserialize value`. Every key
// here is a cache, so a bad key is dropped and the caller rebuilds over it.
export async function safeGet<T>(kv: Deno.Kv, key: Deno.KvKey): Promise<Deno.KvEntryMaybe<T>> {
    try {
        return await kv.get<T>(key);
    } catch (error) {
        if (error instanceof RangeError) {
            console.warn("[KV] dropping undeserializable value at", key, "-", error.message);
            await kv.delete(key);
            return { key, value: null, versionstamp: null };
        }
        throw error;
    }
}

export type CachedInfo<T> = { from: Date; value: T; };

export function isCacheValid<T>(cached: CachedInfo<T> | null, maxAgeMs: number): cached is CachedInfo<T> {
    if (!cached) return false;
    return Date.now() - cached.from.getTime() < maxAgeMs;
}
