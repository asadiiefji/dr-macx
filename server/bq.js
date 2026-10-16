// BigQuery history of per-minute sensor summaries (rows from telemetry.js). Off unless BQ_DATASET is set,
// so local dev against the Firestore emulator writes nothing to the cloud.
import { BigQuery } from '@google-cloud/bigquery';

const DATASET = process.env.BQ_DATASET;
const LOCATION = process.env.BQ_LOCATION || 'asia-southeast2';
// GCP_PROJECT wins over GOOGLE_CLOUD_PROJECT, which local dev points at the Firestore emulator's demo project.
export const GCP_PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
export const bqEnabled = !!DATASET;
export const TABLE = 'sensor_minutes';

const SCHEMA = [
  ['machine_id', 'STRING', 'REQUIRED'], ['machine_code', 'STRING'], ['setup', 'STRING'], ['minute', 'TIMESTAMP', 'REQUIRED'],
  ['run_sec', 'FLOAT'], ['idle_sec', 'FLOAT'], ['off_sec', 'FLOAT'], ['break_sec', 'FLOAT'],
  ['parts', 'INTEGER'], ['nc', 'INTEGER'], ['alarm_codes', 'INTEGER', 'REPEATED'],
  ['current_avg', 'FLOAT'], ['current_max', 'FLOAT'], ['tonnage_avg', 'FLOAT', 'REPEATED'], ['tonnage_max', 'FLOAT', 'REPEATED'],
  ['vib_motor', 'FLOAT'], ['vib_gearbox', 'FLOAT'], ['temp_motor', 'FLOAT'], ['temp_gearbox', 'FLOAT'], ['temp_lube', 'FLOAT'],
  ['acoustic_max', 'FLOAT'], ['io_faults', 'INTEGER'], ['sim_mode', 'STRING'],
].map(([name, type, mode = 'NULLABLE']) => ({ name, type, mode }));

let ready;
// Creates the dataset and the day-partitioned table on first use.
function open() {
  ready ??= (async () => {
    const bq = new BigQuery({ projectId: GCP_PROJECT });
    const ds = bq.dataset(DATASET);
    if (!(await ds.exists())[0]) await ds.create({ location: LOCATION });
    const table = ds.table(TABLE);
    if (!(await table.exists())[0]) {
      await table.create({ schema: SCHEMA, timePartitioning: { type: 'DAY', field: 'minute' }, clustering: { fields: ['machine_id'] } });
    }
    return { bq, table };
  })().catch((e) => {
    ready = null; // try again next time
    throw e;
  });
  return ready;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Streaming insert in chunks. A table created seconds ago can briefly answer 404, so retry a few times.
export async function insertRows(rows) {
  if (!bqEnabled || !rows.length) return;
  const { table } = await open();
  for (let i = 0; i < rows.length; i += 5000) {
    for (let attempt = 1; ; attempt++) {
      try {
        await table.insert(rows.slice(i, i + 5000));
        break;
      } catch (e) {
        if (e.code !== 404 || attempt >= 6) throw e;
        await sleep(5000);
      }
    }
  }
}

// Query with `T` standing for the sensor table. Returns null when BigQuery is off.
export async function query(sql, params = {}) {
  if (!bqEnabled) return null;
  const { bq } = await open();
  const [rows] = await bq.query({ query: sql.replaceAll('`T`', `\`${GCP_PROJECT}.${DATASET}.${TABLE}\``), params, location: LOCATION });
  return rows;
}

// Hour-by-hour sensor trend for one press (what Gemini reads as history). null when BigQuery is off.
export function hourlyTrend(machineId, hours = 24) {
  return query(
    `WITH base AS (
       SELECT * FROM \`T\` WHERE machine_id = @id AND minute >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @h HOUR)),
     nodes AS (
       SELECT TIMESTAMP_TRUNC(minute, HOUR) AS hour, o + 1 AS node, ROUND(AVG(v), 1) AS avg_t, ROUND(MAX(v), 1) AS max_t
       FROM base, UNNEST(tonnage_avg) AS v WITH OFFSET o GROUP BY hour, node)
     SELECT h.hour, h.parts, h.nc, h.run_min, h.idle_min, h.off_min, h.vib_motor, h.vib_gearbox, h.temp_motor, h.temp_gearbox,
       h.temp_lube, h.acoustic_max, h.io_faults, h.alarms,
       ARRAY(SELECT AS STRUCT node, avg_t, max_t FROM nodes WHERE nodes.hour = h.hour ORDER BY node) AS tonnage
     FROM (
       SELECT TIMESTAMP_TRUNC(minute, HOUR) AS hour, SUM(parts) AS parts, SUM(nc) AS nc,
         ROUND(SUM(run_sec) / 60, 1) AS run_min, ROUND(SUM(idle_sec) / 60, 1) AS idle_min, ROUND(SUM(off_sec) / 60, 1) AS off_min,
         ROUND(AVG(vib_motor), 2) AS vib_motor, ROUND(AVG(vib_gearbox), 2) AS vib_gearbox, ROUND(MAX(temp_motor), 1) AS temp_motor,
         ROUND(MAX(temp_gearbox), 1) AS temp_gearbox, ROUND(MAX(temp_lube), 1) AS temp_lube, ROUND(MAX(acoustic_max), 2) AS acoustic_max,
         MAX(io_faults) AS io_faults, ARRAY_CONCAT_AGG(alarm_codes) AS alarms
       FROM base GROUP BY hour) AS h
     ORDER BY h.hour`,
    { id: machineId, h: hours },
  ).then((rows) => rows?.map((r) => ({ ...r, hour: r.hour.value, alarms: [...new Set(r.alarms)] })) ?? null);
}
