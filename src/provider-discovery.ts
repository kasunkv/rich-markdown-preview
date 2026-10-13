import * as vscode from 'vscode';
import { minimatch } from 'minimatch';
import { sameProviderWithin } from './provider-paths';

export const providerDiscoveryLimits = { entries: 20_000, results: 5_000, depth: 64 };
/** Read names only, respecting explicit globs; opaque providers have no disk canonicalization API. */
export async function discoverProviderMarkdown(
  root: vscode.Uri,
  include: string,
  exclude: string,
  cancellation: vscode.CancellationToken,
  limits = providerDiscoveryLimits,
): Promise<vscode.Uri[]> {
  const allowed = () =>
    vscode.workspace.isTrusted &&
    !cancellation.isCancellationRequested &&
    vscode.workspace.workspaceFolders?.some((folder) => folder.uri.toString() === root.toString());
  if (!allowed()) return [];
  const rootStat = await vscode.workspace.fs.stat(root);
  if (!allowed() || rootStat.type & vscode.FileType.SymbolicLink || !(rootStat.type & vscode.FileType.Directory))
    return [];
  const pending = [{ uri: root, relative: '', depth: 0 }];
  const results: vscode.Uri[] = [];
  let entries = 0;
  const matches = (path: string, pattern: string) =>
    minimatch(path, pattern, { dot: true, noext: true, nonegate: true, nocomment: true });
  while (pending.length) {
    if (!allowed()) return [];
    const directory = pending.pop()!;
    const children = await vscode.workspace.fs.readDirectory(directory.uri);
    if (!allowed()) return [];
    entries += children.length;
    if (entries > limits.entries)
      throw new Error('Provider documentation entry limit reached. Narrow include/exclude settings.');
    for (const [name, type] of children) {
      if (
        !name ||
        name === '.' ||
        name === '..' ||
        /[\u0000-\u001f\u007f/\\]/.test(name) ||
        type & vscode.FileType.SymbolicLink
      )
        continue;
      const relative = directory.relative ? `${directory.relative}/${name}` : name;
      const target = vscode.Uri.joinPath(directory.uri, name);
      if (
        !sameProviderWithin(root, target) ||
        (exclude && (matches(relative, exclude) || matches(`${relative}/`, exclude)))
      )
        continue;
      if (type & vscode.FileType.Directory) {
        if (directory.depth >= limits.depth)
          throw new Error('Provider documentation depth limit reached. Narrow include/exclude settings.');
        pending.push({ uri: target, relative, depth: directory.depth + 1 });
      } else if (type === vscode.FileType.File && /\.(md|markdown)$/i.test(name) && matches(relative, include)) {
        results.push(target);
        if (results.length > limits.results)
          throw new Error('Provider documentation result limit reached. Narrow include/exclude settings.');
      }
    }
  }
  return allowed() ? results : [];
}
