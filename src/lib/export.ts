export interface DatabaseErrorLike {
  code?: string;
  message?: string;
}

export const EXPORT_TIMEOUT_CODE = "EXPORT_TIMEOUT";

export function isMissingTasksTable(error: DatabaseErrorLike | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*tasks.*(?:does not exist|not found)/i.test(error?.message || "");
}

export function isExportTimeout(error: DatabaseErrorLike | null): boolean {
  return error?.code === EXPORT_TIMEOUT_CODE;
}
