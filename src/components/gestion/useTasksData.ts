"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch";
import { isOfflineSnapshotFresh, offlineAgendaSnapshotKey, parseOfflineAgendaSnapshot } from "@/lib/offline";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import type { Task, TaskMember, TaskOptionRow } from "./task-types";

function parseMembers(payload: unknown): TaskMember[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { members?: unknown }).members)) return [];
  return ((payload as { members: unknown[] }).members).filter((row): row is TaskMember =>
    Boolean(row) && typeof row === "object" && typeof (row as TaskMember).user_id === "string");
}

/** Tasks plus the cattle/crop/member references, online or from the offline
 * agenda snapshot. Members are optional: if /api/members fails, the page
 * keeps working and only the assignee names are missing. */
export function useTasksData({ userId, offlineReadOnly }: { userId: string | null; offlineReadOnly: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cattle, setCattle] = useState<TaskOptionRow[]>([]);
  const [crops, setCrops] = useState<TaskOptionRow[]>([]);
  const [members, setMembers] = useState<TaskMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [boardMigrationRequired, setBoardMigrationRequired] = useState(false);
  const [tasksTruncated, setTasksTruncated] = useState(false);
  const [agendaSyncedAt, setAgendaSyncedAt] = useState<string | null>(null);
  const requestId = useRef(0);
  const requestRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async () => {
    const currentRequest = ++requestId.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (offlineReadOnly) {
      let cached = null;
      try {
        cached = userId
          ? parseOfflineAgendaSnapshot(window.localStorage.getItem(offlineAgendaSnapshotKey(userId)))
          : null;
      } catch {
        cached = null;
      }
      if (cached && isOfflineSnapshotFresh(cached.savedAt)) {
        const cachedTasks = cached.tasks as Task[];
        setTasks(cachedTasks);
        setCattle(cached.cattle as TaskOptionRow[]);
        setCrops(cached.crops as TaskOptionRow[]);
        setMembers([]);
        setMigrationRequired(cached.migrationRequired === true);
        // The snapshot has no flag for 053: rows carry assigned_to once it is applied.
        setBoardMigrationRequired(!cachedTasks.some((task) => task && typeof task === "object" && "assigned_to" in task));
        setTasksTruncated(cached.tasksTruncated === true);
        setAgendaSyncedAt(cached.savedAt);
        setLoadError(null);
      } else {
        setAgendaSyncedAt(null);
        setLoadError("La agenda requiere conexión y todavía no hay una sincronización local disponible.");
      }
      setLoaded(true);
      if (requestRef.current === controller) requestRef.current = null;
      return;
    }
    setLoadError(null);
    try {
      const membersRequest = fetchWithTimeout("/api/members", { signal: controller.signal, cache: "no-store" }, 8000)
        .then(async (response) => response.ok ? parseMembers(await response.json().catch(() => null)) : [])
        .catch(() => [] as TaskMember[]);
      const [taskRes, cattleRes, cropRes] = await Promise.all([
        fetchWithTimeout("/api/tasks", { signal: controller.signal }, 8000),
        fetchWithTimeout("/api/cattle", { signal: controller.signal }, 8000),
        fetchWithTimeout("/api/crops", { signal: controller.signal }, 8000),
      ]);
      const payloads = await Promise.all([taskRes, cattleRes, cropRes].map(async (response) => ({
        response,
        payload: await response.json().catch(() => null),
      })));
      const failed = payloads.find(({ response }) => !response.ok);
      if (failed) {
        const message = failed.payload && typeof failed.payload === "object" && "error" in failed.payload && typeof failed.payload.error === "string"
          ? failed.payload.error
          : "No se pudo cargar la agenda.";
        throw new Error(message);
      }
      const memberRows = await membersRequest;
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      const [taskPayload, cattlePayload, cropPayload] = payloads.map(({ payload }) => payload);
      setTasks(Array.isArray(taskPayload.tasks) ? taskPayload.tasks : []);
      setMigrationRequired(taskPayload.migrationRequired === true);
      setBoardMigrationRequired(taskPayload.boardMigrationRequired === true);
      setTasksTruncated(taskRes.headers.get("X-CampoAI-Tasks-Truncated") === "true");
      setCattle(Array.isArray(cattlePayload) ? cattlePayload : []);
      setCrops(Array.isArray(cropPayload) ? cropPayload : []);
      setMembers(memberRows);
      const savedAt = new Date().toISOString();
      setAgendaSyncedAt(savedAt);
      if (userId) {
        try {
          window.localStorage.setItem(offlineAgendaSnapshotKey(userId), JSON.stringify({
            tasks: Array.isArray(taskPayload.tasks) ? taskPayload.tasks : [],
            cattle: Array.isArray(cattlePayload) ? cattlePayload : [],
            crops: Array.isArray(cropPayload) ? cropPayload : [],
            savedAt,
            migrationRequired: taskPayload.migrationRequired === true,
            tasksTruncated: taskRes.headers.get("X-CampoAI-Tasks-Truncated") === "true",
          }));
        } catch {
          // Private browsing and storage limits must not block the online agenda.
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Load tasks error:", error);
      if (currentRequest === requestId.current) {
        setLoadError(error instanceof Error ? error.message : "No se pudo cargar la agenda.");
      }
    } finally {
      if (currentRequest === requestId.current) setLoaded(true);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [offlineReadOnly, userId]);

  useEffect(() => {
    void loadData();
    return () => {
      requestId.current += 1;
      requestRef.current?.abort();
    };
  }, [loadData]);
  useDataChangedRefresh(loadData, !offlineReadOnly);
  useOfflineSnapshotRefresh(loadData, userId, offlineReadOnly);

  return {
    tasks, setTasks, cattle, crops, members, loaded, loadError, migrationRequired, boardMigrationRequired,
    tasksTruncated, agendaSyncedAt, loadData,
  };
}
