import * as vscode from 'vscode';
import { documentResourceRoot, parseResourceUrl } from './resources';
import { sameProviderWithin } from './provider-paths';

/** Trusted opaque providers are confined by URI identity and reportable symlink ancestry.
 * Unlike file resources, this does not claim a provider-independent canonical disk path.
 */
export async function resolveProviderImageResource(
  src: string,
  document: vscode.Uri,
  webview: vscode.Webview,
): Promise<string> {
  if (document.scheme === 'file' || !vscode.workspace.isTrusted) return '';
  try {
    const parts = parseResourceUrl(src);
    const decoded = decodeURIComponent(parts.path);
    if (
      !decoded ||
      /[\u0000-\u001f\u007f\\]/.test(decoded) ||
      /^[a-z][a-z\d+.-]*:/i.test(decoded) ||
      decoded.startsWith('/') ||
      decoded.startsWith('~/')
    )
      return '';
    const target = vscode.Uri.joinPath(vscode.Uri.joinPath(document, '..'), decoded);
    const root = documentResourceRoot(document);
    if (!sameProviderWithin(root, target)) return '';
    const suffix = target.path.slice(root.path.replace(/\/$/, '').length);
    const segments = suffix.split('/').filter(Boolean);
    let current = root;
    const rootStat = await vscode.workspace.fs.stat(root);
    if (rootStat.type & vscode.FileType.SymbolicLink || !(rootStat.type & vscode.FileType.Directory)) return '';
    for (let index = 0; index < segments.length; index++) {
      current = vscode.Uri.joinPath(current, segments[index]);
      const stat = await vscode.workspace.fs.stat(current);
      if (stat.type & vscode.FileType.SymbolicLink) return '';
      if (index === segments.length - 1 ? stat.type !== vscode.FileType.File : !(stat.type & vscode.FileType.Directory))
        return '';
    }
    if (!segments.length || !vscode.workspace.isTrusted) return '';
    return (
      webview.asWebviewUri(target).toString() +
      (parts.query ? `?${parts.query}` : '') +
      (parts.fragment ? `#${parts.fragment}` : '')
    );
  } catch {
    return '';
  }
}
