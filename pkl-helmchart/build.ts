import { assert } from "@std/assert";
import { stringify as stringifyYaml } from "@std/yaml";
import { extractChart } from "./chart.ts";
import { pullLegacy } from "./legacy.ts";
import { pullOci } from "./oci.ts";
import { type ChartRef, refKey } from "./ref.ts";
import { buildSchema } from "./schema.ts";
import { storeChartFile } from "./storage.ts";

const host = Deno.env.get("PUBLIC_HOST") ?? "pkl-helm.lucsoft.de";
const generator = new URL("./generate.pkl", import.meta.url).pathname;
const artifact = /.out\/.*\/(?<fileName>.*)/;

// Two requests for a cold chart would otherwise both hit the registry and run pkl twice.
const inFlight = new Map<string, Promise<string>>();

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
    const { success, stdout, stderr } = await new Deno.Command(cmd, {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    assert(success, `${cmd} ${args.join(" ")} failed: ${decoder.decode(stderr)}`);
    return decoder.decode(stdout);
}

function packagePath(ref: ChartRef): string {
    return `/charts/${ref.scheme}/${ref.repoPath}/${ref.chart}`;
}

function projectFile(ref: ChartRef): string {
    return `amends "pkl:Project"

package {
  name = "${ref.chart}"
  version = "${ref.version}"
  baseUri = "package://${host}${packagePath(ref)}"
  packageZipUrl = "https://${host}${packagePath(ref)}@${ref.version}/${ref.chart}@${ref.version}.zip"
}
`;
}

async function build(kv: Deno.Kv, ref: ChartRef): Promise<string> {
    const tarball = ref.scheme === "oci" ? await pullOci(ref) : await pullLegacy(kv, ref);
    const chart = await extractChart(tarball);
    const schema = buildSchema(chart);

    const workDir = await Deno.makeTempDir({ prefix: "pkl-helmchart-" });
    try {
        // The schema lives outside the package directory: it is the generator's input and
        // is served for debugging, but it is not a Pkl module and would only bloat the zip.
        const packageDir = `${workDir}/package`;
        await Deno.mkdir(packageDir);
        const schemaPath = `${workDir}/Values.json`;
        await Deno.writeTextFile(schemaPath, JSON.stringify(schema, null, 2));

        // Stage two: schema to Pkl.
        await run("pkl", [
            "eval",
            generator,
            "-p", `schemaUri=file://${schemaPath}`,
            "-p", `chart=${ref.chart}`,
            "-p", `chartVersion=${ref.version}`,
            "-p", `chartRepository=${ref.repoPath}`,
            "-p", `chartAppVersion=${chart.meta.appVersion ?? ""}`,
            "-m", packageDir,
        ], workDir);

        await Deno.writeTextFile(`${packageDir}/PklProject`, projectFile(ref));
        await run("pkl", [ "project", "resolve" ], packageDir);
        const output = (await run("pkl", [ "project", "package", "--skip-publish-check" ], packageDir)).trim();

        for (const line of output.split("\n")) {
            const fileName = line.match(artifact)?.groups?.fileName;
            assert(fileName, `Failed to extract file name from: ${line}`);
            await storeChartFile(ref, fileName, await Deno.readFile(`${packageDir}/${line.trim()}`));
        }

        // Kept for browsing and debugging; not part of the Pkl package.
        await storeChartFile(ref, "Values.json", JSON.stringify(schema, null, 2));
        await storeChartFile(ref, "Values.pkl", await Deno.readFile(`${packageDir}/Values.pkl`));
        await storeChartFile(ref, "values.yaml", stringifyYaml(chart.values ?? {}));
        await storeChartFile(ref, "Chart.yaml", stringifyYaml(chart.meta));

        await kv.set([ "charts", ...refKey(ref) ], { output });
        return output;
    } finally {
        await Deno.remove(workDir, { recursive: true });
    }
}

export function buildChart(kv: Deno.Kv, ref: ChartRef): Promise<string> {
    const key = refKey(ref).join("/");
    const running = inFlight.get(key);
    if (running) return running;

    const started = build(kv, ref).finally(() => inFlight.delete(key));
    inFlight.set(key, started);
    return started;
}
