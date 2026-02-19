import { assert } from "@std/assert";

const repoUrl = "https://github.com/lucsoft/cluster";

assert(repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/), "Invalid GitHub repository URL");

type CachedInfo<T> = { from: Date, value: T; };

function isCacheValid<T>(cached: CachedInfo<T> | null, maxAgeMs: number): cached is CachedInfo<T> {
    if (!cached) return false;
    const age = Date.now() - cached.from.getTime();
    return age < maxAgeMs;
}

export async function getAllTags(kv: Deno.Kv): Promise<string[]> {
    const cachedTags = await kv.get<CachedInfo<string[]>>([ "github", "tags" ]);

    if (isCacheValid(cachedTags.value, 2 * 60 * 1000)) {
        return cachedTags.value.value;
    }

    const repoPathMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoPathMatch) return [];

    const [ _, owner, repo ] = repoPathMatch;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/tags`;

    const res = await fetch(apiUrl);
    assert(res.ok, `Failed to fetch tags: ${res.status} ${res.statusText}`);
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    const response = data.map((item: any) => item.name);
    await kv.set([ "github", "tags" ], { from: new Date(), value: response });
    return response;
}


export async function getAllPackages(kv: Deno.Kv, targetTag: string): Promise<string[]> {
    const cachedPackages = await kv.get<CachedInfo<string[]>>([ "github", "packages", targetTag ]);
    if (isCacheValid(cachedPackages.value, 60 * 60 * 1000)) {
        return cachedPackages.value.value;
    }
    const repoPathMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoPathMatch) return [];

    const [ _, owner, repo ] = repoPathMatch;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/packages?ref=${targetTag}`;

    const res = await fetch(apiUrl);
    assert(res.ok, `Failed to fetch packages: ${res.status} ${res.statusText} ${JSON.stringify(Object.fromEntries(res.headers.entries()))}`);
    const data = await res.json();
    const response = data
        // deno-lint-ignore no-explicit-any
        .filter((item: any) => item.type === "dir")
        // deno-lint-ignore no-explicit-any
        .map((item: any) => item.name);
    await kv.set([ "github", "packages", targetTag ], { from: new Date(), value: response });
    return response;
}
