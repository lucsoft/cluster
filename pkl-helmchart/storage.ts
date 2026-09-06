import { dirname, join } from "@std/path";
import type { ChartRef } from "./ref.ts";

// Package zips and cached repo indexes are too large for Deno KV's 64 KB value limit,
// so they live as files on the same PVC as the KV database. The directory is derived
// from KV_PATH (/data/kv.sqlite -> /data/charts); locally it falls back to ./data.
const kvPath = Deno.env.get("KV_PATH");
const dataDir = kvPath ? dirname(kvPath) : "./data";

function chartDir(ref: ChartRef): string {
    return join(dataDir, "charts", ref.scheme, ref.repoPath, ref.chart, ref.version);
}

function indexPath(repoPath: string): string {
    return join(dataDir, "index", repoPath, "index.yaml");
}

// The KV database and the artifact tree share a directory, which on a fresh PVC does
// not exist yet; Deno.openKv will not create it.
export async function ensureDataDir(): Promise<void> {
    await Deno.mkdir(dataDir, { recursive: true });
}

async function readFileOrNull(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
        return await Deno.readFile(path);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

async function writeFile(path: string, data: Uint8Array | string): Promise<void> {
    await Deno.mkdir(dirname(path), { recursive: true });
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    await Deno.writeFile(path, bytes);
}

export async function storeChartFile(ref: ChartRef, fileName: string, data: Uint8Array | string): Promise<void> {
    await writeFile(join(chartDir(ref), fileName), data);
}

export function readChartFile(ref: ChartRef, fileName: string): Promise<Uint8Array<ArrayBuffer> | null> {
    return readFileOrNull(join(chartDir(ref), fileName));
}

export async function storeIndex(repoPath: string, data: string): Promise<void> {
    await writeFile(indexPath(repoPath), data);
}

export async function readIndex(repoPath: string): Promise<string | null> {
    const bytes = await readFileOrNull(indexPath(repoPath));
    return bytes === null ? null : new TextDecoder().decode(bytes);
}
