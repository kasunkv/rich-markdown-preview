/** Split before decoding so encoded ?/# remain filename characters. */
export function parseResourceUrl(value: string) {
  const hash = value.indexOf('#');
  const beforeFragment = hash < 0 ? value : value.slice(0, hash);
  const question = beforeFragment.indexOf('?');
  return {
    path: question < 0 ? beforeFragment : beforeFragment.slice(0, question),
    query: question < 0 ? '' : beforeFragment.slice(question + 1),
    fragment: hash < 0 ? '' : value.slice(hash + 1),
  };
}
