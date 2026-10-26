export interface RuntimeConfig {
  callers: {
    module: string;
    get: string;
    post: string;
    put: string;
    patch: string;
    delete: string;
  };
  hooks: { module: string; query: string; mutation: string };
  types: { module: string; request: string; query: string; mutation: string };
  list: false | { name: string; module: string; count: string; items: string };
  envelope:
    | false
    | { name: string; module: string; result: string; data: string; keys: string[] };
  requestKeys: {
    query: string;
    pathParams: string;
    formData: string;
    baseUrl: string;
    signal: string;
  };
  services: { module?: string; fn?: string; baseUrls?: Record<string, string> };
}

export interface OperationInfo {
  name: string;
  method: "get" | "put" | "post" | "patch" | "delete";
  path: string;
  url: string;
  tags: string[];
  summary?: string;
  description?: string;
  deprecated: boolean;
  service: string | null;
  [key: string]: unknown;
}

export interface ForgeConfig {
  /** A document (file or URL), a folder of documents, or `{ service: fileOrUrl }`. */
  input?: string | Record<string, string>;
  out?: string;
  /** Stripped from every emitted route. */
  apiPrefix?: string;
  /** `"builtin"` writes a fetch runtime once; `"custom"` uses `runtime`. */
  client?: "builtin" | "custom";
  /** `"hooks"` adds React Query hooks and key factories. */
  target?: "hooks" | "requests";
  tags?: { include?: string[]; exclude?: string[] };
  /** Adds an infinite-list hook to paged reads; names the paging query parameters. */
  infinite?: boolean | { start?: string; size?: string };
  /** Also writes `schemas.ts`: a Zod validator per model. */
  zod?: boolean;
  runtime?: DeepPartial<RuntimeConfig>;
  generatorName?: string;
  decisionsFile?: string;
  specsDir?: string;
  /** For `openapi-forge pull`: `{ name: url }`. */
  sources?: Record<string, string>;
  headers?: Record<string, string>;
  tls?: { insecure?: boolean; ca?: string };
  format?: "prettier" | false;
  transform?: {
    queryParam?: (
      name: string,
      info: { service: string | null; operation: string; path: string },
    ) => string;
    operationName?: (operation: OperationInfo) => string | undefined;
    fileName?: (tag: string) => string;
    operation?: (operation: OperationInfo) => OperationInfo | null;
  };
  verbose?: boolean;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function defineConfig(config: ForgeConfig): ForgeConfig;
export function resolveOptions(file?: ForgeConfig, cli?: ForgeConfig): ForgeConfig & Record<string, any>;
export function loadConfigFile(
  cwd: string,
  explicit?: string,
): Promise<{ file: string | null; config: ForgeConfig }>;
export function generate(
  options: ForgeConfig & Record<string, any>,
  run: { cwd: string; check?: boolean; forceRuntime?: boolean; interactive?: boolean },
): Promise<{ ok: boolean; stale?: string[]; files?: string[] }>;
export function run(
  options?: ForgeConfig,
  context?: { cwd?: string; check?: boolean },
): Promise<{ ok: boolean; stale?: string[]; files?: string[] }>;
export function emit(
  spec: object,
  options: ForgeConfig & Record<string, any>,
  source: string,
): { files: Map<string, string>; operations: number; tags: number };
export function pull(options: ForgeConfig & Record<string, any>, run: { cwd: string }): Promise<string[]>;
export type Finding = {
  severity: "breaking" | "risky" | "safe";
  kind: string;
  message: string;
  operation?: string;
  schema?: string;
  name?: string;
  hook?: string;
};
export function diffDocuments(oldDoc: object, newDoc: object): Finding[];
export function renderReport(
  findings: Finding[],
  format?: "text" | "markdown" | "json",
  options?: { title?: string },
): string;
export function summarize(findings: Finding[]): Record<Finding["severity"], number>;
export function exceeds(findings: Finding[], threshold?: Finding["severity"]): boolean;
export function doctor(
  options: ForgeConfig & Record<string, any>,
  run: { cwd: string; configFile?: string | null },
): Promise<{ level: "ok" | "warn" | "fail"; message: string }[]>;
export function watchRun(
  rebuild: () => Promise<void>,
  where: { paths: string[]; poll?: number },
): () => void;
export function parseSourcePairs(text: string): Record<string, string>;
export function mergeSpecs(
  services: { name: string; doc: object }[],
  choices?: Record<string, string>,
): { doc: object; report: object };
export function camelCase(value: string): string;
export function pascalCase(value: string): string;
export const DEFAULTS: ForgeConfig;
