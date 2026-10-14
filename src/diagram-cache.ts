import { hasInternalDiagramResource } from './render-limits';

/** Parse a fresh SVG for each use. Never share DOM nodes, IDs, names or selector scopes. */
export function isolateDiagramSvg(svg: string, prefix: string): SVGSVGElement | undefined {
  if (svg.length > 1_000_000 || !/^rmp-diagram-[a-z\d-]+$/.test(prefix)) return undefined;
  const template = document.createElement('template');
  template.innerHTML = svg;
  const root = template.content.firstElementChild;
  if (!(root instanceof SVGSVGElement) || template.content.children.length !== 1) return undefined;
  const elements = [root, ...root.querySelectorAll('*')];
  const identities = new Map<string, string>();
  for (const element of elements) {
    if (
      ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'animate', 'set'].includes(element.localName)
    )
      return undefined;
    for (const attribute of element.attributes) {
      if (
        /^on/i.test(attribute.name) ||
        /javascript:|vbscript:/i.test(attribute.value) ||
        hasInternalDiagramResource(attribute.value, (value) => value)
      )
        return undefined;
    }
    if (
      element.localName === 'style' &&
      (/\@import|javascript:|vbscript:/i.test(element.textContent ?? '') ||
        hasInternalDiagramResource(element.textContent ?? '', (value) => value))
    )
      return undefined;
    for (const name of ['id', 'name']) {
      const identity = element.getAttribute(name);
      if (!identity) continue;
      if (!/^[a-z\d_:.-]+$/i.test(identity) || (name === 'id' && identities.has(identity))) return undefined;
      if (!identities.has(identity)) identities.set(identity, `${prefix}-${identities.size}`);
    }
  }
  const rewrite = (value: string) => {
    for (const [old, unique] of identities) {
      const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      value = value.replace(new RegExp(`#${escaped}(?![a-z\\d_:.-])`, 'gi'), `#${unique}`);
    }
    return value;
  };
  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      if (['id', 'name'].includes(attribute.name)) {
        element.setAttribute(attribute.name, identities.get(attribute.value)!);
      } else if (['aria-labelledby', 'aria-describedby'].includes(attribute.name)) {
        const tokens = attribute.value.split(/\s+/);
        if (tokens.some((token) => !identities.has(token))) return undefined;
        element.setAttribute(attribute.name, tokens.map((token) => identities.get(token)).join(' '));
      } else {
        if (
          (attribute.name === 'href' || attribute.name === 'xlink:href') &&
          attribute.value.startsWith('#') &&
          !identities.has(attribute.value.slice(1))
        )
          return undefined;
        element.setAttribute(attribute.name, rewrite(attribute.value));
      }
    }
    if (element.localName === 'style') element.textContent = rewrite(element.textContent ?? '');
  }
  return root;
}
