/** Persisted session context is untrusted. Reading state is owned by the bounded-state codec. */
export const RESTORED_SESSION_VERSION = 1;
export const RESTORED_HISTORY_LIMIT = 20;
export interface RestoredSession {
  version: 1;
  kind: 'preview' | 'documentation';
  target?: string;
  workspaceRoot?: string;
  history: string[];
  cursor: number;
}

function uriText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\u0000-\u0020\u007f]/.test(value);
}

/** Do not invoke accessors or accept privilege-bearing extra fields from webview storage. */
export function decodeRestoredSession(value: unknown, kind: RestoredSession['kind']): RestoredSession | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    return;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).some(
      (key) =>
        typeof key !== 'string' ||
        !['version', 'kind', 'target', 'workspaceRoot', 'history', 'cursor'].includes(key) ||
        !('value' in fields[key]),
    )
  )
    return;
  const data = value as Record<string, unknown>;
  if (data.version !== RESTORED_SESSION_VERSION || data.kind !== kind) return;
  if (data.target !== undefined && !uriText(data.target)) return;
  if (data.workspaceRoot !== undefined && !uriText(data.workspaceRoot)) return;
  if (kind === 'preview' && data.target === undefined) return;
  if (!Array.isArray(data.history) || data.history.length > RESTORED_HISTORY_LIMIT) return;
  // Inspect array descriptors too: sparse arrays and indexed getters must not cross the boundary.
  const history: string[] = [];
  for (let index = 0; index < data.history.length; index++) {
    const field = Object.getOwnPropertyDescriptor(data.history, String(index));
    if (!field || !('value' in field) || !uriText(field.value)) return;
    history.push(field.value);
  }
  if (!Number.isInteger(data.cursor) || (data.cursor as number) < -1 || (data.cursor as number) >= history.length)
    return;
  if (history.length && data.cursor === -1) return;
  if (history.length && history[data.cursor as number] !== data.target) return;
  return {
    version: RESTORED_SESSION_VERSION,
    kind,
    target: data.target as string | undefined,
    workspaceRoot: data.workspaceRoot as string | undefined,
    history,
    cursor: data.cursor as number,
  };
}

export interface RestorationPolicy<T> {
  /** Parse strictly, rejecting credentials, query/fragment, unsupported schemes and noncanonical forms. */
  parse(value: string): T | undefined;
  /** Current trust, provider support, authoritative roots and resource policy; saved root never grants access. */
  allowed(target: T, savedRoot: T | undefined): boolean;
  exists(target: T): PromiseLike<boolean>;
}

/** No filesystem lookup occurs before policy approval. Recheck after asynchronous provider work. */
export async function validateRestoredTarget<T>(
  session: RestoredSession,
  policy: RestorationPolicy<T>,
): Promise<T | undefined> {
  if (!session.target) return;
  try {
    const target = policy.parse(session.target);
    const root = session.workspaceRoot === undefined ? undefined : policy.parse(session.workspaceRoot);
    if (target === undefined || (session.workspaceRoot !== undefined && root === undefined)) return;
    if (!policy.allowed(target, root)) return;
    if (!(await policy.exists(target)) || !policy.allowed(target, root)) return;
    return target;
  } catch {
    // Providers can disappear or fail; the controller supplies a fixed, accessible fallback.
    return;
  }
}
