import { LimitedBytesTransformStream } from "@std/streams/limited-bytes-transform-stream";
import { UntarStream } from "@std/tar/untar-stream";
import { parse as parseYaml } from "@std/yaml";
import { limits, OverCapError } from "./limits.ts";

export type Dependency = { name?: string; alias?: string; condition?: string; repository?: string; version?: string; };
export type ChartMeta = { name?: string; version?: string; appVersion?: string; description?: string; home?: string; dependencies?: Dependency[]; };

export type Chart = {
    name: string;
    meta: ChartMeta;
    values: unknown;
    // A chart-provided JSON Schema, which is a strictly better source than values.yaml.
    schema: Record<string, unknown> | null;
    templates: string[];
    dependencies: { key: string; chart: Chart; }[];
};

// Shared across the whole extraction, including nested subchart archives, so a chart
// cannot smuggle a decompression bomb past the cap by nesting it.
type Budget = { remaining: number; };

const textDecoder = new TextDecoder();

async function untar(bytes: Uint8Array, budget: Budget): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>();
    const source = ReadableStream.from([ bytes as Uint8Array<ArrayBuffer> ])
        .pipeThrough(new DecompressionStream("gzip"))
        .pipeThrough(new LimitedBytesTransformStream(budget.remaining, { error: true }))
        .pipeThrough(new UntarStream());

    try {
        for await (const entry of source) {
            if (!entry.readable) continue;
            const chunks: Uint8Array[] = [];
            for await (const chunk of entry.readable) chunks.push(chunk);
            const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
            const data = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                data.set(chunk, offset);
                offset += chunk.length;
            }
            budget.remaining -= size;
            files.set(entry.path, data);
        }
    } catch (error) {
        if (error instanceof RangeError) {
            throw new OverCapError("Unpacked chart", limits.unpacked, null);
        }
        throw error;
    }

    return files;
}

function parseYamlFile(files: Map<string, Uint8Array>, path: string): unknown {
    const raw = files.get(path);
    if (!raw) return null;
    return parseYaml(textDecoder.decode(raw));
}

function parseJsonFile(files: Map<string, Uint8Array>, path: string): Record<string, unknown> | null {
    const raw = files.get(path);
    if (!raw) return null;
    try {
        return JSON.parse(textDecoder.decode(raw)) as Record<string, unknown>;
    } catch {
        // A malformed schema should not fail the whole build; inference still works.
        return null;
    }
}

// The single top-level directory of a chart archive, which need not match the chart name.
function rootPrefix(files: Map<string, Uint8Array>): string {
    for (const path of files.keys()) {
        const segment = path.split("/")[ 0 ];
        if (segment) return segment;
    }
    return "";
}

async function readChart(files: Map<string, Uint8Array>, root: string, budget: Budget): Promise<Chart> {
    const meta = (parseYamlFile(files, `${root}/Chart.yaml`) ?? {}) as ChartMeta;
    const name = meta.name ?? root.split("/").at(-1) ?? root;

    const templates: string[] = [];
    for (const [ path, data ] of files) {
        if (!path.startsWith(`${root}/templates/`)) continue;
        if (!path.endsWith(".yaml") && !path.endsWith(".yml") && !path.endsWith(".tpl")) continue;
        templates.push(textDecoder.decode(data));
    }

    const dependencies = await readDependencies(files, root, meta, budget);

    return {
        name,
        meta,
        values: parseYamlFile(files, `${root}/values.yaml`),
        schema: parseJsonFile(files, `${root}/values.schema.json`),
        templates,
        dependencies,
    };
}

// `helm package` refuses to build a chart whose Chart.yaml dependencies are not vendored,
// so anything published to a repo carries its subcharts. They appear either extracted
// under charts/<name>/ or, more commonly, as a nested charts/<name>-<version>.tgz.
async function readDependencies(
    files: Map<string, Uint8Array>,
    root: string,
    meta: ChartMeta,
    budget: Budget,
): Promise<{ key: string; chart: Chart; }[]> {
    const found: { key: string; chart: Chart; }[] = [];
    const seen = new Set<string>();

    const directories = new Set<string>();
    for (const path of files.keys()) {
        const match = path.match(new RegExp(`^${escape(root)}/charts/([^/]+)/`));
        if (match) directories.add(match[ 1 ]);
    }

    for (const directory of directories) {
        const sub = await readChart(files, `${root}/charts/${directory}`, budget);
        seen.add(sub.name);
        found.push({ key: sub.name, chart: sub });
    }

    for (const [ path, data ] of files) {
        if (!path.startsWith(`${root}/charts/`) || !path.endsWith(".tgz")) continue;
        const nested = await untar(data, budget);
        const sub = await readChart(nested, rootPrefix(nested), budget);
        if (seen.has(sub.name)) continue;
        seen.add(sub.name);
        found.push({ key: sub.name, chart: sub });
    }

    // A dependency is keyed in values by its alias when it has one, and the same chart
    // may appear more than once under different aliases.
    const keyed: { key: string; chart: Chart; }[] = [];
    for (const dependency of meta.dependencies ?? []) {
        const match = found.find(candidate => candidate.chart.name === dependency.name);
        if (!match) continue;
        keyed.push({ key: dependency.alias ?? dependency.name ?? match.key, chart: match.chart });
    }
    // Vendored charts a Chart.yaml never declares still resolve under their own name.
    for (const candidate of found) {
        if (!keyed.some(entry => entry.chart === candidate.chart)) keyed.push(candidate);
    }

    return keyed;
}

function escape(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function extractChart(bytes: Uint8Array): Promise<Chart> {
    const budget: Budget = { remaining: limits.unpacked };
    const files = await untar(bytes, budget);
    return await readChart(files, rootPrefix(files), budget);
}
