import { boundedFetch, boundedFetchJson, limits, NotFoundError, OverCapError, UpstreamError } from "./limits.ts";
import { assertAllowed, type ChartRef } from "./ref.ts";

const chartLayerMediaType = "application/vnd.cncf.helm.chart.content.v1.tar+gzip";
const manifestAccept = [
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

type Descriptor = { mediaType?: string; digest?: string; size?: number; };
type Manifest = { layers?: Descriptor[]; };

// `oci/ghcr.io/traefik/helm/traefik@37.3.0` -> registry ghcr.io, repository traefik/helm/traefik.
function target(ref: ChartRef): { registry: string; repository: string; } {
    const [ host, ...rest ] = ref.repoPath.split("/");
    const registry = host === "docker.io" || host === "index.docker.io" ? "registry-1.docker.io" : host;
    const path = [ ...rest, ref.chart ].join("/");
    // Official Docker Hub images live under the implicit `library` namespace.
    const repository = registry === "registry-1.docker.io" && !path.includes("/") ? `library/${path}` : path;
    return { registry, repository };
}

function parseChallenge(header: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const match of header.matchAll(/(\w+)="([^"]*)"/g)) {
        fields[ match[ 1 ] ] = match[ 2 ];
    }
    return fields;
}

// Registries answer an unauthenticated request with a Bearer challenge naming the token
// endpoint. The realm can be a different host than the registry, so it is allowlisted too.
async function authorize(registry: string, repository: string): Promise<Record<string, string>> {
    const url = `https://${registry}/v2/`;
    assertAllowed(url);
    const probe = await fetch(url, { signal: AbortSignal.timeout(limits.timeoutMs) });
    await probe.body?.cancel();
    if (probe.status !== 401) return {};

    const challenge = probe.headers.get("www-authenticate");
    if (!challenge?.toLowerCase().startsWith("bearer")) return {};

    const { realm, service } = parseChallenge(challenge);
    if (!realm) return {};

    const tokenUrl = new URL(realm);
    if (service) tokenUrl.searchParams.set("service", service);
    tokenUrl.searchParams.set("scope", `repository:${repository}:pull`);

    const token = await boundedFetchJson<{ token?: string; access_token?: string; }>(tokenUrl.href, {
        maxBytes: limits.manifest,
        what: `auth token for ${repository}`,
    });
    const value = token?.token ?? token?.access_token;
    return value ? { Authorization: `Bearer ${value}` } : {};
}

export async function pullOci(ref: ChartRef): Promise<Uint8Array> {
    const { registry, repository } = target(ref);
    const headers = await authorize(registry, repository);

    let manifest: Manifest | null = null;
    for (const version of ref.upstreamVersions) {
        manifest = await boundedFetchJson<Manifest>(
            `https://${registry}/v2/${repository}/manifests/${version}`,
            {
                maxBytes: limits.manifest,
                what: `manifest ${repository}:${version}`,
                headers: { ...headers, Accept: manifestAccept },
                allowNotFound: true,
            },
        );
        if (manifest) break;
    }
    if (!manifest) throw new NotFoundError(`No manifest for ${repository}:${ref.version}`);

    const layer = manifest.layers?.find(candidate => candidate.mediaType === chartLayerMediaType)
        ?? manifest.layers?.[ 0 ];
    if (!layer?.digest) throw new UpstreamError(`Manifest for ${repository}:${ref.version} has no chart layer`);

    // The layer size is authoritative and costs nothing, so it is the precheck.
    if (layer.size !== undefined && layer.size > limits.chart) {
        throw new OverCapError(`Chart ${ref.chart}@${ref.version}`, limits.chart, layer.size);
    }

    const bytes = await boundedFetch(`https://${registry}/v2/${repository}/blobs/${layer.digest}`, {
        maxBytes: limits.chart,
        what: `chart blob ${repository}:${ref.version}`,
        headers,
    });
    if (bytes === null) throw new NotFoundError(`Blob ${layer.digest} missing from ${repository}`);

    await verifyDigest(bytes, layer.digest, repository);
    return bytes;
}

async function verifyDigest(bytes: Uint8Array, expected: string, repository: string): Promise<void> {
    if (!expected.startsWith("sha256:")) return;
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    const actual = Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
    if (actual !== expected.slice("sha256:".length)) {
        throw new UpstreamError(`Digest mismatch for the chart blob of ${repository}`);
    }
}
