// Stands in for `vite/client` when the generated layer is type-checked on its own.
interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}
