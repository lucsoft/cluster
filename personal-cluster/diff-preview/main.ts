#!/usr/bin/env -S deno run -A
import $ from "jsr:@david/dax@^0.42.0";

const ADP_VERSION = "v0.2.8";

const APP_REPO = "lucsoft/cluster";
const RENDERED = "personal-cluster/_diff-preview-apps.yaml";

const repoRoot = (await $`git rev-parse --show-toplevel`.text()).trim();

// target = the branch under review, base = the branch it merges into.
// GitHub Actions PRs expose both via env; otherwise current branch -> main.
const targetBranch = Deno.env.get("GITHUB_HEAD_REF") ||
    (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
const baseBranch = Deno.env.get("GITHUB_BASE_REF") || Deno.env.get("BASE_BRANCH") || "main";

if (baseBranch === targetBranch) {
    $.logError(`Base and target are both '${baseBranch}' — nothing to diff.`);
    Deno.exit(1);
}

const dpDir = `${repoRoot}/personal-cluster/diff-preview`;
const baseDir = `${dpDir}/.work/base-branch`;
const targetDir = `${dpDir}/.work/target-branch`;
const outputDir = `${dpDir}/output`;

$.logStep(`Diffing ${targetBranch} -> ${baseBranch}`);

// The tool pulls app content from the remote, so render both sides from the
// remote refs. (In CI the branches are already pushed.)
await $`git fetch origin ${baseBranch} ${targetBranch}`.noThrow();

// Render the app-of-apps from each branch so the tool can discover the apps
// (it renders the actual manifests itself by pulling the branch from the remote).
async function render(ref: string): Promise<string> {
    const tmp = await Deno.makeTempDir({ prefix: "adp-" });
    try {
        await $`git archive ${ref} | tar -x -C ${tmp}`;
        return await $`pkl eval index.pkl`.cwd(`${tmp}/personal-cluster`).text();
    } finally {
        await $`rm -rf ${tmp}`;
    }
}

await $`rm -rf ${dpDir}/.work`;
await $`mkdir -p ${baseDir}/personal-cluster ${targetDir}/personal-cluster ${outputDir}`;
$.logStep("Rendering apps...");
await Deno.writeTextFile(`${baseDir}/${RENDERED}`, await render(`origin/${baseBranch}`));
await Deno.writeTextFile(`${targetDir}/${RENDERED}`, await render(`origin/${targetBranch}`));

$.logStep("Running argocd-diff-preview (Docker + ephemeral Kind cluster)...");
await $`docker run --rm \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ${outputDir}:/output \
  -v ${baseDir}:/base-branch \
  -v ${targetDir}:/target-branch \
  -v ${dpDir}/argocd-config:/argocd-config \
  -e BASE_BRANCH=${baseBranch} \
  -e TARGET_BRANCH=${targetBranch} \
  -e REPO=${APP_REPO} \
  -e FILE_REGEX=${RENDERED.replaceAll(".", "\\.")} \
  -e TIMEOUT=600 \
  -e REDIRECT_TARGET_REVISIONS=${baseBranch} \
  dagandersen/argocd-diff-preview:${ADP_VERSION}`;

$.logStep(`Done. Diff written to ${outputDir}/diff.md`);
