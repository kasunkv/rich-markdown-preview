import { isExternalImageOrigin } from './external-images';

export interface WebviewShellOptions {
  nonce: string;
  cspSource: string;
  scriptUri: string;
  diagramScriptUri?: string;
  styleUri: string;
  logoUri: string;
  resourceUris: readonly string[];
  imageOrigins?: readonly string[];
}

function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The host and HTTP security harness use this exact shell and policy. */
export function buildWebviewShell(options: WebviewShellOptions): string {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(options.nonce)) throw new Error('Invalid webview nonce');
  // cspSource is supplied by VS Code, never by document input.
  if (
    !options.cspSource ||
    !/^(?:'self'|[a-z][a-z\d+.-]*:[^\s;"'<>]*)(?: +(?:'self'|[a-z][a-z\d+.-]*:[^\s;"'<>]*))*$/i.test(options.cspSource)
  )
    throw new Error('Invalid webview resource source');
  // API-mapped authorized roots/assets supply concrete resource origins. The API's
  // broader CDN source list must not grant author-controlled diagram URLs that namespace.
  const resources = [
    ...new Set(
      options.resourceUris.map((uri) => {
        const url = new URL(uri);
        const origin = url.origin === 'null' ? url.protocol : url.origin;
        // Chromium rejects '+' in an exact CSP host source. These API-mapped hosts
        // belong to the kernel resource namespace, not the general CDN namespace.
        const source = url.hostname.endsWith('.vscode-resource.vscode-cdn.net')
          ? `${url.protocol}//*.vscode-resource.vscode-cdn.net${url.pathname.replace(/\/?$/, '/')}`
          : origin;
        if (url.hostname.includes('*') || /[;"'<>]/.test(source)) throw new Error('Invalid mapped resource URI');
        return source;
      }),
    ),
  ];
  const imageResources = [
    ...new Set(
      resources.map((source) => source.replace(/^(https?:\/\/\*\.vscode-resource\.vscode-cdn\.net)\/.*$/, '$1')),
    ),
  ];
  const origins = [...new Set(options.imageOrigins ?? [])];
  for (const origin of origins) {
    if (!isExternalImageOrigin(origin)) throw new Error('Invalid image origin');
  }
  // Inline CSS is required by Mermaid SVG style elements and preference CSS properties.
  // It never permits scripts, event handlers, connections, frames, forms or objects.
  const policy = `default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; img-src ${imageResources.join(' ')} data: ${origins.join(' ')}; style-src ${resources.join(' ')} 'unsafe-inline'; script-src 'nonce-${options.nonce}'; font-src ${resources.join(' ')};`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${attribute(policy)}"><link rel="stylesheet" href="${attribute(options.styleUri)}"><title>Rich Markdown Preview</title></head><body><div id="rmp-ui-app" data-logo="${attribute(options.logoUri)}"></div><script data-diagram-runtime="${attribute(options.diagramScriptUri ?? new URL('diagrams.js', options.scriptUri).toString())}" nonce="${options.nonce}" src="${attribute(options.scriptUri)}"></script></body></html>`;
}
