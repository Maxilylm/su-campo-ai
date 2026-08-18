import { describe, expect, it } from "vitest";
import { annotateOperationErrors, applyAIChangeFeedback, extractMissingMigration, type ChatOperationResponse } from "./chat-operation-errors";

describe("chat operation errors", () => {
  it("extracts a missing migration from operation logs", () => {
    expect(extractMissingMigration(["Error moving cattle: aplicá supabase/021_cattle_move_transaction.sql"])).toBe("supabase/021_cattle_move_transaction.sql");
    expect(extractMissingMigration(["Error moving cattle: destination section not found"])).toBeNull();
  });

  it("adds an actionable migration notice and metadata", () => {
    const response = { response: "Moviendo el lote…", operationMigration: "model-output.sql" };
    annotateOperationErrors(response, ["Error moving cattle: aplicá supabase/021_cattle_move_transaction.sql"]);
    expect(response.response).toContain("supabase/021_cattle_move_transaction.sql");
    expect(response.response).toContain("Salud de los servicios");
    expect(response.operationMigration).toBe("supabase/021_cattle_move_transaction.sql");
  });

  it("keeps generic failures actionable without exposing database details", () => {
    const response = { response: "Registrando…", operationMigration: "stale.sql" };
    annotateOperationErrors(response, ["Error inserting cattle: timeout"]);
    expect(response.response).toContain("Algunos cambios no se guardaron");
    expect(response.operationMigration).toBeUndefined();
  });

  it("only exposes module links when all AI operations succeeded", () => {
    const response = { response: "Guardando…", changeLinks: [{ label: "viejo", href: "/viejo" }] };
    expect(applyAIChangeFeedback(response, [{ table: "tasks", data: {} }], ["Error inserting task"])).toEqual([]);
    expect(response.changeLinks).toBeUndefined();

    const success: ChatOperationResponse = { response: "Guardado" };
    expect(applyAIChangeFeedback(success, [{ table: "tasks", data: {} }], [])).toEqual([{ label: "Tareas", href: "/gestion/tareas" }]);
    expect(success.changeLinks).toEqual([{ label: "Tareas", href: "/gestion/tareas" }]);
  });
});
