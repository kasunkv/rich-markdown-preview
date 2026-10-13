import { reportAsync } from './async';
import * as vscode from 'vscode';
import { minimatch } from 'minimatch';
import { discoverProviderMarkdownBounded } from './provider-discovery';
import { sameProviderWithin } from './provider-paths';

export interface DocumentationFile {
  id: string;
  root: string;
  rootName: string;
  path: string;
}
export const markdownPattern = '**/*.{md,MD,markdown,MARKDOWN}';
export const defaultDocumentationExclude =
  '**/{.git,node_modules,bower_components,dist,build,out,coverage,.next,.venv,venv}/**';
/** A single navigation snapshot and message contains at most this many documents. */
export const documentationResultLimit = 10000;

const markdownFile = /\.(md|markdown)$/i;
const defaultExcludedDirectory = /^(\.git|node_modules|bower_components|dist|build|out|coverage|\.next|\.venv|venv)$/i;

export function relativeDocumentationPath(root: vscode.Uri, uri: vscode.Uri): string | undefined {
  if (!sameProviderWithin(root, uri)) return undefined;
  const prefix = root.path.replace(/\/$/, '') + '/';
  return uri.path.startsWith(prefix) ? uri.path.slice(prefix.length) : undefined;
}

/** Index paths only. Text is opened on demand by the preview session. */
export class DocumentationIndex implements vscode.Disposable {
  files: DocumentationFile[] = [];
  snapshot = 0;
  private targets = new Map<string, vscode.Uri>();
  private indexedPaths = new Set<string>();
  private subscriptions: vscode.Disposable[] = [];
  private watchers: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cancellation: vscode.CancellationTokenSource | undefined;
  private disposed = false;
  private generation = 0;
  private watchRevision = 0;

  constructor(
    private changed: (status: { loading: boolean; error?: string; truncated?: boolean; complete?: boolean }) => void,
    private readonly diagnostic?: () => void,
  ) {
    this.watch();
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.watch();
        reportAsync(this.refresh());
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('richMarkdownPreview.documentation')) reportAsync(this.refresh());
      }),
    );
  }

  private watch() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const revision = ++this.watchRevision;
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers = [];
    for (const root of vscode.workspace.workspaceFolders ?? []) {
      // Watch directories too: deleting or renaming a parent must prune its documents.
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
      const schedule = () => {
        if (
          this.disposed ||
          revision !== this.watchRevision ||
          !vscode.workspace.workspaceFolders?.some((folder) => folder.uri.toString() === root.uri.toString())
        )
          return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => reportAsync(this.refresh()), 350);
      };
      const relevant = (uri: vscode.Uri) => {
        const path = relativeDocumentationPath(root.uri, uri);
        if (!path) return undefined;
        const config = vscode.workspace.getConfiguration('richMarkdownPreview', root.uri);
        const exclude = config.get<string>('documentation.exclude', defaultDocumentationExclude);
        if (
          (exclude === defaultDocumentationExclude &&
            path.split('/').some((part) => defaultExcludedDirectory.test(part))) ||
          (exclude &&
            (minimatch(path, exclude, { dot: true, noext: true, nonegate: true, nocomment: true }) ||
              minimatch(`${path}/`, exclude, { dot: true, noext: true, nonegate: true, nocomment: true })))
        )
          return undefined;
        return path;
      };
      const created = (uri: vscode.Uri) => {
        const path = relevant(uri);
        if (!path) return;
        const include = vscode.workspace
          .getConfiguration('richMarkdownPreview', root.uri)
          .get<string>('documentation.include', markdownPattern);
        if (
          markdownFile.test(path) &&
          minimatch(path, include, { dot: true, noext: true, nonegate: true, nocomment: true })
        ) {
          schedule();
          return;
        }
        // A new folder may arrive already populated (including a renamed folder).
        reportAsync(
          vscode.workspace.fs.stat(uri).then(
            (stat) => {
              if (
                !this.disposed &&
                stat.type & vscode.FileType.Directory &&
                !(stat.type & vscode.FileType.SymbolicLink)
              )
                schedule();
            },
            () => undefined,
          ),
        );
      };
      const deleted = (uri: vscode.Uri) => {
        const path = relevant(uri);
        if (path && (markdownFile.test(path) || this.indexedPaths.has(`${root.uri.toString()}\0${path}`))) schedule();
      };
      this.watchers.push(watcher, watcher.onDidCreate(created), watcher.onDidDelete(deleted));
    }
  }

  async refresh() {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const generation = ++this.generation;
    this.cancellation?.cancel();
    this.cancellation?.dispose();
    const cancellation = (this.cancellation = new vscode.CancellationTokenSource());
    this.changed({ loading: true });
    try {
      const entries: { uri: vscode.Uri; file: DocumentationFile }[] = [];
      let truncated = false;
      let complete = true;
      for (const root of vscode.workspace.workspaceFolders ?? []) {
        if (cancellation.token.isCancellationRequested) return;
        const config = vscode.workspace.getConfiguration('richMarkdownPreview', root.uri);
        const include = config.get<string>('documentation.include', markdownPattern);
        const exclude = config.get<string>('documentation.exclude', defaultDocumentationExclude);
        // An explicit exclusion bypasses files.exclude. Dotfolders and gitignored docs remain discoverable.
        const remaining = Math.max(0, documentationResultLimit - entries.length);
        const provider = root.uri.scheme !== 'file' && root.uri.scheme !== 'vscode-remote';
        const result = provider
          ? await discoverProviderMarkdownBounded(root.uri, include, exclude, cancellation.token, remaining)
          : undefined;
        const uris =
          result?.uris ??
          (await vscode.workspace.findFiles(
            new vscode.RelativePattern(root, include),
            exclude || null,
            remaining + 1,
            cancellation.token,
          ));
        if (
          cancellation.token.isCancellationRequested ||
          !vscode.workspace.workspaceFolders?.some((folder) => folder.uri.toString() === root.uri.toString())
        )
          return;
        if (uris.length > remaining || result?.truncated) truncated = true;
        if (result?.complete === false) complete = false;
        for (const uri of uris) {
          const path = relativeDocumentationPath(root.uri, uri);
          if (!path || !markdownFile.test(path)) continue;
          if (entries.length >= documentationResultLimit) {
            truncated = true;
            break;
          }
          entries.push({
            uri,
            file: {
              id: uri.toString(),
              root: root.uri.toString(),
              rootName: root.name,
              path,
            },
          });
        }
      }
      if (this.disposed || generation !== this.generation) return;
      this.targets = new Map(entries.map((entry) => [entry.file.id, entry.uri]));
      this.indexedPaths = new Set();
      for (const entry of entries) {
        const path = entry.file.path;
        const root = entry.file.root;
        this.indexedPaths.add(`${root}\0${path}`);
        let slash = path.indexOf('/');
        while (slash >= 0) {
          this.indexedPaths.add(`${root}\0${path.slice(0, slash)}`);
          slash = path.indexOf('/', slash + 1);
        }
      }
      this.files = entries
        .map((entry) => entry.file)
        .sort((a, b) => a.root.localeCompare(b.root) || a.path.localeCompare(b.path, undefined, { numeric: true }));
      this.snapshot++;
      this.changed({ loading: false, truncated, complete: complete && !truncated });
    } catch {
      if (this.disposed || generation !== this.generation) return;
      try {
        this.diagnostic?.();
      } catch {
        // A closed diagnostic sink cannot interrupt the user-facing error result.
      }
      this.changed({
        loading: false,
        error:
          'Could not refresh documentation. Retry and check workspace access. Narrow the documentation include/exclude settings if provider discovery exceeds its limits.',
      });
    }
  }

  resolve(id: string) {
    return this.targets.get(id);
  }

  dispose() {
    this.disposed = true;
    ++this.generation;
    clearTimeout(this.timer);
    this.cancellation?.cancel();
    this.cancellation?.dispose();
    [...this.subscriptions, ...this.watchers].forEach((item) => item.dispose());
  }
}
