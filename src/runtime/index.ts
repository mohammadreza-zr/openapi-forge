// The runtime `client: "builtin"` writes beside the generated API layer: a
// transport, the hooks over the chosen library, and the types both share. They
// are plain files in the project — edit them freely, they are written once
// and never overwritten (pass --force-runtime to reset them).
import type { ForgeOptions } from "../types.js";
import { BANNER, typesBase } from "./base.js";
import { clientSource } from "./client.js";
import { LIBRARIES } from "./libraries/index.js";

export function runtimeFiles(
  options: ForgeOptions,
  services: string[] = [],
): Map<string, string> {
  const files = new Map<string, string>();
  const hooks = options.target === "hooks";
  const library = LIBRARIES[options.library];
  const infinite = hooks && Boolean(options.infinite);

  const types = hooks ? library.types(infinite) : { imports: "", body: "" };
  files.set(
    "types.ts",
    `${BANNER}\n${types.imports}${typesBase()}${types.body}`,
  );
  const client = clientSource(options.http, services.length > 0);
  if (client !== null) files.set("client.ts", client);
  if (hooks) files.set("hooks.ts", library.hooks(infinite));
  return files;
}
