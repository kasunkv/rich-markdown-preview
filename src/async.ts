/** Observe intentionally detached work, including VS Code's Thenables. Never expose provider exception text. */
export function reportAsync<T>(operation: PromiseLike<T> | T, failed?: () => void): void {
  Promise.resolve(operation).catch(() => {
    if (failed) {
      try {
        failed();
      } catch {
        // The logger may already have been disposed during extension shutdown.
      }
    } else console.error('Rich Markdown Preview asynchronous operation failed. Retry the action.');
  });
}
