// Conservative security ceilings; spec 027 may refine these using measured performance.
export const renderLimits = { sourceCharacters: 2_000_000, diagramCharacters: 20_000, diagramEdges: 500 } as const;

/** Fixed callers supply the message; input is never interpolated into this HTML. */
export function renderLimitFailure(message: string) {
  return { html: `<p role="alert">${message}</p>`, outline: [], references: [], externalImageOrigins: [] };
}
