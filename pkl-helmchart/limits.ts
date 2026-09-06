import { LimitedBytesTransformStream } from "@std/streams/limited-bytes-transform-stream";
import { assertAllowed } from "./ref.ts";

function envBytes(name: string, fallback: number): number {
    const raw = Deno.env.get(name);
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive number of bytes, got: ${raw}`);
    }
    return parsed;
}

export const limits = {
    // Compressed chart tarball, the .tgz or the OCI blob.
    chart: envBytes("MAX_CHART_BYTES", 10 * 1024 * 1024),
    // Total gzip output across every entry, so a small .tgz cannot expand without bound.
    unpacked: envBytes("MAX_UNPACKED_BYTES", 50 * 1024 * 1024),
    // Classic repo index.yaml, which runs to tens of MB on large repos.
    index: envBytes("MAX_INDEX_BYTES", 32 * 1024 * 1024),
    // OCI manifests and token responses.
    manifest: envBytes("MAX_MANIFEST_BYTES", 1024 * 1024),
    timeoutMs: envBytes("FETCH_TIMEOUT_MS", 30_000),
};

export class OverCapError extends Error {
    constructor(what: string, readonly cap: number, readonly observed: number | null) {
        const seen = observed === null ? "unknown size" : `${observed} bytes`;
        super(`${what} exceeds the ${cap} byte cap (${seen})`);
    }
}

export class UpstreamError extends Error {
    constructor(message: string, readonly status: number | null = null) {
        super(message);
    }
}

export class NotFoundError extends Error {}

type FetchOptions = {
    maxBytes: number;
    what: string;
    headers?: Record<string, string>;
    // Treat a 404 as NotFoundError rather than an upstream failure.
    allowNotFound?: boolean;
};

async function request(url: string, options: FetchOptions): Promise<Response | null> {
    assertAllowed(url);
    let res: Response;
    try {
        res = await fetch(url, {
            headers: options.headers,
            signal: AbortSignal.timeout(limits.timeoutMs),
            redirect: "follow",
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
            throw new UpstreamError(`Timed out fetching ${options.what}`);
        }
        throw error;
    }

    if (res.status === 404 && options.allowNotFound) {
        await res.body?.cancel();
        return null;
    }
    if (!res.ok) {
        await res.body?.cancel();
        throw new UpstreamError(`Failed to fetch ${options.what}: ${res.status} ${res.statusText}`, res.status);
    }
    return res;
}

// Reads a response body under a hard byte cap: the declared Content-Length is rejected
// up front, and the stream is cut off at the cap regardless of what the server declared.
async function readCapped(res: Response, options: FetchOptions): Promise<Uint8Array> {
    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > options.maxBytes) {
        await res.body?.cancel();
        throw new OverCapError(options.what, options.maxBytes, Number(declared));
    }
    if (!res.body) return new Uint8Array();

    const capped = res.body.pipeThrough(
        new LimitedBytesTransformStream(options.maxBytes, { error: true }),
    );

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for await (const chunk of capped) {
            chunks.push(chunk);
            total += chunk.length;
        }
    } catch (error) {
        if (error instanceof RangeError) {
            throw new OverCapError(options.what, options.maxBytes, null);
        }
        throw error;
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

export async function boundedFetch(url: string, options: FetchOptions): Promise<Uint8Array | null> {
    const res = await request(url, options);
    if (!res) return null;
    return await readCapped(res, options);
}

export async function boundedFetchText(url: string, options: FetchOptions): Promise<string | null> {
    const bytes = await boundedFetch(url, options);
    return bytes === null ? null : new TextDecoder().decode(bytes);
}

export async function boundedFetchJson<T>(url: string, options: FetchOptions): Promise<T | null> {
    const text = await boundedFetchText(url, options);
    return text === null ? null : JSON.parse(text) as T;
}

// Free precheck for classic repos, whose index.yaml carries no size for the chart itself.
export async function declaredSize(url: string): Promise<number | null> {
    assertAllowed(url);
    try {
        const res = await fetch(url, {
            method: "HEAD",
            signal: AbortSignal.timeout(limits.timeoutMs),
            redirect: "follow",
        });
        await res.body?.cancel();
        if (!res.ok) return null;
        const declared = res.headers.get("content-length");
        return declared === null ? null : Number(declared);
    } catch {
        // A repo that rejects HEAD is not an error; the streaming cap still applies.
        return null;
    }
}
