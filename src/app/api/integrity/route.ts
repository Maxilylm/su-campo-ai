import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { databaseFailure } from "@/lib/api-error";
import { withTimeout } from "@/lib/timeout";
import { auditInventoryPurchaseLinks, findDuplicateEarTagGroups } from "@/lib/integrity";

const INTEGRITY_QUERY_TIMEOUT_MS = 7000;
const MAX_AUDIT_ROWS = 2000;
const MAX_EXAMPLES = 5;

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const queryResults = await withTimeout(
    Promise.all([
      db
        .from("inventory_movements")
        .select("id, unit_cost")
        .eq("farm_id", result.farmId)
        .eq("type", "compra")
        .not("unit_cost", "is", null)
        .order("created_at", { ascending: false })
        .limit(MAX_AUDIT_ROWS),
      db
        .from("financial_transactions")
        .select("id, inventory_movement_id")
        .eq("farm_id", result.farmId)
        .not("inventory_movement_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(MAX_AUDIT_ROWS),
      db
        .from("cattle")
        .select("id, ear_tag")
        .eq("farm_id", result.farmId)
        .not("ear_tag", "is", null)
        .order("created_at", { ascending: false })
        .limit(MAX_AUDIT_ROWS),
    ]),
    INTEGRITY_QUERY_TIMEOUT_MS,
    null,
  );

  if (!queryResults) {
    return NextResponse.json({ error: "La revisión de integridad tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }

  const [movements, financialTransactions, cattle] = queryResults;
  if (movements.error) return databaseFailure("integrity inventory lookup", movements.error);
  if (financialTransactions.error) return databaseFailure("integrity financial lookup", financialTransactions.error);
  if (cattle.error) return databaseFailure("integrity cattle lookup", cattle.error);

  // Resolve exactly the movement IDs referenced by the sampled financial rows.
  // Otherwise an old, valid movement could look orphaned merely because it was
  // outside the recent movement sample.
  const linkedMovementIds = [...new Set(
    (financialTransactions.data || [])
      .map((transaction) => transaction.inventory_movement_id)
      .filter((id): id is string => typeof id === "string" && Boolean(id)),
  )];
  let referencedMovements: { data: Array<{ id: string }> | null; error: { message?: string } | null } = { data: [], error: null };
  if (linkedMovementIds.length > 0) {
    const referencedResult = await withTimeout(
      db
        .from("inventory_movements")
        .select("id")
        .eq("farm_id", result.farmId)
        .in("id", linkedMovementIds)
        .limit(MAX_AUDIT_ROWS),
      INTEGRITY_QUERY_TIMEOUT_MS,
      null,
    );
    if (!referencedResult) {
      return NextResponse.json({ error: "La revisión de integridad tardó demasiado. Intentá nuevamente." }, { status: 504 });
    }
    referencedMovements = referencedResult;
    if (referencedMovements.error) return databaseFailure("integrity linked movement lookup", referencedMovements.error);
  }

  const audit = auditInventoryPurchaseLinks(
    [...(movements.data || []), ...(referencedMovements.data || [])],
    financialTransactions.data || [],
  );
  const duplicateEarTagGroups = findDuplicateEarTagGroups(cattle.data || []);
  const issues = [
    audit.missingPurchaseFinancialIds.length > 0 && {
      code: "purchase_without_financial",
      count: audit.missingPurchaseFinancialIds.length,
      examples: audit.missingPurchaseFinancialIds.slice(0, MAX_EXAMPLES),
    },
    audit.orphanedFinancialLinkIds.length > 0 && {
      code: "orphaned_financial_link",
      count: audit.orphanedFinancialLinkIds.length,
      examples: audit.orphanedFinancialLinkIds.slice(0, MAX_EXAMPLES),
    },
    audit.duplicateFinancialMovementIds.length > 0 && {
      code: "duplicate_financial_link",
      count: audit.duplicateFinancialMovementIds.length,
      examples: audit.duplicateFinancialMovementIds.slice(0, MAX_EXAMPLES),
    },
    duplicateEarTagGroups.length > 0 && {
      code: "duplicate_cattle_ear_tag",
      count: duplicateEarTagGroups.length,
      examples: duplicateEarTagGroups.flatMap((group) => group.cattleIds).slice(0, MAX_EXAMPLES),
      tags: duplicateEarTagGroups.slice(0, MAX_EXAMPLES).map((group) => group.tag),
    },
  ].filter(Boolean);

  return NextResponse.json({
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    sampledRows: {
      purchaseMovements: movements.data?.length || 0,
      linkedFinancialTransactions: financialTransactions.data?.length || 0,
      cattleWithEarTags: cattle.data?.length || 0,
      maxRows: MAX_AUDIT_ROWS,
    },
    issues,
  });
}
