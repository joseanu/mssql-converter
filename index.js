import express from "express";
import cors from "cors";
import multer from "multer";
import compression from "compression";
import sql from "mssql";
import sqlite3 from "better-sqlite3";
import path from "path";
import fs from "fs";

const app = express();

app.use(compression());

app.use(
  cors({
    origin: function (origin, callback) {
      // Permitir solicitudes sin origen (como curl)
      if (
        origin &&
        (origin.endsWith("replit.dev") || origin.endsWith("presupuestos.red"))
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  }),
);

const sqlConfig = {
  user: "sa",
  password: process.env.MSSQL_SA_PASSWORD,
  server: process.env.MSSQL_HOST || "mssql",
  parseJSON: true,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

// Set storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./uploads/"); // Ensure this directory exists
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const fileNameWithoutExtension = timestamp.toString();
    req.fileNameWithoutExtension = fileNameWithoutExtension;
    cb(null, fileNameWithoutExtension + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  if (path.extname(file.originalname).toLowerCase() === ".bak") {
    cb(null, true);
  } else {
    cb(new Error("Only .bak files are allowed!"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 40 * 1024 * 1024 }, // 40MB
});

// Check SQL Server availability
const waitForSqlServer = async (config) => {
  let pool;
  const startTime = Date.now();
  const connectionAttempts = async () => {
    while (true) {
      try {
        pool = await sql.connect(config);
        console.log("Connected to SQL Server.");
        return pool; // Return the pool for use in the app
      } catch (error) {
        const currentTime = Date.now();
        if (currentTime - startTime > 60000) {
          // 60 seconds
          throw new Error(
            "Connection Timeout: Failed to connect to SQL Server within 60 seconds.",
          );
        }
        if (error instanceof sql.ConnectionError) {
          console.log("Connection error, waiting 2 seconds to retry...");
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for 2 seconds
        } else {
          throw error;
        }
      }
    }
  };
  return connectionAttempts();
};

// Función para restaurar la base de datos
async function restoreDatabase(pool, file, dbName) {
  console.log(`Restoring database from .bak file to ${dbName}.`);
  const fileListResult = await pool
    .request()
    .query(`RESTORE FILELISTONLY FROM DISK = '${path.resolve(file.path)}';`);
  let logicalNameMDF = "";
  let logicalNameLDF = "";
  fileListResult.recordset.forEach((file) => {
    if (file.Type === "D") {
      logicalNameMDF = file.LogicalName;
    } else if (file.Type === "L") {
      logicalNameLDF = file.LogicalName;
    }
  });

  await pool.request().query(
    `RESTORE DATABASE ${dbName} FROM DISK = '${path.resolve(
      file.path,
    )}' WITH FILE = 1, 
    MOVE '${logicalNameMDF}' TO '/var/opt/mssql/data/${dbName}.mdf', 
    MOVE '${logicalNameLDF}' TO '/var/opt/mssql/data/${dbName}_log.ldf';`,
  );
  console.log("Database restored successfully.");
}

// Función para convertir la base de datos a sqlite
async function toSqlite(pool) {
  console.log("Converting to SQLite.");
  const sqliteDB = new sqlite3(":memory:");
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
          column.DATA_TYPE,
        )}`;
        if (column.IS_NULLABLE === "NO") {
          columnDefinition += " NOT NULL";
        }
        return columnDefinition;
      });
      createTableStatement += columnDefinitions.join(", ") + ")";

      sqliteDB.exec(createTableStatement);

      const insertColumns = createTableQuery.recordset.map(
        (column) => column.COLUMN_NAME,
      );
      const insertStatement = sqliteDB.prepare(
        `INSERT INTO ${tableName} (${insertColumns.join(
          ", ",
        )}) VALUES (${insertColumns.map(() => "?").join(",")})`,
      );

      const selectQuery = `SELECT * FROM ${tableName}`;
      const result = await pool.request().query(selectQuery);
      for (const row of result.recordset) {
        const values = insertColumns.map((column) =>
          convertToSQLiteCompatibleType(row[column]),
        );
        insertStatement.run(values);
      }
    }
    // Serializar la base de datos en memoria y enviarla como respuesta
    return sqliteDB.serialize();
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

// Función para convertir la base de datos a JSON
async function toJson(pool) {
  console.log("Converting to JSON.");
  try {
    let tables = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
    `);

    let jsonObj = {};

    for (const table of tables.recordset) {
      const tableName = table.TABLE_NAME;
      const query = `SELECT * FROM ${tableName};`;
      const result = await pool.request().query(query);
      jsonObj[tableName] = result.recordset.map((row) => {
        let filteredRow = {};
        for (let key in row) {
          if (Buffer.isBuffer(row[key])) {
            filteredRow[key] = "";
          } else if (typeof row[key] === "string" && row[key].length > 1500) {
            filteredRow[key] = "";
          } else {
            filteredRow[key] = row[key];
          }
        }
        return filteredRow;
      });
    }

    return jsonObj;
  } catch (error) {
    console.error("Error during JSON export process:", error);
    throw error;
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
  } else if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "bigint"
  ) {
    return value;
  } else if (Buffer.isBuffer(value)) {
    return value;
  } else {
    return JSON.stringify(value);
  }
}

// Función para eliminar la base de datos
async function dropDatabase(pool, dbName) {
  try {
    await pool
      .request()
      .query(`ALTER DATABASE ${dbName} SET OFFLINE WITH ROLLBACK IMMEDIATE;`);
    await pool.request().query(`ALTER DATABASE ${dbName} SET ONLINE;`);
    await pool.request().query(`DROP DATABASE ${dbName};`);
    console.log("Temporary database dropped.");
  } catch (error) {
    console.error("Error dropping database:", error);
    throw error;
  }
}

// POST route for file upload, restore .bak file, export to sqlite, and clean up
app.post("/sqlite", upload.single("bak"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded or incorrect file type.");
  }
  const file = req.file;
  const dbName = `DB_${req.fileNameWithoutExtension}`;
  console.log(`Exporting database to SQLite for ${dbName}.`);

  let pool;

  try {
    pool = await waitForSqlServer(sqlConfig);
    console.log("SQL Server is up and running.");

    await restoreDatabase(pool, file, dbName);
    await pool.request().query(`USE ${dbName};`);
    const data = await toSqlite(pool);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${dbName}.sqlite"`,
    );
    res.status(200).send(data);
  } catch (error) {
    console.error("Error during the process:", error);
    res.status(500).send(error);
  } finally {
    await dropDatabase(pool, dbName);
    if (pool) {
      await pool.close();
    }
    try {
      fs.unlinkSync(file.path);
      console.log(".bak file deleted successfully.");
    } catch (err) {
      console.error("Failed to delete .bak file:", err);
    }
  }
});

// POST route for file upload, restore .bak file, query data, and clean up
app.post("/json", upload.single("bak"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded or incorrect file type.");
  }
  const file = req.file;
  const dbName = `DB_${req.fileNameWithoutExtension}`;
  console.log(`Exporting database to JSON for ${dbName}.`);

  let pool;

  try {
    pool = await waitForSqlServer(sqlConfig);
    console.log("SQL Server is up and running.");

    await restoreDatabase(pool, file, dbName);
    await pool.request().query(`USE ${dbName};`);
    const data = await toJson(pool);

    res.json(data);
  } catch (error) {
    console.error("Error during the process:", error);
    res.status(500).send(error);
  } finally {
    await dropDatabase(pool, dbName);
    if (pool) {
      await pool.close();
    }
    try {
      fs.unlinkSync(file.path);
      console.log(".bak file deleted successfully.");
    } catch (err) {
      console.error("Failed to delete .bak file:", err);
    }
  }
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).send("File too large. Maximum allowed size is 40 MB.");
  } else {
    console.error("Error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Serve an HTML form on '/upload-form'
app.get("/upload-form", (req, res) => {
  res.send(`
    <h2>Upload Form</h2>
    <form action="/sqlite" method="post" enctype="multipart/form-data">
      <div>
        <label for="file">Choose a file to upload:</label>
        <input type="file" id="bak" name="bak">
      </div>
      <button type="submit">Upload File</button>
    </form>
  `);
});

app.get("/", (req, res) => {
  res.send("RΞD Consultores");
});

app.listen(8080, () => {
  console.log("Express server initialized");
});
