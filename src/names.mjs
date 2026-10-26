// Naming helpers: what a document's names become in TypeScript.

export const upperFirst = (value) =>
  value.charAt(0).toUpperCase() + value.slice(1);

export function camelCase(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "")
    .replace(/^./, (char) => char.toLowerCase());
}

export const pascalCase = (value) => upperFirst(camelCase(value));

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

export const isReserved = (name) => RESERVED.has(name);

/** A valid identifier made of `value`, or `fallback` when nothing is left. */
export function identifier(value, fallback) {
  const clean = camelCase(value);
  return clean && !RESERVED.has(clean) ? clean : fallback;
}

/** An object key: bare when it can be, quoted when it has to be. */
export function propertyName(name) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !RESERVED.has(name)
    ? name
    : JSON.stringify(name);
}

/** The model a `$ref` names. */
export const modelName = (ref) => pascalCase(String(ref).split("/").pop());

/** Prose on one line, safe inside a a doc comment comment. */
export function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim().replace(/\*\//g, "* /");
}
