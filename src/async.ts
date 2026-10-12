/** Observe intentionally detached work, including VS Code's Thenables. */
export function reportAsync<T>(operation: PromiseLike<T> | T): void {
  Promise.resolve(operation).catch((error: unknown) => {
    console.error('Rich Markdown Preview asynchronous operation failed:', error);
  });
}
