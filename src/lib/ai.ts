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

  const [sectionsRes, cattleRes, activitiesRes] = await Promise.all([
    db.from("sections").select("*").eq("farm_id", farmId).order("name"),
    db.from("cattle").select("*, sections(name)").eq("farm_id", farmId),
    db
      .from("activities")
      .select("*")
      .eq("farm_id", farmId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const sections = sectionsRes.data || [];
  const cattle = cattleRes.data || [];
  const activities = activitiesRes.data || [];

  // Build a summary
  let ctx = "=== ESTADO ACTUAL DEL CAMPO ===\n\n";

  ctx += "SECCIONES/POTREROS:\n";
  for (const s of sections) {
    const sectionCattle = cattle.filter((c) => c.section_id === s.id);
    const totalHead = sectionCattle.reduce((sum, c) => sum + c.count, 0);
    ctx += `- ${s.name}: ${s.size_hectares || "?"} ha, ${totalHead} cabezas`;
    if (s.capacity) ctx += ` (capacidad: ${s.capacity})`;
    ctx += "\n";
    for (const c of sectionCattle) {
      ctx += `  > ${c.count} ${c.category}${c.breed ? ` (${c.breed})` : ""}${c.health_status !== "healthy" ? ` [${c.health_status}]` : ""}${c.notes ? ` - ${c.notes}` : ""}\n`;
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

  if (activities.length > 0) {
    ctx += "\nACTIVIDAD RECIENTE:\n";
    for (const a of activities.slice(0, 10)) {
      const date = new Date(a.created_at).toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
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

1. ACTUALIZAR datos cuando el usuario reporta cambios (movimientos, conteos, salud, nuevas secciones)
2. CONSULTAR datos cuando el usuario pregunta sobre el estado del campo
3. CONFIGURAR el campo cuando el usuario quiere agregar secciones o registrar hacienda nueva
4. AYUDAR explicando cómo usar el sistema

SIEMPRE respondé en JSON con esta estructura exacta (sin markdown ni code fences):
{
  "intent": "update" | "query" | "setup" | "help",
  "response": "texto de respuesta amigable para el usuario",
  "dbOperations": [
    {
      "table": "sections" | "cattle" | "activities",
      "action": "insert" | "update" | "delete" | "upsert",
      "data": { ... },
      "match": { ... }
    }
  ]
}

Reglas para dbOperations:
- Para MOVER ganado: update cattle SET section_id = (new section id) WHERE section_id = (old section id) AND category = X
- Para AGREGAR sección: insert into sections (name, size_hectares, farm_id)
- Para REGISTRAR hacienda: insert into cattle (section_id, category, count, breed, farm_id)
- Para ACTUALIZAR conteo: update cattle SET count = N WHERE section_id = X AND category = Y
- Para REPORTAR salud: update cattle SET health_status = X, notes = Y
- SIEMPRE incluí un insert en "activities" registrando qué se hizo
- Usá el farm_id: "${farmId}" en todas las operaciones
- Para queries sin cambios, dbOperations debe ser un array vacío []
- Los section_id deben ser UUIDs reales de las secciones existentes del contexto
- Las categorías válidas son: vaca, toro, ternero, ternera, novillo, vaquillona, caballo, oveja

Si la sección mencionada no existe, creala primero como una operación separada y usá un placeholder "NEW_SECTION_[nombre]" como id, después referencialo.

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
      if (["sections", "cattle", "activities"].includes(op.table)) {
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
