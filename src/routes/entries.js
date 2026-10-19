const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../middleware/auth");
const { pool } = require("../services/postgres");
const { uploadFile, getPresignedUrl, deleteFile } = require("../services/s3");
const Entry = require("../models/Entry");
const Child = require("../models/Child");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB max

router.use(requireAuth);

// Helper: check tier allows media type
async function getUserTier(userId) {
  const result = await pool.query(
    "SELECT tier FROM subscriptions WHERE user_id = $1",
    [userId]
  );
  return result.rows[0]?.tier || "free";
}

// Helper: compute age label
function ageLabel(birthDate, entryDate) {
  const birth = new Date(birthDate);
  const entry = new Date(entryDate);
  let years = entry.getFullYear() - birth.getFullYear();
  let months = entry.getMonth() - birth.getMonth();
  if (months < 0) { years--; months += 12; }
  if (years === 0) return `${months} month${months === 1 ? "" : "s"}`;
  if (months === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years}y ${months}m`;
}

// GET /entries?childId=xxx&page=1&limit=20
router.get("/", async (req, res) => {
  try {
    const { childId, page = 1, limit = 20 } = req.query;
    if (!childId) return res.status(400).json({ error: "childId required" });

    // Verify ownership
    const child = await Child.findOne({ _id: childId, userId: req.userId });
    if (!child) return res.status(404).json({ error: "Child not found" });

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const entries = await Entry.find({ childId, userId: req.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Attach presigned URLs for media
    const enriched = await Promise.all(
      entries.map(async (e) => {
        const obj = e.toObject();
        if (obj.photoKey) obj.photoUrl = await getPresignedUrl(obj.photoKey);
        if (obj.videoKey) obj.videoUrl = await getPresignedUrl(obj.videoKey);
        return obj;
      })
    );

    const total = await Entry.countDocuments({ childId, userId: req.userId });

    res.json({ entries: enriched, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("List entries error:", err);
    res.status(500).json({ error: "Failed to list entries" });
  }
});

// GET /entries/:id
router.get("/:id", async (req, res) => {
  try {
    const entry = await Entry.findOne({ _id: req.params.id, userId: req.userId });
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    const obj = entry.toObject();
    if (obj.photoKey) obj.photoUrl = await getPresignedUrl(obj.photoKey);
    if (obj.videoKey) obj.videoUrl = await getPresignedUrl(obj.videoKey);
    res.json(obj);
  } catch (err) {
    console.error("Get entry error:", err);
    res.status(500).json({ error: "Failed to get entry" });
  }
});

// POST /entries
router.post("/", async (req, res) => {
  try {
    const { childId, text, noteForChild, mood } = req.body;
    if (!childId || !text) {
      return res.status(400).json({ error: "childId and text required" });
    }

    const child = await Child.findOne({ _id: childId, userId: req.userId });
    if (!child) return res.status(404).json({ error: "Child not found" });

    const entry = await Entry.create({
      userId: req.userId,
      childId,
      text,
      childAgeLabel: ageLabel(child.birthDate, new Date()),
      noteForChild: noteForChild || null,
      mood: mood || null,
    });

    res.status(201).json(entry);
  } catch (err) {
    console.error("Create entry error:", err);
    res.status(500).json({ error: "Failed to create entry" });
  }
});

// POST /entries/:id/upload — attach photo or video
router.post("/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const entry = await Entry.findOne({ _id: req.params.id, userId: req.userId });
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    if (!req.file) return res.status(400).json({ error: "No file provided" });

    const tier = await getUserTier(req.userId);
    const isVideo = req.file.mimetype.startsWith("video/");
    const isPhoto = req.file.mimetype.startsWith("image/");

    if (isPhoto && tier === "free") {
      return res.status(403).json({ error: "Photo attachments require the Photo tier or higher" });
    }
    if (isVideo && tier !== "video") {
      return res.status(403).json({ error: "Video attachments require the Video tier" });
    }

    const key = await uploadFile(req.file.buffer, req.file.originalname, req.userId);

    if (isPhoto) {
      // Delete old photo if replacing
      if (entry.photoKey) await deleteFile(entry.photoKey);
      entry.photoKey = key;
    } else if (isVideo) {
      if (entry.videoKey) await deleteFile(entry.videoKey);
      entry.videoKey = key;
    }

    await entry.save();

    const url = await getPresignedUrl(key);
    res.json({ key, url });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// PUT /entries/:id — edit text, note, mood
router.put("/:id", async (req, res) => {
  try {
    const entry = await Entry.findOne({ _id: req.params.id, userId: req.userId });
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    if (req.body.text !== undefined) entry.text = req.body.text;
    if (req.body.noteForChild !== undefined) entry.noteForChild = req.body.noteForChild;
    if (req.body.mood !== undefined) entry.mood = req.body.mood;
    await entry.save();

    res.json(entry);
  } catch (err) {
    console.error("Update entry error:", err);
    res.status(500).json({ error: "Failed to update entry" });
  }
});

// DELETE /entries/:id
router.delete("/:id", async (req, res) => {
  try {
    const entry = await Entry.findOne({ _id: req.params.id, userId: req.userId });
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    // Clean up S3 files
    if (entry.photoKey) await deleteFile(entry.photoKey);
    if (entry.videoKey) await deleteFile(entry.videoKey);

    await entry.deleteOne();
    res.json({ deleted: true });
  } catch (err) {
    console.error("Delete entry error:", err);
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

module.exports = router;
