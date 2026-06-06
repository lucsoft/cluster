#!/usr/bin/env -S deno run -A
import $ from "jsr:@david/dax@^0.42.0";

// Webhook receiver for mc-router's auto-scaling. mc-router POSTs {action:"up"}
// on the first connection to an idle backend and {action:"down"} once it's been
// idle, and we scale the mapped Deployment to 1 / 0 via kubectl. mc-router waits
// for the backend itself, so we just trigger the scale and return.
//
// Point mc-router at it with:
//   -auto-scale-webhook-url http://mc-router-scaler.minecraft.svc:8080/scale
//
// SCALE_MAP (env, required): serverAddress -> Deployment name, e.g.
//   {"main.lucsoft.de":"main","atm10.lucsoft.de":"atm10"}
// NAMESPACE (env): Deployment namespace, defaults to "minecraft".

interface ScalePayload {
  action: "up" | "down";
  serverAddress: string;
}

const scaleMap = parseScaleMap();
const namespace = Deno.env.get("NAMESPACE") ?? "minecraft";

function parseScaleMap(): Record<string, string> {
  const raw = Deno.env.get("SCALE_MAP");
  try {
    if (raw) return JSON.parse(raw);
  } catch { /* fall through */ }
  $.logError("SCALE_MAP is required and must be JSON (serverAddress -> deployment name).");
  Deno.exit(1);
}

$.logStep(`listening on :8080/scale (namespace ${namespace}, ${Object.keys(scaleMap).length} mappings)`);

Deno.serve({ port: 8080 }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/healthz") return new Response("ok\n");
  if (req.method !== "POST" || url.pathname !== "/scale") return new Response("not found\n", { status: 404 });

  let payload: ScalePayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("invalid JSON\n", { status: 400 });
  }

  const replicas = payload.action === "up" ? 1 : payload.action === "down" ? 0 : undefined;
  if (replicas === undefined) return new Response(`unknown action ${payload.action}\n`, { status: 400 });

  const deployment = scaleMap[payload.serverAddress];
  // No mapping: 200 so mc-router still dials the configured backend itself.
  if (!deployment) {
    $.logWarn(`no mapping for ${payload.serverAddress}`);
    return new Response("no mapping\n");
  }

  $.logStep(`${payload.action} ${payload.serverAddress} -> ${namespace}/${deployment} (replicas=${replicas})`);
  try {
    await $`kubectl scale deployment ${deployment} --namespace ${namespace} --replicas ${replicas}`;
  } catch (err) {
    $.logError((err as Error).message);
    return new Response("scale failed\n", { status: 502 });
  }
  return new Response("ok\n");
});
