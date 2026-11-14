// Dumps the live MySQL + MongoDB schema to docs/tools/schema.json.
// The diagram and data-dictionary generators read that file, so the docs
// always match the real database.  Run from the project root:
//   node docs/tools/dump-schema.mjs
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';

process.loadEnvFile('.env.local');
const db = process.env.MYSQL_DATABASE;

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT),
  // admin account: gym_app has no TRIGGER/EVENT privilege, so it cannot see those in information_schema
  user: process.env.MYSQL_ADMIN_USER, password: process.env.MYSQL_ADMIN_PASSWORD, database: db,
});
const q = async (sql) => (await conn.query(sql, [db]))[0];

const out = {
  tables: await q(`SELECT TABLE_NAME name, TABLE_COMMENT comment FROM information_schema.TABLES
                   WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY CREATE_TIME, TABLE_NAME`),
  columns: await q(`SELECT TABLE_NAME tbl, COLUMN_NAME col, COLUMN_TYPE type, IS_NULLABLE nullable,
                    COLUMN_DEFAULT def, COLUMN_KEY ckey, EXTRA extra, COLUMN_COMMENT comment
                    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`),
  fks: await q(`SELECT k.TABLE_NAME tbl, k.COLUMN_NAME col, k.REFERENCED_TABLE_NAME ref_tbl,
                k.REFERENCED_COLUMN_NAME ref_col, r.DELETE_RULE on_delete, k.CONSTRAINT_NAME name
                FROM information_schema.KEY_COLUMN_USAGE k
                JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                  ON r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
                WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL`),
  checks: await q(`SELECT t.TABLE_NAME tbl, c.CONSTRAINT_NAME name, c.CHECK_CLAUSE clause
                   FROM information_schema.CHECK_CONSTRAINTS c
                   JOIN information_schema.TABLE_CONSTRAINTS t
                     ON t.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME = c.CONSTRAINT_NAME
                   WHERE c.CONSTRAINT_SCHEMA = ? ORDER BY t.TABLE_NAME, c.CONSTRAINT_NAME`),
  indexes: await q(`SELECT TABLE_NAME tbl, INDEX_NAME name, NON_UNIQUE non_unique, INDEX_TYPE type,
                    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols
                    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?
                    GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE ORDER BY TABLE_NAME, INDEX_NAME`),
  views: await q(`SELECT TABLE_NAME name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`),
  routines: await q(`SELECT ROUTINE_NAME name, ROUTINE_TYPE type FROM information_schema.ROUTINES
                     WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME`),
  triggers: await q(`SELECT TRIGGER_NAME name, EVENT_OBJECT_TABLE tbl, ACTION_TIMING timing, EVENT_MANIPULATION ev
                     FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME`),
  events: await q(`SELECT EVENT_NAME name, INTERVAL_VALUE every, INTERVAL_FIELD unit, STATUS status
                   FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?`),
  rowCounts: {},
};
for (const t of out.tables) {
  out.rowCounts[t.name] = (await conn.query(`SELECT COUNT(*) n FROM \`${t.name}\``))[0][0].n;
}
await conn.end();

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const mdb = mc.db(process.env.MONGODB_DB);
out.mongo = [];
for (const info of await mdb.listCollections().toArray()) {
  if (info.name.startsWith('system.')) continue;
  const c = mdb.collection(info.name);
  out.mongo.push({
    name: info.name, type: info.type, options: info.options,
    indexes: await c.indexes().catch(() => []),
    count: await c.estimatedDocumentCount(),
    sample: await c.findOne({}, { sort: { _id: -1 } }),
  });
}
await mc.close();

fs.writeFileSync('docs/tools/schema.json', JSON.stringify(out, null, 2));
console.log(`tables ${out.tables.length}, columns ${out.columns.length}, fks ${out.fks.length}, checks ${out.checks.length}, ` +
  `views ${out.views.length}, routines ${out.routines.length}, triggers ${out.triggers.length}, events ${out.events.length}, ` +
  `mongo collections ${out.mongo.length}`);
