// The shapes shared across the package: an OpenAPI document as it is read,
// the options a run resolves to, and what the emitter and reports return.

// ── OpenAPI ───────────────────────────────────────────────────────────────

/**
 * A fragment of a document that code rewrites without knowing its shape
 * (the upgrade passes walk every node). Typed loosely on purpose; anything
 * that reads a document for its meaning uses the named types below.
 */
export type Loose = any;

/**
 * A schema as written in a document. The keywords this package reads are
 * named; the index signature keeps vendor extensions (`x-…`) and anything
 * else reachable without a cast.
 */
export interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  nullable?: boolean;
  enum?: unknown[];
  const?: unknown;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  prefixItems?: Schema[];
  additionalProperties?: Schema | boolean;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  discriminator?: { propertyName: string } | string;
  [key: string]: any;
}

export interface Parameter {
  $ref?: string;
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Schema;
  [key: string]: any;
}

export interface MediaType {
  schema?: Schema;
}

export interface OperationObject {
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, MediaType> };
  responses?: Record<string, { content?: Record<string, MediaType>; [key: string]: any }>;
  [key: string]: any;
}

export interface PathItem {
  parameters?: Parameter[];
  [method: string]: any;
}

export interface OpenApiDocument {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string; [key: string]: any };
  paths?: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, Schema>;
    parameters?: Record<string, Parameter>;
    [key: string]: any;
  };
  [key: string]: any;
}

export type HttpMethod = "get" | "put" | "post" | "patch" | "delete";

// ── Options ───────────────────────────────────────────────────────────────

/** The data-fetching library the generated hooks wrap. */
export type LibraryName =
  | "react-query"
  | "vue-query"
  | "svelte-query"
  | "solid-query"
  | "angular-query"
  | "swr";

/** What the built-in runtime sends its requests with. */
export type HttpClientName = "fetch" | "axios" | "angular" | "api-client";

export interface RuntimeConfig {
  callers: {
    module: string;
    get: string;
    post: string;
    put: string;
    patch: string;
    delete: string;
  };
  hooks: {
    module: string;
    query: string;
    mutation: string;
    infinite: string;
    /** Reads a hook argument given as a ref, signal or getter; reactive libraries only. */
    toValue: string;
  };
  types: {
    module: string;
    request: string;
    query: string;
    mutation: string;
    infinite: string;
    /** `T | ref | getter`, the type of a hook argument; reactive libraries only. */
    maybeGetter: string;
  };
  /** The `{ count, list }` shape of a paged answer; `false` turns it off. */
  list:
    | false
    | {
        name: string;
        module: string;
        count: string;
        items: string;
        /** Take both fields to be always there, as the API does, though the document does not say so. */
        assumeRequired?: boolean;
      };
  /** The `{ result, data, … }` wrapper of every answer; `false` for none. */
  envelope:
    | false
    | {
        name: string;
        module: string;
        result: string;
        data: string;
        keys: string[];
      };
  requestKeys: {
    query: string;
    pathParams: string;
    formData: string;
    baseUrl: string;
    signal: string;
    /** Where declared header parameters (and a non-JSON \`Content-Type\`) go; \`false\` when the transport takes none. */
    headers: string | false;
    /** The flag of a call whose answer is an envelope; \`false\` when the transport unwraps on its own. */
    envelope: string | false;
    /** Where the body of a DELETE goes (the transport's \`apiDelete\` takes no body argument); \`false\` skips such operations. */
    body: string | false;
    /** Where the kind of a non-JSON answer goes (\`"text"\` or \`"blob"\`), for a transport that reads the answer as it is told to; \`false\` when it does not. */
    responseType: string | false;
  };
  services: {
    module?: string;
    fn?: string;
    baseUrls?: Record<string, string>;
  };
}

/** An operation as the emitter builds it — what `transform` hooks receive. */
export interface OperationInfo {
  name: string;
  method: HttpMethod;
  path: string;
  /** The route, without the API prefix. */
  url: string;
  tags: string[];
  summary?: string;
  description?: string;
  deprecated: boolean;
  pathParams: Parameter[];
  queryParams: Parameter[];
  /** Declared header parameters, without the ones OpenAPI says to ignore (\`Accept\`, \`Content-Type\`, \`Authorization\`). */
  headerParams: Parameter[];
  bodySchema: Schema | null;
  bodyRequired: boolean;
  /** The media type the body is sent as, e.g. \`application/json\`; \`null\` without a body. */
  bodyMediaType: string | null;
  responseSchema: Schema | null;
  /** The media type of the success answer, e.g. \`application/octet-stream\`; \`null\` without a body. */
  responseMediaType: string | null;
  service: string | null;
}

export interface Transform {
  /** A query parameter's name on the wire. */
  queryParam?: (
    name: string,
    info: { service: string | null; operation: string; path: string },
  ) => string | undefined;
  /** The exported function's name. */
  operationName?: (operation: OperationInfo) => string | undefined | null;
  /** A tag's module file name, without extension. */
  fileName?: (tag: string) => string | undefined;
  /** Change an operation, or return `null` to drop it. */
  operation?: (operation: OperationInfo) => OperationInfo | null;
}

export type Input = string | Record<string, string>;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/** What a config file or the command line may set. */
export interface ForgeConfig {
  /** A document (file or URL), a folder of documents, or `{ service: fileOrUrl }`. */
  input?: Input;
  out?: string;
  /** Stripped from every emitted route. */
  apiPrefix?: string;
  /** `"builtin"` writes a fetch runtime once; `"custom"` uses `runtime`. */
  client?: "builtin" | "custom";
  /** `"hooks"` adds the hooks of `library` and key factories. */
  target?: "hooks" | "requests";
  /** The library the hooks wrap; it decides their names and how they read arguments. */
  library?: LibraryName;
  /** What the built-in runtime sends requests with. */
  http?: HttpClientName;
  tags?: { include?: string | string[]; exclude?: string | string[] };
  /** Adds an infinite-list hook to paged reads; names the paging parameters. */
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
  transform?: Transform;
  verbose?: boolean;
}

/** The options of a run: every default filled in. */
export interface ForgeOptions {
  input: Input;
  out: string;
  apiPrefix: string;
  client: "builtin" | "custom";
  target: "hooks" | "requests";
  library: LibraryName;
  http: HttpClientName;
  tags: { include: string[]; exclude: string[] };
  infinite: false | { start: string; size: string };
  zod: boolean;
  runtime: RuntimeConfig;
  generatorName: string;
  decisionsFile: string;
  specsDir: string;
  sources: Record<string, string>;
  headers?: Record<string, string>;
  tls: { insecure?: boolean; ca?: string };
  format: "prettier" | false;
  transform: Transform;
  verbose: boolean;
}

// ── Results ───────────────────────────────────────────────────────────────

/** Something a document leaves incomplete; the output is still valid. */
export interface Problem {
  where: string;
  message: string;
}

export interface EmitResult {
  files: Map<string, string>;
  /** The backend services the operations name (`x-service`), sorted. */
  services: string[];
  operations: number;
  tags: number;
  problems: Problem[];
}

export interface RunResult {
  ok: boolean;
  stale?: string[];
  files?: string[];
}

export type Severity = "breaking" | "risky" | "safe";

export interface Finding {
  severity: Severity;
  kind: string;
  message: string;
  operation?: string;
  schema?: string;
  name?: string;
  hook?: string;
}

export interface Check {
  level: "ok" | "warn" | "fail";
  message: string;
}

// ── Merging services ──────────────────────────────────────────────────────

/** One backend service's document, by name. */
export interface Service {
  name: string;
  doc: OpenApiDocument;
}

export interface MergeReport {
  /** Keys found in several services with the same content. */
  identical: { key: string; services: string[] }[];
  /** Keys that differ and were assigned an owner. */
  chosen: { key: string; services: string[]; owner: string }[];
  /** Keys that differ and still need an owner. */
  undecided: { key: string; services: string[] }[];
  /** Operations that reach a contested component owned by another service. */
  crossRefs: { key: string; service: string; ref: string; owner: string }[];
}
