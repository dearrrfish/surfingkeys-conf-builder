/** Paths excluded from every extension digest and therefore forbidden as inputs. */
const excludedSegments = new Set(['.git', 'node_modules', 'dist', '.generated', '.cache']);
export function sourceExcludedPath(file: string): boolean {
  return file.split(/[\\/]/).some(segment => excludedSegments.has(segment));
}
