/**
 * Runs tasks with the same key one after another (e.g. all webhooks of one call),
 * while tasks for different keys run concurrently.
 */
const chains = new Map<string, Promise<unknown>>();

export function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  chains.set(key, next);
  void next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
  return next;
}
