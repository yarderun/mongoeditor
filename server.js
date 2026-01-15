import express from "express"
import { MongoClient, ObjectId } from "mongodb"
import cors from "cors"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"

dotenv.config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017"

app.use(cors())
app.use(express.json({ limit: "50mb" }))
app.use(express.static("public"))

let client
let db

// MongoDB bağlantısı
async function connectToMongoDB() {
  try {
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      retryWrites: false,
      serverApi: {
        version: "1",
        strict: false,
        deprecationErrors: false,
      },
    })
    await client.connect()
    const dbName = new URL(MONGODB_URI).pathname.slice(1) || "admin"
    db = client.db(dbName)
    console.log(`✓ MongoDB bağlantısı başarılı: ${dbName}`)
    return true
  } catch (error) {
    console.error("✗ MongoDB bağlantı hatası:", error.message)
    return false
  }
}

// Hata yönetimi middleware
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

// Veritabanı listesi
app.get(
  "/api/databases",
  asyncHandler(async (req, res) => {
    const adminDb = client.db().admin()
    const { databases } = await adminDb.listDatabases()
    res.json({ databases: databases.map((db) => db.name) })
  }),
)

// Koleksiyon listesi
app.get(
  "/api/collections",
  asyncHandler(async (req, res) => {
    const { database } = req.query
    const targetDb = database ? client.db(database) : db
    const collections = await targetDb.listCollections().toArray()
    res.json({ collections: collections.map((c) => c.name) })
  }),
)

// Koleksiyon istatistikleri
app.get(
  "/api/collections/:name/stats",
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const { database } = req.query
    const targetDb = database ? client.db(database) : db

    const stats = await targetDb.command({ collStats: name })
    const count = await targetDb.collection(name).countDocuments()

    res.json({
      count,
      size: stats.size,
      storageSize: stats.storageSize,
      indexes: stats.nindexes,
    })
  }),
)

// Dökümanları getir (pagination + filtering)
app.get(
  "/api/collections/:name/documents",
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const { database, page = 1, limit = 20, sort = "_id", order = "desc", filter = "{}" } = req.query
    const targetDb = database ? client.db(database) : db

    const collection = targetDb.collection(name)
    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit)
    const sortOrder = order === "desc" ? -1 : 1

    let filterObj = {}
    try {
      filterObj = JSON.parse(filter)
      // ObjectId dönüşümü
      if (filterObj._id && typeof filterObj._id === "string") {
        filterObj._id = new ObjectId(filterObj._id)
      }
    } catch (e) {
      // Geçersiz filter, boş bırak
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
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        pages: Math.ceil(total / Number.parseInt(limit)),
      },
    })
  }),
)

// Tek döküman getir
app.get(
  "/api/collections/:name/documents/:id",
  asyncHandler(async (req, res) => {
    const { name, id } = req.params
    const { database } = req.query
    const targetDb = database ? client.db(database) : db

    const collection = targetDb.collection(name)
    const document = await collection.findOne({ _id: new ObjectId(id) })

    if (!document) {
      return res.status(404).json({ error: "Döküman bulunamadı" })
    }

    res.json(document)
  }),
)

// Yeni döküman ekle
app.post(
  "/api/collections/:name/documents",
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const { database, document } = req.body
    const targetDb = database ? client.db(database) : db

    if (!document || typeof document !== "object") {
      return res.status(400).json({ error: "Geçerli bir döküman gerekli" })
    }

    const collection = targetDb.collection(name)
    const result = await collection.insertOne(document)

    res.json({
      success: true,
      insertedId: result.insertedId,
      message: "Döküman başarıyla eklendi",
    })
  }),
)

// Döküman güncelle
app.put(
  "/api/collections/:name/documents/:id",
  asyncHandler(async (req, res) => {
    const { name, id } = req.params
    const { database, document } = req.body
    const targetDb = database ? client.db(database) : db

    if (!document || typeof document !== "object") {
      return res.status(400).json({ error: "Geçerli bir döküman gerekli" })
    }

    const collection = targetDb.collection(name)
    const { _id, ...updateDoc } = document

    const result = await collection.updateOne({ _id: new ObjectId(id) }, { $set: updateDoc })

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Döküman bulunamadı" })
    }

    res.json({
      success: true,
      modifiedCount: result.modifiedCount,
      message: "Döküman başarıyla güncellendi",
    })
  }),
)

// Döküman sil
app.delete(
  "/api/collections/:name/documents/:id",
  asyncHandler(async (req, res) => {
    const { name, id } = req.params
    const { database } = req.query
    const targetDb = database ? client.db(database) : db

    const collection = targetDb.collection(name)
    const result = await collection.deleteOne({ _id: new ObjectId(id) })

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Döküman bulunamadı" })
    }

    res.json({
      success: true,
      message: "Döküman başarıyla silindi",
    })
  }),
)

// Koleksiyon oluştur
app.post(
  "/api/collections",
  asyncHandler(async (req, res) => {
    const { database, name } = req.body
    const targetDb = database ? client.db(database) : db

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Geçerli bir koleksiyon adı gerekli" })
    }

    await targetDb.createCollection(name)

    res.json({
      success: true,
      message: `${name} koleksiyonu başarıyla oluşturuldu`,
    })
  }),
)

// Koleksiyon sil
app.delete(
  "/api/collections/:name",
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const { database } = req.query
    const targetDb = database ? client.db(database) : db

    await targetDb.collection(name).drop()

    res.json({
      success: true,
      message: `${name} koleksiyonu başarıyla silindi`,
    })
  }),
)

// Toplu silme
app.post(
  "/api/collections/:name/bulk-delete",
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const { database, ids } = req.body
    const targetDb = database ? client.db(database) : db

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Geçerli ID listesi gerekli" })
    }

    const collection = targetDb.collection(name)
    const objectIds = ids.map((id) => new ObjectId(id))

    const result = await collection.deleteMany({ _id: { $in: objectIds } })

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} döküman silindi`,
    })
  }),
)

// Hata yakalama middleware
app.use((err, req, res, next) => {
  console.error("Hata:", err)
  res.status(500).json({
    error: err.message || "Sunucu hatası",
    details: process.env.NODE_ENV === "development" ? err.stack : undefined,
  })
})

// Server başlat
async function startServer() {
  const connected = await connectToMongoDB()

  if (!connected) {
    console.log("⚠ MongoDB bağlantısı kurulamadı, ancak server başlatılıyor...")
    console.log("Lütfen MONGODB_URI environment variable'ını ayarlayın.")
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 MongoDB Admin Panel çalışıyor: http://localhost:${PORT}`)
  })
}

// Graceful shutdown
process.on("SIGINT", async () => {
  if (client) {
    await client.close()
    console.log("\n✓ MongoDB bağlantısı kapatıldı")
  }
  process.exit(0)
})

startServer()
