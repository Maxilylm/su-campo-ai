export type ImportBatchRow = { import_row_index?: number | null };

/**
 * A bulk insert is atomic, but the client can lose its response after commit.
 * Treat a batch as replayable only when every expected row index is present.
 */
export function isCompleteImportBatch(rows: readonly ImportBatchRow[], expectedRows: number): boolean {
  if (expectedRows <= 0 || rows.length !== expectedRows) return false;
  const indexes = new Set(rows.map((row) => row.import_row_index));
  if (indexes.size !== expectedRows) return false;
  for (let index = 0; index < expectedRows; index += 1) {
    if (!indexes.has(index)) return false;
  }
  return true;
}
