export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const MAX_OFFSET = 100_000;

export interface PaginationParams {
  limit: number;
  offset: number;
}

export function parsePagination(params: URLSearchParams): PaginationParams {
  const requestedLimit = Number(params.get("limit") || DEFAULT_PAGE_SIZE);
  const requestedOffset = Number(params.get("offset") || 0);
  return {
    limit: Number.isFinite(requestedLimit)
      ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedLimit)))
      : DEFAULT_PAGE_SIZE,
    offset: Number.isFinite(requestedOffset)
      ? Math.min(MAX_OFFSET, Math.max(0, Math.floor(requestedOffset)))
      : 0,
  };
}

export function splitPage<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
  return rows.length > limit
    ? { items: rows.slice(0, limit), hasMore: true }
    : { items: rows, hasMore: false };
}
