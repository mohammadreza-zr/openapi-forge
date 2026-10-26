// Zod validators for the document's component schemas (`schemas.ts`). Each
// one is annotated with its `models.ts` type, so the two cannot drift apart:
// a schema that no longer matches its type fails to compile.
import { camelCase, modelName, propertyName } from "./names.js";
import type { OpenApiDocument, Schema } from "./types.js";

const refName = (ref: string): string => `${camelCase(modelName(ref))}Schema`;
const list = (items: string[]): string => items.join(", ");

function render(schema: Schema | boolean | undefined): string {
  if (schema === true) return "z.unknown()";
  if (!schema || typeof schema !== "object") return "z.unknown()";
  let out = base(schema);
  if (schema.nullable === true) out += ".nullable()";
  return out;
}

function base(schema: Schema): string {
  if (schema.$ref) return `z.lazy(() => ${refName(schema.$ref)})`;
  for (const key of ["oneOf", "anyOf"]) {
    const parts = schema[key];
    if (parts?.length)
      return parts.length === 1
        ? render(parts[0])
        : `z.union([${list(parts.map(render))}])`;
  }
  if (schema.allOf?.length) {
    return schema.allOf
      .map(render)
      .reduce((a, b) => `z.intersection(${a}, ${b})`);
  }
  if (schema.enum) {
    const values = schema.enum;
    if (values.every((value) => typeof value === "string"))
      return `z.enum([${list(values.map((value) => JSON.stringify(value)))}])`;
    return `z.union([${list(values.map((value) => `z.literal(${JSON.stringify(value)})`))}])`;
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "string":
      return schema.format === "binary" ? "z.instanceof(Blob)" : "z.string()";
    case "integer":
    case "number":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    case "array":
      if (schema.prefixItems?.length)
        return `z.tuple([${list(schema.prefixItems.map(render))}])`;
      return `z.array(${render(schema.items)})`;
    default:
      if (schema.properties) return object(schema);
      if (schema.additionalProperties)
        return `z.record(z.string(), ${render(schema.additionalProperties)})`;
      return type === "object"
        ? "z.record(z.string(), z.unknown())"
        : "z.unknown()";
  }
}

function object(schema: Schema): string {
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {}).map(([name, child]) => {
    const value = render(child);
    return `  ${propertyName(name)}: ${required.has(name) ? value : `${value}.optional()`},`;
  });
  return `z.object({\n${fields.join("\n")}\n})`;
}

/** `schemas.ts` for `spec`, or `null` when it has no component schemas. */
export function emitZod(
  spec: OpenApiDocument,
  { banner, skip = () => false }: { banner: string; skip?: (name: string) => boolean },
): string | null {
  const blocks = Object.entries(spec.components?.schemas ?? {})
    .filter(([name]) => !skip(name))
    .map(([name, schema]) => {
      const type = modelName(name);
      return `export const ${refName(name)}: z.ZodType<${type}> = ${render(schema)};`;
    });
  if (!blocks.length) return null;
  const types = Object.keys(spec.components?.schemas ?? {})
    .filter((name) => !skip(name))
    .map(modelName)
    .sort();
  return (
    [
      banner,
      `import { z } from "zod";`,
      `import type { ${list(types)} } from "./models";`,
      ...blocks,
    ].join("\n\n") + "\n"
  );
}
