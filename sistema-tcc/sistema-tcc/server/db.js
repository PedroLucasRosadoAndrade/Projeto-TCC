const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true,      // DATE/DATETIME chegam como texto (sem problemas de fuso)
  decimalNumbers: true,   // DECIMAL chega como número
});

/** Executa uma consulta e devolve somente as linhas. */
async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Executa várias operações numa transação; faz rollback se der erro. */
async function transacao(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Atalho: consulta dentro de uma conexão de transação. */
async function qc(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

module.exports = { pool, q, qc, transacao };
