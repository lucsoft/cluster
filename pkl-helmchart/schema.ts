import type { Chart } from "./chart.ts";
import { openPaths, templatePaths } from "./templates.ts";

export type JsonSchema = {
    type?: string | string[];
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    enum?: unknown[];
    default?: unknown;
    description?: string;
    title?: string;
    [ key: string ]: unknown;
};

// Resolves a local JSON Pointer such as `#/$defs/helm-values.ingress`.
function pointer(root: Record<string, unknown>, ref: string): JsonSchema | null {
    if (!ref.startsWith("#/")) return null;
    let node: unknown = root;
    for (const rawSegment of ref.slice(2).split("/")) {
        const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
        if (!isPlainObject(node)) return null;
        node = node[ segment ];
    }
    return isPlainObject(node) ? node as JsonSchema : null;
}

// Inlines every `$ref` so a chart-provided schema produces the same single-module shape
// as an inferred one. cert-manager's schema is a root `$ref` over 274 `$defs`, which the
// generator would otherwise turn into 274 separate Pkl modules.
function dereference(node: JsonSchema, root: Record<string, unknown>, seen: Set<string>): JsonSchema {
    if (!isPlainObject(node)) return node;

    if (typeof node.$ref === "string") {
        const ref = node.$ref;
        // A recursive definition cannot be inlined; leave it as an open map.
        if (seen.has(ref)) return { type: "object", description: "Recursive definition." };
        const target = pointer(root, ref);
        if (!target) return {};
        const resolved = dereference(target, root, new Set([ ...seen, ref ]));
        // Sibling keywords stay, but the bookkeeping ones must not travel with them.
        const rest: JsonSchema = {};
        for (const [ key, value ] of Object.entries(node)) {
            if (key === "$ref" || key === "$defs" || key === "definitions" || key === "$id" || key === "$schema") continue;
            rest[ key ] = value;
        }
        return { ...resolved, ...rest };
    }

    const out: JsonSchema = {};
    for (const [ key, value ] of Object.entries(node)) {
        if (key === "$defs" || key === "definitions" || key === "$id" || key === "$schema") continue;
        if (key === "properties" && isPlainObject(value)) {
            const properties: Record<string, JsonSchema> = {};
            for (const [ name, child ] of Object.entries(value)) {
                properties[ name ] = dereference(child as JsonSchema, root, seen);
            }
            out.properties = properties;
        } else if ((key === "items" || key === "additionalProperties") && isPlainObject(value)) {
            out[ key ] = dereference(value as JsonSchema, root, seen);
        } else if ((key === "allOf" || key === "anyOf" || key === "oneOf") && Array.isArray(value)) {
            out[ key ] = value.map(entry => dereference(entry as JsonSchema, root, seen));
        } else {
            out[ key ] = value;
        }
    }
    return out;
}

// `allOf` members are a conjunction; the generator has no use for them separately, so
// they are folded into the parent.
function flattenAllOf(node: JsonSchema): JsonSchema {
    if (!isPlainObject(node)) return node;

    const out: JsonSchema = {};
    for (const [ key, value ] of Object.entries(node)) {
        if (key === "properties" && isPlainObject(value)) {
            const properties: Record<string, JsonSchema> = {};
            for (const [ name, child ] of Object.entries(value)) {
                properties[ name ] = flattenAllOf(child as JsonSchema);
            }
            out.properties = properties;
        } else if (key !== "allOf") {
            out[ key ] = value;
        }
    }

    for (const member of (node.allOf ?? []) as JsonSchema[]) {
        const flattened = flattenAllOf(member);
        out.properties = { ...out.properties, ...flattened.properties };
        out.type ??= flattened.type;
    }

    return out;
}

const anyType = [ "string", "integer", "number", "boolean", "object", "array", "null" ];

function isEmptySchema(node: JsonSchema): boolean {
    return node.type === undefined
        && node.enum === undefined
        && node.properties === undefined
        && node.items === undefined
        && node.anyOf === undefined
        && node.oneOf === undefined;
}

// A schema carrying only a description renders as `Null?`, and an untyped `items` gives
// `Listing<Null>`. Both are useless types, so they are widened to something assignable.
function widen(node: JsonSchema): JsonSchema {
    if (!isPlainObject(node)) return node;

    const out: JsonSchema = { ...node };

    if (out.properties) {
        const properties: Record<string, JsonSchema> = {};
        for (const [ name, child ] of Object.entries(out.properties)) properties[ name ] = widen(child);
        out.properties = properties;
    }

    if (out.type === "array") {
        // Emptiness is judged before widening, or the widened `any` would look specific.
        const raw = out.items;
        if (!raw || isEmptySchema(raw)) {
            const sample = Array.isArray(out.default) ? out.default : [];
            const types = new Set(sample.map(element => typeof element));
            if (sample.length > 0 && types.size === 1 && [ "string", "boolean", "number" ].includes([ ...types ][ 0 ])) {
                const only = [ ...types ][ 0 ];
                out.items = { type: only === "number" ? (sample.every(Number.isInteger) ? "integer" : "number") : only };
            } else {
                delete out.items;
            }
        } else {
            out.items = widen(raw);
        }
        return out;
    }

    if (isEmptySchema(out)) out.type = anyType;
    return out;
}

export function normalizeSchema(schema: Record<string, unknown>): JsonSchema {
    return widen(flattenAllOf(dereference(schema as JsonSchema, schema, new Set())));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// An object with no `properties` renders as an open `Dynamic`, which is what a chart's
// empty mapping (`nodeSelector: {}`) means: arbitrary user-supplied keys.
function inferSchema(value: unknown): JsonSchema {
    if (value === null || value === undefined) return { type: anyType };

    if (Array.isArray(value)) {
        const schema: JsonSchema = { type: "array", default: value };
        const types = new Set(value.map(element => typeof element));
        if (value.length > 0 && types.size === 1 && !isPlainObject(value[ 0 ])) {
            const only = [ ...types ][ 0 ];
            if (only === "string") schema.items = { type: "string" };
            else if (only === "boolean") schema.items = { type: "boolean" };
            else if (only === "number") {
                schema.items = { type: value.every(Number.isInteger) ? "integer" : "number" };
            }
        }
        return schema;
    }

    if (isPlainObject(value)) {
        const keys = Object.keys(value);
        if (keys.length === 0) return { type: "object" };
        const dictionary = homogeneousMap(value);
        if (dictionary) return dictionary;
        const properties: Record<string, JsonSchema> = {};
        for (const key of keys) properties[ key ] = inferSchema(value[ key ]);
        return { type: "object", properties };
    }

    // A default that is itself a Helm template says nothing about the rendered type:
    // `enabled: '{{ .Values.vtcluster.enabled }}'` is a boolean everywhere but in values.yaml.
    if (typeof value === "string") {
        return value.includes("{{")
            ? { type: anyType, default: value }
            : { type: "string", default: value };
    }
    if (typeof value === "boolean") return { type: "boolean", default: value };
    if (typeof value === "number") {
        const numeric = Number.isInteger(value) ? "integer" : "number";
        return { type: [ numeric, "string" ], default: value };
    }
    return { type: anyType };
}

function stripDefaults(node: JsonSchema): JsonSchema {
    const out: JsonSchema = {};
    for (const [ key, value ] of Object.entries(node)) {
        if (key === "default") continue;
        if (key === "properties" && isPlainObject(value)) {
            const properties: Record<string, JsonSchema> = {};
            for (const [ name, child ] of Object.entries(value)) properties[ name ] = stripDefaults(child as JsonSchema);
            out.properties = properties;
        } else if (key === "items" && isPlainObject(value)) {
            out.items = stripDefaults(value as JsonSchema);
        } else {
            out[ key ] = value;
        }
    }
    return out;
}

// A mapping whose entries all share one shape is a dictionary the chart samples, not a
// struct: `defaultDashboards.sources` ships a handful of dashboards but accepts any name.
// Typed as `Mapping<String, T>` the keys stay open while the entries stay checked.
function homogeneousMap(value: Record<string, unknown>): JsonSchema | null {
    const entries = Object.entries(value);
    // Two samples are too easily a struct that happens to hold two similar objects.
    if (entries.length < 3) return null;

    // Entries may omit optional fields, so identical key sets are too strict. Requiring
    // that one entry demonstrates the full shape still rejects a struct of unlike parts.
    const union = new Set<string>();
    let widest = 0;
    for (const [ , child ] of entries) {
        if (!isPlainObject(child)) return null;
        const keys = Object.keys(child);
        if (keys.length === 0) return null;
        for (const key of keys) union.add(key);
        widest = Math.max(widest, keys.length);
    }
    if (union.size !== widest) return null;

    const merged: Record<string, unknown> = {};
    for (const [ , child ] of entries) Object.assign(merged, child);
    // Defaults from one sample would document the whole entry type incorrectly.
    return {
        type: "object",
        additionalProperties: stripDefaults(inferSchema(merged)),
        description: `Keyed map. Entries the chart ships by default: ${entries.map(([ key ]) => key).join(", ")}.`,
    };
}

// Overlays the parent chart's declaration of a subchart key onto the subchart's own
// schema. The parent's value is the effective default, so it wins on leaves; the
// subchart contributes every property the parent never mentions.
function mergeSchema(base: JsonSchema, overlay: JsonSchema): JsonSchema {
    if (!isPlainObject(base) || Object.keys(base).length === 0) return overlay;
    if (!isPlainObject(overlay) || Object.keys(overlay).length === 0) return base;

    const merged: JsonSchema = { ...base, ...overlay };

    if (base.properties || overlay.properties) {
        const properties: Record<string, JsonSchema> = { ...base.properties };
        for (const [ key, schema ] of Object.entries(overlay.properties ?? {})) {
            properties[ key ] = key in properties ? mergeSchema(properties[ key ], schema) : schema;
        }
        merged.properties = properties;
        merged.type = "object";
    }

    return merged;
}

// Walks a dotted template reference against the schema, preferring the longest declared
// key so a literal dotted key like `grafana.ini` matches ahead of a two-level path.
function resolve(schema: JsonSchema, segments: string[]): { parent: JsonSchema; missing: string; } | null {
    let node = schema;
    let index = 0;

    while (index < segments.length) {
        const properties = node.properties;
        if (!properties) return null;

        let matched: string | null = null;
        for (let end = segments.length; end > index; end--) {
            const candidate = segments.slice(index, end).join(".");
            if (candidate in properties) {
                matched = candidate;
                index = end;
                break;
            }
        }

        if (!matched) {
            // Only a closed object rejects an undeclared key; an open one already allows it.
            if (node.type !== "object" || node.additionalProperties === false) return null;
            return { parent: node, missing: segments.slice(index).join(".") };
        }

        node = properties[ matched ];
    }

    return null;
}

// Walks to an existing node, honouring dotted keys the same way `resolve` does.
function lookup(schema: JsonSchema, segments: string[]): JsonSchema | null {
    let node = schema;
    let index = 0;

    while (index < segments.length) {
        const properties = node.properties;
        if (!properties) return null;

        let matched: string | null = null;
        for (let end = segments.length; end > index; end--) {
            const candidate = segments.slice(index, end).join(".");
            if (candidate in properties) {
                matched = candidate;
                index = end;
                break;
            }
        }
        if (!matched) return null;
        node = properties[ matched ];
    }

    return node;
}

// Kubernetes shapes that are open maps by definition. A chart lists a key or two as a
// sample — `requests: {storage: 20Gi}` — but the field accepts any key, so typing it as
// a class would reject `cpu` or an extended resource like `nvidia.com/gpu`.
const openByName = new Set([
    "affinity",
    "annotations",
    "containerSecurityContext",
    "extraArgs",
    "extraEnv",
    "extraLabels",
    "labels",
    "limits",
    "matchLabels",
    "nodeSelector",
    "podAnnotations",
    "podLabels",
    "requests",
    "selector",
    "securityContext",
    "serviceAnnotations",
    "serviceLabels",
    // A chart that wraps a CRD samples a few keys under `spec` and passes the rest
    // through verbatim; the CRD's own schema governs it, not the chart's values.
    "spec",
    "podSecurityContext",
]);

function openWellKnown(schema: JsonSchema): void {
    for (const [ key, node ] of Object.entries(schema.properties ?? {})) {
        if (node.type === "object" && node.properties) {
            if (openByName.has(key) && node.additionalProperties !== false) {
                node.description = [
                    node.description,
                    `Free-form map. Keys the chart ships by default: ${Object.keys(node.properties).join(", ")}.`,
                ].filter(Boolean).join(" ");
                delete node.properties;
                continue;
            }
            openWellKnown(node);
        }
    }
}

function openFreeFormMaps(schema: JsonSchema, chart: Chart): void {
    for (const segments of openPaths(chart)) {
        const node = lookup(schema, segments);
        if (!node || node.type !== "object" || !node.properties) continue;
        // An explicit `additionalProperties: false` is the chart refusing extra keys.
        if (node.additionalProperties === false) continue;
        // Keep the chart's own keys visible as documentation, but stop typing them.
        node.description = [
            node.description,
            `Free-form map. Keys the chart ships by default: ${Object.keys(node.properties).join(", ")}.`,
        ].filter(Boolean).join(" ");
        delete node.properties;
    }
}

function addTemplatePaths(schema: JsonSchema, chart: Chart): void {
    for (const segments of templatePaths(chart)) {
        const gap = resolve(schema, segments);
        if (!gap) continue;
        // The leaf is untyped on purpose: the reference proves the key exists, not its shape.
        gap.parent.properties = {
            ...gap.parent.properties,
            [ gap.missing ]: {
                // A bare `{}` schema renders as `Null?`; the explicit union renders as a
                // usable any-type while still carrying the doc comment.
                type: [ "string", "integer", "number", "boolean", "object", "array", "null" ],
                description: "Referenced by a template; not declared in values.yaml.",
            },
        };
    }
}

// Stage one: one JSON Schema describing everything a chart accepts, composed from the
// chart's own schema when it ships one and inferred from values.yaml otherwise, with
// every vendored subchart folded in under the key its parent addresses it by.
export function buildSchema(chart: Chart): JsonSchema {
    const provided = chart.schema;
    const hasSchema = provided !== null;
    const schema: JsonSchema = provided !== null
        ? normalizeSchema(provided)
        : inferSchema(chart.values);

    if (schema.type === undefined && schema.properties) schema.type = "object";

    for (const { key, chart: sub } of chart.dependencies) {
        const subSchema = buildSchema(sub);
        const declared = schema.properties?.[ key ];
        schema.properties = {
            ...schema.properties,
            [ key ]: declared ? mergeSchema(subSchema, declared) : subSchema,
        };
        schema.type = "object";
    }

    // A chart-provided schema is authoritative: Helm itself rejects keys it disallows,
    // so widening it from templates would invent properties the chart refuses.
    addTemplatePaths(schema, chart);
    openFreeFormMaps(schema, chart);
    if (!hasSchema) openWellKnown(schema);

    const described = [ chart.meta.description, chart.meta.home ].filter(Boolean).join(" — ");
    if (described && !schema.description) schema.description = described;

    return schema;
}
