import { getSupabaseAdmin } from "./supabase";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Transcribe audio using Groq Whisper
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: "audio/ogg" }),
    "audio.ogg"
  );
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("language", "es");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Whisper error:", err);
    throw new Error("Audio transcription failed");
  }

  const data = await res.json();
  return data.text;
}

// Get current farm state for AI context
async function getFarmContext(farmId: string): Promise<string> {
  const db = getSupabaseAdmin();

  const [sectionsRes, cattleRes, activitiesRes, vaccinationsRes, healthRes, farmRes, cropsRes, inventoryRes, financialsRes] = await Promise.all([
    db.from("sections").select("*").eq("farm_id", farmId).order("name"),
    db.from("cattle").select("*, sections(name)").eq("farm_id", farmId),
    db.from("activities").select("*").eq("farm_id", farmId).order("created_at", { ascending: false }).limit(20),
    db.from("vaccinations").select("*, sections(name)").eq("farm_id", farmId).order("date_applied", { ascending: false }).limit(10),
    db.from("health_events").select("*, sections(name)").eq("farm_id", farmId).order("date_occurred", { ascending: false }).limit(10),
    db.from("farms").select("operation_type").eq("id", farmId).single(),
    db.from("crops").select("*, sections(name), crop_applications(id, type, product_name, date_applied)").eq("farm_id", farmId),
    db.from("inventory_items").select("*").eq("farm_id", farmId),
    db.from("financial_transactions").select("*").eq("farm_id", farmId).order("date", { ascending: false }).limit(10),
  ]);

  const sections = sectionsRes.data || [];
  const cattle = cattleRes.data || [];
  const activities = activitiesRes.data || [];
  const vaccinations = vaccinationsRes.data || [];
  const healthEvents = healthRes.data || [];
  const farm = farmRes.data;
  const crops = cropsRes.data || [];
  const inventoryItems = inventoryRes.data || [];
  const financials = financialsRes.data || [];

  let ctx = "=== ESTADO ACTUAL DEL CAMPO ===\n\n";

  if (farm?.operation_type) {
    ctx += `TIPO DE ESTABLECIMIENTO: ${farm.operation_type}\n\n`;
  }

  ctx += "SECCIONES/POTREROS:\n";
  for (const s of sections) {
    const sectionCattle = cattle.filter((c) => c.section_id === s.id);
    const totalHead = sectionCattle.reduce((sum, c) => sum + c.count, 0);
    ctx += `- id="${s.id}" nombre="${s.name}": ${s.size_hectares || "?"} ha, ${totalHead} cabezas`;
    if (s.capacity) ctx += `, capacidad ${s.capacity}`;
    ctx += `, agua: ${s.water_status || "bueno"}, pasto: ${s.pasture_status || "bueno"}`;
    if (s.notes) ctx += ` (${s.notes})`;
    ctx += "\n";
    for (const c of sectionCattle) {
      ctx += `  > cattle_id="${c.id}" ${c.count} ${c.category}${c.breed ? ` (${c.breed})` : ""}`;
      if (c.weight_kg) ctx += ` ${c.weight_kg}kg`;
      if (c.ear_tag) ctx += ` caravana:${c.ear_tag}`;
      ctx += ` vax:${c.vaccination_status || "pendiente"}`;
      if (c.reproductive_status) ctx += ` repro:${c.reproductive_status}`;
      ctx += ` origen:${c.origin || "propio"}`;
      if (c.health_status !== "healthy") ctx += ` [${c.health_status}]`;
      if (c.notes) ctx += ` - ${c.notes}`;
      ctx += "\n";
    }
  }

  const unassigned = cattle.filter((c) => !c.section_id);
  if (unassigned.length > 0) {
    ctx += "\nSIN SECCION ASIGNADA:\n";
    for (const c of unassigned) {
      ctx += `- cattle_id="${c.id}" ${c.count} ${c.category}${c.breed ? ` (${c.breed})` : ""}\n`;
    }
  }

  const totalCattle = cattle.reduce((sum, c) => sum + c.count, 0);
  ctx += `\nTOTALES: ${sections.length} secciones, ${totalCattle} cabezas total\n`;

  if (vaccinations.length > 0) {
    ctx += "\nVACUNACIONES RECIENTES:\n";
    for (const v of vaccinations) {
      const date = new Date(v.date_applied).toLocaleDateString("es-AR");
      ctx += `- ${v.vaccine_name}: ${v.head_count} cab. el ${date}`;
      if (v.sections?.name) ctx += ` en ${v.sections.name}`;
      if (v.next_due) ctx += ` (prox: ${new Date(v.next_due).toLocaleDateString("es-AR")})`;
      ctx += "\n";
    }
  }

  if (healthEvents.length > 0) {
    ctx += "\nEVENTOS DE SALUD RECIENTES:\n";
    for (const h of healthEvents) {
      const date = new Date(h.date_occurred).toLocaleDateString("es-AR");
      ctx += `- [${h.resolved ? "RESUELTO" : "PENDIENTE"}] ${h.type}: ${h.description} (${h.head_count} cab., ${date})`;
      if (h.sections?.name) ctx += ` en ${h.sections.name}`;
      ctx += "\n";
    }
  }

  if (activities.length > 0) {
    ctx += "\nACTIVIDAD RECIENTE:\n";
    for (const a of activities.slice(0, 10)) {
      const date = new Date(a.created_at).toLocaleDateString("es-AR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      });
      ctx += `- [${date}] ${a.type}: ${a.description}\n`;
    }
  }

  if (crops.length > 0) {
    ctx += "\nCULTIVOS:\n";
    for (const c of crops) {
      const sectionName = (c as Record<string, unknown>).sections
        ? ((c as Record<string, unknown>).sections as Record<string, unknown>).name
        : null;
      const apps = Array.isArray(c.crop_applications) ? c.crop_applications.length : 0;
      ctx += `- crop_id="${c.id}" ${c.crop_type}`;
      if (c.variety) ctx += ` (${c.variety})`;
      if (sectionName) ctx += ` en ${sectionName}`;
      if (c.planted_hectares) ctx += ` ${c.planted_hectares}ha`;
      ctx += ` estado:${c.status || "planted"}`;
      if (c.yield_kg) ctx += ` rinde:${c.yield_kg}kg/ha`;
      ctx += ` apps:${apps}`;
      if (c.notes) ctx += ` - ${c.notes}`;
      ctx += "\n";
    }
  }

  if (inventoryItems.length > 0) {
    ctx += "\nINVENTARIO:\n";
    for (const item of inventoryItems) {
      const lowStock = item.min_stock && item.current_stock < item.min_stock;
      ctx += `- item_id="${item.id}" ${item.name} (${item.category}): ${item.current_stock} ${item.unit}`;
      if (item.min_stock) ctx += ` min:${item.min_stock}`;
      if (item.cost_per_unit) ctx += ` $${item.cost_per_unit}/${item.unit}`;
      if (lowStock) ctx += " [BAJO]";
      if (item.notes) ctx += ` - ${item.notes}`;
      ctx += "\n";
    }
  }

  if (financials.length > 0) {
    const ingresos = financials.filter((f: Record<string, unknown>) => f.type === "ingreso").reduce((sum: number, f: Record<string, unknown>) => sum + (f.amount as number), 0);
    const egresos = financials.filter((f: Record<string, unknown>) => f.type === "egreso").reduce((sum: number, f: Record<string, unknown>) => sum + (f.amount as number), 0);
    ctx += `\nFINANZAS RECIENTES: Ingresos $${ingresos}, Egresos $${egresos}, Balance $${ingresos - egresos}\n`;
  }

  return ctx;
}

interface AIAction {
  intent: "update" | "query" | "setup" | "help";
  response: string;
  dbOperations?: DBOperation[];
}

interface DBOperation {
  table: string;
  action: "insert" | "update" | "delete" | "upsert" | "move";
  data: Record<string, unknown>;
  match?: Record<string, unknown>;
  move_count?: number;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

// Main AI processing function
export async function processMessage(
  farmId: string,
  message: string,
  messageType: string = "text",
  history: ChatHistoryMessage[] = []
): Promise<AIAction> {
  const farmContext = await getFarmContext(farmId);

  const systemPrompt = `Sos un asistente de gestión ganadera/agrícola llamado CampoAI. Hablás español rioplatense (vos, sos, tenés). Tu trabajo es:

1. ACTUALIZAR datos cuando el usuario reporta cambios (movimientos, conteos, salud, vacunaciones, eventos)
2. CONSULTAR datos cuando el usuario pregunta sobre el estado del campo
3. CONFIGURAR el campo cuando el usuario quiere agregar secciones o registrar hacienda nueva
4. AYUDAR explicando cómo usar el sistema

SIEMPRE respondé en JSON con esta estructura exacta (sin markdown ni code fences):
{
  "intent": "update" | "query" | "setup" | "help",
  "response": "texto de respuesta amigable para el usuario",
  "dbOperations": [
    {
      "table": "sections" | "cattle" | "activities" | "vaccinations" | "health_events" | "crops" | "crop_applications" | "inventory_items" | "inventory_movements" | "financial_transactions",
      "action": "insert" | "update" | "delete" | "move",
      "data": { ... },
      "match": { ... },
      "move_count": N
    }
  ]
}

TABLAS Y COLUMNAS DISPONIBLES:

sections: name (text), size_hectares (number|null), capacity (int|null), color (text, default "#22c55e"), water_status ("bueno"|"bajo"|"seco"|"inundado"), pasture_status ("bueno"|"sobrepastoreado"|"seco"|"creciendo"), notes (text|null)

cattle: section_id (uuid), category (text), breed (text|null), count (int), weight_kg (number|null), ear_tag (text|null), tag_range (text|null), health_status (text, default "healthy"), vaccination_status ("al_dia"|"pendiente"|"vencida"), reproductive_status ("prenada"|"lactando"|"servicio"|"vacia"|null), origin ("propio"|"comprado"|"transferido"), notes (text|null)

vaccinations: vaccine_name (text), section_id (uuid|null), head_count (int), date_applied (ISO timestamp), next_due (ISO timestamp|null), applied_by (text|null), batch_number (text|null), notes (text|null)
  Vacunas comunes: Aftosa, Brucelosis, Carbunclo, Clostridiosis, Rabia, Leptospirosis, IBR, DVB, Antiparasitario

health_events: type ("nacimiento"|"muerte"|"enfermedad"|"lesion"|"tratamiento"|"revision"|"desparasitacion"|"destete"|"castrado"), description (text), section_id (uuid|null), head_count (int), date_occurred (ISO timestamp), resolved (boolean, default false), veterinarian (text|null), notes (text|null)

activities: type ("movement"|"count_update"|"health"|"note"|"setup"|"registration"), description (text), raw_message (text|null), message_type ("text"|"audio")

crops: section_id (uuid|null), crop_type (text, e.g. soja/trigo/maíz/girasol), variety (text|null), planted_hectares (number), planting_date (ISO date|null), expected_harvest (ISO date|null), actual_harvest (ISO date|null), yield_kg (number|null), status ("planted"|"growing"|"harvested"|"failed"), soil_type (text|null), irrigation_type ("secano"|"pivot"|"aspersión"|"goteo"|null), notes (text|null)

crop_applications: crop_id (uuid), type ("fertilizante"|"herbicida"|"insecticida"|"fungicida"), product_name (text|null), dose_per_hectare (text|null), total_applied (text|null), date_applied (ISO date|null), applied_by (text|null), weather_conditions ("soleado"|"nublado"|"lluvioso"|"ventoso"|null), notes (text|null)

inventory_items: name (text), category ("alimento"|"semilla"|"fertilizante"|"agroquímico"|"medicamento"|"combustible"|"otro"), unit ("kg"|"L"|"dosis"|"unidad"), current_stock (number), min_stock (number|null), cost_per_unit (number|null), notes (text|null)

inventory_movements: item_id (uuid), type ("compra"|"uso"|"ajuste"|"pérdida"), quantity (number, positivo para compra, negativo para uso), unit_cost (number|null, solo para compra), section_id (uuid|null), crop_id (uuid|null), cattle_id (uuid|null), date (ISO date), notes (text|null)

financial_transactions: type ("ingreso"|"egreso"), category ("venta_ganado"|"venta_cosecha"|"compra_insumo"|"servicio"|"mano_obra"|"transporte"|"veterinario"|"maquinaria"|"otro"), description (text|null), amount (number, siempre positivo), currency ("USD"|"UYU"|"ARS"), date (ISO date), section_id (uuid|null), crop_id (uuid|null), cattle_id (uuid|null), inventory_movement_id (uuid|null), notes (text|null)

REGLAS IMPORTANTES:
- NO incluyas farm_id en data — se agrega automáticamente
- Los section_id DEBEN ser UUIDs reales del contexto. Mirá id="..." de cada sección
- Los cattle_id están en el contexto como cattle_id="...". Usalos para identificar lotes específicos
- Categorías válidas: vaca, toro, ternero, ternera, novillo, vaquillona, caballo, yegua, oveja
- Para cultivos: crop_id debe ser UUID real del contexto
- Para inventario: item_id debe ser UUID real del contexto
- "pesos" = UYU o ARS según el contexto, "dólares" = USD
- Para compras de insumos, usá inventory_movements con type "compra" y NO financial_transactions directamente (el sistema crea la transacción financiera automáticamente)
- SIEMPRE incluí un insert en "activities" como última operación registrando qué se hizo
- Para queries sin cambios, dbOperations debe ser un array vacío []

MOVIMIENTOS DE GANADO (MUY IMPORTANTE):
Usá action "move" para mover ganado. Esto maneja automáticamente la división de lotes:
{
  "table": "cattle",
  "action": "move",
  "match": { "id": "cattle-uuid-del-lote-origen" },
  "data": { "section_id": "uuid-seccion-destino" },
  "move_count": 10
}
- match.id = el cattle_id del lote de origen (del contexto)
- data.section_id = UUID de la sección destino
- move_count = cuántas cabezas mover (si es menor que el lote total, se divide automáticamente)
- Si querés mover TODO el lote, usá move_count igual al count del lote
- NUNCA uses action "update" para mover ganado, SIEMPRE usá "move"

REGISTRAR HACIENDA NUEVA:
{
  "table": "cattle",
  "action": "insert",
  "data": { "section_id": "uuid", "category": "vaca", "count": 20, "breed": "Angus" }
}

CREAR SECCIÓN NUEVA:
Si la sección no existe, creala primero. Usá "NEW_SECTION_NombreSeccion" como section_id placeholder en operaciones siguientes — se resuelve automáticamente al ID real.

ACTUALIZAR DATOS DE UN LOTE:
{
  "table": "cattle",
  "action": "update",
  "match": { "id": "cattle-uuid" },
  "data": { "health_status": "enfermo", "notes": "fiebre" }
}

Si no entendés el mensaje, intent = "help" y pedí clarificación amigablemente.

${farmContext}`;

  // Build conversation messages
  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  // Add conversation history (last 10 exchanges max to keep context manageable)
  const recentHistory = history.slice(-20);
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add current message
  messages.push({
    role: "user",
    content: messageType === "audio"
      ? `[Mensaje de audio transcripto]: ${message}`
      : message,
  });

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Groq error:", err);
    return {
      intent: "help",
      response: "Hubo un error procesando tu mensaje. Intentá de nuevo.",
    };
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;

  try {
    return JSON.parse(content) as AIAction;
  } catch {
    return {
      intent: "help",
      response: "No pude entender la respuesta. Intentá de nuevo con otro mensaje.",
    };
  }
}

// Execute the DB operations returned by AI
export async function executeOperations(
  farmId: string,
  operations: DBOperation[]
): Promise<string[]> {
  const db = getSupabaseAdmin();
  const logs: string[] = [];
  const newSectionIds: Record<string, string> = {};

  for (const op of operations) {
    try {
      // Replace NEW_SECTION_ placeholders with real IDs
      const data = { ...op.data };
      const match = op.match ? { ...op.match } : undefined;

      for (const [key, val] of Object.entries(data)) {
        if (typeof val === "string" && val.startsWith("NEW_SECTION_")) {
          const realId = newSectionIds[val];
          if (realId) data[key] = realId;
        }
      }

      if (match) {
        for (const [key, val] of Object.entries(match)) {
          if (typeof val === "string" && val.startsWith("NEW_SECTION_")) {
            const realId = newSectionIds[val];
            if (realId) match[key] = realId;
          }
        }
      }

      // Ensure farm_id is set for inserts
      if (["sections", "cattle", "activities", "vaccinations", "health_events", "crops", "crop_applications", "inventory_items", "inventory_movements", "financial_transactions"].includes(op.table)) {
        data.farm_id = farmId;
      }

      // ── MOVE operation (split cattle batch) ──
      if (op.action === "move" && op.table === "cattle" && match?.id) {
        const moveCount = op.move_count || 0;
        const newSectionId = data.section_id;

        if (!newSectionId || !moveCount) {
          logs.push(`Error moving cattle: missing section_id or move_count`);
          continue;
        }

        // Fetch the source cattle record
        const { data: source, error: fetchErr } = await db
          .from("cattle")
          .select("*")
          .eq("id", match.id)
          .eq("farm_id", farmId)
          .single();

        if (fetchErr || !source) {
          logs.push(`Error moving cattle: source record not found (${match.id})`);
          continue;
        }

        if (moveCount >= source.count) {
          // Move the entire batch — just update section_id
          const { error } = await db
            .from("cattle")
            .update({ section_id: newSectionId })
            .eq("id", source.id)
            .eq("farm_id", farmId);

          if (error) {
            logs.push(`Error moving cattle: ${error.message}`);
          } else {
            logs.push(`Moved all ${source.count} ${source.category} to new section: OK`);
          }
        } else {
          // Partial move — reduce source count, create new record at destination
          const { error: updateErr } = await db
            .from("cattle")
            .update({ count: source.count - moveCount })
            .eq("id", source.id)
            .eq("farm_id", farmId);

          if (updateErr) {
            logs.push(`Error reducing source count: ${updateErr.message}`);
            continue;
          }

          // Create new record at destination with same attributes
          const { error: insertErr } = await db
            .from("cattle")
            .insert({
              farm_id: farmId,
              section_id: newSectionId,
              category: source.category,
              breed: source.breed,
              count: moveCount,
              tag_range: source.tag_range,
              ear_tag: null, // ear tags don't carry over in a split
              health_status: source.health_status,
              weight_kg: source.weight_kg,
              origin: source.origin,
              vaccination_status: source.vaccination_status,
              reproductive_status: source.reproductive_status,
              notes: null,
            })
            .select()
            .single();

          if (insertErr) {
            logs.push(`Error creating destination record: ${insertErr.message}`);
            // Rollback the count reduction
            await db.from("cattle").update({ count: source.count }).eq("id", source.id);
          } else {
            logs.push(`Moved ${moveCount} of ${source.count} ${source.category}: OK (split)`);
          }
        }
        continue;
      }

      // ── INSERT ──
      if (op.action === "insert") {
        const { data: inserted, error } = await db
          .from(op.table)
          .insert(data)
          .select()
          .single();

        if (error) {
          logs.push(`Error inserting into ${op.table}: ${error.message}`);
        } else {
          logs.push(`Inserted into ${op.table}: OK`);
          if (op.table === "sections" && inserted) {
            const nameKey = `NEW_SECTION_${data.name}`;
            newSectionIds[nameKey] = inserted.id;
          }
        }

      // ── UPDATE ──
      } else if (op.action === "update" && match) {
        let query = db.from(op.table).update(data);
        query = query.eq("farm_id", farmId);
        for (const [key, val] of Object.entries(match)) {
          query = query.eq(key, val);
        }
        const { error } = await query;
        if (error) {
          logs.push(`Error updating ${op.table}: ${error.message}`);
        } else {
          logs.push(`Updated ${op.table}: OK`);
        }

      // ── UPSERT ──
      } else if (op.action === "upsert") {
        const { error } = await db.from(op.table).upsert(data);
        if (error) {
          logs.push(`Error upserting ${op.table}: ${error.message}`);
        } else {
          logs.push(`Upserted ${op.table}: OK`);
        }

      // ── DELETE ──
      } else if (op.action === "delete" && match) {
        let query = db.from(op.table).delete();
        query = query.eq("farm_id", farmId);
        for (const [key, val] of Object.entries(match)) {
          query = query.eq(key, val);
        }
        const { error } = await query;
        if (error) {
          logs.push(`Error deleting from ${op.table}: ${error.message}`);
        } else {
          logs.push(`Deleted from ${op.table}: OK`);
        }
      }
    } catch (e) {
      logs.push(`Exception on ${op.table}: ${e}`);
    }
  }

  return logs;
}
