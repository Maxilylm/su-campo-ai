// "Historial" of one task, built from the audit rows the database writes on
// every insert/update (log_field_mutation, 012/035). Those rows only say
// insert/update, so a completion is recognised by matching the task's
// completed_at to the update logged at the same moment.

export interface TaskHistoryActivity {
  id: string;
  created_at: string;
  metadata?: { action?: string | null; record_id?: string | null } | null;
}

export interface TaskHistoryEntry {
  id: string;
  label: "Creada" | "Actualizada" | "Completada";
  at: string;
}

/** An update logged within this window of completed_at is the completion. */
const COMPLETION_MATCH_MS = 5_000;

function time(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Newest first. Falls back to the task's own timestamps when the audit rows
 * are missing (older data, history not loaded) so the ticket always shows
 * when it was created and, if done, completed. */
export function buildTaskHistory(
  task: { id: string; created_at?: string | null; completed_at?: string | null; status: string },
  activities: TaskHistoryActivity[],
): TaskHistoryEntry[] {
  const entries: TaskHistoryEntry[] = [];
  const completedAt = task.status === "completed" ? time(task.completed_at) : NaN;

  const own = activities.filter((activity) => !activity.metadata?.record_id || activity.metadata.record_id === task.id);
  // Match the completion to the closest update, not the first one in range.
  let completionId: string | null = null;
  if (Number.isFinite(completedAt)) {
    let best = Infinity;
    for (const activity of own) {
      if (activity.metadata?.action !== "update") continue;
      const distance = Math.abs(time(activity.created_at) - completedAt);
      if (distance <= COMPLETION_MATCH_MS && distance < best) {
        best = distance;
        completionId = activity.id;
      }
    }
  }

  for (const activity of own) {
    const action = activity.metadata?.action;
    if (!Number.isFinite(time(activity.created_at))) continue;
    if (action === "insert") entries.push({ id: activity.id, label: "Creada", at: activity.created_at });
    else if (action === "update") {
      entries.push({ id: activity.id, label: activity.id === completionId ? "Completada" : "Actualizada", at: activity.created_at });
    }
  }

  if (!entries.some((entry) => entry.label === "Creada") && task.created_at && Number.isFinite(time(task.created_at))) {
    entries.push({ id: `${task.id}:created`, label: "Creada", at: task.created_at });
  }
  if (Number.isFinite(completedAt) && !completionId && task.completed_at) {
    entries.push({ id: `${task.id}:completed`, label: "Completada", at: task.completed_at });
  }
  return entries.sort((a, b) => time(b.at) - time(a.at));
}
