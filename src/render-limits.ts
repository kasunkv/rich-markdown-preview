// Conservative security ceilings; spec 027 may refine these using measured performance.
export const renderLimits = { sourceCharacters: 2_000_000, diagramCharacters: 20_000, diagramEdges: 500 } as const;
