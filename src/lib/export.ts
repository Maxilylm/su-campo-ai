export interface DatabaseErrorLike {
  code?: string;
  message?: string;
}

export function isMissingTasksTable(error: DatabaseErrorLike | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*tasks.*(?:does not exist|not found)/i.test(error?.message || "");
}
