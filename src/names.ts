// Naming helpers: what a document's names become in TypeScript.

export const upperFirst = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

export function camelCase(value: unknown): string {
  return String(value)
    .replace(/[^a-zA-Z0-9]+(.)/g, (_: string, char: string) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "")
    .replace(/^./, (char: string) => char.toLowerCase());
}

export const pascalCase = (value: unknown): string => upperFirst(camelCase(value));

const RESERVED = new Set([
  "class",
  "const",
  "function",
  "import",
  "interface",
  "let",
  "new",
  "null",
  "return",
  "this",
  "typeof",
  "var",
]);

export const isReserved = (name: string): boolean => RESERVED.has(name);

/** A valid identifier made of `value`, or `fallback` when nothing is left. */
export function identifier(value: unknown, fallback: string): string {
  const clean = camelCase(value);
  return clean && !RESERVED.has(clean) ? clean : fallback;
}

/** An object key: bare when it can be, quoted when it has to be. */
export function propertyName(name: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !RESERVED.has(name)
    ? name
    : JSON.stringify(name);
}

/** The model a `$ref` names. */
export const modelName = (ref: unknown): string =>
  pascalCase(String(ref).split("/").pop());

/** Prose on one line, safe inside a a doc comment comment. */
export function oneLine(text: unknown): string {
  return String(text).replace(/\s+/g, " ").trim().replace(/\*\//g, "* /");
}
