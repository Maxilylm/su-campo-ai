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

  const [sectionsRes, cattleRes, activitiesRes, vaccinationsRes, healthRes] = await Promise.all([
    db.from("sections").select("*").eq("farm_id", farmId).order("name"),
    db.from("cattle").select("*, sections(name)").eq("farm_id", farmId),
    db.from("activities").select("*").eq("farm_id", farmId).order("created_at", { ascending: false }).limit(20),
    db.from("vaccinations").select("*, sections(name)").eq("farm_id", farmId).order("date_applied", { ascending: false }).limit(10),
    db.from("health_events").select("*, sections(name)").eq("farm_id", farmId).order("date_occurred", { ascending: false }).limit(10),
  ]);

  const sections = sectionsRes.data || [];
  const cattle = cattleRes.data || [];
  const activities = activitiesRes.data || [];
  const vaccinations = vaccinationsRes.data || [];
  const healthEvents = healthRes.data || [];

  let ctx = "=== ESTADO ACTUAL DEL CAMPO ===\n\n";

  ctx += "SECCIONES/POTREROS (id → nombre):\n";
  for (const s of sections) {
    const sectionCattle = cattle.filter((c) => c.section_id === s.id);
    const totalHead = sectionCattle.reduce((sum, c) => sum + c.count, 0);
    ctx += `- id="${s.id}" nombre="${s.name}": ${s.size_hectares || "?"} ha, ${totalHead} cabezas`;
    if (s.capacity) ctx += `, capacidad ${s.capacity}`;
    ctx += `, agua: ${s.water_status || "bueno"}, pasto: ${s.pasture_status || "bueno"}`;
    if (s.notes) ctx += ` (${s.notes})`;
    ctx += "\n";
    for (const c of sectionCattle) {
      ctx += `  > ${c.count} ${c.category}${c.breed ? ` (${c.breed})` : ""}`;
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
      ctx += `- ${c.count} ${c.category}${c.breed ? ` (${c.breed})` : ""}\n`;
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

  return ctx;
}

interface AIAction {
  intent: "update" | "query" | "setup" | "help";
  response: string;
  dbOperations?: DBOperation[];
}

interface DBOperation {
  table: string;
  action: "insert" | "update" | "delete" | "upsert";
  data: Record<string, unknown>;
  match?: Record<string, unknown>;
}

// Main AI processing function
export async function processMessage(
  farmId: string,
  message: string,
  messageType: string = "text"
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
      "table": "sections" | "cattle" | "activities" | "vaccinations" | "health_events",
      "action": "insert" | "update" | "delete" | "upsert",
      "data": { ... },
      "match": { ... }
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

REGLAS IMPORTANTES:
- Usá el farm_id: "${farmId}" en TODAS las operaciones (se agrega automáticamente, no lo incluyas en data)
- Los section_id DEBEN ser UUIDs reales tomados del contexto de abajo. Mirá el campo id="..." de cada sección
- Las categorías válidas: vaca, toro, ternero, ternera, novillo, vaquillona, caballo, yegua, oveja
- SIEMPRE incluí un insert en "activities" como última operación registrando qué se hizo
- Para queries sin cambios, dbOperations debe ser un array vacío []
- Si la sección mencionada no existe, creala primero como operación separada. Usá "NEW_SECTION_NombreSeccion" como section_id placeholder en las operaciones siguientes — se resuelve automáticamente al ID real
- Para mover ganado: update cattle con match {section_id: "viejo-uuid", category: "X"} y data {section_id: "nuevo-uuid"}
- Para registrar hacienda: insert into cattle con section_id, category, count, breed, etc.
- Para vacunaciones: insert into vaccinations con vaccine_name, head_count, date_applied, section_id, etc.
- Para eventos de salud: insert into health_events con type, description, head_count, section_id, etc.

Si no entendés el mensaje, intent = "help" y pedí clarificación amigablemente.

${farmContext}`;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: messageType === "audio"
            ? `[Mensaje de audio transcripto]: ${message}`
            : message,
        },
      ],
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

      // Ensure farm_id is set
      if (["sections", "cattle", "activities", "vaccinations", "health_events"].includes(op.table)) {
        data.farm_id = farmId;
      }

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
          // Track new section IDs for placeholder resolution
          if (op.table === "sections" && inserted) {
            const placeholder = Object.entries(op.data).find(
              ([, v]) => typeof v === "string" && v.startsWith("NEW_SECTION_")
            );
            if (placeholder) {
              newSectionIds[placeholder[1] as string] = inserted.id;
            }
            // Also map by name
            const nameKey = `NEW_SECTION_${data.name}`;
            newSectionIds[nameKey] = inserted.id;
          }
        }
      } else if (op.action === "update" && match) {
        let query = db.from(op.table).update(data);
        for (const [key, val] of Object.entries(match)) {
          query = query.eq(key, val);
        }
        const { error } = await query;
        if (error) {
          logs.push(`Error updating ${op.table}: ${error.message}`);
        } else {
          logs.push(`Updated ${op.table}: OK`);
        }
      } else if (op.action === "upsert") {
        const { error } = await db.from(op.table).upsert(data);
        if (error) {
          logs.push(`Error upserting ${op.table}: ${error.message}`);
        } else {
          logs.push(`Upserted ${op.table}: OK`);
        }
      } else if (op.action === "delete" && match) {
        let query = db.from(op.table).delete();
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
