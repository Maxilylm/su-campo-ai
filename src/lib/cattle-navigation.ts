export interface SearchableCattleRow {
  id: string;
  category: string;
  breed: string | null;
  ear_tag: string | null;
  tag_range: string | null;
  sectionName: string;
  origin: string;
  health_status: string;
}

export function filterCattleRows<T extends SearchableCattleRow>(rows: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return rows;

  return rows.filter((row) => [
    row.sectionName,
    row.category,
    row.breed,
    row.ear_tag,
    row.tag_range,
    row.origin,
    row.health_status,
  ].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalizedQuery));
}

export function pageForRowId(rows: Array<{ id: string }>, id: string | null, rowsPerPage: number): number {
  if (!id || rowsPerPage <= 0) return 1;
  const index = rows.findIndex((row) => row.id === id);
  return index < 0 ? 1 : Math.floor(index / rowsPerPage) + 1;
}
