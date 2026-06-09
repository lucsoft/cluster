/**
 * Reads a value from Deno KV, tolerating corrupted/incompatible entries.
 *
 * Deno KV stores values using V8 serialization. If an entry was written by an
 * incompatible Deno/V8 version (e.g. after an upgrade) or got corrupted, the
 * read throws `RangeError: could not deserialize value`. Since every key in
 * this service is just a cache, we treat that as a miss: drop the bad key and
 * let the caller refetch/rebuild, overwriting it.
 */
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
