import { renderLimits } from './render-limits';

/** Authorize only retained slots; cap concurrent reads and stop scheduling superseded work. */
export async function renderWithAsyncImages<T extends { html: string }>(
  render: (image: (src: string) => string) => T,
  resolve: (src: string) => Promise<string>,
  current: () => boolean = () => true,
): Promise<T> {
  const images: string[] = [];
  const result = render((src) => {
    images.push(src);
    return `rmp-provider-image-${images.length - 1}`;
  });
  const slots = [...result.html.matchAll(/src="rmp-provider-image-(\d+)"/g)];
  const sources = [...new Set(slots.map(([, index]) => images[Number(index)]).filter((src) => src !== undefined))];
  const resources = new Map<string, string>();
  let cursor = 0;
  let failed = false;
  const retained = sources.slice(0, renderLimits.providerImages);
  await Promise.all(
    Array.from({ length: Math.min(renderLimits.providerConcurrency, retained.length) }, async () => {
      while (!failed && current() && cursor < retained.length) {
        const src = retained[cursor++];
        let resource: string;
        try {
          resource = await resolve(src);
        } catch (error) {
          failed = true;
          throw error;
        }
        if (failed || !current()) return;
        resources.set(src, resource);
      }
    }),
  );
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    ...result,
    html:
      result.html.replace(
        /src="rmp-provider-image-(\d+)"/g,
        (_slot, index: string) => `src="${escape(resources.get(images[Number(index)]) ?? '')}"`,
      ) +
      (sources.length > retained.length
        ? '<p role="status">Only the first 128 distinct local images were authorized. Open the source, or split this document to load the remaining images.</p>'
        : ''),
  };
}

/** Share four physical provider operations across revisions; timed-out reads keep their slot until settlement. */
export class ProviderImageReadBudget {
  private active = 0;
  private blocked = false;
  constructor(private readonly available: () => void) {}
  async resolve(read: () => Promise<string>, current: () => boolean): Promise<{ resource: string; busy: boolean }> {
    if (!current()) return { resource: '', busy: false };
    if (this.active >= renderLimits.providerConcurrency) {
      this.blocked = true;
      return { resource: '', busy: true };
    }
    ++this.active;
    const operation = Promise.resolve().then(read);
    const release = () => {
      --this.active;
      if (this.blocked) {
        this.blocked = false;
        this.available();
      }
    };
    void operation.then(release, release);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation.then((resource) => ({ resource, busy: false })),
        new Promise<{ resource: string; busy: boolean }>((resolve) => {
          timer = setTimeout(() => {
            this.blocked = true;
            resolve({ resource: '', busy: true });
          }, renderLimits.providerWaitMilliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
