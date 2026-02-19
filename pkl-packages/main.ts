// deno-lint-ignore-file no-explicit-any
import { Sandbox } from "@deno/sandbox";
import { assert } from "@std/assert";
import { html } from "lit";
import { respondHtml } from "./respondHtml.ts";

const repoUrl = "https://github.com/lucsoft/cluster";

async function getFoldersInsideGithubRepo(repoUrl: string): Promise<string[]> {
    const repoPathMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoPathMatch) return [];

    const [ _, owner, repo ] = repoPathMatch;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/packages`;

    const res = await fetch(apiUrl);
    if (!res.ok) return [];
    const data = await res.json();
    return data
        .filter((item: any) => item.type === "dir")
        .map((item: any) => item.name);
}

async function getCurrentHash(repoUrl: string): Promise<string> {
    const repoPathMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoPathMatch) return "";

    const [ _, owner, repo ] = repoPathMatch;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`;

    const res = await fetch(apiUrl);
    assert(res.ok, `Failed to fetch commits: ${res.status} ${res.statusText}`);
    if (!res.ok) return "";
    const data = await res.json();
    return data[ 0 ]?.sha || "";
}
const matching = /.out\/.*\/(?<fileName>.*)/;

Deno.serve(async (req: Request) => {
    const url = new URL(req.url);
    const pattern = new URLPattern({ pathname: "/packages/:packageName" });
    const fullPattern = new URLPattern({ pathname: "/packages/:packageName@:version/*?" });
    console.log("[REQ]", req.method, url.href);
    if (pattern.test(url) && !fullPattern.test(url)) {
        const { packageName } = pattern.exec(url)!.pathname.groups;
        return Response.redirect(new URL("/packages/" + packageName + "@latest", url), 302);
    }
    else if (fullPattern.test(url)) {
        const { packageName, version } = fullPattern.exec(url)!.pathname.groups;

        const kv = await Deno.openKv();

        const realVersion = version === "latest" ? await getCurrentHash("https://github.com/lucsoft/cluster") : version;

        const response = await kv.get<{ output: string; }>([ "packages", packageName!, realVersion! ]);

        if (!response.value) {
            await using sbx = await Sandbox.create({ org: "lucsoft" });
            await sbx.fs.mkdir("/home/app/bin");
            await sbx.fs.mkdir("/home/app/repo");
            await sbx.sh`
                git clone --depth 1 ${repoUrl} .
                git reset --hard ${realVersion}
            `.cwd("./repo");
            await sbx.sh`
                export PATH="/home/app/bin:$PATH"
                curl -L -o pkl 'https://github.com/apple/pkl/releases/download/0.30.2/pkl-linux-amd64'
                chmod +x pkl
                pkl --version
            `.cwd("/home/app/bin");


            await sbx.sh`
                pwd
                ls -la
                /home/app/bin/pkl project package
            `
                .cwd(`/home/app/repo/packages/${packageName}`);

            const responding = await sbx.sh`cd /home/app/repo/packages/${packageName}; /home/app/bin/pkl project package`
                .text();

            const output = responding.trim();

            await kv.set([ "packages", packageName!, realVersion! ], { output });

            for (const element of output.trim().split("\n")) {
                const data = await sbx.fs.readFile(`./repo/packages/${packageName}/${element.trim()}`);
                const realName = element.match(matching)?.groups?.fileName;
                assert(realName, `Failed to extract file name from: ${element}`);
                await kv.set([ "packages", packageName!, realVersion!, realName ], { data });
            }

            (response as unknown as { value: { output: string; }; }).value = { output };
        }

        const relative = fullPattern.exec(url)!.pathname.groups[ "0" ];
        assert(response.value, "Response value should be set at this point");
        if (relative) {
            const fileName = response.value.output.match(matching)?.groups?.fileName;

            if (!fileName)
                return new Response("File not found", { status: 404 });

            const file = await kv.get<{ data: Uint8Array<ArrayBuffer>; }>([ "packages", packageName!, realVersion!, fileName ]);

            if (!file.value)
                return new Response("File not found", { status: 404 });

            return new Response(file.value.data, {
                headers: { "Content-Type": "application/octet-stream" },
            });
        }

        const mainFile = response.value.output.split("\n").toSorted((a, b) => a.localeCompare(b))[ 0 ];
        const fileName = mainFile.match(matching)?.groups?.fileName;
        if (!fileName)
            return new Response("File not found", { status: 404 });

        const file = await kv.get<{ data: Uint8Array<ArrayBuffer>; }>([ "packages", packageName!, realVersion!, fileName ]);
        if (!file.value)
            return new Response("File not found", { status: 404 });

        return new Response(file.value.data, {
            headers: { "Content-Type": "application/octet-stream" },
        });
    }
    const packages = await getFoldersInsideGithubRepo("https://github.com/lucsoft/cluster");
    return respondHtml(html`
        <meta name="color-scheme" content="dark light">
        <style>
            body {
                font-family: system-ui, sans-serif;
            }
        </style>
        <h1>Package List: </h1>
        <ul>
            ${packages.map(pkg => html`<li><a href="/packages/${pkg}">${pkg}</a></li>`)}
        </ul>
    `);
});