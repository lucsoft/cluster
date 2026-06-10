import { assert } from "@std/assert";

const repoUrl = "https://github.com/lucsoft/cluster";
const matching = /.out\/.*\/(?<fileName>.*)/;

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

export async function buildPackage(kv: Deno.Kv, version: string, packageName: string) {
    const repoDir = await Deno.makeTempDir({ prefix: "pkl-packages-" });
    try {
        // Shallow-clone the repo at the requested tag.
        await run("git", [ "clone", "--depth", "1", "--branch", version, repoUrl, repoDir ], ".");

        const packageDir = `${repoDir}/packages/${packageName}`;
        const output = (await run("pkl", [ "project", "package", "--skip-publish-check" ], packageDir)).trim();

        await kv.set([ "packages", packageName, version ], { output });

        for (const element of output.split("\n")) {
            const realName = element.match(matching)?.groups?.fileName;
            assert(realName, `Failed to extract file name from: ${element}`);
            const data = await Deno.readFile(`${packageDir}/${element.trim()}`);
            await kv.set([ "packages", packageName, version, realName ], { data });
        }

        return output;
    } finally {
        await Deno.remove(repoDir, { recursive: true });
    }
}
