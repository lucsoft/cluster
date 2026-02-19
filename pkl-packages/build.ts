import { Sandbox } from "@deno/sandbox";
import { assert } from "@std/assert";

const repoUrl = "https://github.com/lucsoft/cluster";
const matching = /.out\/.*\/(?<fileName>.*)/;

export async function buildPackage(kv: Deno.Kv, version: string, packageName: string) {
    await using sbx = await Sandbox.create({ org: "lucsoft" });
    await sbx.fs.mkdir("/home/app/bin");
    await sbx.fs.mkdir("/home/app/repo");
    await sbx.sh`
        git clone ${repoUrl} .
        git switch --detach tags/${version}
    `.cwd("./repo");
    await sbx.sh`
        export PATH="/home/app/bin:$PATH"
        curl -L -o pkl 'https://github.com/apple/pkl/releases/download/0.30.2/pkl-linux-amd64'
        chmod +x pkl
        pkl --version
    `.cwd("/home/app/bin");


    await sbx.sh`/home/app/bin/pkl project package --skip-publish-check`
        .cwd(`/home/app/repo/packages/${packageName}`);

    const responding = await sbx.sh`cd /home/app/repo/packages/${packageName}; /home/app/bin/pkl project package --skip-publish-check`
        .text();

    const output = responding.trim();

    await kv.set([ "packages", packageName, version ], { output });

    for (const element of output.trim().split("\n")) {
        const data = await sbx.fs.readFile(`./repo/packages/${packageName}/${element.trim()}`);
        const realName = element.match(matching)?.groups?.fileName;
        assert(realName, `Failed to extract file name from: ${element}`);
        await kv.set([ "packages", packageName, version, realName ], { data });
    }
    return output;
}