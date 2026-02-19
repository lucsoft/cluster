import { render } from "@lit-labs/ssr";
import { RenderResultReadable } from "@lit-labs/ssr/lib/render-result-readable.js";
import { TemplateResult } from "lit";

export const respondHtml = (html: TemplateResult) => new Response(new RenderResultReadable(render(html)), {
    headers: { "Content-Type": "text/html" },
});
