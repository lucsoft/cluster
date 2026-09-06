import { parse } from "@std/semver";

// A chart reference as it appears in the request path.
export type ChartRef = {
    scheme: "https" | "oci";
    repoPath: string;
    chart: string;
    version: string;
    // Upstream chart versions are matched against both forms; Pkl rejects a leading `v`.
    upstreamVersions: string[];
    rest: string | null;
};

export class BadRequestError extends Error {}
export class ForbiddenError extends Error {}

const pattern = /^\/charts\/(?<scheme>https|oci)\/(?<repoPath>.+?)\/(?<chart>[^/@]+)@(?<version>[^/]+?)(?:\/(?<rest>.*))?$/;

// Hosts the service is allowed to fetch from. Every outbound URL is checked, including
// the .tgz an index.yaml points at and the OCI token realm, which need not share the
// registry's host.
const defaultAllowedHosts = [
    "charts.jetstack.io",
    "argoproj.github.io",
    "victoriametrics.github.io",
    "fission.github.io",
    "isindir.github.io",
    "kubernetes.github.io",
    "grafana.github.io",
    "prometheus-community.github.io",
    "github.com",
    "objects.githubusercontent.com",
    "raw.githubusercontent.com",
    "ghcr.io",
    // A reference names docker.io, which oci.ts rewrites to the registry and auth hosts
    // it actually talks to; the allowlist has to accept the name as written.
    "docker.io",
    "index.docker.io",
    "registry-1.docker.io",
    "auth.docker.io",
];

export const allowedHosts = Deno.env.get("ALLOWED_HOSTS")
    ?.split(",")
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    ?? defaultAllowedHosts;

export function assertAllowed(url: string | URL): void {
    const parsed = typeof url === "string" ? new URL(url) : url;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new ForbiddenError(`Refusing non-HTTP(S) URL: ${parsed.protocol}`);
    }
    const target = `${parsed.host}${parsed.pathname}`;
    const allowed = allowedHosts.some(entry =>
        entry.includes("/") ? target.startsWith(entry) : parsed.host === entry
    );
    if (!allowed) {
        throw new ForbiddenError(`Host not allowlisted: ${parsed.host}`);
    }
}

export function parseChartRef(pathname: string): ChartRef {
    const groups = pathname.match(pattern)?.groups;
    if (!groups) {
        throw new BadRequestError("Expected /charts/<https|oci>/<repo>/<chart>@<version>");
    }

    const { scheme, repoPath, chart, version, rest } = groups;

    // Mutable tags (`latest`, `main`) would break the cache-forever contract, and a Pkl
    // package version must be bare semver even where the chart tags itself with a `v`.
    try {
        if (version.startsWith("v")) throw new Error("leading v");
        parse(version);
    } catch {
        throw new BadRequestError(`Version must be semver without a leading "v": ${version}`);
    }

    const ref: ChartRef = {
        scheme: scheme as "https" | "oci",
        repoPath,
        chart,
        version,
        upstreamVersions: [ version, `v${version}` ],
        rest: rest ?? null,
    };

    assertAllowed(repoUrl(ref));
    return ref;
}

// The upstream base URL the reference points at, without the chart or version.
export function repoUrl(ref: ChartRef): string {
    return `https://${ref.repoPath}`;
}

// Stable cache/storage key for a chart, independent of any trailing file path.
export function refKey(ref: ChartRef): string[] {
    return [ ref.scheme, ref.repoPath, ref.chart, ref.version ];
}
