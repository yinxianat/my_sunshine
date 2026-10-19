const express = require("express");
const { requireAuth } = require("../middleware/auth");
const Child = require("../models/Child");

const router = express.Router();

// All routes require auth
router.use(requireAuth);

// GET /children — list all children for this user
router.get("/", async (req, res) => {
  try {
    const children = await Child.find({ userId: req.userId }).sort({
      createdAt: 1,
    });
    res.json(children);
  } catch (err) {
    console.error("List children error:", err);
    res.status(500).json({ error: "Failed to list children" });
  }
});

// POST /children — add a child
router.post("/", async (req, res) => {
  try {
    const { name, birthDate } = req.body;
    if (!name || !birthDate) {
      return res.status(400).json({ error: "Name and birthDate required" });
    }

    const child = await Child.create({
      userId: req.userId,
      name,
      birthDate: new Date(birthDate),
    });

    res.status(201).json(child);
  } catch (err) {
    console.error("Create child error:", err);
    res.status(500).json({ error: "Failed to create child" });
  }
});

// PUT /children/:id — update a child's name or birth date
router.put("/:id", async (req, res) => {
  try {
    const child = await Child.findOne({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!child) return res.status(404).json({ error: "Child not found" });

    if (req.body.name) child.name = req.body.name;
    if (req.body.birthDate) child.birthDate = new Date(req.body.birthDate);
    await child.save();

    res.json(child);
  } catch (err) {
    console.error("Update child error:", err);
    res.status(500).json({ error: "Failed to update child" });
  }
});

module.exports = router;
