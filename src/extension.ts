import { validateWebviewMessage, normalizeCSV, validLink, messageLimits, type HostMessage } from './messages';
import { reportAsync as observeAsync } from './async';
import { PreviewSession, PreviewHostBridge, PreviewNavigationAdapter, sessionDiagnostic } from './preview-session';
import { PreviewPreferenceStore } from './preview-preferences';
import { ExternalImagePermissions, externalImageCspOrigins } from './external-images';
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
  const output = vscode.window.createOutputChannel('Rich Markdown Preview');
  const lifecycle = new PreviewSession(sessionDiagnostic(output));
  const reportAsync = (operation: PromiseLike<unknown> | unknown) =>
    observeAsync(operation, () => lifecycle.fail('host operation'));
  context.subscriptions.push(output, lifecycle);
  const panels = new Map<string, vscode.WebviewPanel>();
  const externalImageRefreshers = new Set<() => void>();
  const externalImagePermissions = new ExternalImagePermissions(
    {
      get: (key) => lifecycle.boundary('read external image permissions', () => context.globalState.get(key)),
      update: (key, value) => context.globalState.update(key, value),
    },
    () => {
      for (const refresh of externalImageRefreshers) refresh();
    },
  );
  const status = vscode.window.createStatusBarItem(
    'richMarkdownPreview.documentationHome',
    vscode.StatusBarAlignment.Left,
    10,
  );
  status.name = 'Rich Markdown Documentation';
  status.text = '$(markdown) Rich Markdown Documentation';
  status.tooltip = 'Open Documentation Home — Rich Markdown Preview';
  status.command = 'richMarkdownPreview.openDocumentationHome';
  const updateStatus = () =>
    lifecycle.boundary('update documentation status', () => {
      if (
        vscode.workspace.workspaceFolders?.length &&
        vscode.workspace.getConfiguration('richMarkdownPreview').get('documentation.showStatusBar', true)
      )
        status.show();
      else status.hide();
    });
  updateStatus();
  context.subscriptions.push(
    status,
    vscode.workspace.onDidChangeWorkspaceFolders(updateStatus),
    vscode.workspace.onDidChangeConfiguration(updateStatus),
  );
  const openPreview = async (uri?: vscode.Uri, documentationHome = false) => {
    const opening = lifecycle.capture();
    if (!lifecycle.current(opening)) return;
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
      if (!lifecycle.current(opening)) return;
      lifecycle.fail('open selected Markdown file');
      reportAsync(vscode.window.showWarningMessage('Could not open the selected Markdown file.'));
      return;
    }
    if (!lifecycle.current(opening)) return;
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
        enableFindWidget: true,
        localResourceRoots: previewResourceRoots(context.extensionUri, document?.uri),
      },
    );
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'rich-markdown-preview.png');
    panels.set(key, panel);
    const webview = panel.webview;
    const session = new PreviewSession(sessionDiagnostic(output));
    const bridge = new PreviewHostBridge(session, (message) => webview.postMessage(message));
    const post = (message: HostMessage, generation = session.capture()) => bridge.post(message, generation);
    const navigationAdapter = new PreviewNavigationAdapter(session);
    const preferenceStore = new PreviewPreferenceStore(session, () => preferences(preferenceUri()), defaults);
    const effectivePreferences = () => preferenceStore.effective();
    const nonce = randomBytes(16).toString('hex');
    let fileReferences: FileReference[] = [];
    let externalImageOrigins = new Set<string>();
    // Spec 020 can supply the same trust/suspension input to both rendering and CSP.
    const remoteImagePolicy = () => ({ grants: externalImagePermissions.grants, enabled: true });
    const resource = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', file));
    const setWebviewHtml = () => {
      const policy = remoteImagePolicy();
      webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: ${externalImageCspOrigins(policy.grants, policy.enabled)}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};"><link rel="stylesheet" href="${resource('preview.css')}"><title>Rich Markdown Preview</title></head><body><div id="rmp-ui-app" data-logo="${webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'assets', 'rich-markdown-preview.png'))}"></div><script nonce="${nonce}" src="${resource('preview.js')}"></script></body></html>`;
    };
    setWebviewHtml();
    let index: DocumentationIndex | undefined;
    let indexStatus: { loading: boolean; error?: string } = { loading: true };
    const history: { id?: string; fragment?: string }[] = [{}];
    let historyPosition = 0;
    let fragment: string | undefined;
    let sentFiles: DocumentationIndex['files'] | undefined;
    let sentNavigation = '';
    const sendNavigation = (force = false) => {
      if (!session.current() || !index) return;
      const snapshot = JSON.stringify([document?.uri.toString(), historyPosition, history.length, indexStatus]);
      if (!force && index.files === sentFiles && snapshot === sentNavigation) return;
      const files = index.files;
      const request = session.capture();
      const message: HostMessage = {
        type: 'documentation',
        files,
        ...indexStatus,
        active: document?.uri.toString(),
        canBack: historyPosition > 0,
        canForward: historyPosition < history.length - 1,
      };
      reportAsync(
        session.run(
          'send documentation navigation',
          async () => {
            const delivered = await post(message, request);
            if (!session.current(request) || !delivered) return;
            sentFiles = files;
            sentNavigation = snapshot;
          },
          request,
        ),
      );
    };
    let renderId = '';
    let renderRevision = 0;
    let renderedDocumentId = '';
    let renderedSource = '';
    const refreshModelIdentity = (source = document?.getText() ?? '') => {
      const identity = document?.uri.toString() ?? 'home';
      if (!renderId || identity !== renderedDocumentId || source !== renderedSource) {
        externalImageOrigins.clear();
        renderedDocumentId = identity;
        renderedSource = source;
        renderId = nonce + '_' + ++renderRevision;
      }
      return source;
    };
    const resetExternalImagePolicy = () =>
      session.boundary('reset external image policy', () => {
        session.supersede();
        renderId = '';
        fileReferences = [];
        externalImageOrigins.clear();
        setWebviewHtml();
      });
    externalImageRefreshers.add(resetExternalImagePolicy);
    session.own({
      dispose: () => {
        externalImageRefreshers.delete(resetExternalImagePolicy);
      },
    });
    const update = () =>
      session.boundary('render Markdown', () => {
        const source = refreshModelIdentity();
        if (!document) {
          fileReferences = [];
          reportAsync(
            post({
              type: 'render',
              renderId,
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
        const result = renderMarkdown(
          source,
          (src) => resolveImageResource(src, document!.uri, webview),
          remoteImagePolicy(),
        );
        fileReferences = result.references;
        externalImageOrigins = new Set(result.externalImageOrigins);
        reportAsync(
          post({
            type: 'render',
            renderId,
            ...result,
            preferences: effectivePreferences(),
            documentId: document.uri.toString(),
            fragment,
            ...(documentationHome ? { documentationHome: true, documentId: document.uri.toString(), fragment } : {}),
          }),
        );
        fragment = undefined;
        sendNavigation();
      });
    const navigate = async (target?: vscode.Uri, anchor?: string, position?: number) => {
      const request = session.supersede();
      const acceptedModel = renderId;
      const currentModel = () => session.current(request) && acceptedModel === renderId;
      try {
        const next = target
          ? await navigationAdapter.resolve('open document', () => vscode.workspace.openTextDocument(target), request)
          : undefined;
        if (!currentModel()) return;
        if (target && !next) {
          reportAsync(
            vscode.window.showWarningMessage('Could not open this document. It may have moved or been deleted.'),
          );
          return;
        }
        if (next && anchor) {
          const resolved = session.boundary('parse source heading', () =>
            resolveSourceFragment(next.getText(), anchor),
          );
          if (!resolved) return;
          const warning = fragmentWarning(resolved);
          if (warning) reportAsync(vscode.window.showWarningMessage(warning));
        }
        document = next;
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
        if (!currentModel()) return;
        session.fail('navigate document');
        reportAsync(
          vscode.window.showWarningMessage('Could not open this document. It may have moved or been deleted.'),
        );
      }
    };
    const openTarget = async (target: vscode.Uri, anchor = '') => {
      if (!session.current()) return;
      const request = session.supersede();
      const acceptedModel = renderId;
      const currentModel = () => session.current(request) && acceptedModel === renderId;
      try {
        if (document && target.toString() === document.uri.toString()) {
          const resolved = session.boundary('parse source heading', () =>
            resolveSourceFragment(document!.getText(), anchor),
          );
          if (!resolved) return;
          const warning = fragmentWarning(resolved);
          if (warning) reportAsync(vscode.window.showWarningMessage(warning));
          fragment = anchor;
          update();
        } else if (
          documentationHome &&
          /\.(md|markdown)$/i.test(target.path) &&
          vscode.workspace.getWorkspaceFolder(target)
        ) {
          await navigate(target, anchor);
          // navigate owns the new generation; this operation has no follow-up effects.
          return;
        } else if (anchor && /\.(md|markdown)$/i.test(target.path)) {
          const source = await navigationAdapter.resolve(
            'open source document',
            () => vscode.workspace.openTextDocument(target),
            request,
          );
          if (!currentModel()) return;
          if (!source) {
            reportAsync(vscode.window.showWarningMessage('Could not open this link. Check the target file access.'));
            return;
          }
          const resolved = session.boundary('parse source heading', () =>
            resolveSourceFragment(source.getText(), anchor),
          );
          const warning = resolved
            ? fragmentWarning(resolved)
            : 'Could not locate this heading. Open the source to locate this section.';
          if (warning) reportAsync(vscode.window.showWarningMessage(warning));
          if (resolved?.kind === 'heading') {
            const selection = new vscode.Range(resolved.line, 0, resolved.line, 0);
            const editor = await vscode.window.showTextDocument(source, { selection });
            if (!currentModel()) return;
            editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
          } else {
            await vscode.window.showTextDocument(source);
            if (!currentModel()) return;
          }
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
          if (!currentModel()) return;
        }
      } catch {
        if (!currentModel()) return;
        session.fail('open source target');
        reportAsync(vscode.window.showWarningMessage('Could not open this link. Check the target file access.'));
      }
    };
    if (documentationHome) {
      index = new DocumentationIndex(
        (status) => {
          if (!session.current()) return;
          indexStatus = status;
          sendNavigation();
          if (!status.loading && !status.error && document && !index?.resolve(document.uri.toString())) {
            const selected = document;
            const request = session.capture();
            if (!vscode.workspace.getWorkspaceFolder(selected.uri)) reportAsync(navigate());
            else
              reportAsync(
                session.run(
                  'check selected document',
                  async () => {
                    const stat = await navigationAdapter.resolve(
                      'check selected document',
                      () => vscode.workspace.fs.stat(selected.uri),
                      request,
                    );
                    if (!session.current(request)) return;
                    if (!stat && document === selected) await navigate();
                  },
                  request,
                ),
              );
          }
        },
        () => session.fail('refresh documentation'),
      );
      session.own(index);
    }
    const updatePreferences = () =>
      session.boundary('update preview preferences', () =>
        reportAsync(post({ type: 'preferences', preferences: effectivePreferences() })),
      );
    const disposables = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (session.current() && event.document.uri.toString() === document?.uri.toString()) {
          fileReferences = [];
          renderId = '';
          session.boundary('render Markdown', () => refreshModelIdentity(event.document.getText()));
          session.debounce(update, 180);
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
      webview.onDidReceiveMessage((raw) =>
        bridge.receive(raw, async (message, request) => {
          if (!session.current(request) || !validateWebviewMessage(message)) return;
          if (message.type === 'ready') {
            sentFiles = undefined;
            update();
            if (index) await index.refresh();
            return;
          }
          if (message.renderId !== renderId) return;
          const acceptedRenderId = message.renderId;
          const requestId = message.requestId;
          const currentModel = () => session.current(request) && acceptedRenderId === renderId;
          if (message.type === 'grantExternalImageOrigin' || message.type === 'revokeExternalImageOrigin') {
            const action = message.type === 'grantExternalImageOrigin' ? 'grant' : 'revoke';
            const canChange = () =>
              currentModel() &&
              externalImageOrigins.has(message.origin) &&
              (action === 'revoke' || remoteImagePolicy().enabled);
            try {
              await externalImagePermissions.change(
                action,
                message.origin,
                canChange,
                async (origin) =>
                  (await vscode.window.showWarningMessage(
                    `Allow images from ${origin} in all previews?`,
                    {
                      modal: true,
                      detail:
                        'Image requests can reveal your IP address to this origin. No document referrer is sent. This origin is remembered in your VS Code user storage.',
                    },
                    'Allow images',
                  )) === 'Allow images',
              );
            } catch {
              if (!session.current()) return;
              session.fail('save external image permission');
              reportAsync(
                vscode.window.showWarningMessage(
                  action === 'revoke'
                    ? 'External images are blocked for this session, but the revocation could not be saved. Retry before restarting VS Code.'
                    : 'The image permission could not be saved. Images remain blocked. Check user storage access and retry.',
                ),
              );
            }
            return;
          }
          if (message.type === 'documentationAction' && index) {
            if (message.action === 'open' && typeof message.id === 'string') {
              const target = index.resolve(message.id);
              if (target) await navigate(target);
            }
            if (message.action === 'home') await navigate();
            if (message.action === 'refresh') {
              await index.refresh();
              if (!currentModel()) return;
            }
            if (message.action === 'source' && document) {
              await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
              if (!currentModel()) return;
            }
            if (message.action === 'back' || message.action === 'forward') {
              const position = historyPosition + (message.action === 'back' ? -1 : 1);
              if (position >= 0 && position < history.length) {
                const entry = history[position];
                await navigate(entry.id ? vscode.Uri.parse(entry.id) : undefined, entry.fragment, position);
              }
            }
            return;
          }
          if (message.type === 'reference') {
            const reference = fileReferences.find((item) => item.id === message.id);
            if (!reference) return;
            if (/^https?:\/\//i.test(reference.path)) {
              if (!validLink(reference.path)) return;
              try {
                await vscode.env.openExternal(vscode.Uri.parse(reference.path));
                if (!currentModel()) return;
              } catch {
                if (!currentModel()) return;
                session.fail('open external reference');
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
                path.length > messageLimits.uri ||
                /[\u0000-\u001f\u007f]/.test(path) ||
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
              const stat = await navigationAdapter.resolve(
                'resolve referenced file',
                () => vscode.workspace.fs.stat(target),
                request,
              );
              if (!currentModel() || !fileReferences.includes(reference)) return;
              if (!stat) continue;
              if (stat.type & vscode.FileType.Directory) continue;
              await openTarget(target, parseResourceUrl(reference.path).fragment);
              return;
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
              reportAsync(
                preferenceStore.set(
                  preferenceKey,
                  value,
                  () =>
                    vscode.workspace
                      .getConfiguration('richMarkdownPreview', settingUri)
                      .update(
                        setting,
                        value,
                        vscode.workspace.getWorkspaceFolder(settingUri)
                          ? vscode.ConfigurationTarget.WorkspaceFolder
                          : vscode.ConfigurationTarget.Global,
                      ),
                  updatePreferences,
                  () =>
                    reportAsync(
                      vscode.window.showWarningMessage(
                        'Preview updated, but the setting could not be saved. Check configuration permissions.',
                      ),
                    ),
                ),
              );
            }
          }
          if (message.type === 'copy') {
            try {
              await vscode.env.clipboard.writeText(message.text);
              if (!currentModel()) return;
              reportAsync(post({ type: 'copyResult', requestId, success: true }));
            } catch {
              if (!currentModel()) return;
              session.fail('copy code');
              reportAsync(post({ type: 'copyResult', requestId, success: false }, request));
            }
          }
          if (message.type === 'tableCopy' || message.type === 'tableExport') {
            const csv = normalizeCSV(message.text);
            if (csv === undefined) return;
            try {
              if (message.type === 'tableCopy') {
                await vscode.env.clipboard.writeText(csv);
                if (!currentModel()) return;
              } else {
                const filename = message.filename;
                const destination = await vscode.window.showSaveDialog({
                  defaultUri: vscode.Uri.joinPath(directory, filename),
                  filters: { 'CSV files': ['csv'] },
                  saveLabel: 'Export CSV',
                });
                if (!currentModel()) return;
                if (!destination) {
                  reportAsync(post({ type: 'tableActionResult', requestId, action: message.type, cancelled: true }));
                  return;
                }
                await vscode.workspace.fs.writeFile(destination, Buffer.from('\uFEFF' + csv, 'utf8'));
                if (!currentModel()) return;
              }
              reportAsync(post({ type: 'tableActionResult', requestId, action: message.type, success: true }));
            } catch {
              if (!currentModel()) return;
              session.fail('table action');
              const detail = 'Table action failed. Check clipboard or destination file access and retry.';
              reportAsync(vscode.window.showWarningMessage(detail));
              reportAsync(
                post({ type: 'tableActionResult', requestId, action: message.type, success: false, error: detail }),
              );
            }
          }
          if (message.type === 'link') {
            const href = message.href;
            if (/^(https?:|mailto:)/i.test(href)) {
              try {
                await vscode.env.openExternal(vscode.Uri.parse(href));
                if (!currentModel()) return;
              } catch {
                if (!currentModel()) return;
                session.fail('open link');
                reportAsync(vscode.window.showWarningMessage('Could not open this link.'));
              }
            } else if (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('//')) {
              try {
                const parts = parseResourceUrl(href);
                const path = decodeURIComponent(parts.path);
                if (/[\u0000-\u001f]/.test(path) || path.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(path)) return;
                await openTarget(parts.path ? vscode.Uri.joinPath(directory, path) : document!.uri, parts.fragment);
              } catch {
                if (!currentModel()) return;
                session.fail('open link');
                reportAsync(vscode.window.showWarningMessage('Could not open this link.'));
              }
            }
          }
        }),
      ),
    ];
    disposables.forEach((disposable) => session.own(disposable));
    session.own(
      panel.onDidDispose(() => {
        session.dispose();
        panels.delete(key);
      }),
    );
    context.subscriptions.push(panel);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('richMarkdownPreview.openDocumentationHome', () =>
      lifecycle.run('open documentation preview', () => openPreview(undefined, true)),
    ),
    vscode.commands.registerCommand('richMarkdownPreview.openPreview', (uri?: vscode.Uri) =>
      lifecycle.run('open Markdown preview', () => openPreview(uri)),
    ),
    vscode.commands.registerCommand('markdownLens.openPreview', (uri?: vscode.Uri) =>
      lifecycle.run('open Markdown preview', () => openPreview(uri)),
    ),
    vscode.commands.registerCommand('styledMarkdown.openPreview', (uri?: vscode.Uri) =>
      lifecycle.run('open Markdown preview', () => openPreview(uri)),
    ),
  );
}
