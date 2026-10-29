// Brings any supported document to the one dialect the emitter reads
// (OpenAPI 3.0): Swagger 2.0 is converted, and the 3.1 spellings of a
// nullable type or a constant become their 3.0 equivalents. Both steps leave
// a document that is already 3.0 as it was.

import type { Loose, OpenApiDocument } from "../types.js";

const FORM_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data"];
const SCHEMA_KEYS = [
  "type",
  "format",
  "items",
  "enum",
  "default",
  "maximum",
  "minimum",
  "maxLength",
  "minLength",
  "pattern",
  "maxItems",
  "minItems",
  "uniqueItems",
  "multipleOf",
];

const isObject = (value: unknown): value is Loose =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// ── OpenAPI 3.1 → 3.0 spellings ───────────────────────────────────────────

function normalizeSchema(node: Loose): void {
  if (Array.isArray(node)) return node.forEach(normalizeSchema);
  if (!isObject(node)) return;

  if (Array.isArray(node.type)) {
    const types = node.type.filter((type: string) => type !== "null");
    if (types.length !== node.type.length) node.nullable = true;
    if (types.length === 1) node.type = types[0];
    else {
      delete node.type;
      if (types.length) node.oneOf = types.map((type: string) => ({ type }));
    }
  }
  if ("const" in node && !isObject(node.properties?.const)) {
    node.enum = [node.const];
    delete node.const;
  }
  for (const [key, value] of Object.entries(node)) {
    // The values of these are schemas keyed by name, so a property called
    // `type` or `const` is a name here, not a keyword.
    if (
      ["properties", "patternProperties", "definitions", "schemas"].includes(
        key,
      ) &&
      isObject(value)
    )
      Object.values(value).forEach(normalizeSchema);
    else normalizeSchema(value);
  }
}

// ── Swagger 2.0 → OpenAPI 3.0 ─────────────────────────────────────────────

const REF_PREFIXES = [
  ["#/definitions/", "#/components/schemas/"],
  ["#/parameters/", "#/components/parameters/"],
  ["#/responses/", "#/components/responses/"],
];

function rewriteRefs(node: Loose): void {
  if (Array.isArray(node)) return node.forEach(rewriteRefs);
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") {
      for (const [from, to] of REF_PREFIXES)
        if (value.startsWith(from)) node[key] = to + value.slice(from.length);
    } else rewriteRefs(value);
  }
}

function convertSchema(schema: Loose): void {
  if (Array.isArray(schema)) return schema.forEach(convertSchema);
  if (!isObject(schema)) return;
  if (schema.type === "file") {
    schema.type = "string";
    schema.format = "binary";
  }
  if ("x-nullable" in schema) schema.nullable = schema["x-nullable"] === true;
  if (typeof schema.discriminator === "string")
    schema.discriminator = { propertyName: schema.discriminator };
  for (const [key, value] of Object.entries(schema)) {
    if (["properties", "definitions"].includes(key) && isObject(value))
      Object.values(value).forEach(convertSchema);
    else convertSchema(value);
  }
}

/** A parameter's own `type`, `items`, `enum` … as the `schema` of a 3.0 one. */
function schemaOfParameter(parameter: Loose): Loose {
  const schema: Loose = {};
  for (const key of SCHEMA_KEYS)
    if (key in parameter) schema[key] = parameter[key];
  if (schema.type === "file")
    Object.assign(schema, { type: "string", format: "binary" });
  return schema;
}

/**
 * How Swagger 2.0 writes a list in the query: `csv` unless the parameter says
 * otherwise, where 3.0 repeats the key unless told not to. Spelled out, so the
 * emitter can report a list the client would send differently.
 */
function queryListStyle(parameter: Loose): Loose | null {
  if (parameter.in !== "query" || parameter.type !== "array") return null;
  switch (parameter.collectionFormat ?? "csv") {
    case "multi":
      return { style: "form", explode: true };
    case "ssv":
      return { style: "spaceDelimited", explode: false };
    case "pipes":
      return { style: "pipeDelimited", explode: false };
    case "tsv":
      return null;
    default:
      return { style: "form", explode: false };
  }
}

function convertParameter(parameter: Loose): Loose {
  const { name, in: where, required, description } = parameter;
  const out = { name, in: where, ...(description && { description }) };
  if (required !== undefined || where === "path")
    out.required = required ?? true;
  out.schema = parameter.schema ?? schemaOfParameter(parameter);
  const style = queryListStyle(parameter);
  if (style) Object.assign(out, style);
  return out;
}

function convertOperation(
  operation: Loose,
  doc: Loose,
  shared: Loose[],
  resolve: (ref: string) => Loose,
): Loose {
  const consumes = operation.consumes ?? doc.consumes ?? ["application/json"];
  const produces = operation.produces ?? doc.produces ?? ["application/json"];
  const parameters = [];
  const form = [];
  let body;

  for (const raw of [...shared, ...(operation.parameters ?? [])]) {
    const parameter = raw.$ref ? (resolve(raw.$ref) ?? raw) : raw;
    if (parameter.in === "body") body = parameter;
    else if (parameter.in === "formData") form.push(parameter);
    else if (raw.$ref) parameters.push(raw);
    else parameters.push(convertParameter(parameter));
  }

  const next = { ...operation, parameters };
  delete next.consumes;
  delete next.produces;
  if (body) {
    next.requestBody = {
      required: body.required === true,
      content: Object.fromEntries(
        consumes.map((type: string) => [type, { schema: body.schema }]),
      ),
    };
  } else if (form.length) {
    const type =
      consumes.find((item: string) => FORM_TYPES.includes(item)) ?? FORM_TYPES[1];
    next.requestBody = {
      required: form.some((item) => item.required),
      content: {
        [type]: {
          schema: {
            type: "object",
            properties: Object.fromEntries(
              form.map((item) => [
                item.name,
                {
                  ...schemaOfParameter(item),
                  ...(item.description && { description: item.description }),
                },
              ]),
            ),
            required: form
              .filter((item) => item.required)
              .map((item) => item.name),
          },
        },
      },
    };
  }
  next.responses = convertResponses(operation.responses ?? {}, produces);
  return next;
}

function convertResponses(responses: Loose, produces: string[]): Loose {
  return Object.fromEntries(
    Object.entries(responses).map(([status, response]) => {
      if (!isObject(response) || response.$ref || !response.schema)
        return [status, response];
      const { schema, headers, examples, ...rest } = response;
      return [
        status,
        {
          ...rest,
          content: Object.fromEntries(
            produces.map((type) => [type, { schema }]),
          ),
        },
      ];
    }),
  );
}

function swagger2ToOpenApi3(doc: Loose): Loose {
  const next = structuredClone(doc);
  const resolve = (ref: string) =>
    String(ref)
      .replace(/^#\//, "")
      .split("/")
      .reduce((node, part) => node?.[part], next);

  const schemes = next.schemes ?? ["https"];
  const out: Loose = {
    openapi: "3.0.3",
    info: next.info,
    ...(next.host && {
      servers: [{ url: `${schemes[0]}://${next.host}${next.basePath ?? ""}` }],
    }),
    paths: {},
    components: { schemas: next.definitions ?? {} },
  };
  if (next.parameters)
    out.components.parameters = Object.fromEntries(
      Object.entries<Loose>(next.parameters)
        .filter(
          ([, parameter]) =>
            parameter.in !== "body" && parameter.in !== "formData",
        )
        .map(([name, parameter]) => [name, convertParameter(parameter)]),
    );
  if (next.responses)
    out.components.responses = convertResponses(
      next.responses,
      next.produces ?? ["application/json"],
    );
  if (next.tags) out.tags = next.tags;

  for (const [path, item] of Object.entries<Loose>(next.paths ?? {})) {
    const shared = item.parameters ?? [];
    const converted: Loose = {};
    for (const [key, value] of Object.entries<Loose>(item)) {
      if (key === "parameters") continue;
      converted[key] = [
        "get",
        "put",
        "post",
        "patch",
        "delete",
        "head",
        "options",
      ].includes(key)
        ? convertOperation(value, next, shared, resolve)
        : value;
    }
    out.paths[path] = converted;
  }
  convertSchema(out);
  rewriteRefs(out);
  return out;
}

/** The document in the dialect the emitter reads. Never mutates its argument. */
export function upgradeDocument(doc: OpenApiDocument): OpenApiDocument {
  let next: Loose = doc;
  if (typeof doc?.swagger === "string" && doc.swagger.startsWith("2"))
    next = swagger2ToOpenApi3(doc);
  else if (typeof doc?.openapi === "string" && !doc.openapi.startsWith("3.0"))
    next = structuredClone(doc);
  else return doc;
  normalizeSchema(next);
  return next;
}
