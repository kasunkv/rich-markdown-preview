import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { renderMarkdown } from './render';
import { previewStyles } from './styles';
import { referencePaths, type FileReference } from './references';
import { homedir } from 'node:os';

const defaults = { style: 'documentation', appearance: 'auto', contentWidth: 900, fontSize: 16, lineHeight: 1.7, wrapCode: false };
type Preferences = typeof defaults;
const enums: Record<string, readonly string[]> = { style: previewStyles.map(style => style.id), appearance: ['auto', 'light', 'dark'] };
const ranges: Record<string, readonly number[]> = { contentWidth: [480, 1600], fontSize: [12, 24], lineHeight: [1.3, 2.2] };
function validPreference(setting: unknown, value: unknown): boolean {
  return typeof setting === 'string' && (
    (Object.hasOwn(enums, setting) && typeof value === 'string' && enums[setting].includes(value)) ||
    (Object.hasOwn(ranges, setting) && typeof value === 'number' && Number.isFinite(value) && value >= ranges[setting][0] && value <= ranges[setting][1]) ||
    (setting === 'wrapCode' && typeof value === 'boolean')
  );
}
function preferences(uri: vscode.Uri): Preferences {
  const config = vscode.workspace.getConfiguration('richMarkdownPreview', uri);
  const previous = vscode.workspace.getConfiguration('markdownLens', uri);
  const legacy = vscode.workspace.getConfiguration('styledMarkdown', uri);
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const inspected = config.inspect(key);
    const configured = inspected && [inspected.globalValue, inspected.workspaceValue, inspected.workspaceFolderValue].some(value => value !== undefined);
    const value = configured ? config.get(key, fallback) : previous.get(key, legacy.get(key, fallback));
    return [key, validPreference(key, value) ? value : fallback];
  })) as Preferences;
}
export function activate(context: vscode.ExtensionContext) {
  const panels = new Map<string, vscode.WebviewPanel>();
  const openPreview = async (uri?: vscode.Uri) => {
    let document: vscode.TextDocument | undefined;
    try {
      document = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
    } catch {
      void vscode.window.showWarningMessage('Could not open the selected Markdown file.'); return;
    }
    if (!document || (document.languageId !== 'markdown' && !/\.md$/i.test(document.uri.path))) { void vscode.window.showInformationMessage('Open a Markdown file first.'); return; }
    const openToSide = vscode.workspace.getConfiguration('richMarkdownPreview', document.uri).get<boolean>('openPreviewToSide', true) !== false;
    const viewColumn = openToSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
    const key = document.uri.toString();
    const existing = panels.get(key);
    if (existing) { existing.reveal(viewColumn); return; }
    const directory = vscode.Uri.joinPath(document.uri, '..');
    const panel = vscode.window.createWebviewPanel('richMarkdownPreview.preview', `Rich Markdown Preview: ${document.fileName.split(/[\\/]/).pop()}`, viewColumn, {
      enableScripts: true, localResourceRoots: [context.extensionUri, directory]
    });
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'rich-markdown-preview.png');
    panels.set(key, panel);
    const webview = panel.webview;
    const sessionPreferences: Partial<Preferences> = {};
    const effectivePreferences = () => ({ ...preferences(document.uri), ...sessionPreferences });
    const nonce = randomBytes(16).toString('hex');
    let fileReferences: FileReference[] = [];
    const resource = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', file));
    webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};"><link rel="stylesheet" href="${resource('preview.css')}"><title>Rich Markdown Preview</title></head><body><div id="app" data-logo="${webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'assets', 'rich-markdown-preview.png'))}"></div><script nonce="${nonce}" src="${resource('preview.js')}"></script></body></html>`;
    const update = () => {
      const result = renderMarkdown(document.getText(), src => {
        if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')) return src;
        try { return webview.asWebviewUri(vscode.Uri.joinPath(directory, decodeURIComponent(src))).toString(); } catch { return ''; }
      });
      fileReferences = result.references;
      void webview.postMessage({ type: 'render', ...result, preferences: effectivePreferences() });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updatePreferences = () => void webview.postMessage({ type: 'preferences', preferences: effectivePreferences() });
    let preferenceWrites = Promise.resolve();
    const disposables = [
      vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.toString() === key) { clearTimeout(timer); timer = setTimeout(update, 180); } }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (['richMarkdownPreview', 'markdownLens', 'styledMarkdown'].some(section => event.affectsConfiguration(section, document.uri))) updatePreferences();
      }),
      panel.onDidChangeViewState(() => { if (panel.visible) update(); }),
      webview.onDidReceiveMessage(async message => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') update();
        if (message.type === 'reference' && typeof message.id === 'string') {
          const reference = fileReferences.find(item => item.id === message.id);
          if (!reference) return;
          if (/^https?:\/\//i.test(reference.path)) {
            try { await vscode.env.openExternal(vscode.Uri.parse(reference.path)); }
            catch { void vscode.window.showWarningMessage('Could not open this reference.'); }
            return;
          }
          const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? directory;
          const rootSetting = vscode.workspace.getConfiguration('richMarkdownPreview', document.uri).get<string>('referenceRoot', '');
          const root = rootSetting ? (/^[a-z]:[\\/]/i.test(rootSetting) ? vscode.Uri.file(rootSetting) : vscode.Uri.joinPath(workspaceRoot, rootSetting)) : workspaceRoot;
          for (const candidate of referencePaths(reference)) {
            let path: string;
            try { path = decodeURIComponent(candidate).replace(/\\/g, '/'); } catch { continue; }
            if (!path || /[\u0000-\u001f]/.test(path) || path.startsWith('//') || (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:\//i.test(path))) continue;
            const target = /^[a-z]:\//i.test(path) ? vscode.Uri.file(path) : path.startsWith('~/') ? vscode.Uri.file(`${homedir()}/${path.slice(2)}`) : path.startsWith('/') ? vscode.Uri.joinPath(root, path.slice(1)) : vscode.Uri.joinPath(directory, path);
            try {
              const stat = await vscode.workspace.fs.stat(target);
              if (stat.type & vscode.FileType.Directory) continue;
              await vscode.commands.executeCommand('vscode.open', target);
              return;
            } catch { /* Try the dialect's next candidate. */ }
          }
          void vscode.window.showWarningMessage(`Could not open referenced file: ${reference.path}. Check its path or Rich Markdown Preview: Reference Root.`);
          return;
        }
        if (message.type === 'preference') {
          const { key: setting, value } = message;
          if (validPreference(setting, value)) {
            const preferenceKey = setting as keyof Preferences;
            Object.assign(sessionPreferences, { [preferenceKey]: value });
            preferenceWrites = preferenceWrites.then(async () => {
              await vscode.workspace.getConfiguration('richMarkdownPreview', document.uri).update(setting, value, vscode.workspace.getWorkspaceFolder(document.uri) ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
              if (sessionPreferences[preferenceKey] === value) delete sessionPreferences[preferenceKey];
              updatePreferences();
            }).catch(error => {
              updatePreferences();
              const detail = error instanceof Error ? error.message : String(error);
              void vscode.window.showWarningMessage(`Preview updated, but the setting could not be saved: ${detail}`);
            });
          }
        }
        if (message.type === 'copy' && typeof message.text === 'string') {
          try { await vscode.env.clipboard.writeText(message.text); void webview.postMessage({ type: 'copyResult', success: true }); }
          catch { void webview.postMessage({ type: 'copyResult', success: false }); }
        }
        if (['tableCopy', 'tableExport'].includes(message.type) && typeof message.text === 'string') {
          try {
            if (message.type === 'tableCopy') await vscode.env.clipboard.writeText(message.text);
            else {
              const filename = typeof message.filename === 'string' && /^table-\d+\.csv$/.test(message.filename) ? message.filename : 'table.csv';
              const destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(directory, filename), filters: { 'CSV files': ['csv'] }, saveLabel: 'Export CSV' });
              if (!destination) { void webview.postMessage({ type: 'tableActionResult', action: message.type, cancelled: true }); return; }
              await vscode.workspace.fs.writeFile(destination, Buffer.from('\uFEFF' + message.text, 'utf8'));
            }
            void webview.postMessage({ type: 'tableActionResult', action: message.type, success: true });
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            void vscode.window.showWarningMessage(`Table action failed: ${detail}`);
            void webview.postMessage({ type: 'tableActionResult', action: message.type, success: false, error: detail });
          }
        }
        if (message.type === 'link' && typeof message.href === 'string') {
          const href = message.href;
          if (/^(https?:|mailto:)/i.test(href)) {
            try { await vscode.env.openExternal(vscode.Uri.parse(href)); }
            catch { void vscode.window.showWarningMessage('Could not open this link.'); }
          }
          else if (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('//')) {
            try { await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(directory, decodeURIComponent(href.split('#')[0]))); } catch { void vscode.window.showWarningMessage('Could not open this link.'); }
          }
        }
      })
    ];
    panel.onDidDispose(() => { clearTimeout(timer); panels.delete(key); disposables.forEach(d => d.dispose()); });
    context.subscriptions.push(panel);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('richMarkdownPreview.openPreview', openPreview),
    vscode.commands.registerCommand('markdownLens.openPreview', openPreview),
    vscode.commands.registerCommand('styledMarkdown.openPreview', openPreview)
  );
}
