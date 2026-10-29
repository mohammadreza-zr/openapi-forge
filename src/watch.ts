// Re-run a build whenever its inputs change: local documents are watched, a
// URL is polled. Bursts of events become one run, and a failed
// run is reported and waited out instead of ending the watch.
import { existsSync, watch } from "node:fs";

const DEBOUNCE_MS = 150;

/**
 * @param {() => Promise<void>} rebuild
 * @param {{ paths: string[], poll?: number }} where  `poll` is in seconds
 */
export function watchRun(
  rebuild: () => Promise<void>,
  { paths, poll }: { paths: string[]; poll?: number },
): () => void {
  let running = false;
  let again = false;
  let timer: NodeJS.Timeout | undefined;

  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await rebuild();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    running = false;
    if (again) {
      again = false;
      schedule();
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  };

  const watchers = paths
    .filter((path: string) => existsSync(path))
    .map((path: string) => watch(path, { recursive: true }, schedule));
  const poller = poll ? setInterval(run, poll * 1000) : undefined;

  run();
  return () => {
    clearTimeout(timer);
    clearInterval(poller);
    for (const watcher of watchers) watcher.close();
  };
}
