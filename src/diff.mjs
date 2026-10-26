// What changed between two OpenAPI documents, in the terms of the code this
// package generates: which operations were added or removed, which request
// or response shapes moved, and which of those a caller of the generated
// layer would feel. Every finding names the generated function and hook, so
// a pulled spec turns into a to-do list instead of a wall of YAML.
import { identifier, modelName, pascalCase } from "./names.mjs";

const HTTP_METHODS = ["get", "put", "post", "patch", "delete"];

/** How much a change matters to a consumer, most severe first. */
export const SEVERITIES = ["breaking", "risky", "safe"];

// ── A document as a flat contract ─────────────────────────────────────────

/** A short, comparable spelling of a schema: names stay names. */
function typeText(schema) {
  if (!schema || typeof schema !== "object") return "unknown";
  if (schema.$ref) return modelName(schema.$ref);
  let text;
  if (schema.enum) {
    text = schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  } else if (schema.oneOf?.length) {
    text = schema.oneOf.map(typeText).join(" | ");
  } else if (schema.anyOf?.length) {
    text = schema.anyOf.map(typeText).join(" | ");
  } else if (schema.allOf?.length) {
    text = schema.allOf.map(typeText).join(" & ");
  } else if (schema.type === "array") {
    const item = typeText(schema.items);
    text = /[|&\s]/.test(item) ? `(${item})[]` : `${item}[]`;
  } else if (schema.type === "object" || schema.properties) {
    const names = Object.keys(schema.properties ?? {}).sort();
    text = names.length
      ? `{ ${names.map((name) => `${name}: ${typeText(schema.properties[name])}`).join("; ")} }`
      : schema.additionalProperties
        ? `Record<string, ${typeText(schema.additionalProperties)}>`
        : "object";
  } else {
    text = Array.isArray(schema.type)
      ? schema.type.join(" | ")
      : (schema.type ?? "unknown");
    if (schema.format) text += `(${schema.format})`;
  }
  return schema.nullable === true ? `${text} | null` : text;
}

function derefParam(doc, parameter) {
  if (!parameter?.$ref) return parameter;
  let node = doc;
  for (const part of String(parameter.$ref).replace(/^#\//, "").split("/")) {
    node = node?.[part];
  }
  return node ?? parameter;
}

function bodyOf(operation) {
  const content = operation.requestBody?.content ?? {};
  const entry =
    content["application/json"] ??
    content["application/*+json"] ??
    Object.values(content).find((item) => item?.schema);
  if (!entry) return null;
  return {
    required: operation.requestBody?.required === true,
    type: typeText(entry.schema),
  };
}

function responseOf(operation) {
  const success = Object.entries(operation.responses ?? {}).find(([status]) =>
    /^2\d\d$/.test(status),
  )?.[1];
  const entry =
    success?.content?.["application/json"] ??
    Object.values(success?.content ?? {}).find((item) => item?.schema);
  return entry ? typeText(entry.schema) : null;
}

/** `operations` and `schemas`, each reduced to what a consumer depends on. */
export function contractOf(doc) {
  const operations = new Map();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = item?.[method];
      if (!operation) continue;
      const parameters = new Map();
      for (const raw of [
        ...(item.parameters ?? []),
        ...(operation.parameters ?? []),
      ]) {
        const parameter = derefParam(doc, raw);
        if (!parameter?.name) continue;
        parameters.set(`${parameter.in}:${parameter.name}`, {
          required: parameter.required === true || parameter.in === "path",
          type: typeText(parameter.schema),
        });
      }
      const name = identifier(
        operation.operationId ?? `${method} ${path}`,
        `${method}Path`,
      );
      operations.set(`${method.toUpperCase()} ${path}`, {
        name,
        tags: operation.tags ?? [],
        deprecated: operation.deprecated === true,
        parameters,
        body: bodyOf(operation),
        response: responseOf(operation),
      });
    }
  }

  const schemas = new Map();
  for (const [name, schema] of Object.entries(doc.components?.schemas ?? {})) {
    const required = new Set(schema.required ?? []);
    const properties = new Map(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [
        key,
        { required: required.has(key), type: typeText(value) },
      ]),
    );
    schemas.set(modelName(name), {
      properties,
      // A schema with no properties is compared as its whole spelling.
      shape: properties.size ? null : typeText(schema),
      enum: schema.enum
        ? new Set(schema.enum.map((value) => JSON.stringify(value)))
        : null,
    });
  }
  return { operations, schemas };
}

// ── Comparing two contracts ───────────────────────────────────────────────

const hookNames = (operation) => {
  const base = pascalCase(operation.name);
  return operation.method === "GET" ? `use${base}Query` : `use${base}Mutation`;
};

function finding(severity, kind, subject, message, extra = {}) {
  return { severity, kind, ...subject, message, ...extra };
}

function diffParameters(before, after, at) {
  const out = [];
  for (const [key, next] of after.parameters) {
    const previous = before.parameters.get(key);
    const [where, name] = key.split(":");
    if (!previous) {
      out.push(
        finding(
          next.required ? "breaking" : "safe",
          "parameter-added",
          at,
          `${next.required ? "required " : ""}${where} parameter \`${name}\` added (${next.type})`,
        ),
      );
      continue;
    }
    if (previous.type !== next.type) {
      out.push(
        finding(
          "breaking",
          "parameter-type",
          at,
          `${where} parameter \`${name}\`: ${previous.type} → ${next.type}`,
        ),
      );
    }
    if (previous.required !== next.required) {
      out.push(
        finding(
          next.required ? "breaking" : "safe",
          "parameter-required",
          at,
          `${where} parameter \`${name}\` is now ${next.required ? "required" : "optional"}`,
        ),
      );
    }
  }
  for (const key of before.parameters.keys()) {
    if (!after.parameters.has(key)) {
      const [where, name] = key.split(":");
      out.push(
        finding(
          "breaking",
          "parameter-removed",
          at,
          `${where} parameter \`${name}\` removed`,
        ),
      );
    }
  }
  return out;
}

function diffOperation(key, before, after) {
  const at = { operation: key, name: after.name };
  const out = diffParameters(before, after, at);

  if (JSON.stringify(before.body) !== JSON.stringify(after.body)) {
    if (!before.body) {
      out.push(
        finding(
          after.body.required ? "breaking" : "safe",
          "body-added",
          at,
          `request body added (${after.body.type})`,
        ),
      );
    } else if (!after.body) {
      out.push(finding("breaking", "body-removed", at, "request body removed"));
    } else {
      if (before.body.type !== after.body.type)
        out.push(
          finding(
            "breaking",
            "body-type",
            at,
            `request body: ${before.body.type} → ${after.body.type}`,
          ),
        );
      if (before.body.required !== after.body.required)
        out.push(
          finding(
            after.body.required ? "breaking" : "safe",
            "body-required",
            at,
            `request body is now ${after.body.required ? "required" : "optional"}`,
          ),
        );
    }
  }
  if (before.response !== after.response) {
    out.push(
      finding(
        "breaking",
        "response-type",
        at,
        `response: ${before.response ?? "none"} → ${after.response ?? "none"}`,
      ),
    );
  }
  if (!before.deprecated && after.deprecated)
    out.push(finding("risky", "deprecated", at, "now deprecated"));
  if (before.deprecated && !after.deprecated)
    out.push(finding("safe", "undeprecated", at, "no longer deprecated"));
  if (before.name !== after.name) {
    out.push(
      finding(
        "breaking",
        "renamed",
        at,
        `operationId ${before.name} → ${after.name} (the generated function is renamed)`,
      ),
    );
  }
  return out;
}

function diffSchema(name, before, after) {
  const at = { schema: name };
  const out = [];
  for (const [key, next] of after.properties) {
    const previous = before.properties.get(key);
    if (!previous) {
      out.push(
        finding(
          next.required ? "risky" : "safe",
          "property-added",
          at,
          `${next.required ? "required " : ""}property \`${key}\` added (${next.type})`,
        ),
      );
      continue;
    }
    if (previous.type !== next.type)
      out.push(
        finding(
          "breaking",
          "property-type",
          at,
          `\`${key}\`: ${previous.type} → ${next.type}`,
        ),
      );
    if (previous.required !== next.required)
      out.push(
        finding(
          "risky",
          "property-required",
          at,
          `\`${key}\` is now ${next.required ? "required" : "optional"}`,
        ),
      );
  }
  for (const key of before.properties.keys()) {
    if (!after.properties.has(key))
      out.push(
        finding(
          "breaking",
          "property-removed",
          at,
          `property \`${key}\` removed`,
        ),
      );
  }
  if (
    before.shape !== after.shape &&
    !before.properties.size &&
    !after.properties.size
  ) {
    out.push(
      finding(
        "breaking",
        "schema-type",
        at,
        `${before.shape} → ${after.shape}`,
      ),
    );
  }
  if (before.enum || after.enum) {
    const was = before.enum ?? new Set();
    const now = after.enum ?? new Set();
    for (const value of was)
      if (!now.has(value))
        out.push(
          finding("risky", "enum-removed", at, `enum value ${value} removed`),
        );
    for (const value of now)
      if (!was.has(value))
        out.push(
          finding("safe", "enum-added", at, `enum value ${value} added`),
        );
  }
  return out;
}

/** Every finding between two parsed documents, most severe first. */
export function diffDocuments(oldDoc, newDoc) {
  const before = contractOf(oldDoc);
  const after = contractOf(newDoc);
  const findings = [];

  for (const [key, operation] of after.operations) {
    const method = key.split(" ")[0];
    const previous = before.operations.get(key);
    const at = {
      operation: key,
      name: operation.name,
      hook: hookNames({ ...operation, method }),
    };
    if (!previous) {
      findings.push(finding("safe", "operation-added", at, "added"));
      continue;
    }
    findings.push(
      ...diffOperation(key, previous, operation).map((item) => ({
        ...item,
        hook: at.hook,
      })),
    );
  }
  for (const [key, operation] of before.operations) {
    if (!after.operations.has(key)) {
      findings.push(
        finding(
          "breaking",
          "operation-removed",
          { operation: key, name: operation.name },
          "removed",
        ),
      );
    }
  }

  for (const [name, schema] of after.schemas) {
    const previous = before.schemas.get(name);
    if (!previous)
      findings.push(finding("safe", "schema-added", { schema: name }, "added"));
    else findings.push(...diffSchema(name, previous, schema));
  }
  for (const name of before.schemas.keys()) {
    if (!after.schemas.has(name))
      findings.push(
        finding("breaking", "schema-removed", { schema: name }, "removed"),
      );
  }

  return findings.sort(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
  );
}

// ── Reports ───────────────────────────────────────────────────────────────

export function summarize(findings) {
  const counts = { breaking: 0, risky: 0, safe: 0 };
  for (const item of findings) counts[item.severity] += 1;
  return counts;
}

const subjectOf = (item) =>
  item.operation
    ? `${item.operation}${item.name ? ` (${item.name}${item.hook ? ` · ${item.hook}` : ""})` : ""}`
    : `schema ${item.schema}`;

/** Group findings by what they are about, so one operation reads as one block. */
function grouped(findings) {
  const groups = new Map();
  for (const item of findings) {
    const key = subjectOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

const MARK = { breaking: "✖", risky: "▲", safe: "+" };

/** `text` for the terminal, `markdown` for a PR comment, `json` for tooling. */
export function renderReport(
  findings,
  format = "text",
  { title = "API changes" } = {},
) {
  if (format === "json")
    return `${JSON.stringify({ summary: summarize(findings), findings }, null, 2)}\n`;

  const counts = summarize(findings);
  if (!findings.length) return `${title}: no differences.\n`;
  const head = `${title}: ${counts.breaking} breaking, ${counts.risky} risky, ${counts.safe} safe`;

  if (format === "markdown") {
    const lines = [`### ${head}`, ""];
    for (const severity of SEVERITIES) {
      const items = findings.filter((item) => item.severity === severity);
      if (!items.length) continue;
      lines.push(`**${severity}**`, "");
      for (const [subject, list] of grouped(items)) {
        lines.push(`- \`${subject}\``);
        for (const item of list) lines.push(`  - ${item.message}`);
      }
      lines.push("");
    }
    return `${lines.join("\n")}\n`;
  }

  const lines = [head];
  for (const severity of SEVERITIES) {
    const items = findings.filter((item) => item.severity === severity);
    if (!items.length) continue;
    lines.push("", `${severity}`);
    for (const [subject, list] of grouped(items)) {
      lines.push(`  ${MARK[severity]} ${subject}`);
      for (const item of list) lines.push(`      ${item.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Whether a run should fail: any finding at or above `threshold`. */
export function exceeds(findings, threshold) {
  if (!threshold) return false;
  const limit = SEVERITIES.indexOf(threshold);
  return findings.some((item) => SEVERITIES.indexOf(item.severity) <= limit);
}
