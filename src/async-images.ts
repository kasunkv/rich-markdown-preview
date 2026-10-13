/** Render once, then substitute only image-src slots after provider authorization.
 * The renderer callback supplies the slots; source text cannot inject HTML attributes.
 */
export async function renderWithAsyncImages<T extends { html: string }>(
  render: (image: (src: string) => string) => T,
  resolve: (src: string) => Promise<string>,
): Promise<T> {
  const pending = new Map<string, Promise<string>>();
  const images: string[] = [];
  const result = render((src) => {
    images.push(src);
    return `rmp-provider-image-${images.length - 1}`;
  });
  // Final renderer fallback may discard all queued slots; authorize only retained content.
  const resources = new Map<string, string>();
  await Promise.all(
    [...result.html.matchAll(/src="rmp-provider-image-(\d+)"/g)].map(async ([, index]) => {
      const src = images[Number(index)];
      if (src === undefined) return;
      let resource = pending.get(src);
      if (!resource) {
        resource = resolve(src);
        pending.set(src, resource);
      }
      resources.set(index, await resource);
    }),
  );
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    ...result,
    html: result.html.replace(
      /src="rmp-provider-image-(\d+)"/g,
      (_slot, index: string) => `src="${escape(resources.get(index) ?? '')}"`,
    ),
  };
}
