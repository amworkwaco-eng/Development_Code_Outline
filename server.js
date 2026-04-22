const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─── Config ─────────────────────────────────────────────────

// Support .env files (lightweight, no dotenv dependency)
try {
  const envFile = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  envFile.split("\n").forEach(line => {
    const [key, ...val] = line.split("=");
    if (key && val.length) process.env[key.trim()] = val.join("=").trim();
  });
} catch {}

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_PW = process.env.ADMIN_PASSWORD || "admin";
const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const META_FILE = path.join(DATA_DIR, "documents.json");

// Ensure directories exist
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(META_FILE)) fs.writeFileSync(META_FILE, "[]");

// ─── Helpers ────────────────────────────────────────────────

const activeSessions = new Map(); // token -> expiry

function readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, "utf8")); }
  catch { return []; }
}

function writeMeta(docs) {
  fs.writeFileSync(META_FILE, JSON.stringify(docs, null, 2));
}

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || !activeSessions.has(token) || activeSessions.get(token) < Date.now()) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ─── App ────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const ok = /pdf|png|jpg|jpeg|gif|webp/.test(file.mimetype);
    cb(null, ok);
  }
});

// ─── Admin auth ─────────────────────────────────────────────

app.post("/api/admin/login", (req, res) => {
  if (req.body.password !== ADMIN_PW) {
    return res.status(401).json({ error: "Invalid password" });
  }
  const token = crypto.randomBytes(32).toString("hex");
  activeSessions.set(token, Date.now() + 24 * 60 * 60 * 1000); // 24h
  res.json({ token });
});

// ─── Admin: upload document ─────────────────────────────────

app.post("/api/admin/upload", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });

  const docs = readMeta();
  const doc = {
    id: crypto.randomBytes(8).toString("hex"),
    name: req.file.originalname,
    filename: req.file.filename,
    type: req.file.mimetype,
    size: req.file.size,
    tags: [],
    uploaded: new Date().toISOString(),
  };

  // Auto-tag from filename
  const fn = doc.name.toLowerCase();
  if (/30[0-9]|31[0-4]|32[0-9]|33[0-9]|34[0-9]|35[0-9]|37[0-9]|district/i.test(fn)) doc.tags.push("district");
  if (/430|special.?use|middle.?hous/i.test(fn)) doc.tags.push("use-standards");
  if (/418|setback/i.test(fn)) doc.tags.push("setbacks");
  if (/413|parking/i.test(fn)) doc.tags.push("parking");
  if (/407|411|landscape|screen|buffer/i.test(fn)) doc.tags.push("landscape");
  if (/501|transport|access/i.test(fn)) doc.tags.push("transport");
  if (/422|sensitive|hillside|wetland/i.test(fn)) doc.tags.push("sensitive");
  if (/414|sign/i.test(fn)) doc.tags.push("signs");
  if (/20[0-9]|procedure|article.?ii/i.test(fn)) doc.tags.push("procedures");
  if (/rdcs|road.?design|ordinance.?738/i.test(fn)) doc.tags.push("rdcs");
  if (/tsp|transportation.?system/i.test(fn)) doc.tags.push("tsp");
  if (/comp.?plan|comprehensive/i.test(fn)) doc.tags.push("comp-plan");
  if (doc.tags.length === 0) doc.tags.push("other");

  docs.push(doc);
  writeMeta(docs);
  res.json(doc);
});

// ─── Admin: list documents ──────────────────────────────────

app.get("/api/admin/documents", requireAdmin, (req, res) => {
  res.json(readMeta());
});

// ─── Admin: update tags ─────────────────────────────────────

app.patch("/api/admin/documents/:id/tags", requireAdmin, (req, res) => {
  const docs = readMeta();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  doc.tags = req.body.tags || [];
  writeMeta(docs);
  res.json(doc);
});

// ─── Admin: delete document ─────────────────────────────────

app.delete("/api/admin/documents/:id", requireAdmin, (req, res) => {
  let docs = readMeta();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });

  // Delete file
  const filePath = path.join(UPLOADS_DIR, doc.filename);
  try { fs.unlinkSync(filePath); } catch {}

  docs = docs.filter(d => d.id !== req.params.id);
  writeMeta(docs);
  res.json({ ok: true });
});

// ─── Public: list documents (metadata only, no content) ─────

app.get("/api/documents", (req, res) => {
  const docs = readMeta().map(d => ({
    id: d.id, name: d.name, tags: d.tags, uploaded: d.uploaded, size: d.size
  }));
  res.json(docs);
});

// ─── Public: generate outline ───────────────────────────────

app.post("/api/generate", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "API key not configured" });

  const { use, useLbl, district, road, roadLbl, relevantTags } = req.body;
  if (!use || !district || !road) return res.status(400).json({ error: "Missing fields" });

  const docs = readMeta();
  const tagSet = new Set(relevantTags || []);
  const matchingDocs = docs.filter(d => d.tags.some(t => tagSet.has(t)));

  if (matchingDocs.length === 0) {
    return res.json({
      text: "No source documents matched this scenario. An administrator needs to upload the applicable CDC, RDCS, or TSP sections.",
      usedDocs: []
    });
  }

  // Build message content with documents
  const content = [];

  for (const doc of matchingDocs) {
    const filePath = path.join(UPLOADS_DIR, doc.filename);
    if (!fs.existsSync(filePath)) continue;

    const fileData = fs.readFileSync(filePath).toString("base64");
    const isPdf = doc.type.includes("pdf");

    content.push({
      type: isPdf ? "document" : "image",
      source: { type: "base64", media_type: doc.type, data: fileData }
    });
    content.push({ type: "text", text: `[Document: ${doc.name} — uploaded ${new Date(doc.uploaded).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}]` });
  }

  content.push({
    type: "text",
    text: `Based on the Washington County CDC documents provided above, extract ALL applicable code language for this development scenario:

USE: ${useLbl}
LAND USE DISTRICT: ${district}
ROAD FRONTAGE: ${roadLbl}

For EACH of the following topics, reproduce the EXACT code text (verbatim, with section numbers) that applies. If a topic is not covered in the provided documents, say "Not found in provided documents — upload the applicable section."

1. DISTRICT STANDARDS — Permitted uses, conditional uses, dimensional standards (lot size, setbacks, height, coverage, density) for ${district}
2. USE-SPECIFIC STANDARDS — Any §430 special use standards for ${useLbl}
3. SETBACKS — §418 setback requirements applicable to ${district}
4. PARKING — §413 parking ratios, bicycle parking, design standards for ${useLbl}
5. LANDSCAPING — §407 street trees, parking lot landscaping, buffers
6. TRANSPORTATION — §501 access management, TIA thresholds, frontage improvements for ${roadLbl}
7. SIGNS — §414 sign standards for ${district}
8. ROAD STANDARDS — RDCS right-of-way, sidewalk, and improvement standards for ${roadLbl}

Use "═══════" dividers between each topic. Reproduce code language EXACTLY — do not summarize. Include all subsection numbers.`
  });

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        system: "You are a Washington County Oregon CDC code extraction tool. Your ONLY job is to find and reproduce EXACT, VERBATIM code text from the provided documents. Never summarize — always reproduce the actual code language with section numbers intact. If a requested section is not in the provided documents, clearly state that.",
        messages: [{ role: "user", content }]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(502).json({ error: `Anthropic API error (${apiRes.status}): ${errText}` });
    }

    const data = await apiRes.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n\n");

    res.json({
      text: text || "No response text returned.",
      usedDocs: matchingDocs.map(d => ({ name: d.name, uploaded: d.uploaded }))
    });
  } catch (err) {
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
});

// ─── Start ──────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Washington County CDC Tool running at http://localhost:${PORT}`);
  console.log(`  Admin panel: http://localhost:${PORT}/admin.html\n`);
});
