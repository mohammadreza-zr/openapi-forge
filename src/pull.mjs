// Replaces the documents in the specs folder with the ones the backend
// services publish. A document is written exactly as it was served — never
// reformatted — and only when it is a readable OpenAPI document.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { fetchText } from "./load/source.mjs";
import { diffDocuments, renderReport } from "./diff.mjs";

const TAG = "openapi-forge";
const SERVICE_NAME = /^[a-z0-9][a-z0-9-]*$/i;

/** `name=url;name2=url2` — the form an environment variable carries. */
export function parseSourcePairs(text) {
  const out = {};
  for (const pair of String(text ?? "").split(";")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    const name = trimmed.slice(0, separator).trim();
    const url = trimmed.slice(separator + 1).trim();
    if (separator === -1 || !SERVICE_NAME.test(name) || !URL.canParse(url)) {
      throw new Error(
        `${TAG}: ${JSON.stringify(trimmed)} is not a \`name=url\` pair.`,
      );
    }
    out[name] = url;
  }
  return out;
}

export async function pull(options, { cwd }) {
  const sources = Object.entries(options.sources ?? {});
  if (!sources.length) {
    throw new Error(
      `${TAG}: nothing to pull — set \`sources: { name: url }\` in the config, ` +
        "or OPENAPI_FORGE_SOURCES=name=url;name2=url2.",
    );
  }
  const dir = resolve(cwd, options.specsDir);

  // Every document is fetched before any is written, so a failed pull leaves
  // the folder as it was.
  const pulled = await Promise.all(
    sources.map(async ([name, url]) => {
      const text = await fetchText(url, {
        headers: options.headers,
        tls: options.tls,
        cwd,
      });
      const doc = parseYaml(text);
      if (!doc?.paths || !(doc.openapi || doc.swagger)) {
        throw new Error(
          `${TAG}: ${url} is not an OpenAPI document — it has no \`openapi\` or \`paths\`.`,
        );
      }
      const json = text.trimStart().startsWith("{");
      return { name, text, ext: json ? "json" : "yaml" };
    }),
  );

  await mkdir(dir, { recursive: true });
  for (const { name, text, ext } of pulled) {
    const file = join(dir, `${name}.${ext}`);
    const current = await readFile(file, "utf8").catch(() => null);
    if (current !== text) await writeFile(file, text, "utf8");
    console.log(
      `${TAG}: ${name} ${current === text ? "unchanged" : current === null ? "added" : "updated"}`,
    );
    if (current !== null && current !== text) {
      const findings = diffDocuments(parseYaml(current), parseYaml(text));
      if (findings.length)
        console.log(renderReport(findings, "text", { title: name }));
    }
  }
  return pulled.map(({ name }) => name);
}
