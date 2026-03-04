import express from "express"
import { MongoClient, ObjectId } from "mongodb"
import cors from "cors"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"
import pgPkg from "pg"

dotenv.config()

const { Pool } = pgPkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017"
const POSTGRES_URI = process.env.POSTGRES_URI || process.env.PG_URI || process.env.DATABASE_URL
const POSTGRES_SCHEMA = process.env.POSTGRES_SCHEMA || "public"

app.use(cors())
app.use(express.json({ limit: "50mb" }))
app.use(express.static("public"))

let mongoClient
let mongoDb

const pgPools = new Map()
const defaultPgDatabase = (() => {
  if (!POSTGRES_URI) return "postgres"
  try {
    const url = new URL(POSTGRES_URI)
    return url.pathname.replace("/", "") || "postgres"
  } catch (error) {
    return "postgres"
  }
})()

// MongoDB connection
async function connectToMongoDB() {
  try {
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      retryWrites: false,
      serverApi: {
        version: "1",
        strict: false,
        deprecationErrors: false,
      },
    })

    await mongoClient.connect()
    const dbName = new URL(MONGODB_URI).pathname.slice(1) || "admin"
    mongoDb = mongoClient.db(dbName)
    console.log(`MongoDB connection ready: ${dbName}`)
    return true
  } catch (error) {
    console.error("MongoDB connection error:", error.message)
    return false
  }
}

// PostgreSQL connection helpers
function getPgPool(targetDb) {
  if (!POSTGRES_URI) {
    throw new Error("PostgreSQL connection string is not configured (set POSTGRES_URI or PG_URI)")
  }

  const dbName = targetDb || defaultPgDatabase
  if (pgPools.has(dbName)) {
    return pgPools.get(dbName)
  }

  const url = new URL(POSTGRES_URI)
  url.pathname = `/${dbName}`
  const pool = new Pool({ connectionString: url.toString() })
  pgPools.set(dbName, pool)
  return pool
}

async function connectToPostgres() {
  if (!POSTGRES_URI) {
    console.log("INFO: PostgreSQL URI not provided; skipping Postgres setup.")
    return false
  }

  try {
    const pool = getPgPool(defaultPgDatabase)
    await pool.query("SELECT 1")
    console.log(`?PostgreSQL connection ready: ${defaultPgDatabase}`)
    return true
  } catch (error) {
    console.error("?PostgreSQL connection error:", error.message)
    return false
  }
}

async function getPgPrimaryKey(pool, schema, table) {
  const { rows } = await pool.query(
    `
    SELECT a.attname AS column_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
    WHERE i.indisprimary AND n.nspname = $1 AND c.relname = $2
    ORDER BY a.attnum
    `,
    [schema, table],
  )

  return rows[0]?.column_name || null
}

async function getPgColumns(pool, schema, table) {
  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
    `,
    [schema, table],
  )

  return rows.map((row) => row.column_name)
}

function buildPgWhereClause(filterObj, allowedColumns) {
  if (!filterObj || typeof filterObj !== "object") {
    return { clause: "", values: [] }
  }

  const values = []
  const conditions = []

  for (const [key, value] of Object.entries(filterObj)) {
    if (!allowedColumns.includes(key)) continue

    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "$like")) {
      values.push(`%${value.$like}%`)
      conditions.push(`"${key}" ILIKE $${values.length}`)
    } else {
      values.push(value)
      conditions.push(`"${key}" = $${values.length}`)
    }
  }

  if (!conditions.length) {
    return { clause: "", values: [] }
  }

  return {
    clause: `WHERE ${conditions.join(" AND ")}`,
    values,
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

// MongoDB routes
app.get(
  "/api/databases",
  asyncHandler(async (req, res) => {
    const adminDb = mongoClient.db().admin()
    const { databases } = await adminDb.listDatabases()
    res.json({ databases: databases.map((dbItem) => dbItem.name) })
  }),
)

app.get(
  "/api/collections",
  asyncHandler(async (req, res) => {
    const { database } = req.query
    const targetDb = database ? mongoClient.db(database) : mongoDb
    const collections = await targetDb.listCollections().toArray()
    res.json({ collections: collections.map((c) => c.name) })
  }),
)

app.get(
  "/api/collections/:name/stats",
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const { database } = req.query
    const targetDb = database ? mongoClient.db(database) : mongoDb

    const stats = await targetDb.command({ collStats: name })
    const count = await targetDb.collection(name).countDocuments()

    res.json({
      count,
      size: stats.size,
      storageSize: stats.storageSize,
      indexes: stats.nindexes,
      primaryKey: "_id",
    })
  }),
)

app.get(
  "/api/collections/:name/documents",
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const { database, page = 1, limit = 20, sort = "_id", order = "desc", filter = "{}" } = req.query
    const targetDb = database ? mongoClient.db(database) : mongoDb

    const collection = targetDb.collection(name)
    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit)
    const sortOrder = order === "desc" ? -1 : 1

    let filterObj = {}
    try {
      filterObj = JSON.parse(filter)
      if (filterObj._id && typeof filterObj._id === "string") {
        filterObj._id = new ObjectId(filterObj._id)
      }
    } catch (e) {
      // ignore invalid filter
    }

    const documents = await collection
      .find(filterObj)
      .sort({ [sort]: sortOrder })
      .skip(skip)
      .limit(Number.parseInt(limit))
      .toArray()

    const total = await collection.countDocuments(filterObj)

    res.json({
      documents,
      primaryKey: "_id",
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        pages: Math.ceil(total / Number.parseInt(limit)),
      },
    })
  }),
)

app.get(
  "/api/collections/:name/documents/:id",
  asyncHandler(async (req, res) => {
    const { name, id } = req.params
    const { database } = req.query
    const targetDb = database ? mongoClient.db(database) : mongoDb

    const collection = targetDb.collection(name)
    const document = await collection.findOne({ _id: new ObjectId(id) })

    if (!document) {
      return res.status(404).json({ error: "Document not found" })
    }

    res.json(document)
  }),
)

app.post(
  "/api/collections/:name/documents",
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const { database, document } = req.body
    const targetDb = database ? mongoClient.db(database) : mongoDb

    if (!document || typeof document !== "object") {
      return res.status(400).json({ error: "Valid document required" })
    }

    const collection = targetDb.collection(name)
    const result = await collection.insertOne(document)

    res.json({
      success: true,
      insertedId: result.insertedId,
      message: "Document inserted",
    })
  }),
)

app.put(
  "/api/collections/:name/documents/:id",
  asyncHandler(async (req, res) => {
    const { name, id } = req.params
    const { database, document } = req.body
    const targetDb = database ? mongoClient.db(database) : mongoDb

    if (!document || typeof document !== "object") {
      return res.status(400).json({ error: "Valid document required" })
    }

    const collection = targetDb.collection(name)
    const { _id, ...updateDoc } = document

    const result = await collection.updateOne({ _id: new ObjectId(id) }, { $set: updateDoc })

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Document not found" })
    }

    res.json({
      success: true,
      modifiedCount: result.modifiedCount,
      message: "Document updated",
    })
  }),
)

app.delete(
  "/api/collections/:name/documents/:id",
  asyncHandler(async (req, res) => {
    const { name, id } = req.params
    const { database } = req.query
    const targetDb = database ? mongoClient.db(database) : mongoDb

    const collection = targetDb.collection(name)
    const result = await collection.deleteOne({ _id: new ObjectId(id) })

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Document not found" })
    }

    res.json({ success: true, message: "Document deleted" })
  }),
)

app.post(
  "/api/collections/:name/bulk-delete",
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const { database, ids } = req.body
    const targetDb = database ? mongoClient.db(database) : mongoDb

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Valid ID list required" })
    }

    const collection = targetDb.collection(name)
    const objectIds = ids.map((item) => new ObjectId(item))

    const result = await collection.deleteMany({ _id: { $in: objectIds } })

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} documents deleted`,
    })
  }),
)

app.post(
  "/api/collections",
  asyncHandler(async (req, res) => {
    const { database, name } = req.body
    const targetDb = database ? mongoClient.db(database) : mongoDb

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Valid collection name required" })
    }

    await targetDb.createCollection(name)

    res.json({ success: true, message: `${name} created` })
  }),
)

app.delete(
  "/api/collections/:name",
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const { database } = req.query
    const targetDb = database ? mongoClient.db(database) : mongoDb

    await targetDb.collection(name).drop()

    res.json({ success: true, message: `${name} dropped` })
  }),
)

// PostgreSQL routes
app.get(
  "/api/pg/databases",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.json({ databases: [] })
    }

    const pool = getPgPool(defaultPgDatabase)
    const { rows } = await pool.query(
      "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
    )
    res.json({ databases: rows.map((row) => row.datname) })
  }),
)

app.get(
  "/api/pg/tables",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.status(400).json({ error: "PostgreSQL is not configured" })
    }

    const { database, schema = POSTGRES_SCHEMA } = req.query
    const pool = getPgPool(database)

    const { rows } = await pool.query(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name
      `,
      [schema],
    )

    res.json({ tables: rows.map((row) => row.table_name), schema })
  }),
)

app.get(
  "/api/pg/tables/:name/stats",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.status(400).json({ error: "PostgreSQL is not configured" })
    }

    const { name } = req.params
    const { database, schema = POSTGRES_SCHEMA } = req.query
    const pool = getPgPool(database)

    const primaryKey = (await getPgPrimaryKey(pool, schema, name)) || "id"

    const countResult = await pool.query(`SELECT COUNT(*)::bigint AS count FROM "${schema}"."${name}"`)
    const sizeResult = await pool.query(
      `SELECT COALESCE(pg_total_relation_size(to_regclass(quote_ident($1::text) || '.' || quote_ident($2::text))), 0) AS size`,
      [schema, name],
    )
    const indexResult = await pool.query(
      `SELECT COUNT(*) AS indexes FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
      [schema, name],
    )
    const columnsResult = await pool.query(
      `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
      `,
      [schema, name],
    )

    res.json({
      count: Number(countResult.rows[0].count),
      size: Number(sizeResult.rows[0].size || 0),
      storageSize: Number(sizeResult.rows[0].size || 0),
      indexes: Number(indexResult.rows[0].indexes || 0),
      primaryKey,
      columns: columnsResult.rows,
    })
  }),
)

app.get(
  "/api/pg/tables/:name/rows",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.status(400).json({ error: "PostgreSQL is not configured" })
    }

    const { name } = req.params
    const {
      database,
      schema = POSTGRES_SCHEMA,
      page = 1,
      limit = 20,
      sort,
      order = "desc",
      filter = "{}",
    } = req.query

    const pool = getPgPool(database)
    const columns = await getPgColumns(pool, schema, name)
    const primaryKey = (await getPgPrimaryKey(pool, schema, name)) || columns[0] || "id"

    const sortField = columns.includes(sort) ? sort : primaryKey
    const pageNum = Math.max(1, Number.parseInt(page))
    const limitNum = Math.min(Math.max(1, Number.parseInt(limit)), 200)
    const offset = (pageNum - 1) * limitNum

    let filterObj = {}
    try {
      filterObj = JSON.parse(filter)
    } catch (error) {
      filterObj = {}
    }

    const where = buildPgWhereClause(filterObj, columns)
    const params = [...where.values]
    const limitIndex = params.length + 1
    const offsetIndex = params.length + 2

    params.push(limitNum, offset)

    const rowsResult = await pool.query(
      `
      SELECT * FROM "${schema}"."${name}" ${where.clause}
      ${sortField ? `ORDER BY "${sortField}" ${order === "asc" ? "ASC" : "DESC"}` : ""}
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    )

    const countResult = await pool.query(
      `SELECT COUNT(*)::bigint AS total FROM "${schema}"."${name}" ${where.clause}`,
      where.values,
    )

    const total = Number(countResult.rows[0].total)

    res.json({
      documents: rowsResult.rows,
      primaryKey,
      columns,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    })
  }),
)

app.get(
  "/api/pg/tables/:name/rows/:id",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.status(400).json({ error: "PostgreSQL is not configured" })
    }

    const { name, id } = req.params
    const { database, schema = POSTGRES_SCHEMA } = req.query
    const pool = getPgPool(database)

    const primaryKey = (await getPgPrimaryKey(pool, schema, name)) || "id"
    const result = await pool.query(
      `SELECT * FROM "${schema}"."${name}" WHERE "${primaryKey}" = $1 LIMIT 1`,
      [id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Row not found" })
    }

    res.json(result.rows[0])
  }),
)

app.post(
  "/api/pg/tables/:name/rows",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.status(400).json({ error: "PostgreSQL is not configured" })
    }

    const { name } = req.params
    const { database, schema = POSTGRES_SCHEMA, document } = req.body
    const pool = getPgPool(database)

    if (!document || typeof document !== "object") {
      return res.status(400).json({ error: "Valid row payload required" })
    }

    const keys = Object.keys(document)
    if (keys.length === 0) {
      return res.status(400).json({ error: "Row cannot be empty" })
    }

    const columns = keys.map((key) => `"${key}"`).join(", ")
    const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(", ")
    const values = keys.map((key) => document[key])

    const insertResult = await pool.query(
      `INSERT INTO "${schema}"."${name}" (${columns}) VALUES (${placeholders}) RETURNING *`,
      values,
    )

    const primaryKey = (await getPgPrimaryKey(pool, schema, name)) || "id"
    const inserted = insertResult.rows[0]

    res.json({
      success: true,
      insertedId: inserted?.[primaryKey] ?? inserted?.id,
      document: insertResult.rows[0],
      message: "Row inserted",
    })
  }),
)

app.put(
  "/api/pg/tables/:name/rows/:id",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.status(400).json({ error: "PostgreSQL is not configured" })
    }

    const { name, id } = req.params
    const { database, schema = POSTGRES_SCHEMA, document } = req.body
    const pool = getPgPool(database)

    if (!document || typeof document !== "object") {
      return res.status(400).json({ error: "Valid row payload required" })
    }

    const primaryKey = (await getPgPrimaryKey(pool, schema, name)) || "id"
    const columns = await getPgColumns(pool, schema, name)

    const entries = Object.entries(document).filter(([key]) => key !== primaryKey && columns.includes(key))

    if (!entries.length) {
      return res.status(400).json({ error: "No updatable fields provided" })
    }

    const setClauses = entries.map(([key], idx) => `"${key}" = $${idx + 1}`)
    const values = entries.map(([, value]) => value)

    const updatedAtColumn = columns.includes("updated_at") ? `, "updated_at" = NOW()` : ""
    const whereIndex = values.length + 1

    const result = await pool.query(
      `UPDATE "${schema}"."${name}" SET ${setClauses.join(", ")}${updatedAtColumn} WHERE "${primaryKey}" = $${whereIndex} RETURNING *`,
      [...values, id],
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Row not found" })
    }

    res.json({ success: true, document: result.rows[0], message: "Row updated" })
  }),
)

app.delete(
  "/api/pg/tables/:name/rows/:id",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.status(400).json({ error: "PostgreSQL is not configured" })
    }

    const { name, id } = req.params
    const { database, schema = POSTGRES_SCHEMA } = req.query
    const pool = getPgPool(database)

    const primaryKey = (await getPgPrimaryKey(pool, schema, name)) || "id"

    const result = await pool.query(
      `DELETE FROM "${schema}"."${name}" WHERE "${primaryKey}" = $1`,
      [id],
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Row not found" })
    }

    res.json({ success: true, message: "Row deleted" })
  }),
)

app.post(
  "/api/pg/tables/:name/bulk-delete",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.status(400).json({ error: "PostgreSQL is not configured" })
    }

    const { name } = req.params
    const { database, schema = POSTGRES_SCHEMA, ids } = req.body
    const pool = getPgPool(database)

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Valid ID list required" })
    }

    const primaryKey = (await getPgPrimaryKey(pool, schema, name)) || "id"
    const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(", ")

    const result = await pool.query(
      `DELETE FROM "${schema}"."${name}" WHERE "${primaryKey}" IN (${placeholders})`,
      ids,
    )

    res.json({ success: true, deletedCount: result.rowCount, message: `${result.rowCount} rows deleted` })
  }),
)

app.post(
  "/api/pg/tables",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.status(400).json({ error: "PostgreSQL is not configured" })
    }

    const { database, schema = POSTGRES_SCHEMA, name } = req.body
    const pool = getPgPool(database)

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Valid table name required" })
    }

    const safeName = name.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(safeName)) {
      return res.status(400).json({ error: "Table name must contain only letters, numbers and underscores" })
    }

    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS "${schema}"."${safeName}" (
        id SERIAL PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
      `,
    )

    res.json({ success: true, message: `${safeName} table created with columns id, data, created_at, updated_at` })
  }),
)

app.delete(
  "/api/pg/tables/:name",
  asyncHandler(async (req, res) => {
    if (!POSTGRES_URI) {
      return res.status(400).json({ error: "PostgreSQL is not configured" })
    }

    const { name } = req.params
    const { database, schema = POSTGRES_SCHEMA } = req.query
    const pool = getPgPool(database)

    await pool.query(`DROP TABLE IF EXISTS "${schema}"."${name}"`)
    res.json({ success: true, message: `${name} table dropped` })
  }),
)

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err)
  res.status(500).json({
    error: err.message || "Server error",
    details: process.env.NODE_ENV === "development" ? err.stack : undefined,
  })
})

async function startServer() {
  const mongoConnected = await connectToMongoDB()
  const pgConnected = await connectToPostgres()

  if (!mongoConnected) {
    console.log("WARN: MongoDB connection could not be established; server will still run.")
  }

  if (!pgConnected && POSTGRES_URI) {
    console.log("WARN: PostgreSQL connection could not be established; server will still run.")
  }

  app.listen(PORT, () => {
    console.log(`\nSERVER Admin panel running: http://localhost:${PORT}`)
  })
}

process.on("SIGINT", async () => {
  if (mongoClient) {
    await mongoClient.close()
    console.log("\nMongoDB connection closed")
  }

  for (const pool of pgPools.values()) {
    await pool.end()
  }
  if (pgPools.size) {
    console.log("PostgreSQL connections closed")
  }

  process.exit(0)
})

startServer()
