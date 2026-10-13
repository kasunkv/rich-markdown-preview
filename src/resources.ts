import * as vscode from 'vscode';
import { realpathSync, statSync } from 'node:fs';
import { relative, isAbsolute, sep } from 'node:path';

import { parseResourceUrl } from './resource-url';
export { parseResourceUrl } from './resource-url';

export function documentResourceRoot(document: vscode.Uri): vscode.Uri {
  return vscode.workspace.getWorkspaceFolder(document)?.uri ?? vscode.Uri.joinPath(document, '..');
}

export function previewResourceRoots(extension: vscode.Uri, document?: vscode.Uri): vscode.Uri[] {
  return [
    vscode.Uri.joinPath(extension, 'dist'),
    vscode.Uri.joinPath(extension, 'assets'),
    ...(document && (vscode.workspace.isTrusted || restrictedNavigationAllowed(document))
      ? [documentResourceRoot(document)]
      : []),
  ];
}

/** File images use canonical disk containment; asynchronous opaque provider images are handled separately. */
export function resolveImageResource(src: string, document: vscode.Uri, webview: vscode.Webview): string {
  if (/^(https?:|data:)/i.test(src) || src.startsWith('//')) return src;
  try {
    const parts = parseResourceUrl(src);
    const decoded = decodeURIComponent(parts.path);
    if (!decoded || /[\u0000-\u001f\\]/.test(decoded)) return '';
    let target: vscode.Uri;
    if (/^file:/i.test(parts.path)) target = vscode.Uri.parse(parts.path);
    else {
      if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('/')) return '';
      target = vscode.Uri.joinPath(vscode.Uri.joinPath(document, '..'), decoded);
    }
    const root = documentResourceRoot(document);
    if (target.scheme !== 'file' || root.scheme !== 'file' || target.authority !== root.authority) return '';
    if (!vscode.workspace.isTrusted && !restrictedNavigationAllowed(target)) return '';
    const logical = relative(root.fsPath, target.fsPath);
    if (logical === '..' || logical.startsWith(`..${sep}`) || isAbsolute(logical)) return '';
    const canonicalRoot = realpathSync(root.fsPath);
    const canonicalTarget = realpathSync(target.fsPath);
    const within = relative(canonicalRoot, canonicalTarget);
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || !statSync(canonicalTarget).isFile())
      return '';
    // Preserve suffixes as URI metadata, never as filesystem path components.
    const converted = webview.asWebviewUri(target).toString();
    return converted + (parts.query ? `?${parts.query}` : '') + (parts.fragment ? `#${parts.fragment}` : '');
  } catch {
    return '';
  }
}

/** Restricted Mode only reads canonical local files contained by a workspace folder. */
export function restrictedNavigationAllowed(target: vscode.Uri): boolean {
  try {
    const root = vscode.workspace.getWorkspaceFolder(target)?.uri;
    if (!root || target.scheme !== 'file' || root.scheme !== 'file' || target.authority !== root.authority)
      return false;
    const logical = relative(root.fsPath, target.fsPath);
    if (logical === '..' || logical.startsWith(`..${sep}`) || isAbsolute(logical)) return false;
    const canonicalRoot = realpathSync(root.fsPath);
    const canonicalTarget = realpathSync(target.fsPath);
    const within = relative(canonicalRoot, canonicalTarget);
    return (
      within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within) && statSync(canonicalTarget).isFile()
    );
  } catch {
    return false;
  }
}
