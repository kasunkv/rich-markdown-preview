/** Render once, then substitute only image-src slots after provider authorization.
 * The renderer callback supplies the slots; source text cannot inject HTML attributes.
 */
export async function renderWithAsyncImages<T extends { html: string }>(
  render: (image: (src: string) => string) => T,
  resolve: (src: string) => Promise<string>,
): Promise<T> {
  const pending = new Map<string, Promise<string>>();
  const images: Promise<string>[] = [];
  const result = render((src) => {
    let resource = pending.get(src);
    if (!resource) {
      resource = resolve(src);
      pending.set(src, resource);
    }
    images.push(resource);
    return `rmp-provider-image-${images.length - 1}`;
  });
  const resources = await Promise.all(images);
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    ...result,
    html: result.html.replace(
      /src="rmp-provider-image-(\d+)"/g,
      (_slot, index: string) => `src="${escape(resources[Number(index)] ?? '')}"`,
    ),
  };
}
