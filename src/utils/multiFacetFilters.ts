export interface MultiFacetRule<T> {
  value: string;
  allValue?: string;
  getValue: (item: T) => string | number | null | undefined;
}

/** Apply a list of independent equality facets without mutating the source rows. */
export function applyMultiFacetFilters<T>(items: readonly T[], facets: readonly MultiFacetRule<T>[]): T[] {
  const activeFacets = facets.filter(facet => facet.value !== (facet.allValue ?? 'all'));
  if (activeFacets.length === 0) return [...items];
  return items.filter(item => activeFacets.every(facet => String(facet.getValue(item) ?? '') === facet.value));
}
