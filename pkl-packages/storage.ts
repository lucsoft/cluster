import { dirname, join } from "@std/path";

/**
 * Package zip artifacts are too large for Deno KV (64 KB value limit), so they
 * live as plain files on the same PVC as the KV database. The directory is
 * derived from KV_PATH (e.g. /data/kv.sqlite -> /data/packages); locally,
 * where KV_PATH is unset, it falls back to ./data/packages.
 */
const kvPath = Deno.env.get("KV_PATH");
const packagesDir = join(kvPath ? dirname(kvPath) : "./data", "packages");

function packageFilePath(packageName: string, version: string, fileName: string): string {
    return join(packagesDir, packageName, version, fileName);
}

export async function storePackageFile(packageName: string, version: string, fileName: string, data: Uint8Array): Promise<void> {
    const path = packageFilePath(packageName, version, fileName);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeFile(path, data);
}

export async function readPackageFile(packageName: string, version: string, fileName: string): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
        return await Deno.readFile(packageFilePath(packageName, version, fileName));
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}
