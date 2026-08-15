#!/usr/bin/env -S deno run -A
// Fission v2 environment runtime for Porffor (https://porffor.dev).
//
// Fission's fetcher writes the function's package to /userfunc/deployarchive and POSTs
// /v2/specialize once per pod; every other request is an invocation. We AOT-compile the
// user's JS to a native binary at specialize time, so invoking is just exec'ing it.
//
// The function is a script, not a handler: whatever it prints to stdout becomes the
// response body. That is all Porffor-compiled binaries can do today.

const port = 8888;

interface FunctionLoadRequest {
  filepath: string;
  functionName?: string;
}

let binary: string | null = null;

async function specialize({ filepath }: FunctionLoadRequest) {
  const dir = await Deno.makeTempDir({ prefix: "porffor-fn-" });
  const source = `${dir}/user.js`;
  const output = `${dir}/user`;

  // The literal package lands as a plain file; a built package lands as a directory.
  const stat = await Deno.stat(filepath);
  await Deno.copyFile(stat.isDirectory ? `${filepath}/user.js` : filepath, source);

  const compile = await new Deno.Command("porf", {
    args: [source, "-o", output],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!compile.success) {
    throw new Error(new TextDecoder().decode(compile.stderr).trim() || "porffor failed to compile");
  }
  binary = output;
}

async function invoke(): Promise<Response> {
  if (binary == null) return new Response("function is not specialized\n", { status: 500 });

  const decoder = new TextDecoder();
  const run = await new Deno.Command(binary, { stdout: "piped", stderr: "piped" }).output();
  if (!run.success) return new Response(decoder.decode(run.stderr), { status: 500 });

  return new Response(decoder.decode(run.stdout), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

Deno.serve({ port, hostname: "0.0.0.0" }, async (request) => {
  const { pathname } = new URL(request.url);

  if (request.method === "POST" && pathname === "/v2/specialize") {
    // Fission retries on connection errors only, so surface failures as a 500 body.
    try {
      await specialize(await request.json() as FunctionLoadRequest);
      return new Response(null, { status: 200 });
    } catch (error) {
      return new Response(`${error}\n`, { status: 500 });
    }
  }

  return await invoke();
});
