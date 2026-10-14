/** Bounded, in-memory LRU. Keys must include every security/resource policy input. */
export class RenderCache<T> {
  private readonly entries = new Map<string, { value: T; units: number }>();
  private units = 0;
  constructor(
    private readonly maxEntries: number,
    private readonly maxUnits: number,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxUnits) || maxUnits < 1)
      throw new RangeError('Cache bounds must be positive safe integers');
  }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, valueUnits: number): boolean {
    this.delete(key);
    // Include the full key, so source/theme keys cannot bypass the memory budget.
    const units = key.length + valueUnits;
    if (!Number.isSafeInteger(valueUnits) || valueUnits < 0 || !Number.isSafeInteger(units) || units > this.maxUnits)
      return false;
    while (this.entries.size >= this.maxEntries || this.units + units > this.maxUnits)
      this.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, units });
    this.units += units;
    return true;
  }
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.units -= entry.units;
      this.entries.delete(key);
    }
  }
  clear(): void {
    this.entries.clear();
    this.units = 0;
  }
  get size(): number {
    return this.entries.size;
  }
  get retainedUnits(): number {
    return this.units;
  }
}

/** No hashes: version, source and resource/trust/grant context must match exactly. */
export function documentRenderKey(uri: string, version: number, source: string, policy: string): string {
  return JSON.stringify([uri, version, source, policy]);
}

/** SVG entries are templates, never live DOM; callers must isolate IDs on every use. */
export function diagramRenderKey(source: string, theme: string, rendererPolicy: string): string {
  return JSON.stringify([source, theme, rendererPolicy]);
}

/** Tracks render work independently of privileged session generations. */
export class RenderWork {
  private revision = 0;
  private visible = true;
  private deliveredKey: string | undefined;
  request(): number {
    return ++this.revision;
  }
  setVisible(visible: boolean): void {
    if (this.visible !== visible) {
      this.visible = visible;
      ++this.revision;
    }
  }
  current(revision: number): boolean {
    return this.visible && revision === this.revision;
  }
  needsRender(key: string): boolean {
    return this.visible && key !== this.deliveredKey;
  }
  delivered(key: string, revision: number): boolean {
    if (!this.current(revision)) return false;
    this.deliveredKey = key;
    return true;
  }
  reset(): void {
    this.deliveredKey = undefined;
    ++this.revision;
  }
}
