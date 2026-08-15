export interface DatedRecord {
  id: string;
  date: string;
}

export function mergeFinancialContext<T extends DatedRecord>(
  recentRecords: T[],
  exactRecords: T[],
  requestedId: string | null,
): Array<T & { contextOnly?: boolean }> {
  if (!requestedId) return recentRecords;

  const byId = new Map(recentRecords.map((record) => [record.id, record]));
  for (const record of exactRecords) {
    if (!byId.has(record.id)) byId.set(record.id, { ...record, contextOnly: true });
  }

  return Array.from(byId.values()).sort((left, right) => right.date.localeCompare(left.date));
}
