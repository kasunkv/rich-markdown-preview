import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { renderMarkdown } from './render';
import { previewStyles } from './styles';

const defaults = { style: 'documentation', appearance: 'auto', contentWidth: 900, fontSize: 16, lineHeight: 1.7, wrapCode: false };
type Preferences = typeof defaults;
function preferences(uri: vscode.Uri): Preferences {
  const config = vscode.workspace.getConfiguration('styledMarkdown', uri);
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, config.get(key, value)])) as Preferences;
}
export function activate(context: vscode.ExtensionContext) {
  const panels = new Map<string, vscode.WebviewPanel>();
  context.subscriptions.push(vscode.commands.registerCommand('styledMarkdown.openPreview', async (uri?: vscode.Uri) => {
    let document: vscode.TextDocument | undefined;
    try {
      document = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
    } catch {
      void vscode.window.showWarningMessage('Could not open the selected Markdown file.'); return;
    }
    if (!document || document.languageId !== 'markdown') { void vscode.window.showInformationMessage('Open a Markdown file first.'); return; }
    const key = document.uri.toString();
    const existing = panels.get(key);
    if (existing) { existing.reveal(vscode.ViewColumn.Beside); return; }
    const directory = vscode.Uri.joinPath(document.uri, '..');
    const panel = vscode.window.createWebviewPanel('styledMarkdown.preview', `Preview: ${document.fileName.split(/[\\/]/).pop()}`, vscode.ViewColumn.Beside, {
      enableScripts: true, localResourceRoots: [context.extensionUri, directory]
    });
    panels.set(key, panel);
    const webview = panel.webview;
    const sessionPreferences: Partial<Preferences> = {};
    const effectivePreferences = () => ({ ...preferences(document.uri), ...sessionPreferences });
    const nonce = randomBytes(16).toString('hex');
    const resource = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', file));
    webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};"><link rel="stylesheet" href="${resource('preview.css')}"><title>Styled Markdown Preview</title></head><body><div id="app"></div><script nonce="${nonce}" src="${resource('preview.js')}"></script></body></html>`;
    const update = () => {
      const result = renderMarkdown(document.getText(), src => {
        if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')) return src;
        try { return webview.asWebviewUri(vscode.Uri.joinPath(directory, decodeURIComponent(src))).toString(); } catch { return ''; }
      });
      void webview.postMessage({ type: 'render', ...result, preferences: effectivePreferences() });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updatePreferences = () => void webview.postMessage({ type: 'preferences', preferences: effectivePreferences() });
    let preferenceWrites = Promise.resolve();
    const disposables = [
      vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.toString() === key) { clearTimeout(timer); timer = setTimeout(update, 180); } }),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('styledMarkdown', document.uri)) updatePreferences(); }),
      panel.onDidChangeViewState(() => { if (panel.visible) update(); }),
      webview.onDidReceiveMessage(async message => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') update();
        if (message.type === 'preference') {
          const { key: setting, value } = message;
          const enums: Record<string, string[]> = { style: previewStyles.map(style => style.id), appearance: ['auto', 'light', 'dark'] };
          const ranges: Record<string, number[]> = { contentWidth: [480, 1600], fontSize: [12, 24], lineHeight: [1.3, 2.2] };
          const valid = typeof setting === 'string' && ((Object.hasOwn(enums, setting) && enums[setting].includes(value)) || (Object.hasOwn(ranges, setting) && typeof value === 'number' && Number.isFinite(value) && value >= ranges[setting][0] && value <= ranges[setting][1]) || (setting === 'wrapCode' && typeof value === 'boolean'));
          if (valid) {
            const preferenceKey = setting as keyof Preferences;
            Object.assign(sessionPreferences, { [preferenceKey]: value });
            preferenceWrites = preferenceWrites.then(async () => {
              await vscode.workspace.getConfiguration('styledMarkdown', document.uri).update(setting, value, vscode.workspace.getWorkspaceFolder(document.uri) ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
              if (sessionPreferences[preferenceKey] === value) delete sessionPreferences[preferenceKey];
              updatePreferences();
            }).catch(error => {
              updatePreferences();
              const detail = error instanceof Error ? error.message : String(error);
              void vscode.window.showWarningMessage(`Preview updated, but the setting could not be saved: ${detail}`);
            });
          }
        }
        if (message.type === 'copy' && typeof message.text === 'string') await vscode.env.clipboard.writeText(message.text);
        if (message.type === 'link' && typeof message.href === 'string') {
          const href = message.href;
          if (/^https?:|^mailto:/i.test(href)) { await vscode.env.openExternal(vscode.Uri.parse(href)); }
          else if (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('//')) {
            try { await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(directory, decodeURIComponent(href.split('#')[0]))); } catch { void vscode.window.showWarningMessage('Could not open this link.'); }
          }
        }
      })
    ];
    panel.onDidDispose(() => { clearTimeout(timer); panels.delete(key); disposables.forEach(d => d.dispose()); });
    context.subscriptions.push(panel);
  }));
}
