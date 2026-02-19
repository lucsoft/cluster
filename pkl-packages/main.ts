import { assert } from "@std/assert";
import { compare, format, parse } from "@std/semver";
import { html } from "lit";
import { buildPackage } from "./build.ts";
import { getAllPackages, getAllTags } from "./github.ts";
import { respondHtml } from "./respondHtml.ts";

const matching = /.out\/.*\/(?<fileName>.*)/;
const fullPattern = new URLPattern({ pathname: "/packages/:packageName@:version/*?" });

Deno.serve(async (req: Request) => {
    const url = new URL(req.url);
    console.log("[REQ]", req.method, url.href);

    const kv = await Deno.openKv();

    const tags = await getAllTags(kv);
    const newestTag = tags
        .map(tag => parse(tag))
        .toSorted((a, b) => compare(a, b))
        .at(-1);
    assert(newestTag, "No tags found");

    const packages = await getAllPackages(kv, format(newestTag));

    if (fullPattern.test(url)) {
        const { packageName, version } = fullPattern.exec(url)!.pathname.groups;
        assert(version, "Version is required");
        assert(packageName, "Package name is required");
        if (!packages.includes(packageName)) {
            return new Response("Package not found", { status: 404 });
        }
        if (!tags.includes(version)) {
            return new Response("Version not found", { status: 404 });
        }

        parse(version);

        const cachedResponse = await kv.get<{ output: string; }>([ "packages", packageName, version ]);
        const output = cachedResponse.value?.output ?? await buildPackage(kv, version, packageName);

        const isRelativePath = fullPattern.exec(url)!.pathname.groups[ "0" ];
        const notFoundError = new Response("File not found", { status: 404 });

        const fileName = isRelativePath
            ? output.match(matching)?.groups?.fileName
            : output.split("\n").toSorted((a, b) => a.localeCompare(b))[ 0 ].match(matching)?.groups?.fileName;

        if (!fileName) return notFoundError;

        const file = await kv.get<{ data: Uint8Array<ArrayBuffer>; }>([ "packages", packageName, version, fileName ]);
        if (!file.value) return notFoundError;

        return new Response(file.value.data, {
            headers: { "Content-Type": "application/octet-stream" },
        });
    }

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

            h1
            {
                margin: 0;
            }

            ul
            {
                display: grid;
                grid-auto-flow: row;
                max-width: max-content;
                gap: 8px;
                margin: 0;
                padding: 0;

                li
                {
                    display: grid;
                    border: 1px solid #ccc;
                    padding: 12px;
                    gap: 8px;
                    border-radius: 4px;
                    &:hover {
                        background-color: #8181811f;
                    }
                    .title {
                        font-weight: bold;
                    }
                }
            }
        </style>
        <h1>Packages</h1>
        <ul>
            ${packages.map(pkg => html`
                <li>
                    <span class="title">${pkg}</span>
                    <span>${`package://pkl-pkgs.lucsoft.de/packages/${pkg}@${format(newestTag)}`}</span>
                </li>
            `)}
        </ul>
        <a href="https://github.com/lucsoft/cluster">Source code on GitHub</a>
    `);
});