const fs = require("fs")
const path = require("path")
const express = require("express")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const multer = require("multer")
const dotenv = require("dotenv")
const cookieParser = require("cookie-parser")
const app = express()

dotenv.config()

const PORT = process.env.PORT || 3002

app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, "public")))

app.use((req, res, next) => {
  res.locals.currentPath = req.path
  next()
})

mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/opulent")
  .then(() => console.log("Conectado a MongoDB"))
  .catch((err) => console.error("Error conectando a MongoDB:", err.message))

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
)

const User = mongoose.models.User || mongoose.model("User", userSchema)

const productSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      enum: ["Louis Vuitton", "Dior", "Lacoste", "Perfumes", "Camisas", "Carteras"],
      index: true,
    },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    price: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    images: { type: [String], default: [] },
    stockBySize: {
      type: [
        {
          size: { type: String, trim: true, required: true, maxlength: 20 },
          qty: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
)

const Product = mongoose.models.Product || mongoose.model("Product", productSchema)

const uploadsDir = path.join(__dirname, "public", "uploads")
fs.mkdirSync(uploadsDir, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const safeExt = path.extname(file.originalname || "").slice(0, 10)
      const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      cb(null, `${unique}${safeExt}`)
    },
  }),
})

const requireAdminPage = (req, res, next) => {
  if (req.cookies?.opulent_admin === "1") return next()
  return res.redirect("/")
}

const requireAdminApi = (req, res, next) => {
  if (req.cookies?.opulent_admin === "1") return next()
  return res.status(401).json({ message: "No autorizado." })
}

app.get("/", (req, res) => res.render("index"))
app.get("/CataLV", (req, res) => res.render("CataLV"))
app.get("/CataDior", (req, res) => res.render("CataDior"))
app.get("/CataLacoste", (req, res) => res.render("CataLacoste"))
app.get("/admin", requireAdminPage, (req, res) => res.render("admin"))
app.get("/producto/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "")
    const product = await Product.findById(id).lean()
    if (!product) return res.status(404).render("producto", { product: null })
    res.render("producto", { product })
  } catch {
    res.status(404).render("producto", { product: null })
  }
})

app.get("/api/db/status", (req, res) => {
  res.json({ readyState: mongoose.connection.readyState })
})

app.get("/api/products", async (req, res) => {
  try {
    const category = String(req.query?.category || "").trim()
    const filter = {}
    if (category) filter.category = category
    const products = await Product.find(filter).sort({ createdAt: -1 }).lean()
    res.json({ products })
  } catch {
    res.status(500).json({ message: "Error cargando productos." })
  }
})

app.get("/api/products/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "")
    const product = await Product.findById(id).lean()
    if (!product) return res.status(404).json({ message: "Producto no encontrado." })
    res.json({ product })
  } catch {
    res.status(400).json({ message: "Producto no encontrado." })
  }
})

app.post(
  "/api/admin/products",
  requireAdminApi,
  upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "images", maxCount: 20 },
  ]),
  async (req, res) => {
  try {
    const category = String(req.body?.category || "").trim()
    const name = String(req.body?.name || "").trim()
    const price = Number(req.body?.price)
    const discountRaw = req.body?.discount
    const discount = discountRaw === "" || discountRaw == null ? 0 : Number(discountRaw)
    const stockRaw = req.body?.stockBySize

    const normalizeStockBySize = (raw) => {
      const str = String(raw == null ? "" : raw).trim()
      if (!str) return []
      let parsed
      try {
        parsed = JSON.parse(str)
      } catch {
        return []
      }
      if (!Array.isArray(parsed)) return []

      const out = []
      const seen = new Set()
      parsed.forEach((row) => {
        const size = String(row?.size || "").trim()
        const qty = Number(row?.qty)
        if (!size) return
        if (!Number.isFinite(qty) || qty < 0) return
        const key = size.toUpperCase()
        if (seen.has(key)) return
        seen.add(key)
        out.push({ size, qty: Math.floor(qty) })
      })
      return out
    }

    if (!category || !name || !Number.isFinite(price)) {
      return res.status(400).json({ message: "Faltan datos." })
    }

    const coverFile = Array.isArray(req.files?.cover) ? req.files.cover[0] : null
    const otherFiles = Array.isArray(req.files?.images) ? req.files.images : []
    const otherImages = otherFiles.map((f) => `/uploads/${f.filename}`)
    const coverImage = coverFile ? `/uploads/${coverFile.filename}` : otherImages.shift() || ""
    const images = [coverImage, ...otherImages].filter(Boolean)

    if (!images.length) {
      return res.status(400).json({ message: "Sube al menos una imagen." })
    }

    const stockBySize = normalizeStockBySize(stockRaw)
    const product = await Product.create({ category, name, price, discount, images, stockBySize })
    res.status(201).json({ product })
  } catch {
    res.status(500).json({ message: "Error creando el producto." })
  }
  }
)

app.put(
  "/api/admin/products/:id",
  requireAdminApi,
  upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "images", maxCount: 20 },
  ]),
  async (req, res) => {
  try {
    const id = String(req.params.id || "")
    const category = String(req.body?.category || "").trim()
    const name = String(req.body?.name || "").trim()
    const price = Number(req.body?.price)
    const discountRaw = req.body?.discount
    const discount = discountRaw === "" || discountRaw == null ? 0 : Number(discountRaw)
    const replaceImages = String(req.body?.replaceImages || "") === "1"
    const stockRaw = req.body?.stockBySize

    const normalizeStockBySize = (raw) => {
      const str = String(raw == null ? "" : raw).trim()
      if (!str) return []
      let parsed
      try {
        parsed = JSON.parse(str)
      } catch {
        return []
      }
      if (!Array.isArray(parsed)) return []

      const out = []
      const seen = new Set()
      parsed.forEach((row) => {
        const size = String(row?.size || "").trim()
        const qty = Number(row?.qty)
        if (!size) return
        if (!Number.isFinite(qty) || qty < 0) return
        const key = size.toUpperCase()
        if (seen.has(key)) return
        seen.add(key)
        out.push({ size, qty: Math.floor(qty) })
      })
      return out
    }

    const product = await Product.findById(id)
    if (!product) return res.status(404).json({ message: "Producto no encontrado." })

    if (category) product.category = category
    if (name) product.name = name
    if (Number.isFinite(price)) product.price = price
    if (Number.isFinite(discount)) product.discount = discount
    if (stockRaw != null) product.stockBySize = normalizeStockBySize(stockRaw)

    const coverFile = Array.isArray(req.files?.cover) ? req.files.cover[0] : null
    const otherFiles = Array.isArray(req.files?.images) ? req.files.images : []
    const newImages = otherFiles.map((f) => `/uploads/${f.filename}`)
    const newCover = coverFile ? `/uploads/${coverFile.filename}` : ""

    if (replaceImages && product.images?.length) {
      product.images.forEach((p) => {
        const abs = path.join(__dirname, "public", p.replace(/^\//, ""))
        fs.unlink(abs, () => {})
      })
      product.images = []
    }

    if (replaceImages) {
      if (newCover || newImages.length) {
        const cover = newCover || newImages.shift() || ""
        product.images = [cover, ...newImages].filter(Boolean)
      }
    } else {
      if (newCover) {
        product.images = [newCover, ...(Array.isArray(product.images) ? product.images.filter((p) => p !== newCover) : [])]
      }
      if (newImages.length) {
        if (!product.images?.length) {
          product.images = newImages
        } else {
          product.images = [...product.images, ...newImages]
        }
      }
    }

    await product.save()
    res.json({ product })
  } catch {
    res.status(500).json({ message: "Error actualizando el producto." })
  }
  }
)

app.delete("/api/admin/products/:id", requireAdminApi, async (req, res) => {
  try {
    const id = String(req.params.id || "")
    const product = await Product.findByIdAndDelete(id).lean()
    if (!product) return res.status(404).json({ message: "Producto no encontrado." })

    if (Array.isArray(product.images)) {
      product.images.forEach((p) => {
        const abs = path.join(__dirname, "public", String(p).replace(/^\//, ""))
        fs.unlink(abs, () => {})
      })
    }

    res.json({ ok: true })
  } catch {
    res.status(500).json({ message: "Error eliminando el producto." })
  }
})

app.post("/api/auth/login", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim()
    const email = String(req.body?.email || "").trim().toLowerCase()
    const password = String(req.body?.password || "")

    if (!email || !password) {
      return res.status(400).json({ message: "Faltan datos." })
    }

    const user = await User.findOne({ email }).select("+passwordHash")
    if (!user) {
      return res.status(401).json({ message: "Datos incorrectos." })
    }

    if (name && user.name.toLowerCase() !== name.toLowerCase()) {
      return res.status(401).json({ message: "Datos incorrectos." })
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      return res.status(401).json({ message: "Datos incorrectos." })
    }

    res.status(200).json({ id: user._id, name: user.name, email: user.email })
  } catch {
    res.status(500).json({ message: "Error verificando el usuario." })
  }
})

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim()
    const email = String(req.body?.email || "").trim().toLowerCase()
    const password = String(req.body?.password || "")

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Faltan datos." })
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres." })
    }

    const existing = await User.findOne({ email })
    if (existing) {
      return res.status(409).json({ message: "Ese correo ya está registrado." })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await User.create({ name, email, passwordHash })

    res.status(201).json({ id: user._id, name: user.name, email: user.email })
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Ese correo ya está registrado." })
    }
    res.status(500).json({ message: "Error creando el usuario." })
  }
})

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`)
})
