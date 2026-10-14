// Conservative security ceilings; spec 027 may refine these using measured performance.
export const renderLimits = {
  sourceCharacters: 2_000_000,
  sourceLines: 25_000,
  tableRows: 5_000,
  markdownTokens: 100_000,
  diagrams: 20,
  highlightCharacters: 20_000,
  totalHighlightCharacters: 80_000,
  diagramCharacters: 20_000,
  diagramEdges: 500,
  providerImages: 128,
  providerConcurrency: 4,
  providerWaitMilliseconds: 2_000,
  providerPathSegments: 64,
} as const;

/** Fixed callers supply the message; input is never interpolated into this HTML. */
export function renderLimitFailure(message: string) {
  return { html: `<p role="alert">${message}</p>`, outline: [], references: [], externalImageOrigins: [] };
}

/** Internal kernel URLs cannot be authored in diagrams: they bypass canonical image resolution. */
export function hasInternalDiagramResource(source: string, unescape: (value: string) => string): boolean {
  let normalized = source;
  for (let pass = 0; pass < 8; pass++) {
    const previous = normalized;
    normalized = unescape(normalized)
      .replace(
        /\\(?:u\{([a-f\d]{1,6})\}|u([a-f\d]{8}|[a-f\d]{4})|([a-f\d]{1,6})\s?)/gi,
        (_match, braces: string, unicode: string, css: string) => {
          const point = Number.parseInt(braces || unicode || css, 16);
          return point <= 0x10ffff ? String.fromCodePoint(point) : '';
        },
      )
      .replace(/\\\r?\n[ \t]*/g, '')
      .replace(/\\([^a-f\d\s])/gi, '$1')
      .replace(/[\u0000-\u001f\u007f]/g, '');
    try {
      normalized = normalized.replace(/(?:%[a-f\d]{2})+/gi, (chunk) => decodeURIComponent(chunk));
      // URL applies the browser's UTS46 hostname mapping (width, dots and ignorables).
      // Inspect authority candidates rather than treating author spelling as a hostname.
      normalized = normalized.replace(
        /(?:https?:[^\x00-\x20"'<>()[\]{}]+|\/\/[^\x00-\x20"'<>()[\]{}]+)/gi,
        (candidate) => {
          const url = new URL(candidate.startsWith('//') ? `https:${candidate}` : candidate);
          return `${url.protocol}//${url.hostname}${url.pathname}${url.search}${url.hash}`;
        },
      );
    } catch {
      return true;
    }
    if (/vscode-(?:webview(?:-resource)?|resource)(?::|\.vscode-cdn\.net)/i.test(normalized)) return true;
    if (normalized === previous) return false;
  }
  return true;
}
