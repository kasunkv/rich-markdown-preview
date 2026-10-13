import { PreviewSession } from './preview-session';

/** Keep live overrides while serialized configuration writes settle. */
export class PreviewPreferenceStore<T extends object> {
  private readonly overrides: Partial<T> = {};
  private writes = Promise.resolve();
  private generation = -1;
  constructor(
    private readonly session: PreviewSession,
    private readonly read: () => T,
    private readonly fallback: T,
  ) {}
  private synchronize(): void {
    const generation = this.session.capture();
    if (generation !== this.generation) {
      for (const key of Object.keys(this.overrides)) delete this.overrides[key as keyof T];
      this.generation = generation;
    }
  }
  effective(): T {
    this.synchronize();
    return { ...(this.session.boundary('read preview configuration', this.read) ?? this.fallback), ...this.overrides };
  }
  set<K extends keyof T>(
    key: K,
    value: T[K],
    write: () => PromiseLike<void>,
    changed: () => void,
    failed: () => void,
  ): Promise<void> {
    const generation = this.session.capture();
    if (!this.session.current(generation)) return this.writes;
    this.synchronize();
    this.overrides[key] = value;
    this.writes = this.writes.then(async () => {
      if (!this.session.current(generation)) return;
      let saved = false;
      await this.session.run(
        'save preview configuration',
        async () => {
          await write();
          saved = true;
        },
        generation,
      );
      if (!this.session.current(generation)) return;
      if (saved && this.overrides[key] === value) delete this.overrides[key];
      this.session.boundary('update preview preferences', changed);
      if (!saved) this.session.boundary('report configuration failure', failed);
    });
    return this.writes;
  }
}
