// Reading one OpenAPI document: from a file, or from a URL — over plain
// fetch, or over node:https when the host has a private CA or a self-signed
// certificate.
import { readFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { isAbsolute, resolve } from "node:path";
import { rootCertificates } from "node:tls";
import { parse as parseYaml } from "yaml";

import type { OpenApiDocument } from "../types.js";
import { upgradeDocument } from "./upgrade.js";

interface RequestOptions {
  headers?: Record<string, string>;
  ca?: string;
  rejectUnauthorized?: boolean;
  redirects?: number;
}

/** What reading a document needs beyond its location. */
export interface ReadOptions {
  headers?: Record<string, string>;
  tls?: { insecure?: boolean; ca?: string };
  cwd: string;
}

/** A thrown value, as far as an error message needs it. */
type Failure = {
  message?: string;
  code?: string;
  cause?: { code?: string; message?: string };
} | null | undefined;

const TAG = "openapi-forge";

/**
 * `fetch` cannot take TLS options without an extra dispatcher dependency, so
 * a document behind a private CA or a self-signed certificate is read with
 * the builtin `node:https` client instead — same headers, same redirects.
 */
function nodeRequestText(
  url: string,
  { headers, ca, rejectUnauthorized, redirects = 5 }: RequestOptions,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const isHttps = url.startsWith("https:");
    const options: Omit<RequestOptions, "ca"> & { ca?: string[] } = { headers };
    if (isHttps) {
      options.rejectUnauthorized = rejectUnauthorized;
      // `ca` alone would replace the public roots, so a host with a public
      // certificate would stop verifying as soon as a private CA is named.
      if (ca !== undefined) options.ca = [...rootCertificates, ca];
    }
    const request = (isHttps ? httpsGet : httpGet)(url, options, (response) => {
      const statusCode = response.statusCode ?? 0;
      if (
        statusCode >= 300 &&
        statusCode < 400 &&
        response.headers.location &&
        redirects > 0
      ) {
        response.resume();
        const next = new URL(response.headers.location, url);
        // Credentials stay with the host they were meant for, as `fetch` does.
        const sameOrigin = next.origin === new URL(url).origin;
        nodeRequestText(next.toString(), {
          headers: sameOrigin ? headers : undefined,
          ca,
          rejectUnauthorized,
          redirects: redirects - 1,
        }).then(resolvePromise, rejectPromise);
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        rejectPromise(
          new Error(`${TAG}: ${statusCode} ${response.statusMessage} — ${url}`),
        );
        return;
      }
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => resolvePromise(data));
      response.on("error", rejectPromise);
    });
    request.setTimeout(60_000, () => {
      request.destroy(new Error(`${TAG}: timed out fetching ${url}`));
    });
    request.on("error", rejectPromise);
  });
}

const isTlsFailure = (error: Failure): boolean =>
  /cert|tls|ssl|self.signed|unable.to.get.issuer|unable.to.verify|handshake|ca cert/i.test(
    `${error?.cause?.code ?? error?.code ?? ""} ${error?.cause?.message ?? error?.message ?? ""}`,
  );

const describeCause = (error: Failure): string =>
  error?.cause?.code
    ? `${error.cause.code}: ${error.cause.message ?? error.message}`
    : (error?.message ?? String(error));

/**
 * A bare `fetch failed` hides the cause: name the TLS failure and the ways
 * past a private CA instead of leaving the next reader to guess.
 */
function tlsHintError(url: string, error: Failure): unknown {
  if (!isTlsFailure(error)) return error;
  return new Error(
    `${TAG}: TLS verification failed for ${url} (${describeCause(error)}).\n` +
      "        The server's certificate is not publicly trusted — typical for\n" +
      "        intranet hosts with a private CA or a self-signed cert. Pick one:\n" +
      "          tls: { insecure: true } / --insecure   skip verification (local dev only, never in CI)\n" +
      "          tls: { ca: 'ca.pem' }   / --ca <file>  trust your internal CA\n" +
      "          NODE_EXTRA_CA_CERTS=/path/to/ca.pem    the same trust, via node itself",
  );
}

async function readCa(
  caFile: string | undefined,
  cwd: string,
): Promise<string | undefined> {
  if (!caFile) return undefined;
  const candidates = isAbsolute(caFile)
    ? [caFile]
    : [resolve(cwd, caFile), resolve(caFile)];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `${TAG}: cannot read the CA certificate ${JSON.stringify(caFile)}. ` +
      "Pass an absolute path or one relative to the project.",
  );
}

export const isUrl = (value: unknown): boolean => /^https?:\/\//.test(String(value));

/** The text behind a URL, honouring headers and the TLS options. */
export async function fetchText(
  url: string,
  { headers, tls = {}, cwd }: ReadOptions,
): Promise<string> {
  const insecure = tls.insecure === true;
  if (url.startsWith("https:") && (insecure || tls.ca)) {
    if (insecure) {
      console.warn(
        `${TAG}: TLS certificate verification is disabled. ` +
          "Use this for local development only, never in CI.",
      );
    }
    const ca = await readCa(tls.ca, cwd);
    try {
      return await nodeRequestText(url, {
        headers,
        ca,
        rejectUnauthorized: !insecure,
      });
    } catch (error) {
      throw tlsHintError(url, error as Failure);
    }
  }
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw tlsHintError(url, error as Failure);
  }
  if (!response.ok) {
    throw new Error(
      `${TAG}: ${response.status} ${response.statusText} — ${url}`,
    );
  }
  return response.text();
}

/** A JSON or YAML text as a document; JSON is valid YAML, so one parser suffices. */
export function parseDocument(
  text: string,
  where = "the document",
): OpenApiDocument {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (error) {
    throw new Error(
      `${TAG}: ${where} is neither valid JSON nor valid YAML. ` +
        "Export the spec as JSON or YAML (Swashbuckle: …/swagger/v1/swagger.json, " +
        `…/openapi.yaml). ${(error as Error).message}`,
    );
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(
      `${TAG}: ${where} is empty or not an OpenAPI object — it has no \`openapi\` or \`paths\`.`,
    );
  }
  return upgradeDocument(doc as OpenApiDocument);
}

/** One document, from a URL or a path. */
export async function readDocument(
  location: string,
  { headers, tls, cwd }: ReadOptions,
): Promise<OpenApiDocument> {
  const text = isUrl(location)
    ? await fetchText(location, { headers, tls, cwd })
    : await readFile(resolve(cwd, location), "utf8");
  return parseDocument(text, location);
}
