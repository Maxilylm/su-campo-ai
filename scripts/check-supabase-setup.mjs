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

if (errors.length > 0) {
  console.error("Supabase setup check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Supabase setup OK: ${migrations.length} migrations in order, documented, and checked for duplicate integrity indexes.`);
}
