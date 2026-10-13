import { reportAsync } from './async';
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { renderMarkdown } from './render';
import { resolveSourceFragment, fragmentWarning } from './fragment-navigation';
import { parseResourceUrl } from './resource-url';
import { previewStyles } from './styles';
import { referencePaths, type FileReference } from './references';
import { homedir } from 'node:os';
import { DocumentationIndex } from './documentation';
import { numericPreferenceRanges } from './preference-ranges';
import { previewResourceRoots, resolveImageResource } from './resources';

const defaults = {
  style: 'documentation',
  appearance: 'auto',
  contentWidth: 900,
  fontSize: 16,
  lineHeight: 1.7,
  wrapCode: false,
};
type Preferences = typeof defaults;
const enums: Record<string, readonly string[]> = {
  style: previewStyles.map((style) => style.id),
  appearance: ['auto', 'light', 'dark'],
};
const ranges: Record<string, readonly number[]> = {
  contentWidth: numericPreferenceRanges.contentWidth,
  fontSize: numericPreferenceRanges.fontSize,
  lineHeight: numericPreferenceRanges.lineHeight,
};
function validPreference(setting: unknown, value: unknown): boolean {
  return (
    typeof setting === 'string' &&
    ((Object.hasOwn(enums, setting) && typeof value === 'string' && enums[setting].includes(value)) ||
      (Object.hasOwn(ranges, setting) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= ranges[setting][0] &&
        value <= ranges[setting][1]) ||
      (setting === 'wrapCode' && typeof value === 'boolean'))
  );
}
function preferences(uri: vscode.Uri): Preferences {
  const config = vscode.workspace.getConfiguration('richMarkdownPreview', uri);
  const previous = vscode.workspace.getConfiguration('markdownLens', uri);
  const legacy = vscode.workspace.getConfiguration('styledMarkdown', uri);
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => {
      const inspected = config.inspect(key);
      const configured =
        inspected &&
        [inspected.globalValue, inspected.workspaceValue, inspected.workspaceFolderValue].some(
          (value) => value !== undefined,
        );
      const value = configured ? config.get(key, fallback) : previous.get(key, legacy.get(key, fallback));
      return [key, validPreference(key, value) ? value : fallback];
    }),
  ) as Preferences;
}
export function activate(context: vscode.ExtensionContext) {
  const panels = new Map<string, vscode.WebviewPanel>();
  const status = vscode.window.createStatusBarItem(
    'richMarkdownPreview.documentationHome',
    vscode.StatusBarAlignment.Left,
    10,
  );
  status.name = 'Rich Markdown Documentation';
  status.text = '$(markdown) Rich Markdown Documentation';
  status.tooltip = 'Open Documentation Home — Rich Markdown Preview';
  status.command = 'richMarkdownPreview.openDocumentationHome';
  const updateStatus = () => {
    if (
      vscode.workspace.workspaceFolders?.length &&
      vscode.workspace.getConfiguration('richMarkdownPreview').get('documentation.showStatusBar', true)
    )
      status.show();
    else status.hide();
  };
  updateStatus();
  context.subscriptions.push(
    status,
    vscode.workspace.onDidChangeWorkspaceFolders(updateStatus),
    vscode.workspace.onDidChangeConfiguration(updateStatus),
  );
  const openPreview = async (uri?: vscode.Uri, documentationHome = false) => {
    const homeKey = 'richMarkdownPreview.documentationHome';
    if (documentationHome) {
      const existing = panels.get(homeKey);
      if (existing) {
        existing.reveal(vscode.ViewColumn.Active);
        return;
      }
      if (!vscode.workspace.workspaceFolders?.length) {
        reportAsync(vscode.window.showInformationMessage('Open a folder or workspace to browse its documentation.'));
        return;
      }
    }
    let document: vscode.TextDocument | undefined;
    try {
      document = documentationHome
        ? undefined
        : uri
          ? await vscode.workspace.openTextDocument(uri)
          : vscode.window.activeTextEditor?.document;
    } catch {
      reportAsync(vscode.window.showWarningMessage('Could not open the selected Markdown file.'));
      return;
    }
    if (
      !documentationHome &&
      (!document || (document.languageId !== 'markdown' && !/\.md$/i.test(document.uri.path)))
    ) {
      reportAsync(vscode.window.showInformationMessage('Open a Markdown file first.'));
      return;
    }
    const preferenceUri = () => document?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri ?? context.extensionUri;
    const openToSide =
      !documentationHome &&
      vscode.workspace
        .getConfiguration('richMarkdownPreview', preferenceUri())
        .get<boolean>('openPreviewToSide', true) !== false;
    const viewColumn = openToSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
    const key = documentationHome ? homeKey : document!.uri.toString();
    const existing = panels.get(key);
    if (existing) {
      existing.reveal(viewColumn);
      return;
    }
    let directory = document ? vscode.Uri.joinPath(document.uri, '..') : preferenceUri();
    const panel = vscode.window.createWebviewPanel(
      documentationHome ? homeKey : 'richMarkdownPreview.preview',
      documentationHome ? 'Documentation Home' : `Rich Markdown Preview: ${document!.fileName.split(/[\\/]/).pop()}`,
      viewColumn,
      {
        enableScripts: true,
        localResourceRoots: previewResourceRoots(context.extensionUri, document?.uri),
      },
    );
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'rich-markdown-preview.png');
    panels.set(key, panel);
    const webview = panel.webview;
    const sessionPreferences: Partial<Preferences> = {};
    const effectivePreferences = () => ({ ...preferences(preferenceUri()), ...sessionPreferences });
    const nonce = randomBytes(16).toString('hex');
    let fileReferences: FileReference[] = [];
    const resource = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', file));
    webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};"><link rel="stylesheet" href="${resource('preview.css')}"><title>Rich Markdown Preview</title></head><body><div id="rmp-ui-app" data-logo="${webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'assets', 'rich-markdown-preview.png'))}"></div><script nonce="${nonce}" src="${resource('preview.js')}"></script></body></html>`;
    let index: DocumentationIndex | undefined;
    let indexStatus: { loading: boolean; error?: string } = { loading: true };
    let disposed = false;
    let navigation = 0;
    const history: { id?: string; fragment?: string }[] = [{}];
    let historyPosition = 0;
    let fragment: string | undefined;
    let sentFiles: DocumentationIndex['files'] | undefined;
    let sentNavigation = '';
    const sendNavigation = (force = false) => {
      if (!index) return;
      const snapshot = JSON.stringify([document?.uri.toString(), historyPosition, history.length, indexStatus]);
      if (!force && index.files === sentFiles && snapshot === sentNavigation) return;
      sentFiles = index.files;
      sentNavigation = snapshot;
      reportAsync(
        webview.postMessage({
          type: 'documentation',
          files: index.files,
          ...indexStatus,
          active: document?.uri.toString(),
          canBack: historyPosition > 0,
          canForward: historyPosition < history.length - 1,
        }),
      );
    };
    const update = () => {
      if (!document) {
        fileReferences = [];
        reportAsync(
          webview.postMessage({
            type: 'render',
            html: '',
            outline: [],
            preferences: effectivePreferences(),
            documentationHome: true,
            documentId: 'home',
          }),
        );
        sendNavigation(true);
        return;
      }
      const result = renderMarkdown(document.getText(), (src) => resolveImageResource(src, document!.uri, webview));
      fileReferences = result.references;
      reportAsync(
        webview.postMessage({
          type: 'render',
          ...result,
          preferences: effectivePreferences(),
          documentId: document.uri.toString(),
          fragment,
          ...(documentationHome ? { documentationHome: true, documentId: document.uri.toString(), fragment } : {}),
        }),
      );
      fragment = undefined;
      sendNavigation();
    };
    const navigate = async (target?: vscode.Uri, anchor?: string, position?: number) => {
      const request = ++navigation;
      try {
        const next = target ? await vscode.workspace.openTextDocument(target) : undefined;
        if (disposed || request !== navigation) return;
        document = next;
        if (next && anchor) {
          const warning = fragmentWarning(resolveSourceFragment(next.getText(), anchor));
          if (warning) reportAsync(vscode.window.showWarningMessage(warning));
        }
        fragment = anchor;
        directory = document ? vscode.Uri.joinPath(document.uri, '..') : preferenceUri();
        webview.options = {
          enableScripts: true,
          localResourceRoots: previewResourceRoots(context.extensionUri, document?.uri),
        };
        if (position !== undefined) historyPosition = position;
        else {
          const entry = { id: target?.toString(), fragment: anchor };
          if (history[historyPosition].id !== entry.id || history[historyPosition].fragment !== entry.fragment) {
            history.splice(historyPosition + 1);
            history.push(entry);
            historyPosition = history.length - 1;
          }
        }
        panel.title = document ? `Documentation: ${document.fileName.split(/[\\/]/).pop()}` : 'Documentation Home';
        update();
      } catch {
        reportAsync(
          vscode.window.showWarningMessage('Could not open this document. It may have moved or been deleted.'),
        );
      }
    };
    const openTarget = async (target: vscode.Uri, anchor = '') => {
      if (document && target.toString() === document.uri.toString()) {
        const warning = fragmentWarning(resolveSourceFragment(document.getText(), anchor));
        if (warning) reportAsync(vscode.window.showWarningMessage(warning));
        fragment = anchor;
        update();
      } else if (
        documentationHome &&
        /\.(md|markdown)$/i.test(target.path) &&
        vscode.workspace.getWorkspaceFolder(target)
      ) {
        await navigate(target, anchor);
      } else if (anchor && /\.(md|markdown)$/i.test(target.path)) {
        const source = await vscode.workspace.openTextDocument(target);
        const resolved = resolveSourceFragment(source.getText(), anchor);
        const warning = fragmentWarning(resolved);
        if (warning) reportAsync(vscode.window.showWarningMessage(warning));
        if (resolved.kind === 'heading') {
          const selection = new vscode.Range(resolved.line, 0, resolved.line, 0);
          const editor = await vscode.window.showTextDocument(source, { selection });
          editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        } else await vscode.window.showTextDocument(source);
      } else {
        if (anchor) {
          const resolved = resolveSourceFragment('', anchor);
          reportAsync(
            vscode.window.showWarningMessage(
              resolved.kind === 'unsupported-line' || resolved.kind === 'malformed'
                ? fragmentWarning(resolved)!
                : 'Heading navigation is supported only for Markdown files. Open the source to locate this section.',
            ),
          );
        }
        await vscode.commands.executeCommand('vscode.open', target);
      }
    };
    if (documentationHome)
      index = new DocumentationIndex((status) => {
        indexStatus = status;
        sendNavigation();
        if (!status.loading && !status.error && document && !index?.resolve(document.uri.toString())) {
          const selected = document;
          if (!vscode.workspace.getWorkspaceFolder(selected.uri)) reportAsync(navigate());
          else
            reportAsync(
              vscode.workspace.fs.stat(selected.uri).then(
                () => {},
                () => {
                  if (!disposed && document === selected) reportAsync(navigate());
                },
              ),
            );
        }
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updatePreferences = () =>
      reportAsync(webview.postMessage({ type: 'preferences', preferences: effectivePreferences() }));
    let preferenceWrites = Promise.resolve();
    const disposables = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === document?.uri.toString()) {
          clearTimeout(timer);
          timer = setTimeout(update, 180);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          ['richMarkdownPreview', 'markdownLens', 'styledMarkdown'].some((section) =>
            event.affectsConfiguration(section, preferenceUri()),
          )
        )
          updatePreferences();
      }),
      panel.onDidChangeViewState(() => {
        if (panel.visible) update();
      }),
      webview.onDidReceiveMessage(async (message) => {
        try {
          if (!message || typeof message !== 'object') return;
          if (message.type === 'ready') {
            sentFiles = undefined;
            update();
            if (index) await index.refresh();
          }
          if (message.type === 'documentationAction' && index) {
            if (message.action === 'open' && typeof message.id === 'string') {
              const target = index.resolve(message.id);
              if (target) await navigate(target);
            }
            if (message.action === 'home') await navigate();
            if (message.action === 'refresh') await index.refresh();
            if (message.action === 'source' && document)
              await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
            if (message.action === 'back' || message.action === 'forward') {
              const position = historyPosition + (message.action === 'back' ? -1 : 1);
              if (position >= 0 && position < history.length) {
                const entry = history[position];
                await navigate(entry.id ? vscode.Uri.parse(entry.id) : undefined, entry.fragment, position);
              }
            }
            return;
          }
          if (message.type === 'reference' && typeof message.id === 'string') {
            const reference = fileReferences.find((item) => item.id === message.id);
            if (!reference) return;
            if (/^https?:\/\//i.test(reference.path)) {
              try {
                await vscode.env.openExternal(vscode.Uri.parse(reference.path));
              } catch {
                reportAsync(vscode.window.showWarningMessage('Could not open this reference.'));
              }
              return;
            }
            const workspaceRoot = vscode.workspace.getWorkspaceFolder(preferenceUri())?.uri ?? directory;
            const rootSetting = vscode.workspace
              .getConfiguration('richMarkdownPreview', preferenceUri())
              .get<string>('referenceRoot', '');
            const root = rootSetting
              ? /^[a-z]:[\\/]/i.test(rootSetting)
                ? vscode.Uri.file(rootSetting)
                : vscode.Uri.joinPath(workspaceRoot, rootSetting)
              : workspaceRoot;
            for (const candidate of referencePaths(reference)) {
              let path: string;
              try {
                path = decodeURIComponent(candidate).replace(/\\/g, '/');
              } catch {
                continue;
              }
              if (
                !path ||
                /[\u0000-\u001f]/.test(path) ||
                path.startsWith('//') ||
                (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:\//i.test(path))
              )
                continue;
              const target = /^[a-z]:\//i.test(path)
                ? vscode.Uri.file(path)
                : path.startsWith('~/')
                  ? vscode.Uri.file(`${homedir()}/${path.slice(2)}`)
                  : path.startsWith('/')
                    ? vscode.Uri.joinPath(root, path.slice(1))
                    : vscode.Uri.joinPath(directory, path);
              try {
                const stat = await vscode.workspace.fs.stat(target);
                if (stat.type & vscode.FileType.Directory) continue;
                await openTarget(target, parseResourceUrl(reference.path).fragment);
                return;
              } catch {
                /* Try the dialect's next candidate. */
              }
            }
            reportAsync(
              vscode.window.showWarningMessage(
                `Could not open referenced file: ${reference.path}. Check its path or Rich Markdown Preview: Reference Root.`,
              ),
            );
            return;
          }
          if (message.type === 'preference') {
            const { key: setting, value } = message;
            if (validPreference(setting, value)) {
              const preferenceKey = setting as keyof Preferences;
              const settingUri = preferenceUri();
              Object.assign(sessionPreferences, { [preferenceKey]: value });
              preferenceWrites = preferenceWrites
                .then(async () => {
                  await vscode.workspace
                    .getConfiguration('richMarkdownPreview', settingUri)
                    .update(
                      setting,
                      value,
                      vscode.workspace.getWorkspaceFolder(settingUri)
                        ? vscode.ConfigurationTarget.WorkspaceFolder
                        : vscode.ConfigurationTarget.Global,
                    );
                  if (sessionPreferences[preferenceKey] === value) delete sessionPreferences[preferenceKey];
                  updatePreferences();
                })
                .catch((error) => {
                  updatePreferences();
                  const detail = error instanceof Error ? error.message : String(error);
                  reportAsync(
                    vscode.window.showWarningMessage(`Preview updated, but the setting could not be saved: ${detail}`),
                  );
                });
            }
          }
          if (message.type === 'copy' && typeof message.text === 'string') {
            try {
              await vscode.env.clipboard.writeText(message.text);
              reportAsync(webview.postMessage({ type: 'copyResult', success: true }));
            } catch {
              reportAsync(webview.postMessage({ type: 'copyResult', success: false }));
            }
          }
          if (['tableCopy', 'tableExport'].includes(message.type) && typeof message.text === 'string') {
            try {
              if (message.type === 'tableCopy') await vscode.env.clipboard.writeText(message.text);
              else {
                const filename =
                  typeof message.filename === 'string' && /^table-\d+\.csv$/.test(message.filename)
                    ? message.filename
                    : 'table.csv';
                const destination = await vscode.window.showSaveDialog({
                  defaultUri: vscode.Uri.joinPath(directory, filename),
                  filters: { 'CSV files': ['csv'] },
                  saveLabel: 'Export CSV',
                });
                if (!destination) {
                  reportAsync(
                    webview.postMessage({ type: 'tableActionResult', action: message.type, cancelled: true }),
                  );
                  return;
                }
                await vscode.workspace.fs.writeFile(destination, Buffer.from('\uFEFF' + message.text, 'utf8'));
              }
              reportAsync(webview.postMessage({ type: 'tableActionResult', action: message.type, success: true }));
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error);
              reportAsync(vscode.window.showWarningMessage(`Table action failed: ${detail}`));
              reportAsync(
                webview.postMessage({ type: 'tableActionResult', action: message.type, success: false, error: detail }),
              );
            }
          }
          if (message.type === 'link' && typeof message.href === 'string') {
            const href = message.href;
            if (/^(https?:|mailto:)/i.test(href)) {
              try {
                await vscode.env.openExternal(vscode.Uri.parse(href));
              } catch {
                reportAsync(vscode.window.showWarningMessage('Could not open this link.'));
              }
            } else if (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('//')) {
              try {
                const parts = parseResourceUrl(href);
                const path = decodeURIComponent(parts.path);
                if (/[\u0000-\u001f]/.test(path) || path.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(path)) return;
                await openTarget(parts.path ? vscode.Uri.joinPath(directory, path) : document!.uri, parts.fragment);
              } catch {
                reportAsync(vscode.window.showWarningMessage('Could not open this link.'));
              }
            }
          }
        } catch (error) {
          console.error('Rich Markdown Preview message failed:', error);
        }
      }),
    ];
    panel.onDidDispose(() => {
      disposed = true;
      ++navigation;
      index?.dispose();
      clearTimeout(timer);
      panels.delete(key);
      disposables.forEach((d) => d.dispose());
    });
    context.subscriptions.push(panel);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('richMarkdownPreview.openDocumentationHome', () => openPreview(undefined, true)),
    vscode.commands.registerCommand('richMarkdownPreview.openPreview', (uri?: vscode.Uri) => openPreview(uri)),
    vscode.commands.registerCommand('markdownLens.openPreview', (uri?: vscode.Uri) => openPreview(uri)),
    vscode.commands.registerCommand('styledMarkdown.openPreview', (uri?: vscode.Uri) => openPreview(uri)),
  );
}
