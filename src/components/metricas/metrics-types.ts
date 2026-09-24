import type { BatchWeightGain } from "@/lib/weight";

/** /api/metrics response. Fields marked optional are newer than some offline
 * snapshots already saved on devices, so the page must tolerate their absence. */
export interface MetricsData {
  metricsTruncated?: boolean;
  truncatedSources?: string[];
  snapshot: {
    totalHeads: number;
    totalPlantedHa: number;
    totalSectionHa: number;
    lowStockItems: number;
    overdueVax: number;
    unresolvedHealth: number;
    income: number;
    expenses: number;
    margin: number;
    primaryCurrency: string;
    financialByCurrency: { currency: string; income: number; expenses: number; net: number }[];
  };
  livestock: {
    stockingRate: number;
    mortalityRate: number;
    totalHeads: number;
    weightGain?: BatchWeightGain[];
  };
  crops: {
    avgYield: number;
    harvestedCount: number;
    activeCrops: number;
  };
  trends: {
    financial: { month: string; currency: string; income: number; expenses: number }[];
    /** Illness, injury and death cases per month (older snapshots: all events, no deaths). */
    health: { month: string; count: number; deaths?: number }[];
  };
}
