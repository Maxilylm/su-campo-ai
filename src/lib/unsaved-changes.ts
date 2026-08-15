export function hasUnsavedChanges(baseline: string | null, current: string): boolean {
  return baseline !== null && baseline !== current;
}
