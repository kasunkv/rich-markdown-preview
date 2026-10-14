/** URI path rules; the adapter keeps provider authority and never uses fsPath. */
export interface ResourceUri {
  scheme: string;
  authority: string;
  path: string;
}
export interface ReferenceAdapter<T extends ResourceUri> {
  joinPath(base: T, ...segments: string[]): T;
  file(path: string): T;
  platform: string;
  home: string;
}
export type ReferenceResolution<T> = { kind: 'target'; uri: T } | { kind: 'invalid' | 'unsupported'; message: string };

export function sameProviderWithin(root: ResourceUri, target: ResourceUri): boolean {
  const path = root.path.replace(/\/$/, '');
  return (
    root.scheme === target.scheme &&
    root.authority === target.authority &&
    (target.path === path || target.path.startsWith(path + '/'))
  );
}

/** Leading / is the configured reference root, as in the original reference contract. */
export function resolveReference<T extends ResourceUri>(
  candidate: string,
  directory: T,
  workspaceRoot: T,
  rootSetting: string,
  adapter: ReferenceAdapter<T>,
): ReferenceResolution<T> {
  let path: string;
  try {
    path = decodeURIComponent(candidate).replace(/\\/g, '/');
  } catch {
    return { kind: 'invalid', message: 'The reference contains invalid URL encoding. Check its path.' };
  }
  if (
    !path ||
    path.length > 8192 ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.startsWith('//') ||
    (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:\//i.test(path))
  )
    return { kind: 'invalid', message: 'Use a relative path or a / reference rooted in Reference Root.' };
  const windows = /^[a-z]:\//i.test(path);
  const windowsRoot = /^[a-z]:[\\/]/i.test(rootSetting);
  const home = path.startsWith('~/');
  if ((windows || windowsRoot || home) && directory.scheme !== 'file')
    return {
      kind: 'unsupported',
      message:
        'Host absolute and home paths are unavailable for this provider. Use a relative path or a workspace-relative Reference Root.',
    };
  if ((windows || windowsRoot) && adapter.platform !== 'win32')
    return {
      kind: 'unsupported',
      message:
        'Windows absolute paths require a Windows extension host. Use a relative path or a workspace-relative Reference Root.',
    };
  if (windows) return { kind: 'target', uri: adapter.file(path) };
  if (home) return { kind: 'target', uri: adapter.file(`${adapter.home}/${path.slice(2)}`) };
  const root = rootSetting
    ? windowsRoot
      ? adapter.file(rootSetting)
      : adapter.joinPath(workspaceRoot, rootSetting)
    : workspaceRoot;
  return {
    kind: 'target',
    uri: path.startsWith('/') ? adapter.joinPath(root, path.slice(1)) : adapter.joinPath(directory, path),
  };
}
