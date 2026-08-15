import { normalizedEarTag } from "@/lib/cattle";

export interface PurchaseMovementForAudit {
  id?: unknown;
  unit_cost?: unknown;
}

export interface FinancialLinkForAudit {
  id?: unknown;
  inventory_movement_id?: unknown;
}

export interface CattleForAudit {
  id?: unknown;
  ear_tag?: unknown;
}

export interface DuplicateEarTagGroup {
  tag: string;
  cattleIds: string[];
}

export interface IntegrityAuditResult {
  missingPurchaseFinancialIds: string[];
  orphanedFinancialLinkIds: string[];
  duplicateFinancialMovementIds: string[];
}

export function findDuplicateEarTagGroups(cattle: CattleForAudit[]): DuplicateEarTagGroup[] {
  const groups = new Map<string, string[]>();
  for (const row of cattle) {
    if (typeof row.id !== "string") continue;
    const tag = normalizedEarTag(row.ear_tag);
    if (!tag) continue;
    groups.set(tag, [...(groups.get(tag) || []), row.id]);
  }
  return [...groups.entries()]
    .filter(([, cattleIds]) => cattleIds.length > 1)
    .map(([tag, cattleIds]) => ({ tag, cattleIds }));
}

/** Compare the two sides of the inventory purchase integration without mutating data. */
export function auditInventoryPurchaseLinks(
  movements: PurchaseMovementForAudit[],
  financialTransactions: FinancialLinkForAudit[],
): IntegrityAuditResult {
  const movementIds = new Set(
    movements.filter((movement) => typeof movement.id === "string").map((movement) => movement.id as string),
  );
  const linkedFinancialIds = new Set<string>();
  const linkCounts = new Map<string, number>();
  const orphanedFinancialLinkIds: string[] = [];

  for (const transaction of financialTransactions) {
    const movementId = transaction.inventory_movement_id;
    if (typeof movementId !== "string" || !movementId) continue;
    if (!movementIds.has(movementId) && typeof transaction.id === "string") {
      orphanedFinancialLinkIds.push(transaction.id);
    }
    linkedFinancialIds.add(movementId);
    linkCounts.set(movementId, (linkCounts.get(movementId) || 0) + 1);
  }

  const missingPurchaseFinancialIds = movements
    .filter((movement) => Number(movement.unit_cost) > 0 && typeof movement.id === "string" && !linkedFinancialIds.has(movement.id))
    .map((movement) => movement.id as string);

  const duplicateFinancialMovementIds = [...linkCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([movementId]) => movementId);

  return { missingPurchaseFinancialIds, orphanedFinancialLinkIds, duplicateFinancialMovementIds };
}
