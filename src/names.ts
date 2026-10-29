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

/** Words no function, argument or variable can be named (an object key can). */
const RESERVED_IDENTIFIERS = new Set([
  ...RESERVED,
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "if",
  "implements",
  "in",
  "instanceof",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "super",
  "switch",
  "throw",
  "true",
  "try",
  "void",
  "while",
  "with",
  "yield",
]);

export const isReserved = (name: string): boolean => RESERVED.has(name);

/**
 * A valid identifier made of `value`, or `fallback` when nothing is left: no
 * name, a reserved word (`delete`) or a leading digit (`2fa`).
 */
export function identifier(value: unknown, fallback: string): string {
  const clean = camelCase(value);
  return clean && !/^\d/.test(clean) && !RESERVED_IDENTIFIERS.has(clean)
    ? clean
    : fallback;
}

/** An object key: bare when it can be, quoted when it has to be. */
export function propertyName(name: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !RESERVED.has(name)
    ? name
    : JSON.stringify(name);
}

/** The model a `$ref` names; a leading digit (`2FA`) is no type name, so it gets `_`. */
export const modelName = (ref: unknown): string => {
  const name = pascalCase(String(ref).split("/").pop());
  return /^\d/.test(name) ? `_${name}` : name;
};

/** Prose on one line, safe inside a doc comment. */
export function oneLine(text: unknown): string {
  return String(text).replace(/\s+/g, " ").trim().replace(/\*\//g, "* /");
}
