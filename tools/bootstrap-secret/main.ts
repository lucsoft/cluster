#!/usr/bin/env -S deno run -A
import $ from "jsr:@david/dax@^0.42.0";
import { parse, stringify } from "jsr:@std/yaml@^1.0.5";
import { parseArgs } from "jsr:@std/cli@^1.0.0/parse-args";

// Decrypts a sealed SopsSecret (*.sops.yaml) and transforms its secretTemplates
// into plain Kubernetes Secret(s), printed to stdout. Apply yourself, e.g.:
//
//   deno task bootstrap-secret <file.sops.yaml> | kubectl apply -f -
//
// This is for bootstrap: the sops-secrets-operator needs e.g. `sops-gcp-creds`
// to exist before it can decrypt anything (including itself) -> chicken-and-egg,
// so we decrypt + create that Secret by hand instead of relying on the operator.

interface SecretTemplate {
  name: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  type?: string;
  stringData?: Record<string, string>;
  data?: Record<string, string>;
}
interface SopsSecret {
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  spec?: { secretTemplates?: SecretTemplate[] };
}

const args = parseArgs(Deno.args, {
  boolean: ["help"],
  alias: { h: "help" },
});

if (args.help || args._.length === 0) {
  console.error(
    `Decrypt a sealed SopsSecret and print its Kubernetes Secret(s) to stdout.

Usage:
  deno task bootstrap-secret <file.sops.yaml> | kubectl apply -f -

Options:
  -h, --help   Show this help`,
  );
  Deno.exit(args.help ? 0 : 1);
}

const inputPath = String(args._[0]);

// ---- 1. Decrypt with sops -----------------------------------------------
$.logStep(`Decrypting ${inputPath}`); // -> stderr, keeps stdout clean
const plaintext = await $`sops decrypt ${inputPath}`.text();
const doc = parse(plaintext) as SopsSecret;

if (doc.kind !== "SopsSecret") {
  $.logWarn(
    `Warning: ${inputPath} is kind "${doc.kind}", expected "SopsSecret".`,
  );
}

// ---- 2. Transform secretTemplates -> Secret(s) --------------------------
const templates = doc.spec?.secretTemplates ?? [];
const namespace = doc.metadata?.namespace;
if (templates.length === 0) {
  $.logWarn("No secretTemplates found — nothing to output.");
}

const manifests = templates.map((tpl) =>
  stringify({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: tpl.name,
      ...(namespace ? { namespace } : {}),
      ...(tpl.labels ? { labels: tpl.labels } : {}),
      ...(tpl.annotations ? { annotations: tpl.annotations } : {}),
    },
    type: tpl.type ?? "Opaque",
    ...(tpl.stringData ? { stringData: tpl.stringData } : {}),
    ...(tpl.data ? { data: tpl.data } : {}),
  })
);

// ---- 3. Print to stdout (pipe into `kubectl apply -f -`) -----------------
console.log(manifests.join("---\n"));
