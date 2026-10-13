import { renderMarkdown } from './render';

export type FragmentResult =
  | { kind: 'none' }
  | { kind: 'heading'; fragment: string; line: number }
  | { kind: 'unsupported-line' | 'malformed' | 'missing'; fragment: string };

// Accept raw URL fragments and decode exactly once, just as the preview does.
export function resolveSourceFragment(source: string, rawFragment: string): FragmentResult {
  if (!rawFragment) return { kind: 'none' };
  let fragment: string;
  try {
    fragment = decodeURIComponent(rawFragment);
  } catch {
    return { kind: 'malformed', fragment: rawFragment };
  }
  if (/^L\d+(?:-L?\d+)?$/i.test(fragment)) return { kind: 'unsupported-line', fragment };
  const heading = renderMarkdown(source).outline.find((item) => item.fragment === fragment);
  return heading ? { kind: 'heading', fragment, line: heading.sourceLine } : { kind: 'missing', fragment };
}

export function fragmentWarning(result: FragmentResult): string | undefined {
  if (result.kind === 'unsupported-line')
    return `Line fragment #${result.fragment} is not supported. Open the source and use Go to Line instead.`;
  if (result.kind === 'malformed') return 'This link has a malformed heading fragment. Check its percent encoding.';
  if (result.kind === 'missing') return `Heading #${result.fragment} was not found. Check the target heading or link.`;
  return undefined;
}
