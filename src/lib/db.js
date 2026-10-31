import 'server-only';
import mysql from 'mysql2/promise';

// One connection pool for the whole app (kept on globalThis so hot reload
// in development does not open a new pool on every file change).
// Credentials come only from environment variables (.env.local).
const pool =
    globalThis.gymMysqlPool ??
    mysql.createPool({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        connectionLimit: 10,
        dateStrings: true,
        decimalNumbers: true,
    });
if (process.env.NODE_ENV !== 'production') globalThis.gymMysqlPool = pool;

// Runs a parameterised query as a prepared statement. Values are always
// passed separately from the SQL text, which prevents SQL injection.
export async function sql(text, params = []) {
    const [rows] = await pool.execute(text, params);
    return rows;
}

export async function sqlOne(text, params = []) {
    const rows = await sql(text, params);
    return rows[0] ?? null;
}

// Calls a stored procedure and reads its OUT parameters.
// CALL and SELECT @out must run on the same connection, because @variables
// belong to a session.
export async function callProcedure(name, inArgs = [], outNames = []) {
    const conn = await pool.getConnection();
    try {
        const args = [...inArgs.map(() => '?'), ...outNames.map((n) => `@${n}`)].join(', ');
        await conn.query(`CALL ${name}(${args})`, inArgs);
        if (!outNames.length) return {};
        const [[row]] = await conn.query(`SELECT ${outNames.map((n) => `@${n} AS ${n}`).join(', ')}`);
        return row;
    } finally {
        conn.release();
    }
}

// Runs several statements as one transaction: all succeed or none do.
export async function transaction(work) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await work(conn);
        await conn.commit();
        return result;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// Turns a MySQL error into a message that is safe to show to the user.
export function dbErrorMessage(err) {
    if (err?.sqlState === '45000') return err.sqlMessage; // SIGNAL from a trigger/procedure
    if (err?.errno === 1062) return 'That value is already in use.';
    if (err?.errno === 3819) return 'Some of the values are not valid.';
    if (err?.errno === 1452) return 'A linked record does not exist.';
    console.error(err);
    return 'Something went wrong. Please try again.';
}
