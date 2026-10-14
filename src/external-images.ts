/** User-owned permission state; never sourced from workspace configuration. */
export const externalImageGrantsKey = 'richMarkdownPreview.externalImageOrigins.v1';

/** Reject ambiguous URL spellings and credentials before browser normalization. */
export function externalImageOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return;
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || authority.includes('@')) return;
  try {
    const url = new URL(value);

    const hostname = url.hostname;
    if (
      !hostname.startsWith('[') &&
      (hostname.length > 253 ||
        !hostname.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)))
    )
      return;
    return url.origin;
  } catch {
    return;
  }
}

/** Messages and stored grants must name an origin, never a URL/path or wildcard. */
export function isExternalImageOrigin(value: unknown): value is string {
  return typeof value === 'string' && !value.startsWith('https://[') && externalImageOrigin(value) === value;
}

export function readExternalImageGrants(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter(isExternalImageOrigin) : []);
}

export type ExternalImageDecision =
  | { kind: 'local'; source: string }
  | { kind: 'blocked'; origin?: string; reason?: 'unsupported-ipv6' }
  | { kind: 'allowed'; source: string; origin: string };

/** The enabled hook lets the host apply its trust policy without a workspace setting. */
export function externalImageDecision(
  source: string,
  grants: ReadonlySet<string>,
  enabled = true,
): ExternalImageDecision {
  if (source.trim() !== source || /[\\\u0000-\u001f\u007f]/u.test(source)) return { kind: 'blocked' };
  if (/^https:\/\/(?:\[|%5b)/i.test(source)) return { kind: 'blocked', reason: 'unsupported-ipv6' };
  const origin = externalImageOrigin(source);
  if (origin) {
    return enabled && grants.has(origin) ? { kind: 'allowed', source, origin } : { kind: 'blocked', origin };
  }
  if (source.startsWith('//') || (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^(?:file:|data:)/i.test(source)))
    return { kind: 'blocked' };
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
  private readonly revoked = new Set<string>();
  private readonly revokeVersions = new Map<string, number>();

  constructor(
    private readonly store: ExternalImageGrantStore,
    private readonly changed: (action: 'grant' | 'revoke', origin: string) => void = () => undefined,
  ) {
    this.grants = readExternalImageGrants(store.get(externalImageGrantsKey));
  }

  change(
    action: 'grant' | 'revoke',
    origin: string,
    isCurrentRenderedOrigin: () => boolean,
    confirm: (origin: string) => PromiseLike<boolean>,
  ): Promise<boolean> {
    if (!isExternalImageOrigin(origin) || !isCurrentRenderedOrigin()) return Promise.resolve(false);
    const revokeVersion = this.revokeVersions.get(origin) ?? 0;
    // Deny synchronously, even while a different permission operation is awaiting persistence.
    if (action === 'revoke') {
      this.revokeVersions.set(origin, revokeVersion + 1);
      this.revoked.add(origin);
      this.grants.delete(origin);
      this.changed(action, origin);
    }
    const apply = async () => {
      if (action === 'grant') {
        if (!isCurrentRenderedOrigin() || !(await confirm(origin)) || !isCurrentRenderedOrigin()) return false;
      }
      const next = new Set(this.grants);
      if (action === 'grant') next.add(origin);
      await this.store.update(externalImageGrantsKey, [...next].sort());
      if (action === 'grant') {
        if (!isCurrentRenderedOrigin() || (this.revokeVersions.get(origin) ?? 0) !== revokeVersion) return false;
        this.revoked.delete(origin);
      }
      this.grants.clear();
      // A revoke during an earlier pending write cannot be reintroduced by that write's snapshot.
      for (const grant of next) if (!this.revoked.has(grant)) this.grants.add(grant);
      if (action === 'grant') this.changed(action, origin);
      return true;
    };
    const result = this.queue.then(apply);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
