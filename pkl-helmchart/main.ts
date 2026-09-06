import { html } from "lit";
import { buildChart } from "./build.ts";
import { safeGet } from "./kv.ts";
import { NotFoundError, OverCapError, UpstreamError } from "./limits.ts";
import icon from "./icon.svg" with { type: "text" };
import { BadRequestError, type ChartRef, ForbiddenError, parseChartRef, refKey } from "./ref.ts";
import { respondHtml } from "./respondHtml.ts";
import { ensureDataDir, readChartFile } from "./storage.ts";

const host = Deno.env.get("PUBLIC_HOST") ?? "pkl-helm.lucsoft.de";
const artifact = /.out\/.*\/(?<fileName>.*)/;

function errorResponse(error: unknown): Response {
    if (error instanceof BadRequestError) return new Response(error.message, { status: 400 });
    if (error instanceof ForbiddenError) return new Response(error.message, { status: 403 });
    if (error instanceof NotFoundError) return new Response(error.message, { status: 404 });
    if (error instanceof OverCapError) return new Response(error.message, { status: 413 });
    if (error instanceof UpstreamError) {
        const status = error.message.startsWith("Timed out") ? 504 : 502;
        return new Response(error.message, { status });
    }
    console.error("[ERR]", error);
    return new Response("Internal error", { status: 500 });
}

// Files kept next to the package for browsing; everything else comes out of the zip set.
const extras: Record<string, string> = {
    "Values.json": "application/json",
    "Values.pkl": "text/plain; charset=utf-8",
    "values.yaml": "text/yaml; charset=utf-8",
    "Chart.yaml": "text/yaml; charset=utf-8",
};

async function serveChart(kv: Deno.Kv, ref: ChartRef): Promise<Response> {
    const cached = await safeGet<{ output: string; }>(kv, [ "charts", ...refKey(ref) ]);
    let output = cached.value?.output ?? await buildChart(kv, ref);

    // Files kept beside the package rather than inside it.
    if (ref.rest && ref.rest in extras) {
        const data = await readChartFile(ref, ref.rest);
        if (!data) throw new NotFoundError(`No ${ref.rest} for ${ref.chart}@${ref.version}`);
        return new Response(data, { headers: { "Content-Type": extras[ ref.rest ] } });
    }

    const names = output.split("\n")
        .map(line => ({ line, fileName: line.match(artifact)?.groups?.fileName }))
        .filter((entry): entry is { line: string; fileName: string; } => entry.fileName !== undefined);

    // Without a path Pkl is asking for the metadata document, which sorts first.
    const wanted = ref.rest
        ? names.find(entry => entry.fileName === ref.rest)
        : names.toSorted((a, b) => a.line.localeCompare(b.line))[ 0 ];
    if (!wanted) throw new NotFoundError(`No artifact named ${ref.rest} for ${ref.chart}@${ref.version}`);

    let data = await readChartFile(ref, wanted.fileName);
    if (!data) {
        // Cached in KV but missing on disk, e.g. a fresh PVC. Rebuild and re-read.
        output = await buildChart(kv, ref);
        data = await readChartFile(ref, wanted.fileName);
    }
    if (!data) throw new NotFoundError("File not found");

    return new Response(data, { headers: { "Content-Type": "application/octet-stream" } });
}

async function cachedCharts(kv: Deno.Kv): Promise<ChartRef[]> {
    const charts: ChartRef[] = [];
    for await (const entry of kv.list({ prefix: [ "charts" ] })) {
        const [ , scheme, repoPath, chart, version ] = entry.key as string[];
        if (!scheme || !repoPath || !chart || !version) continue;
        charts.push({ scheme: scheme as "https" | "oci", repoPath, chart, version, upstreamVersions: [], rest: null });
    }
    return charts.toSorted((a, b) => `${a.repoPath}/${a.chart}`.localeCompare(`${b.repoPath}/${b.chart}`));
}

Deno.serve(async (req: Request) => {
    const url = new URL(req.url);
    console.log("[REQ]", req.method, url.href);

    if (url.pathname === "/icon.svg") {
        return new Response(icon, { headers: { "Content-Type": "image/svg+xml" } });
    }

    await ensureDataDir();
    const kv = await Deno.openKv(Deno.env.get("KV_PATH"));

    if (url.pathname.startsWith("/charts/")) {
        try {
            return await serveChart(kv, parseChartRef(url.pathname));
        } catch (error) {
            return errorResponse(error);
        }
    }

    const charts = await cachedCharts(kv);

    return respondHtml(html`
        <meta name="color-scheme" content="dark light">
        <style>
            body {
                font-family: system-ui, sans-serif;
                display: grid;
                grid-auto-flow: row;
                align-content: start;
                gap: 32px;
                margin: 32px 0;
                justify-items: center;
                grid-template-rows: max-content;
            }

            h1 { margin: 0; }

            p.lead {
                max-width: 60ch;
                text-align: center;
                margin: 0;
                line-height: 1.5;
            }

            code {
                background-color: #8181811f;
                padding: 2px 6px;
                border-radius: 4px;
            }

            ul {
                display: grid;
                grid-auto-flow: row;
                max-width: max-content;
                gap: 8px;
                margin: 0;
                padding: 0;

                li {
                    display: grid;
                    border: 1px solid #ccc;
                    padding: 12px;
                    gap: 8px;
                    border-radius: 4px;
                    &:hover { background-color: #8181811f; }
                    .title { font-weight: bold; }
                }
            }
        </style>
        <img src="/icon.svg" width="256" alt="Icon">
        <h1>Helm chart values as Pkl</h1>
        <p class="lead">
            Request any chart at
            <code>/charts/&lt;https|oci&gt;/&lt;repo&gt;/&lt;chart&gt;@&lt;version&gt;</code>
            and it is pulled, converted to a JSON Schema and served as a Pkl package.
            Append <code>/Values.pkl</code>, <code>/Values.json</code> or
            <code>/values.yaml</code> to inspect what was generated.
        </p>
        ${charts.length === 0 ? html`<p class="lead">Nothing built yet.</p>` : html`
            <ul>
                ${charts.map(chart => html`
                    <li>
                        <span class="title">${chart.chart}@${chart.version}</span>
                        <span>${`package://${host}/charts/${chart.scheme}/${chart.repoPath}/${chart.chart}@${chart.version}`}</span>
                    </li>
                `)}
            </ul>
        `}
        <a href="https://github.com/lucsoft/cluster">Source code on GitHub</a>
    `);
});
