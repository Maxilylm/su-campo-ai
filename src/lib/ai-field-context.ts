import { escapeAIContextValue as esc } from "./ai-context";
import { neighboursOf, type FieldGraph } from "./field-graph";
import { grazingHistoryLine } from "./grazing-history";
import { categoryLabel, DEFAULT_MAX_GRAZING_DAYS, DEFAULT_MIN_REST_DAYS, type RotationMove, type SectionFieldStatus } from "./grazing";

/** Which potreros share a fence, so "¿por dónde muevo los novillos?" has an
 * answer: a move between linderos crosses no other potrero. Computed from the
 * shapes drawn on the map; potreros without a drawn area have unknown linderos. */
export function linderosAIContext(graph: FieldGraph): string {
  if (graph.nodes.length === 0) return "";
  const drawn = graph.nodes.filter((node) => node.hasPolygon);
  if (drawn.length === 0) {
    return "\nLINDEROS: ningún potrero está dibujado como área en el mapa, así que no se sabe cuáles comparten alambrado. Si preguntan por dónde mover, sugerí dibujarlos en Mapa.\n";
  }
  let ctx = "\nLINDEROS (potreros que comparten alambrado, calculado del mapa; mover entre linderos no cruza otros potreros; \"portera\" = hay portera marcada en ese alambrado):\n";
  for (const node of drawn) {
    const list = neighboursOf(graph, node.id);
    ctx += `- "${esc(node.name)}": `;
    ctx += list.length > 0
      ? `linda con ${list.map((neighbour) => `"${esc(neighbour.name)}"${neighbour.gate ? " (portera)" : ""}`).join(", ")}`
      : "sin linderos dibujados";
    ctx += "\n";
  }
  const undrawn = graph.nodes.filter((node) => !node.hasPolygon);
  if (undrawn.length > 0) ctx += `- sin dibujar en el mapa (linderos desconocidos): ${undrawn.map((node) => `"${esc(node.name)}"`).join(", ")}\n`;
  return ctx;
}

const STOCKING_LABELS ={ empty: "vacío", ok: "normal", high: "al límite", over: "SOBRECARGADO" } as const;

/** Derived stocking, grazing clock and rotation facts for the assistant. The
 * model is bad at arithmetic over raw rows and has no way to know how long a
 * potrero has been grazed, so it gets the numbers the map shows instead. */
export function fieldStatusAIContext(statuses: SectionFieldStatus[], rotation: RotationMove[]): string {
  if (statuses.length === 0) return "";
  let ctx = `\nCARGA Y ROTACIÓN (calculado por CampoAI; UG = unidad ganadera, vaca = 1; descanso recomendado ≥${DEFAULT_MIN_REST_DAYS} d, pastoreo máx. sugerido ${DEFAULT_MAX_GRAZING_DAYS} d):\n`;
  for (const status of statuses) {
    ctx += `- section_id="${status.id}" "${esc(status.name)}": ${STOCKING_LABELS[status.stocking]}`;
    if (status.heads > 0) {
      ctx += `, ${status.heads} cab. (${status.byCategory.map((row) => `${row.count} ${categoryLabel(row.category, row.count)}`).join(", ")}), ${status.ug} UG`;
      if (status.ugPerHa != null) ctx += `, ${status.ugPerHa} UG/ha`;
      if (status.stockingReason) ctx += `, ${status.stockingReason}`;
      ctx += status.daysOccupied != null ? `, ${status.daysOccupied} d de pastoreo` : ", ingreso sin registrar";
    } else if (status.crops.length === 0) {
      ctx += status.daysRested != null ? `, ${status.daysRested} d de descanso` : ", descanso sin registrar";
    }
    if (status.crops.length > 0) ctx += `, cultivo: ${status.crops.map((crop) => esc(crop.label)).join(" + ")}`;
    const history = grazingHistoryLine(status.history);
    if (history) ctx += `; historial: ${history}`;
    ctx += "\n";
  }
  if (rotation.length > 0) {
    ctx += "MOVIMIENTOS SUGERIDOS (proponelos solo si el usuario pregunta qué hacer o a dónde mover; un movimiento siempre requiere su confirmación):\n";
    for (const move of rotation) {
      const best = move.destinations[0];
      ctx += `- desde "${esc(move.fromName)}" (${move.heads} cab.) por ${move.reasons.map((reason) => reason.label).join(", ")}: `;
      ctx += best
        ? `mejor destino "${esc(best.name)}" section_id="${best.sectionId}"${best.notes.length ? ` (${best.notes.join(", ")})` : ""}`
          + (move.destinations.length > 1 ? `; alternativas: ${move.destinations.slice(1).map((destination) => `"${esc(destination.name)}"`).join(", ")}` : "")
        : move.reservedFor
          ? `el único potrero apto ("${esc(move.reservedFor.sectionName)}") ya está sugerido para "${esc(move.reservedFor.forName)}", más urgente`
          : "ningún potrero libre puede recibirlos";
      ctx += "\n";
    }
  }
  return ctx;
}
