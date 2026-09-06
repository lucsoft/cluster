import type { Chart } from "./chart.ts";

const reference = /\.Values\.([A-Za-z0-9_.-]+)/g;

// Paths a chart's own templates dereference. Helm also resolves values dynamically
// (`index .Values $name`, contexts packed into a dict and unpacked inside a named
// template), so this is a lower bound and is only ever used to widen a type, never
// to narrow one.
export function templatePaths(chart: Chart): string[][] {
    const paths = new Set<string>();
    for (const source of chart.templates) {
        for (const match of source.matchAll(reference)) {
            const cleaned = match[ 1 ].replace(/[.-]+$/, "");
            if (cleaned.length > 0) paths.add(cleaned);
        }
    }
    return [ ...paths ].map(path => path.split("."));
}

// Mappings the chart itself treats as free-form: iterated over key by key, or dumped
// wholesale into the manifest. Their declared keys are examples, not a closed set, so
// typing them as a class would reject configuration the chart accepts.
const openAccess = [
    /range\s+[^:={]*:=\s*index\s+\.Values\s+"([^"]+)"/g,
    /range\s+[^:={]*:=\s*\.Values\.([A-Za-z0-9_.-]+)/g,
    /toYaml\s+\(?\.Values\.([A-Za-z0-9_.-]+)/g,
    /toYaml\s+\(index\s+\.Values\s+"([^"]+)"/g,
    /with\s+\.Values\.([A-Za-z0-9_.-]+)\s*\}\}/g,
    /with\s+\(index\s+\.Values\s+"([^"]+)"\)/g,
];

export function openPaths(chart: Chart): string[][] {
    const paths = new Set<string>();
    for (const source of chart.templates) {
        for (const pattern of openAccess) {
            for (const match of source.matchAll(pattern)) {
                const cleaned = match[ 1 ].replace(/[.-]+$/, "");
                if (cleaned.length > 0) paths.add(cleaned);
            }
        }
    }
    return [ ...paths ].map(path => path.split("."));
}
