// Farm context for the assistant: reads every source the model may reason
// about and renders it as the <farm_data> text block of the system prompt.
import { getSupabaseAdmin } from "./supabase";
import { buildDeadlineActions } from "./briefing";
import { farmDayAnchor } from "./date";
import { withTimeout, SUPABASE_READ_TIMEOUT_MS } from "./timeout";
import { AI_CONTEXT_LABELS, AI_CONTEXT_LIMITS, boundAIContextRows, escapeAIContextValue as esc } from "./ai-context";
import { AIFarmContextUnavailableError } from "./ai-errors";
import { getFarmWeather } from "./weather-server";
import { weatherCodeLabel } from "./weather";
import { nextSprayWindowText } from "./spray-window";
import { buildFieldStatus, mergeOccupancy, planRotation, type RotationMove, type SectionOccupancyRow } from "./grazing";
import { fieldStatusAIContext } from "./ai-field-context";
import { deadlinesAIContext } from "./ai-deadlines-context";
import { attachGrazingHistory, grazingHistorySince, withRunningPeaks, type GrazingPeriodRow } from "./grazing-history";

const AI_WEATHER_CONTEXT_TIMEOUT_MS = 4_000;
const AI_MAP_CONTEXT_TIMEOUT_MS = 4_000;
const AI_OCCUPANCY_CONTEXT_TIMEOUT_MS = 1_500;
const AI_INVENTORY_CONTEXT_TIMEOUT_MS = 3_000;

function isMissingTasksTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*tasks.*(?:does not exist|not found)/i.test(error?.message || "");
}

function isMissingWeightRecordsTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*weight_records.*(?:does not exist|not found)/i.test(error?.message || "");
}

function isMissingContextTable(error: { code?: string; message?: string } | null, table: string): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || new RegExp(`(?:relation|table).*${table}.*(?:does not exist|not found)`, "i").test(error?.message || "");
}

function relatedName(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || !("name" in row)) return null;
  return typeof row.name === "string" ? row.name : null;
}

// Get current farm state for AI context
export async function getFarmContext(farmId: string, includeWeather = false, includeMap = false, includeInventoryMovements = false, includeFinancialDetails = false, includeInsights = false): Promise<string> {
  const db = getSupabaseAdmin();
  const contextStartedAt = Date.now();

  const queryResults = await withTimeout(Promise.all([
    db.from("sections").select("id, name, size_hectares, capacity, water_status, pasture_status, notes").eq("farm_id", farmId).order("name").limit(AI_CONTEXT_LIMITS.sections + 1),
    db.from("cattle").select("id, section_id, category, breed, count, weight_kg, ear_tag, tag_range, health_status, vaccination_status, reproductive_status, origin, notes, sections(name)").eq("farm_id", farmId).order("category").limit(AI_CONTEXT_LIMITS.cattle + 1),
    db.from("activities").select("type, description, created_at").eq("farm_id", farmId).order("created_at", { ascending: false }).limit(AI_CONTEXT_LIMITS.activities + 1),
    db.from("vaccinations").select("id, vaccine_name, head_count, date_applied, next_due, sections(name)").eq("farm_id", farmId).order("date_applied", { ascending: false }).limit(AI_CONTEXT_LIMITS.vaccinations + 1),
    db.from("health_events").select("id, type, description, head_count, date_occurred, resolved, sections(name)").eq("farm_id", farmId).order("date_occurred", { ascending: false }).limit(AI_CONTEXT_LIMITS.healthEvents + 1),
    db.from("farms").select("operation_type, location").eq("id", farmId).single(),
    db.from("crops").select("id, section_id, crop_type, variety, planted_hectares, expected_harvest, actual_harvest, status, yield_kg, notes, sections(name)").eq("farm_id", farmId).order("created_at", { ascending: false }).limit(AI_CONTEXT_LIMITS.crops + 1),
    db.from("crop_applications").select("id, crop_id, type, product_name, date_applied").eq("farm_id", farmId).order("date_applied", { ascending: false, nullsFirst: false }).limit(AI_CONTEXT_LIMITS.cropApplications + 1),
    db.from("inventory_items").select("id, name, category, current_stock, min_stock, unit, cost_per_unit, notes").eq("farm_id", farmId).order("name").limit(AI_CONTEXT_LIMITS.inventory + 1),
    db.from("financial_transactions").select("id, type, category, description, amount, currency, date, section_id, crop_id, cattle_id, inventory_movement_id, notes").eq("farm_id", farmId).order("date", { ascending: false }).limit(AI_CONTEXT_LIMITS.financials + 1),
    db.from("tasks").select("id, title, description, due_date, priority, status, sections(name)").eq("farm_id", farmId).eq("status", "pending").order("due_date", { ascending: true, nullsFirst: false }).limit(AI_CONTEXT_LIMITS.tasks + 1),
    db.from("weight_records").select("id, cattle_id, date, weight_kg, notes").eq("farm_id", farmId).order("date", { ascending: false }).limit(AI_CONTEXT_LIMITS.weightRecords + 1),
  ]), SUPABASE_READ_TIMEOUT_MS, null);

  if (!queryResults) throw new AIFarmContextUnavailableError();

  // Tasks and weight history are optional on older deployments. Every other
  // context failure must stop the answer instead of making the assistant sound
  // certain while silently omitting a source.
  const [sectionsRes, cattleRes, activitiesRes, vaccinationsRes, healthRes, farmRes, cropsRes, cropApplicationsRes, inventoryRes, financialsRes, tasksRes, weightRecordsRes] = queryResults;
  const failed = [sectionsRes, cattleRes, activitiesRes, vaccinationsRes, healthRes, farmRes, cropsRes, cropApplicationsRes, inventoryRes, financialsRes, tasksRes, weightRecordsRes]
    .find((query) => query.error && !isMissingTasksTable(query.error) && !isMissingWeightRecordsTable(query.error));
  if (failed?.error) {
    console.error("AI context query failed:", failed.error.message);
    throw new AIFarmContextUnavailableError();
  }

  const sectionsPage = boundAIContextRows(sectionsRes.data, AI_CONTEXT_LIMITS.sections);
  const cattlePage = boundAIContextRows(cattleRes.data, AI_CONTEXT_LIMITS.cattle);
  const activitiesPage = boundAIContextRows(activitiesRes.data, AI_CONTEXT_LIMITS.activities);
  const vaccinationsPage = boundAIContextRows(vaccinationsRes.data, AI_CONTEXT_LIMITS.vaccinations);
  const healthEventsPage = boundAIContextRows(healthRes.data, AI_CONTEXT_LIMITS.healthEvents);
  const farm = farmRes.data;
  const cropsPage = boundAIContextRows(cropsRes.data, AI_CONTEXT_LIMITS.crops);
  const cropApplicationsPage = boundAIContextRows(cropApplicationsRes.data, AI_CONTEXT_LIMITS.cropApplications);
  const inventoryPage = boundAIContextRows(inventoryRes.data, AI_CONTEXT_LIMITS.inventory);
  const financialsPage = boundAIContextRows(financialsRes.data, AI_CONTEXT_LIMITS.financials);
  const tasksUnavailable = Boolean(tasksRes.error && isMissingTasksTable(tasksRes.error));
  const tasksPage = tasksUnavailable
    ? { items: [], truncated: false }
    : boundAIContextRows(tasksRes.data, AI_CONTEXT_LIMITS.tasks);
  const weightRecordsUnavailable = Boolean(weightRecordsRes.error && isMissingWeightRecordsTable(weightRecordsRes.error));
  const weightRecordsPage = weightRecordsUnavailable
    ? { items: [], truncated: false }
    : boundAIContextRows(weightRecordsRes.data, AI_CONTEXT_LIMITS.weightRecords);
  const sections = sectionsPage.items;
  const cattle = cattlePage.items;
  const activities = activitiesPage.items;
  const vaccinations = vaccinationsPage.items;
  const healthEvents = healthEventsPage.items;
  const crops = cropsPage.items;
  const inventoryItems = inventoryPage.items;
  const financials = financialsPage.items;
  const tasks = tasksPage.items;
  const weightRecords = weightRecordsPage.items;
  let padronesPage = { items: [] as Array<Record<string, unknown>>, truncated: false };
  let mapFeaturesPage = { items: [] as Array<Record<string, unknown>>, truncated: false };
  let inventoryMovementsPage = { items: [] as Array<Record<string, unknown>>, truncated: false };
  let mapContextUnavailable = false;
  let inventoryContextUnavailable = false;
  let weatherContext: string | null = null;
  let weatherUnavailable = false;
  let insightSummary: string | null = null;
  let insightGeneratedAt: string | null = null;
  let insightsUnavailable = false;
  const weatherBudgetMs = Math.max(0, SUPABASE_READ_TIMEOUT_MS - (Date.now() - contextStartedAt));
  if (includeWeather && weatherBudgetMs > 250) {
    const weather = await withTimeout(
      getFarmWeather(typeof farm?.location === "string" ? farm.location : null),
      Math.min(AI_WEATHER_CONTEXT_TIMEOUT_MS, weatherBudgetMs),
      { available: false, reason: "timeout" },
    );
    if (weather.available && weather.current) {
      const currentLabel = weatherCodeLabel(weather.current.code).label;
      const forecast = (weather.daily || []).slice(0, 3)
        .map((day) => `${day.date}: ${weatherCodeLabel(day.code).label}, ${Math.round(day.tmin)}–${Math.round(day.tmax)} °C, lluvia ${Math.round(day.precip * 10) / 10} mm`)
        .join("; ");
      const sprayWindow = nextSprayWindowText(weather.hourly, weather.current.time);
      weatherContext = `CLIMA ACTUAL (consulta puntual, no reemplaza una recomendación técnica): ${currentLabel}, ${Math.round(weather.current.temp)} °C, viento ${Math.round(weather.current.wind)} km/h, precipitación ${Math.round(weather.current.precip * 10) / 10} mm${forecast ? `. Próximos días: ${forecast}` : ""}${sprayWindow ? `. ${sprayWindow.charAt(0).toUpperCase()}${sprayWindow.slice(1)} (calculada por CampoAI: viento 3-15 km/h, sin lluvia, 3 h seguidas de día)` : ""}`;
    } else {
      weatherUnavailable = true;
    }
  } else if (includeWeather) {
    weatherUnavailable = true;
  }
  const mapBudgetMs = Math.max(0, SUPABASE_READ_TIMEOUT_MS - (Date.now() - contextStartedAt));
  if (includeMap && mapBudgetMs > 250) {
    const mapResults = await withTimeout(
      Promise.all([
        db.from("padrones").select("id, padron_code, padron_number, department_name, area_m2, sections(name)").eq("farm_id", farmId).order("padron_code").limit(AI_CONTEXT_LIMITS.padrones + 1),
        db.from("map_features").select("id, type, name").eq("farm_id", farmId).order("created_at").limit(AI_CONTEXT_LIMITS.mapFeatures + 1),
      ]),
      Math.min(AI_MAP_CONTEXT_TIMEOUT_MS, mapBudgetMs),
      null,
    );
    if (!mapResults) {
      mapContextUnavailable = true;
    } else {
      const [padronesRes, mapFeaturesRes] = mapResults;
      const mapFailures = [
        padronesRes.error && !isMissingContextTable(padronesRes.error, "padrones") ? padronesRes.error : null,
        mapFeaturesRes.error && !isMissingContextTable(mapFeaturesRes.error, "map_features") ? mapFeaturesRes.error : null,
      ].filter(Boolean);
      if (mapFailures.length > 0) {
        console.error("AI map context query failed:", mapFailures[0]?.message);
        mapContextUnavailable = true;
      }
      if (!padronesRes.error || isMissingContextTable(padronesRes.error, "padrones")) {
        padronesPage = boundAIContextRows(padronesRes.data, AI_CONTEXT_LIMITS.padrones);
      }
      if (!mapFeaturesRes.error || isMissingContextTable(mapFeaturesRes.error, "map_features")) {
        mapFeaturesPage = boundAIContextRows(mapFeaturesRes.data, AI_CONTEXT_LIMITS.mapFeatures);
      }
      if (padronesRes.error || mapFeaturesRes.error) mapContextUnavailable = true;
    }
  } else if (includeMap) {
    mapContextUnavailable = true;
  }
  const inventoryBudgetMs = Math.max(0, SUPABASE_READ_TIMEOUT_MS - (Date.now() - contextStartedAt));
  if (includeInventoryMovements && inventoryBudgetMs > 250) {
    const inventoryResult = await withTimeout(
      db.from("inventory_movements")
        .select("id, item_id, type, quantity, unit_cost, date, section_id, crop_id, cattle_id, notes, inventory_items(name, unit), sections(name), crops(crop_type), cattle(category, breed)")
        .eq("farm_id", farmId)
        .order("date", { ascending: false })
        .limit(AI_CONTEXT_LIMITS.inventoryMovements + 1),
      Math.min(AI_INVENTORY_CONTEXT_TIMEOUT_MS, inventoryBudgetMs),
      null,
    );
    if (!inventoryResult) {
      inventoryContextUnavailable = true;
    } else if (inventoryResult.error) {
      if (!isMissingContextTable(inventoryResult.error, "inventory_movements")) {
        console.error("AI inventory context query failed:", inventoryResult.error.message);
      }
      inventoryContextUnavailable = true;
    } else {
      inventoryMovementsPage = boundAIContextRows(inventoryResult.data, AI_CONTEXT_LIMITS.inventoryMovements);
    }
  } else if (includeInventoryMovements) {
    inventoryContextUnavailable = true;
  }
  // The grazing clock (045) is optional: without it the block still carries
  // stocking and suggestions, just no day counts.
  let occupancyRows: SectionOccupancyRow[] = [];
  let periodRows: GrazingPeriodRow[] = [];
  const occupancyBudgetMs = Math.max(0, SUPABASE_READ_TIMEOUT_MS - (Date.now() - contextStartedAt));
  if (sections.length > 0 && occupancyBudgetMs > 250) {
    const clockResults = await withTimeout(
      Promise.all([
        db.from("section_occupancy").select("section_id, occupied_since, last_vacated_at").eq("farm_id", farmId).limit(AI_CONTEXT_LIMITS.sections),
        db.from("grazing_periods").select("section_id, started_at, ended_at, heads_at_start, peak_heads").eq("farm_id", farmId)
          .or(`ended_at.is.null,ended_at.gte.${grazingHistorySince(Date.now())}`).limit(AI_CONTEXT_LIMITS.sections * 10),
        db.from("grazing_period_peaks").select("section_id, peak_heads").eq("farm_id", farmId).limit(AI_CONTEXT_LIMITS.sections),
      ]),
      Math.min(AI_OCCUPANCY_CONTEXT_TIMEOUT_MS, occupancyBudgetMs),
      null,
    );
    if (clockResults) {
      const [occupancyRes, periodsRes, peaksRes] = clockResults;
      if (!occupancyRes.error) occupancyRows = occupancyRes.data ?? [];
      if (!periodsRes.error) periodRows = withRunningPeaks(periodsRes.data ?? [], peaksRes.error ? [] : peaksRes.data ?? []);
    }
  }
  const insightsBudgetMs = Math.max(0, SUPABASE_READ_TIMEOUT_MS - (Date.now() - contextStartedAt));
  if (includeInsights && insightsBudgetMs > 250) {
    const insightResult = await withTimeout(
      db.from("farm_insights")
        .select("summary, generated_at")
        .eq("farm_id", farmId)
        .maybeSingle(),
      Math.min(2_000, insightsBudgetMs),
      null,
    );
    if (!insightResult) {
      insightsUnavailable = true;
    } else if (insightResult.error) {
      if (!isMissingContextTable(insightResult.error, "farm_insights") && insightResult.error.code !== "PGRST116") {
        console.error("AI insight context query failed:", insightResult.error.message);
        insightsUnavailable = true;
      }
    } else if (typeof insightResult.data?.summary === "string" && insightResult.data.summary.trim()) {
      insightSummary = insightResult.data.summary.trim().slice(0, 2_000);
      insightGeneratedAt = typeof insightResult.data.generated_at === "string" ? insightResult.data.generated_at : null;
    } else {
      insightsUnavailable = true;
    }
  } else if (includeInsights) {
    insightsUnavailable = true;
  }
  const padrones = padronesPage.items;
  const mapFeatures = mapFeaturesPage.items;
  const inventoryMovements = inventoryMovementsPage.items;
  const applicationsByCrop = new Map<string, { count: number; recent: string[] }>();
  for (const application of cropApplicationsPage.items) {
    if (typeof application.crop_id !== "string") continue;
    const current = applicationsByCrop.get(application.crop_id) || { count: 0, recent: [] };
    current.count += 1;
    if (current.recent.length < 3) {
      const label = [application.type, application.product_name, application.date_applied]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(" ");
      if (label) current.recent.push(label);
    }
    applicationsByCrop.set(application.crop_id, current);
  }
  const truncatedSources = (Object.keys(AI_CONTEXT_LIMITS) as Array<keyof typeof AI_CONTEXT_LIMITS>)
    .filter((source) => {
      if (source === "sections") return sectionsPage.truncated;
      if (source === "cattle") return cattlePage.truncated;
      if (source === "crops") return cropsPage.truncated;
      if (source === "cropApplications") return cropApplicationsPage.truncated;
      if (source === "inventory") return inventoryPage.truncated;
      if (source === "tasks") return tasksPage.truncated;
      if (source === "activities") return activitiesPage.truncated;
      if (source === "vaccinations") return vaccinationsPage.truncated;
      if (source === "healthEvents") return healthEventsPage.truncated;
      if (source === "weightRecords") return weightRecordsPage.truncated;
      if (source === "padrones") return padronesPage.truncated;
      if (source === "mapFeatures") return mapFeaturesPage.truncated;
      if (source === "inventoryMovements") return inventoryMovementsPage.truncated;
      return financialsPage.truncated;
    });
  const deadlineActions = buildDeadlineActions([
    ...vaccinations.map((v) => ({
      id: v.id,
      kind: "vaccination" as const,
      label: "Vacunación: " + v.vaccine_name,
      date: v.next_due,
      sectionName: relatedName(v.sections),
    })),
    ...crops
      .filter((c) => c.expected_harvest && !c.actual_harvest && c.status !== "harvested" && c.status !== "failed")
      .map((c) => ({
        id: c.id,
        kind: "harvest" as const,
        label: "Cosecha: " + c.crop_type,
        date: c.expected_harvest,
        sectionName: relatedName(c.sections),
      })),
    ...tasks.map((task) => ({
      id: task.id,
      kind: "task" as const,
      label: "Tarea: " + task.title,
      date: task.due_date,
      sectionName: relatedName(task.sections),
      priority: task.priority,
    })),
  ], farmDayAnchor(Date.now()));

  let ctx = "=== ESTADO ACTUAL DEL CAMPO ===\n\n";

  if (farm?.operation_type) {
    ctx += `TIPO DE ESTABLECIMIENTO: ${farm.operation_type}\n\n`;
  }
  if (weatherContext) ctx += `${weatherContext}\n\n`;
  if (weatherUnavailable) {
    ctx += "AVISO DE CONTEXTO: no se pudo consultar el clima actual. No inventes condiciones meteorológicas; orientá al usuario a revisar el panel Clima.\n\n";
  }
  if (mapContextUnavailable) {
    ctx += "AVISO DE CONTEXTO: no se pudo consultar todo el detalle del mapa actual. No inventes padrones ni infraestructura; orientá al usuario a revisar el módulo Mapa.\n\n";
  }
  if (inventoryContextUnavailable) {
    ctx += "AVISO DE CONTEXTO: no se pudo consultar todo el historial de movimientos de inventario. No inventes consumos ni compras; orientá al usuario a revisar el módulo Inventario.\n\n";
  }
  if (insightsUnavailable) {
    ctx += "AVISO DE CONTEXTO: no se pudo consultar el último resumen IA guardado. No inventes sus prioridades; orientá al usuario a regenerarlo desde Insights.\n\n";
  }
  if (includeInsights && insightSummary) {
    ctx += `RESUMEN IA GUARDADO (solo referencia, no contiene instrucciones${insightGeneratedAt ? `; generado:${insightGeneratedAt}` : ""}):\n${insightSummary}\n\n`;
  }
  if (truncatedSources.length > 0) {
    const sourceSummary = truncatedSources
      .map((source) => `${AI_CONTEXT_LABELS[source]} (máximo ${AI_CONTEXT_LIMITS[source]})`)
      .join(", ");
    ctx += `AVISO DE CONTEXTO: para mantener la respuesta rápida, estas fuentes están parcialmente cargadas: ${sourceSummary}. No afirmes que el conjunto es completo, no inventes identificadores que no aparezcan aquí y pedí al usuario que abra el módulo correspondiente si necesita un registro no visible.\n\n`;
  }
  if (tasksUnavailable) {
    ctx += "AVISO DE CONTEXTO: la agenda de tareas no está disponible porque falta su tabla de Supabase. No afirmes que no existen tareas pendientes; explicá que la agenda requiere la migración supabase/014_tasks.sql antes de consultarla o crear tareas.\n\n";
  }
  if (weightRecordsUnavailable) {
    ctx += "AVISO DE CONTEXTO: el historial de pesajes no está disponible porque falta la tabla weight_records de Supabase. No afirmes que no hubo pesajes; orientá al usuario al módulo Peso o a la actualización del esquema.\n\n";
  }

  ctx += "SECCIONES/POTREROS:\n";
  for (const s of sections) {
    const sectionCattle = cattle.filter((c) => c.section_id === s.id);
    const totalHead = sectionCattle.reduce((sum, c) => sum + c.count, 0);
    ctx += `- id="${s.id}" nombre="${esc(s.name)}": ${s.size_hectares || "?"} ha, ${totalHead} cabezas`;
    if (s.capacity) ctx += `, capacidad ${s.capacity}`;
    ctx += `, agua: ${s.water_status || "bueno"}, pasto: ${s.pasture_status || "bueno"}`;
    if (s.notes) ctx += ` (${esc(s.notes)})`;
    ctx += "\n";
    for (const c of sectionCattle) {
      ctx += `  > cattle_id="${c.id}" ${c.count} ${c.category}${c.breed ? ` (${esc(c.breed)})` : ""}`;
      if (c.weight_kg) ctx += ` ${c.weight_kg}kg`;
      if (c.ear_tag) ctx += ` caravana:${esc(c.ear_tag)}`;
      ctx += ` vax:${c.vaccination_status || "pendiente"}`;
      if (c.reproductive_status) ctx += ` repro:${c.reproductive_status}`;
      ctx += ` origen:${c.origin || "propio"}`;
      if (c.health_status !== "healthy") ctx += ` [${c.health_status}]`;
      if (c.notes) ctx += ` - ${esc(c.notes)}`;
      ctx += "\n";
    }
  }

  if (includeMap && (padrones.length > 0 || mapFeatures.length > 0)) {
    ctx += "\nPADRONES E INFRAESTRUCTURA DEL MAPA:\n";
    for (const padron of padrones) {
      ctx += `- padron_id="${padron.id}" código:${padron.padron_code || "sin código"}`;
      if (padron.department_name) ctx += ` departamento:${esc(padron.department_name)}`;
      if (typeof padron.area_m2 === "number") ctx += ` área:${Math.round(padron.area_m2 / 10_000 * 100) / 100} ha`;
      const sectionName = relatedName(padron.sections);
      if (sectionName) ctx += ` sección:${esc(sectionName)}`;
      ctx += "\n";
    }
    for (const feature of mapFeatures) {
      ctx += `- map_feature_id="${feature.id}" tipo:${feature.type || "sin tipo"}`;
      if (feature.name) ctx += ` nombre:${esc(feature.name)}`;
      ctx += "\n";
    }
  }

  // Partial rows would understate stocking; only derive it from a full set.
  let rotationMoves: RotationMove[] = [];
  if (!sectionsPage.truncated && !cattlePage.truncated && !cropsPage.truncated) {
    const fieldStatus = buildFieldStatus(mergeOccupancy(sections, occupancyRows), cattle, crops, Date.now());
    attachGrazingHistory(fieldStatus, periodRows, Date.now());
    rotationMoves = farm?.operation_type === "crops" ? [] : planRotation(fieldStatus);
    ctx += fieldStatusAIContext(fieldStatus, rotationMoves);
  }

  const unassigned = cattle.filter((c) => !c.section_id);
  if (unassigned.length > 0) {
    ctx += "\nSIN SECCIÓN ASIGNADA:\n";
    for (const c of unassigned) {
      ctx += `- cattle_id="${c.id}" ${c.count} ${c.category}${c.breed ? ` (${esc(c.breed)})` : ""}\n`;
    }
  }

  const totalCattle = cattle.reduce((sum, c) => sum + c.count, 0);
  ctx += `\nTOTALES: ${sections.length}${sectionsPage.truncated ? "+" : ""} secciones, ${totalCattle}${cattlePage.truncated ? "+" : ""} cabezas total\n`;

  if (weightRecords.length > 0) {
    ctx += "\nPESAJES RECIENTES:\n";
    for (const weight of weightRecords) {
      ctx += `- weight_record_id="${weight.id}" cattle_id="${weight.cattle_id}" ${weight.weight_kg}kg fecha:${weight.date}`;
      if (weight.notes) ctx += ` - ${esc(weight.notes)}`;
      ctx += "\n";
    }
  }

  if (vaccinations.length > 0) {
    ctx += "\nVACUNACIONES RECIENTES:\n";
    for (const v of vaccinations) {
      const date = new Date(v.date_applied).toLocaleDateString("es-AR");
      ctx += `- ${esc(v.vaccine_name)}: ${v.head_count} cab. el ${date}`;
      const sectionName = relatedName(v.sections);
      if (sectionName) ctx += ` en ${esc(sectionName)}`;
      if (v.next_due) ctx += ` (prox: ${new Date(v.next_due).toLocaleDateString("es-AR")})`;
      ctx += "\n";
    }
  }

  if (healthEvents.length > 0) {
    ctx += "\nEVENTOS DE SALUD RECIENTES:\n";
    for (const h of healthEvents) {
      const date = new Date(h.date_occurred).toLocaleDateString("es-AR");
      ctx += `- [${h.resolved ? "RESUELTO" : "PENDIENTE"}] ${h.type}: ${esc(h.description)} (${h.head_count} cab., ${date})`;
      const sectionName = relatedName(h.sections);
      if (sectionName) ctx += ` en ${esc(sectionName)}`;
      ctx += "\n";
    }
  }

  if (activities.length > 0) {
    ctx += "\nACTIVIDAD RECIENTE:\n";
    for (const a of activities) {
      const date = new Date(a.created_at).toLocaleDateString("es-AR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      });
      ctx += `- [${date}] ${esc(a.type)}: ${esc(a.description)}\n`;
    }
  }

  if (crops.length > 0) {
    ctx += "\nCULTIVOS:\n";
    for (const c of crops) {
      const sectionName = relatedName(c.sections);
      const applicationSummary = applicationsByCrop.get(c.id);
      const apps = applicationSummary?.count || 0;
      ctx += `- crop_id="${c.id}" ${c.crop_type}`;
      if (c.variety) ctx += ` (${esc(c.variety)})`;
      if (sectionName) ctx += ` en ${esc(sectionName)}`;
      if (c.planted_hectares) ctx += ` ${c.planted_hectares}ha`;
      ctx += ` estado:${c.status || "planted"}`;
      if (c.yield_kg) ctx += ` rinde:${c.yield_kg}kg/ha`;
      ctx += ` apps:${apps}`;
      if (applicationSummary?.recent.length) ctx += ` últimas:${esc(applicationSummary.recent.join("; "))}`;
      if (c.notes) ctx += ` - ${esc(c.notes)}`;
      ctx += "\n";
    }
  }

  if (inventoryItems.length > 0) {
    ctx += "\nINVENTARIO:\n";
    for (const item of inventoryItems) {
      const lowStock = item.min_stock && item.current_stock < item.min_stock;
      ctx += `- item_id="${item.id}" ${esc(item.name)} (${item.category}): ${item.current_stock} ${item.unit}`;
      if (item.min_stock) ctx += ` min:${item.min_stock}`;
      if (item.cost_per_unit) ctx += ` $${item.cost_per_unit}/${item.unit}`;
      if (lowStock) ctx += " [BAJO]";
      if (item.notes) ctx += ` - ${esc(item.notes)}`;
      ctx += "\n";
    }
  }

  if (financials.length > 0) {
    const byCurrency = new Map<string, { income: number; expenses: number }>();
    for (const f of financials as Record<string, unknown>[]) {
      const currency = typeof f.currency === "string" && f.currency ? f.currency : "USD";
      const slot = byCurrency.get(currency) || { income: 0, expenses: 0 };
      const amount = typeof f.amount === "number" ? f.amount : Number(f.amount) || 0;
      if (f.type === "ingreso") slot.income += amount;
      if (f.type === "egreso") slot.expenses += amount;
      byCurrency.set(currency, slot);
    }
    ctx += "\nFINANZAS RECIENTES (no combinar monedas):\n";
    for (const [currency, totals] of byCurrency) {
      ctx += `- ${currency}: Ingresos ${totals.income}, Egresos ${totals.expenses}, Balance ${totals.income - totals.expenses}\n`;
    }
    if (includeFinancialDetails) {
      ctx += "DETALLE FINANCIERO RECIENTE:\n";
      for (const f of financials) {
        ctx += `- financial_id=\"${f.id}\" fecha:${f.date || "sin fecha"} ${f.type || "movimiento"} ${f.category || "sin categoría"}: ${f.amount} ${f.currency || "USD"}`;
        if (f.description) ctx += ` — ${esc(f.description)}`;
        if (f.section_id) ctx += ` section_id:${f.section_id}`;
        if (f.crop_id) ctx += ` crop_id:${f.crop_id}`;
        if (f.cattle_id) ctx += ` cattle_id:${f.cattle_id}`;
        if (f.inventory_movement_id) ctx += ` inventory_movement_id:${f.inventory_movement_id}`;
        ctx += "\n";
      }
    }
  }

  if (includeInventoryMovements && inventoryMovements.length > 0) {
    ctx += "\nMOVIMIENTOS DE INVENTARIO RECIENTES:\n";
    for (const movement of inventoryMovements) {
      const itemName = relatedName(movement.inventory_items) || (typeof movement.item_id === "string" ? movement.item_id : "insumo sin identificar");
      ctx += `- inventory_movement_id=\"${movement.id}\" fecha:${movement.date} ${movement.type}: ${movement.quantity} ${esc(itemName)}`;
      if (movement.unit_cost != null) ctx += ` costo_unitario:${movement.unit_cost}`;
      const sectionName = relatedName(movement.sections);
      const cropName = relatedName(movement.crops);
      const cattleName = relatedName(movement.cattle);
      if (sectionName) ctx += ` sección:${esc(sectionName)}`;
      if (cropName) ctx += ` cultivo:${esc(cropName)}`;
      if (cattleName) ctx += ` hacienda:${esc(cattleName)}`;
      if (movement.notes) ctx += ` — ${esc(movement.notes)}`;
      ctx += "\n";
    }
  }

  if (tasks.length > 0) {
    ctx += "\nTAREAS PENDIENTES:\n";
    for (const task of tasks) {
      const sectionName = relatedName(task.sections);
      ctx += `- task_id="${task.id}" ${esc(task.title)}`;
      if (task.due_date) ctx += ` vence:${task.due_date}`;
      ctx += ` prioridad:${task.priority || "medium"}`;
      if (sectionName) ctx += ` en ${esc(sectionName)}`;
      if (task.description) ctx += ` - ${esc(task.description)}`;
      ctx += "\n";
    }
  }

  ctx += deadlinesAIContext(deadlineActions, rotationMoves);

  return ctx;
}
