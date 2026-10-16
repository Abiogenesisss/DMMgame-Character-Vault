/** Show the card's outfit first; retain shared uniforms for download and viewing. */
export function cardPortraits<T extends { label?: string }>(portraits: T[] = []): T[] {
  const uniform = (p: T) => /制服[0-9０-９]*L?$/.test(p.label || '');
  return [...portraits.filter(p => !uniform(p)), ...portraits.filter(uniform)];
}
