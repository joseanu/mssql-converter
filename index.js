import express from "express";
import multer from "multer";
import compression from "compression";
import sql from "mssql";
import path from "path";
import fs from "fs";

import tables from "./tablesList.js";

const app = express();

app.use(compression());

const sqlConfig = {
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
  let attempts = 0;
  const startTime = Date.now();
  const connectionAttempts = async () => {
    while (true) {
      try {
        pool = await sql.connect(config);
        console.log("Connected to SQL Server.");
        return pool; // Return the pool for use in the app
      } catch (error) {
        const currentTime = Date.now();
        if ((currentTime - startTime) > 60000) { // 60 seconds
          throw new Error("Connection Timeout: Failed to connect to SQL Server within 60 seconds.");
        }
        if (error instanceof sql.ConnectionError) {
          console.log("Connection error, waiting 2 seconds to retry...");
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for 2 seconds
          attempts += 1;
        } else {
          throw error; // In case of other errors, throw them to be caught by the caller
        }
      }
    }
  };
  return connectionAttempts();
};


// 'Hello World' GET Route
app.get("/", (req, res) => {
  res.send("Hello World!");
});

// POST route for file upload, restore .bak file, query data, and clean up
app.post("/bak", upload.single("bak"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded or incorrect file type.");
  }
  const file = req.file;
  const dbName = `DB_${req.fileNameWithoutExtension}`;
  let pool;

  try {
    pool = await waitForSqlServer(sqlConfig);
    console.log("SQL Server is up and running.");

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

    console.log("Fetching data from multiple tables.");
    let jsonObj = {};

    for (const table in tables) {
      let columns = tables[table].join(", ");
      const query = `SELECT ${columns} FROM ${dbName}.dbo.${table} FOR JSON AUTO;`;
      const result = await pool.request().query(query);
      jsonObj[table] = result.recordset[0];
    }
    console.log("Data fetched from all tables.");
    res.json(jsonObj);

    await pool.request().query(`DROP DATABASE ${dbName};`);
    console.log("Temporary database dropped.");
  } catch (error) {
    if (error instanceof sql.RequestError) {
      console.error("SQL Request Error during the process:", error);
      res
        .status(500)
        .send("SQL Request Error: Failed to complete the operation.");
    } else if (error instanceof sql.ConnectionError) {
      console.error("SQL Connection Error during the process:", error);
      res
        .status(500)
        .send("SQL Connection Error: Failed to complete the operation.");
    } else {
      console.error("Unexpected Error during the process:", error);
      res
        .status(500)
        .send("Unexpected Error: Failed to complete the operation.");
    }
  } finally {
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

// Serve an HTML form on '/upload-form'
app.get("/upload-form", (req, res) => {
  res.send(`
    <h2>Upload Form</h2>
    <form action="/bak" method="post" enctype="multipart/form-data">
      <div>
        <label for="file">Choose a file to upload:</label>
        <input type="file" id="bak" name="bak">
      </div>
      <button type="submit">Upload File</button>
    </form>
  `);
});

app.listen(8080, () => {
  console.log("Express server initialized");
});
