/**
 * The page's query parameters.
 *
 * Debug flags are whole parameter names (`?dev`, `&noao`, `&touch`), never substrings of
 * the query: the query also carries a free-text name, and `?name=devika` must not switch
 * on `dev`.
 */
const query = () => new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

/** is `?key` (or `?key=…`) in the URL */
export const flag = (key: string): boolean => query().has(key);

/** the value of `?key=…`, or null */
export const param = (key: string): string | null => query().get(key);

export const DEFAULT_NAME = 'Mithra';
export const MAX_NAME = 24;

/** the birthday person's name from `?name=…`: trimmed, capped, and never blank */
export function nameParam(search = typeof location === 'undefined' ? '' : location.search): string {
  const n = new URLSearchParams(search).get('name')?.trim().slice(0, MAX_NAME).trim();
  return n || DEFAULT_NAME;
}
