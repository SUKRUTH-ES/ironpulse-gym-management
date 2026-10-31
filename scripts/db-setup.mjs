// Builds both databases from scratch and loads demo data.
//   npm run db:setup            -> schema + demo data
//   npm run db:setup -- --empty -> schema only
//
// Uses the MySQL admin account (MYSQL_ADMIN_*) because creating triggers,
// routines and events needs extra privileges. It then creates the limited
// account the web app connects with (MYSQL_USER), which can only read/write
// rows and call procedures - it cannot change or drop tables.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import { createMongoCollections } from '../db/mongo/collections.mjs';
import { seedMysql, seedMongo } from './seed-data.mjs';

const SQL_FILES = ['01_schema.sql', '02_views.sql', '03_routines.sql', '04_triggers.sql', '05_events.sql'];
const sqlDir = path.join(import.meta.dirname, '..', 'db', 'mysql');

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing ${name} in .env.local (see .env.example)`);
        process.exit(1);
    }
    return value;
}

// Splits a .sql file into statements, honouring DELIMITER lines the same
// way the mysql command-line client does.
function splitSql(text) {
    const statements = [];
    let delimiter = ';';
    let buffer = '';
    for (const line of text.split(/\r?\n/)) {
        const change = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
        if (change) {
            delimiter = change[1];
            continue;
        }
        buffer += line + '\n';
        if (/^\s*--/.test(line)) continue;
        const trimmed = buffer.trimEnd();
        if (trimmed.endsWith(delimiter)) {
            const statement = trimmed.slice(0, -delimiter.length).trim();
            const hasCode = statement.split('\n').some((l) => l.trim() && !l.trim().startsWith('--'));
            if (hasCode) statements.push(statement);
            buffer = '';
        }
    }
    return statements;
}

async function setupMysql() {
    const admin = await mysql.createConnection({
        host: process.env.MYSQL_HOST || '127.0.0.1',
        port: Number(process.env.MYSQL_PORT || 3306),
        user: requireEnv('MYSQL_ADMIN_USER'),
        password: requireEnv('MYSQL_ADMIN_PASSWORD'),
        dateStrings: true,
    });

    for (const file of SQL_FILES) {
        const statements = splitSql(await readFile(path.join(sqlDir, file), 'utf8'));
        for (const statement of statements) {
            try {
                await admin.query(statement);
            } catch (err) {
                console.error(`\n${file} failed on:\n${statement.slice(0, 400)}\n`);
                throw err;
            }
        }
        console.log(`  ${file}: ${statements.length} statements`);
    }

    const appUser = requireEnv('MYSQL_USER');
    const appPassword = requireEnv('MYSQL_PASSWORD');
    const database = process.env.MYSQL_DATABASE || 'gym_db';
    await admin.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [appUser, 'localhost', appPassword]);
    await admin.query('ALTER USER ?@? IDENTIFIED BY ?', [appUser, 'localhost', appPassword]);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON \`${database}\`.* TO ?@?`, [appUser, 'localhost']);
    console.log(`  app account ${appUser}@localhost: SELECT, INSERT, UPDATE, DELETE, EXECUTE on ${database}`);

    const [[{ scheduler }]] = await admin.query('SELECT @@event_scheduler AS scheduler');
    if (scheduler !== 'ON') console.warn('  ! event_scheduler is OFF - scheduled housekeeping will not run');

    return admin;
}

async function main() {
    const empty = process.argv.includes('--empty');

    console.log('MySQL');
    const admin = await setupMysql();
    await admin.query('USE gym_db');

    console.log('MongoDB');
    const client = new MongoClient(requireEnv('MONGODB_URI'));
    await client.connect();
    const mdb = client.db(process.env.MONGODB_DB || 'gym_mongo');
    await mdb.dropDatabase();
    await createMongoCollections(mdb);
    console.log('  collections, validators and indexes created');

    if (!empty) {
        console.log('Demo data');
        const facts = await seedMysql(admin);
        await seedMongo(mdb, facts);
    }

    await admin.end();
    await client.close();
    console.log('Done.');
}

main().catch((err) => {
    console.error(err.sqlMessage || err.message);
    process.exit(1);
});
