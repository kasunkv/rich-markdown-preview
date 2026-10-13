import { isExternalImageOrigin } from './external-images';

export interface WebviewShellOptions {
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  logoUri: string;
  imageOrigins?: readonly string[];
}

function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The host and HTTP security harness use this exact shell and policy. */
export function buildWebviewShell(options: WebviewShellOptions): string {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(options.nonce)) throw new Error('Invalid webview nonce');
  // cspSource is supplied by VS Code, never by document input.
  if (!options.cspSource || /[;\s"'<>]/.test(options.cspSource)) throw new Error('Invalid webview resource source');
  const origins = [...new Set(options.imageOrigins ?? [])];
  for (const origin of origins) {
    if (!isExternalImageOrigin(origin)) throw new Error('Invalid image origin');
  }
  // Inline CSS is required by Mermaid SVG style elements and preference CSS properties.
  // It never permits scripts, event handlers, connections, frames, forms or objects.
  const policy = `default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; img-src ${options.cspSource} data: ${origins.join(' ')}; style-src ${options.cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}'; font-src ${options.cspSource};`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${attribute(policy)}"><link rel="stylesheet" href="${attribute(options.styleUri)}"><title>Rich Markdown Preview</title></head><body><div id="rmp-ui-app" data-logo="${attribute(options.logoUri)}"></div><script nonce="${options.nonce}" src="${attribute(options.scriptUri)}"></script></body></html>`;
}
