import { parse as parseYaml } from "@std/yaml";
import { isCacheValid, safeGet, type CachedInfo } from "./kv.ts";
import { boundedFetch, boundedFetchText, declaredSize, limits, NotFoundError, OverCapError } from "./limits.ts";
import { type ChartRef, repoUrl } from "./ref.ts";
import { readIndex, storeIndex } from "./storage.ts";

type IndexEntry = { version?: string; urls?: string[]; digest?: string; };
type RepoIndex = { entries?: Record<string, IndexEntry[]>; };

const indexMaxAgeMs = 10 * 60 * 1000;

async function repoIndex(kv: Deno.Kv, ref: ChartRef): Promise<RepoIndex> {
    const stamp = await safeGet<CachedInfo<true>>(kv, [ "index", ref.scheme, ref.repoPath ]);
    if (isCacheValid(stamp.value, indexMaxAgeMs)) {
        const cached = await readIndex(ref.repoPath);
        if (cached) return parseYaml(cached) as RepoIndex;
    }

    const url = `${repoUrl(ref)}/index.yaml`;
    const text = await boundedFetchText(url, { maxBytes: limits.index, what: `index.yaml of ${ref.repoPath}` });
    if (text === null) throw new NotFoundError(`No index.yaml at ${url}`);

    await storeIndex(ref.repoPath, text);
    await kv.set([ "index", ref.scheme, ref.repoPath ], { from: new Date(), value: true });
    return parseYaml(text) as RepoIndex;
}

// Resolves the chart's .tgz, then downloads it under the byte cap. The URL in index.yaml
// may be relative to the repo and often points at a different host than the index itself,
// so it is allowlist-checked again on the way out (inside boundedFetch).
export async function pullLegacy(kv: Deno.Kv, ref: ChartRef): Promise<Uint8Array> {
    const index = await repoIndex(kv, ref);
    const entries = index.entries?.[ ref.chart ];
    if (!entries) throw new NotFoundError(`Chart ${ref.chart} not in ${ref.repoPath}`);

    const entry = entries.find(candidate =>
        candidate.version !== undefined && ref.upstreamVersions.includes(candidate.version)
    );
    if (!entry) throw new NotFoundError(`Version ${ref.version} of ${ref.chart} not in ${ref.repoPath}`);

    const rawUrl = entry.urls?.[ 0 ];
    if (!rawUrl) throw new NotFoundError(`Entry ${ref.chart}@${ref.version} has no download URL`);
    const url = new URL(rawUrl, `${repoUrl(ref)}/`).href;

    const declared = await declaredSize(url);
    if (declared !== null && declared > limits.chart) {
        throw new OverCapError(`Chart ${ref.chart}@${ref.version}`, limits.chart, declared);
    }

    const bytes = await boundedFetch(url, { maxBytes: limits.chart, what: `chart ${ref.chart}@${ref.version}` });
    if (bytes === null) throw new NotFoundError(`Chart tarball missing at ${url}`);
    if (entry.digest) await verifyDigest(bytes, entry.digest, ref);
    return bytes;
}

async function verifyDigest(bytes: Uint8Array, expected: string, ref: ChartRef): Promise<void> {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    const actual = Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
    const want = expected.replace(/^sha256:/, "");
    if (actual !== want) {
        throw new Error(`Digest mismatch for ${ref.chart}@${ref.version}: expected ${want}, got ${actual}`);
    }
}
