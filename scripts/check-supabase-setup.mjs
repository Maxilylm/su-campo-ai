import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supabaseDir = path.join(projectRoot, "supabase");
const fullSetup = fs.readFileSync(path.join(supabaseDir, "full_setup.sql"), "utf8");
const readme = fs.readFileSync(path.join(supabaseDir, "README.md"), "utf8");
const migrations = fs.readdirSync(supabaseDir)
  .filter((file) => /^\d{3}_.+\.sql$/.test(file))
  .sort();
const errors = [];
let previousPosition = -1;

// Section headers look like:
//   -- ═══...═══
//   -- 033_integrity_and_performance.sql
//   -- ═══...═══
//   <body>
// Capture each migration's embedded body so it can be diffed against the
// migration file's own source, not just checked for presence — a migration
// file edited after being pasted into full_setup.sql previously went
// undetected as long as its header marker was still there.
const SEP_ESCAPED = "-- ═══════════════════════════════════════════════════════════════".replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const headerPattern = new RegExp(`^${SEP_ESCAPED}\\n-- (\\S+\\.sql)\\n${SEP_ESCAPED}\\n`, "gm");
const sections = [...fullSetup.matchAll(headerPattern)].map((match) => ({
  name: match[1],
  headerStart: match.index,
  bodyStart: match.index + match[0].length,
}));
const embeddedBodies = new Map();
for (let i = 0; i < sections.length; i++) {
  const bodyEnd = i + 1 < sections.length ? sections[i + 1].headerStart : fullSetup.length;
  embeddedBodies.set(sections[i].name, fullSetup.slice(sections[i].bodyStart, bodyEnd).trim());
}

// Some early migrations were hand-reformatted when full_setup.sql was
// assembled (their own leading descriptive comment stripped, some lines
// re-wrapped). Normalizing away comments, whitespace runs, and paren
// spacing avoids flagging that historical cosmetic drift while still
// catching a real content mismatch — different statements, values, or
// missing lines survive normalization as an actual diff.
function normalizeSql(text) {
  const withoutComments = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

for (const migration of migrations) {
  const marker = `-- ${migration}`;
  const position = fullSetup.indexOf(marker);
  if (position < 0) {
    errors.push(`${migration} no está incluido en full_setup.sql`);
  } else if (position < previousPosition) {
    errors.push(`${migration} aparece fuera de orden en full_setup.sql`);
  } else {
    previousPosition = position;
  }
  if (!readme.includes(`\`${migration}\``)) {
    errors.push(`${migration} no está documentado en supabase/README.md`);
  }
  if (embeddedBodies.has(migration)) {
    const sourceBody = fs.readFileSync(path.join(supabaseDir, migration), "utf8");
    const embeddedBody = embeddedBodies.get(migration);
    if (normalizeSql(sourceBody) !== normalizeSql(embeddedBody)) {
      errors.push(`${migration} en full_setup.sql no coincide con el archivo fuente (contenido desincronizado)`);
    }
  }
}

for (const indexName of [
  "idx_financial_inventory_movement_unique",
  "idx_cattle_farm_ear_tag_unique",
  "idx_inventory_movements_idempotency",
  "idx_weight_records_idempotency",
  "idx_padrones_idempotency",
  "idx_cattle_import_batch_rows",
  "idx_inventory_import_batch_rows",
  "idx_financial_import_batch_rows",
  "idx_tasks_idempotency",
  "idx_financial_transactions_idempotency",
  "idx_crops_idempotency",
  "idx_crop_applications_idempotency",
  "idx_vaccinations_idempotency",
  "idx_health_events_idempotency",
  "idx_map_features_idempotency",
  "idx_sections_idempotency",
  "idx_cattle_idempotency",
  "idx_inventory_items_idempotency",
]) {
  const occurrences = fullSetup.match(new RegExp(indexName, "g"))?.length || 0;
  if (occurrences !== 1) errors.push(`${indexName} aparece ${occurrences} veces en full_setup.sql`);
}

if (!fullSetup.includes("create_padron_with_section")) {
  errors.push("018_padron_transaction.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("019_padron_idempotency.sql")) {
  errors.push("019_padron_idempotency.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("020_import_idempotency.sql")) {
  errors.push("020_import_idempotency.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("public.move_cattle")) {
  errors.push("021_cattle_move_transaction.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("022_task_idempotency.sql")) {
  errors.push("022_task_idempotency.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("023_financial_idempotency.sql")) {
  errors.push("023_financial_idempotency.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("024_operational_idempotency.sql")) {
  errors.push("024_operational_idempotency.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("025_map_feature_idempotency.sql")) {
  errors.push("025_map_feature_idempotency.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("026_chat_request_idempotency.sql")) {
  errors.push("026_chat_request_idempotency.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("027_whatsapp_side_effects.sql")) {
  errors.push("027_whatsapp_side_effects.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("028_sample_data_idempotency.sql")) {
  errors.push("028_sample_data_idempotency.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("029_hacienda_idempotency.sql")) {
  errors.push("029_hacienda_idempotency.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("030_inventory_item_idempotency.sql")) {
  errors.push("030_inventory_item_idempotency.sql no está incluido en full_setup.sql");
}

if (!fullSetup.includes("031_farm_memberships.sql")) {
  errors.push("031_farm_memberships.sql no está incluido en full_setup.sql");
}

if (errors.length > 0) {
  console.error("Supabase setup check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Supabase setup OK: ${migrations.length} migrations in order, documented, and checked for duplicate integrity indexes.`);
}
