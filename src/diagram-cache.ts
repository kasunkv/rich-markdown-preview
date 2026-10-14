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
      [
        'script',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'button',
        'animate',
        'animatemotion',
        'animatetransform',
        'set',
      ].includes(element.localName.toLowerCase())
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
      if (!/^[a-z\d_:-]+$/i.test(identity) || (name === 'id' && identities.has(identity))) return undefined;
      if (!identities.has(identity)) identities.set(identity, `${prefix}-${identities.size}`);
    }
  }
  const localReferences = (value: string) => {
    if (value.includes(String.fromCharCode(92))) return false;
    return [...value.matchAll(/url\(\s*['"]?#([^'"\s)]+)['"]?\s*\)/gi)].every((match) => identities.has(match[1]));
  };
  const animations = new Map<string, string>();
  const sheets = new Map<Element, CSSStyleSheet>();
  const scope = (rules: CSSRuleList): boolean =>
    [...rules].every((rule) => {
      if (rule instanceof CSSStyleRule) {
        const valid = rule.selectorText.split(',').every((selector) => {
          const value = selector.trim();
          const anchor = '#' + root.id;
          return (
            !/[+~]/.test(value) &&
            !!root.id &&
            (value === anchor || (value.startsWith(anchor) && /^[\s:.>+~[]/.test(value.slice(anchor.length))))
          );
        });
        if (valid)
          rule.selectorText = rule.selectorText.replace(/#([a-z\d_-]+)/gi, (reference, identity: string) =>
            identities.has(identity) ? '#' + identities.get(identity) : reference,
          );
        return valid;
      }
      if (rule instanceof CSSKeyframesRule) {
        if (!/^[a-z_][a-z\d_-]*$/i.test(rule.name)) return false;
        const previous = rule.name;
        const unique = animations.get(previous) ?? prefix + '-animation-' + animations.size;
        animations.set(previous, unique);
        rule.name = unique;
        return true;
      }
      if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) return scope(rule.cssRules);
      return false;
    });
  for (const element of elements) {
    if (element.localName !== 'style') continue;
    const css = element.textContent!;
    if (!localReferences(css)) return undefined;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    if (!scope(sheet.cssRules)) return undefined;
    sheets.set(element, sheet);
  }
  const animationNames = (style: CSSStyleDeclaration) => {
    for (const name of ['animation', 'animation-name']) {
      const value = style.getPropertyValue(name);
      if (value)
        style.setProperty(
          name,
          value.replace(/[a-z_][a-z\d_-]*/gi, (token) => animations.get(token) ?? token),
          style.getPropertyPriority(name),
        );
    }
  };
  const updateAnimations = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) animationNames(rule.style);
      else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) updateAnimations(rule.cssRules);
    }
  };
  for (const sheet of sheets.values()) updateAnimations(sheet.cssRules);
  const rewrite = (value: string) =>
    value.replace(
      /url\(\s*(['"]?)#([^'"\s)]+)['"]?\s*\)/gi,
      (_reference, _quote: string, identity: string) => `url(#${identities.get(identity)})`,
    );
  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      if (['id', 'name'].includes(attribute.name)) {
        element.setAttribute(attribute.name, identities.get(attribute.value)!);
      } else if (['aria-labelledby', 'aria-describedby'].includes(attribute.name)) {
        const tokens = attribute.value.split(/\s+/);
        if (tokens.some((token) => !identities.has(token))) return undefined;
        element.setAttribute(attribute.name, tokens.map((token) => identities.get(token)).join(' '));
      } else {
        if (attribute.value.toLowerCase().includes('url') && !localReferences(attribute.value)) return undefined;
        if (
          ['href', 'xlink:href', 'src'].includes(attribute.name) &&
          !/^(?:#|https?:|data:image\/)/i.test(attribute.value)
        )
          return undefined;
        if (
          (attribute.name === 'href' || attribute.name === 'xlink:href') &&
          attribute.value.startsWith('#') &&
          !identities.has(attribute.value.slice(1))
        )
          return undefined;
        element.setAttribute(
          attribute.name,
          ['href', 'xlink:href'].includes(attribute.name) && attribute.value.startsWith('#')
            ? '#' + identities.get(attribute.value.slice(1))
            : rewrite(attribute.value),
        );
      }
    }
    if (element.localName === 'style')
      element.textContent = rewrite([...sheets.get(element)!.cssRules].map((rule) => rule.cssText).join('\n'));
    if (element.hasAttribute('style')) animationNames((element as HTMLElement).style);
  }
  return root;
}
