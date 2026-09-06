import { assertEquals, assertThrows } from "@std/assert";
import { BadRequestError, ForbiddenError, parseChartRef } from "./ref.ts";

Deno.test("parses a classic repository reference", () => {
    const ref = parseChartRef("/charts/https/victoriametrics.github.io/helm-charts/victoria-metrics-k8s-stack@0.90.0");
    assertEquals(ref.scheme, "https");
    assertEquals(ref.repoPath, "victoriametrics.github.io/helm-charts");
    assertEquals(ref.chart, "victoria-metrics-k8s-stack");
    assertEquals(ref.version, "0.90.0");
    assertEquals(ref.rest, null);
});

Deno.test("parses an OCI reference with a trailing artifact path", () => {
    const ref = parseChartRef("/charts/oci/ghcr.io/traefik/helm/traefik@37.3.0/traefik@37.3.0.zip");
    assertEquals(ref.scheme, "oci");
    assertEquals(ref.repoPath, "ghcr.io/traefik/helm");
    assertEquals(ref.chart, "traefik");
    assertEquals(ref.rest, "traefik@37.3.0.zip");
});

Deno.test("matches both the bare and the v-prefixed upstream version", () => {
    assertEquals(parseChartRef("/charts/https/charts.jetstack.io/cert-manager@1.20.2").upstreamVersions, [ "1.20.2", "v1.20.2" ]);
});

Deno.test("rejects mutable tags and v-prefixed versions", () => {
    assertThrows(() => parseChartRef("/charts/https/charts.jetstack.io/cert-manager@latest"), BadRequestError);
    assertThrows(() => parseChartRef("/charts/https/charts.jetstack.io/cert-manager@v1.20.2"), BadRequestError);
});

Deno.test("rejects a host that is not allowlisted", () => {
    assertThrows(() => parseChartRef("/charts/https/evil.example.com/thing@1.0.0"), ForbiddenError);
});
