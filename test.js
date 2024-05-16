import sql from "mssql";
import sqlite3 from "better-sqlite3";

const config = {
  user: "sa",
  password: process.env.MSSQL_SA_PASSWORD,
  server: "localhost",
  parseJSON: true,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  options: {
    encrypt: true, // for azure
    trustServerCertificate: true, // true for local dev / self-signed certs
  },
};

// Función para convertir la base de datos a sqlite
async function exportToSqlite(pool) {
  const sqliteDB = new sqlite3(":memory:", { verbose: console.log });
  try {
    let tables = await pool.request().query(`
    SELECT TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_TYPE = 'BASE TABLE'
  `);

    for (const table of tables.recordset) {
      const tableName = table.TABLE_NAME;
      const createTableQuery = await pool.request().query(`
      SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_NAME = '${tableName}'
      ORDER BY c.ORDINAL_POSITION
    `);

      let createTableStatement = `CREATE TABLE ${tableName} (`;
      const columnDefinitions = createTableQuery.recordset.map((column) => {
        let columnDefinition = `${column.COLUMN_NAME} ${mapDataType(
          column.DATA_TYPE
        )}`;
        if (column.IS_NULLABLE === "NO") {
          columnDefinition += " NOT NULL";
        }
        return columnDefinition;
      });
      createTableStatement += columnDefinitions.join(", ") + ")";

      sqliteDB.exec(createTableStatement);

      const insertColumns = createTableQuery.recordset.map(column => column.COLUMN_NAME);
      const insertStatement = sqliteDB.prepare(
        `INSERT INTO ${tableName} (${insertColumns.join(", ")}) VALUES (${insertColumns.map(() => "?").join(",")})`
      );

      const selectQuery = `SELECT * FROM ${tableName}`;
      const result = await pool.request().query(selectQuery);
      for (const row of result.recordset) {
        const values = insertColumns.map(
          (column) => convertToSQLiteCompatibleType(row[column])
        );
        insertStatement.run(values);
      }
    }
    // Serializar la base de datos en memoria y enviarla como respuesta
    return sqliteDB.serialize();
    // return await sqliteDB.backup("./backup.sqlite");
  } catch (error) {
    console.error("Error during SQLite export process:", error);
    throw error;
  } finally {
    if (sqliteDB) {
      sqliteDB.close();
      console.log("SQLite database closed successfully.");
    }
  }
}

function mapDataType(sqlType) {
  switch (sqlType) {
    case "varchar":
    case "nvarchar":
    case "char":
      return "TEXT";
    case "bit":
    case "int":
    case "bigint":
      return "INTEGER";
    case "float":
    case "decimal":
      return "REAL";
    case "datetime":
    case "timestamp":
      return "TEXT";
    default:
      return "TEXT";
  }
}

function convertToSQLiteCompatibleType(value) {
  if (value === null || value === undefined) {
    return null;
  } else if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') {
    return value;
  } else if (Buffer.isBuffer(value)) {
    return value;
  } else {
    return JSON.stringify(value);
  }
}

const pool = await sql.connect(config);
await pool.request().query(`USE DB_1715832897261;`);
const data = await exportToSqlite(pool);

console.log(data);
