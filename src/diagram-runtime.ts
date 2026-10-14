import mermaid from 'mermaid';

const runtime: typeof mermaid = {
  ...mermaid,
  async render(id, text, container) {
    const result = await mermaid.render(id, text, container);
    // Mermaid sequence CSS references an optional gradient that it does not emit.
    // Keep the same transparent paint without a dangling reference into another SVG.
    const template = document.createElement('template');
    template.innerHTML = result.svg;
    const ids = new Set<string>();
    for (const element of template.content.querySelectorAll('[id]')) {
      if (ids.has(element.id)) element.removeAttribute('id');
      else ids.add(element.id);
    }
    // The browser previously resolves duplicate Mermaid IDs to the first element.
    // Retain that identity while preventing duplicates from bypassing strict isolation.
    const svg = template.innerHTML;
    return { ...result, svg: ids.has(`${id}-gradient`) ? svg : svg.replaceAll(`url(#${id}-gradient)`, 'none') };
  },
};
/** Bundled offline diagrams, exposed only after the nonce-bearing runtime script loads. */
export function renderer() {
  return runtime;
}
