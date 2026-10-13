/** Session lifetime shared by the host bridge and injected privileged adapters. */
export class PreviewSession {
  private generation = 0;
  private disposed = false;
  private releases: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly diagnostic: (operation: string) => void) {}
  capture(): number {
    return this.generation;
  }
  current(generation = this.generation): boolean {
    return !this.disposed && generation === this.generation;
  }
  supersede(): number {
    if (!this.disposed) ++this.generation;
    return this.generation;
  }
  own(disposable: { dispose(): void }): void {
    if (this.disposed) this.release(() => disposable.dispose());
    else this.releases.push(() => disposable.dispose());
  }
  debounce(callback: () => void, delay: number): void {
    if (!this.current()) return;
    clearTimeout(this.timer);
    const generation = this.capture();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.current(generation)) this.boundary('refresh preview', callback);
    }, delay);
  }
  boundary<T>(operation: string, callback: () => T): T | undefined {
    if (!this.current()) return;
    try {
      return callback();
    } catch {
      this.report(operation);
    }
  }
  async run<T>(
    operation: string,
    callback: () => PromiseLike<T> | T,
    generation = this.capture(),
  ): Promise<T | undefined> {
    if (!this.current(generation)) return;
    try {
      const result = await callback();
      if (this.current(generation)) return result;
    } catch {
      if (this.current(generation)) this.report(operation);
    }
  }
  fail(operation: string): void {
    if (this.current()) this.report(operation);
  }
  private report(operation: string): void {
    try {
      this.diagnostic(operation);
    } catch {
      // Diagnostics must never turn a handled host failure into an unhandled rejection.
    }
  }
  private release(release: () => void): void {
    try {
      release();
    } catch {
      this.report('release preview listener');
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    clearTimeout(this.timer);
    this.releases.splice(0).forEach((release) => this.release(release));
  }
}

/** Log fixed operation labels only. Exception messages may contain document data or credentials. */
export function sessionDiagnostic(output: { appendLine(value: string): void }): (operation: string) => void {
  return (operation) =>
    output.appendLine(
      `Preview: ${operation} failed. Retry the action; check file access or configuration permissions. No document data recorded.`,
    );
}

export class PreviewHostBridge {
  constructor(
    private readonly session: PreviewSession,
    private readonly postMessage: (message: unknown) => PromiseLike<boolean>,
  ) {}
  async receive(raw: unknown, handler: (raw: unknown, generation: number) => PromiseLike<void> | void): Promise<void> {
    const generation = this.session.capture();
    await this.session.run('handle preview message', () => handler(raw, generation), generation);
  }
  async post(message: unknown, generation = this.session.capture()): Promise<boolean> {
    const delivered = await this.session.run('deliver webview message', () => this.postMessage(message), generation);
    if (!this.session.current(generation)) return false;
    if (delivered === false) this.session.fail('deliver webview message');
    return delivered === true;
  }
}

/** URI/provider operations remain host supplied; every result is tied to its initiating document. */
export class PreviewNavigationAdapter {
  constructor(private readonly session: PreviewSession) {}
  async resolve<T>(
    operation: string,
    read: () => PromiseLike<T> | T,
    generation = this.session.capture(),
  ): Promise<T | undefined> {
    return this.session.run(operation, read, generation);
  }
}
