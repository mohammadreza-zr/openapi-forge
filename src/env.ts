import { resolve } from "node:path";

/**
 * Files read into `process.env`, most specific first. Node's `loadEnvFile`
 * never replaces a variable that is already set, so the first one to name a
 * variable wins — and the shell wins over all of them (Vite's order).
 */
export const ENV_FILES = [".env.local", ".env"] as const;

/**
 * Read `.env.local` and `.env` of `cwd`, if they exist, so `OPENAPI_FORGE_*`
 * (and anything a config file reads from `process.env`) can live in the
 * project's own env files. Returns the files that were read.
 */
export function loadEnvFiles(cwd: string): string[] {
  // `process.loadEnvFile` exists from Node 20.12; the package supports 20.
  if (typeof process.loadEnvFile !== "function") return [];
  const read: string[] = [];
  for (const name of ENV_FILES) {
    try {
      process.loadEnvFile(resolve(cwd, name));
      read.push(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return read;
}
