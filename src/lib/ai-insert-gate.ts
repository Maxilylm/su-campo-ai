import { askJev, type JevAnswers, type JevQuestion } from "./jev";
import type { AIOperation } from "./ai-operation";

/**
 * A semantic guard on the one path that reaches the database unattended.
 *
 * requireAIConfirmation holds every update, delete and move for explicit
 * confirmation, but plain inserts apply straight away: they are idempotent and
 * easy to undo, and asking a farmer to confirm "anotá 5 terneros" twice a day
 * would make the assistant useless. That structural rule cannot see three
 * things, all observed against the live model:
 *
 *   - the model answering a question ("¿cuántos novillos tengo?") with an
 *     insert nobody asked for
 *   - a voice note transcribed into something the model guesses at
 *   - an insert carrying a figure the message never stated
 *
 * Jev decides those in one 70-500ms call. Anything it cannot vouch for falls
 * through to the confirmation flow that already exists — the farmer reviews a
 * proposal instead of discovering a bad row later.
 */

// Deliberately phrased as positive assertions: Jev reads instructions
// literally and handles negations poorly, so "the message asks to record"
// scores far more reliably than "the message is not a question".
export const INSERT_GATE_QUESTIONS: Record<string, JevQuestion> = {
  intencion: {
    type: "choice",
    instructions: "¿Qué pide el mensaje del productor?",
    criteria: {
      registrar: "Pide explícitamente anotar, cargar o registrar un dato concreto",
      consultar: "Pide información, hace una pregunta o pide un resumen",
      ambiguo: "El mensaje está incompleto, confuso o mal transcripto",
    },
  },
  coincide: {
    type: "noul",
    instructions: "¿Las operaciones propuestas corresponden exactamente a lo que el mensaje pide registrar?",
    criteria: {
      true: "Las operaciones reflejan los datos que el mensaje menciona",
      false: "Las operaciones agregan, inventan o cambian datos que el mensaje no menciona",
    },
  },
};

// Calibrated against recorded live responses (see ai-insert-gate.test.ts): a
// clear instruction with matching operations scored intent 1.0 / match 0.75,
// while an invented insert, a garbled transcript and an unstated amount
// scored match 0.05, 0.17 and 0.11. The gap is wide, so these sit in the
// middle of it. Raise them to hold more; lower them if legitimate inserts
// start being held.
const MIN_INTENT_CONFIDENCE = 0.7;
const MIN_MATCH_PROBABILITY = 0.5;

// Jev's context window is 64k tokens, far more than this, but a long voice
// transcript must not push the operations out of the model's attention — the
// question is whether the two agree, so both sides have to stay readable.
const MAX_MESSAGE_CHARS = 2_000;
const MAX_OPERATIONS_CHARS = 3_000;

export type InsertGateVerdict =
  | { confirm: false }
  | { confirm: true; reason: "intencion" | "coincidencia" };

const APPLY: InsertGateVerdict = { confirm: false };

const ID_FIELD_LABELS: Record<string, string> = {
  section_id: "potrero",
  cattle_id: "lote",
  crop_id: "cultivo",
  item_id: "insumo",
  inventory_movement_id: "movimiento",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Jev compares the farmer's words with the proposed write, and a UUID can
 * never match "en el Norte": live, every correct registration with a
 * section_id was held as "coincidencia". Swap each referenced id for the name
 * the farmer would use, and drop ids that cannot be named — they carry
 * nothing the message could have said. */
export function humanizeOperations(operations: AIOperation[], names: ReadonlyMap<string, string>): Array<Record<string, unknown>> {
  return operations.map((operation) => {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(operation.data ?? {})) {
      if (typeof value === "string" && UUID.test(value)) {
        const name = names.get(value);
        if (name) data[ID_FIELD_LABELS[key] ?? key.replace(/_id$/, "")] = name;
        continue;
      }
      data[key] = value;
    }
    return { table: operation.table, action: operation.action, data };
  });
}

/** Pair the farmer's own words with what the model wants to write, so Jev
 * judges the two against each other rather than either on its own. */
export function buildInsertGateState(message: string, operations: AIOperation[], names: ReadonlyMap<string, string> = new Map()): string {
  const operationsJson = JSON.stringify(humanizeOperations(operations, names)).slice(0, MAX_OPERATIONS_CHARS);
  return [
    `Mensaje del productor: "${message.trim().slice(0, MAX_MESSAGE_CHARS)}"`,
    `Operaciones propuestas: ${operationsJson}`,
  ].join("\n");
}

/** Apply the thresholds to Jev's answers. Anything unreadable — no answers at
 * all, a missing question, an answer of the wrong type — applies as before,
 * so a provider change can degrade this gate but never break the assistant. */
export function evaluateInsertGate(answers: JevAnswers | null): InsertGateVerdict {
  if (!answers) return APPLY;

  const intencion = answers.intencion;
  const coincide = answers.coincide;
  if (!intencion || intencion.type !== "choice" || typeof intencion.confidence !== "number") return APPLY;
  if (!coincide || coincide.type !== "noul" || typeof coincide.noul !== "number") return APPLY;

  if (intencion.choice !== "registrar" || intencion.confidence < MIN_INTENT_CONFIDENCE) {
    return { confirm: true, reason: "intencion" };
  }
  if (coincide.noul < MIN_MATCH_PROBABILITY) {
    return { confirm: true, reason: "coincidencia" };
  }
  return APPLY;
}

/** Decide whether an otherwise auto-applied insert should be held for review. */
export async function gateAutoInsert(
  message: string,
  operations: AIOperation[],
  names: ReadonlyMap<string, string> = new Map(),
): Promise<InsertGateVerdict> {
  const answers = await askJev(buildInsertGateState(message, operations, names), INSERT_GATE_QUESTIONS);
  return evaluateInsertGate(answers);
}
