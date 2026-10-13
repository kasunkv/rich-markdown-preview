import { reportAsync } from './async';
import * as vscode from 'vscode';

export interface DocumentationFile {
  id: string;
  root: string;
  rootName: string;
  path: string;
}
export const markdownPattern = '**/*.{md,MD,markdown,MARKDOWN}';
export const defaultDocumentationExclude =
  '**/{.git,node_modules,bower_components,dist,build,out,coverage,.next,.venv,venv}/**';

/** Index paths only. Text is opened on demand by the preview session. */
export class DocumentationIndex implements vscode.Disposable {
  files: DocumentationFile[] = [];
  private targets = new Map<string, vscode.Uri>();
  private subscriptions: vscode.Disposable[] = [];
  private watchers: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cancellation: vscode.CancellationTokenSource | undefined;
  private disposed = false;
  private generation = 0;

  constructor(
    private changed: (status: { loading: boolean; error?: string }) => void,
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
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers = [];
    for (const root of vscode.workspace.workspaceFolders ?? []) {
      // Watch directories too: deleting or renaming a parent must prune its documents.
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
      const schedule = () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => reportAsync(this.refresh()), 350);
      };
      this.watchers.push(watcher, watcher.onDidCreate(schedule), watcher.onDidDelete(schedule));
    }
  }

  async refresh() {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.cancellation?.cancel();
    this.cancellation?.dispose();
    const cancellation = (this.cancellation = new vscode.CancellationTokenSource());
    this.changed({ loading: true });
    try {
      const groups = await Promise.all(
        (vscode.workspace.workspaceFolders ?? []).map(async (root) => {
          const config = vscode.workspace.getConfiguration('richMarkdownPreview', root.uri);
          const include = config.get<string>('documentation.include', markdownPattern);
          const exclude = config.get<string>('documentation.exclude', defaultDocumentationExclude);
          // An explicit exclusion bypasses files.exclude. Dotfolders and gitignored docs remain discoverable.
          const uris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(root, include),
            exclude || null,
            undefined,
            cancellation.token,
          );
          return uris
            .filter((uri) => /\.(md|markdown)$/i.test(uri.path))
            .map((uri) => ({
              uri,
              file: {
                id: uri.toString(),
                root: root.uri.toString(),
                rootName: root.name,
                path: uri.path.slice(root.uri.path.replace(/\/$/, '').length + 1),
              },
            }));
        }),
      );
      if (this.disposed || generation !== this.generation) return;
      const entries = groups.flat();
      this.targets = new Map(entries.map((entry) => [entry.file.id, entry.uri]));
      this.files = entries
        .map((entry) => entry.file)
        .sort((a, b) => a.root.localeCompare(b.root) || a.path.localeCompare(b.path, undefined, { numeric: true }));
      this.changed({ loading: false });
    } catch {
      if (this.disposed || generation !== this.generation) return;
      try {
        this.diagnostic?.();
      } catch {
        // A closed diagnostic sink cannot interrupt the user-facing error result.
      }
      this.changed({
        loading: false,
        error: 'Could not refresh documentation. Retry and check workspace access.',
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
