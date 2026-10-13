/** User-owned permission state; never sourced from workspace configuration. */
export const externalImageGrantsKey = 'richMarkdownPreview.externalImageOrigins.v1';

/** Reject ambiguous URL spellings and credentials before browser normalization. */
export function externalImageOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return;
  if (!/^https:\/\//i.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return;
    return url.origin;
  } catch {
    return;
  }
}

/** Messages and stored grants must name an origin, never a URL/path or wildcard. */
export function isExternalImageOrigin(value: unknown): value is string {
  return typeof value === 'string' && externalImageOrigin(value) === value;
}

export function readExternalImageGrants(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter(isExternalImageOrigin) : []);
}

export type ExternalImageDecision =
  | { kind: 'local'; source: string }
  | { kind: 'blocked'; origin?: string }
  | { kind: 'allowed'; source: string; origin: string };

/** The enabled hook lets the host apply its trust policy without a workspace setting. */
export function externalImageDecision(
  source: string,
  grants: ReadonlySet<string>,
  enabled = true,
): ExternalImageDecision {
  const origin = externalImageOrigin(source);
  if (origin) {
    return enabled && grants.has(origin) ? { kind: 'allowed', source, origin } : { kind: 'blocked', origin };
  }
  if (/^(?:https?:|\/\/)/i.test(source)) return { kind: 'blocked' };
  return { kind: 'local', source };
}

/** CSP uses the exact validated grant set; remote wildcard schemes are forbidden. */
export function externalImageCspOrigins(grants: ReadonlySet<string>, enabled = true): string {
  return enabled ? [...grants].filter(isExternalImageOrigin).sort().join(' ') : '';
}

export interface ExternalImageGrantStore {
  get(key: string): unknown;
  update(key: string, value: string[]): PromiseLike<void>;
}

/** One host-owned instance coordinates durable permission changes across all previews. */
export class ExternalImagePermissions {
  readonly grants: Set<string>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: ExternalImageGrantStore) {
    this.grants = readExternalImageGrants(store.get(externalImageGrantsKey));
  }

  change(
    action: 'grant' | 'revoke',
    origin: string,
    isCurrentRenderedOrigin: () => boolean,
    confirm: (origin: string) => PromiseLike<boolean>,
  ): Promise<boolean> {
    const apply = async () => {
      if (!isExternalImageOrigin(origin) || !isCurrentRenderedOrigin()) return false;
      if (action === 'grant' && !(await confirm(origin))) return false;
      // A navigation or disposal while the native prompt is open invalidates the request.
      if (!isCurrentRenderedOrigin()) return false;
      const next = new Set(this.grants);
      if (action === 'grant') next.add(origin);
      else next.delete(origin);
      await this.store.update(externalImageGrantsKey, [...next].sort());
      this.grants.clear();
      for (const grant of next) this.grants.add(grant);
      return true;
    };
    const result = this.queue.then(apply);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
