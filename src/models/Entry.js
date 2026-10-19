const mongoose = require("mongoose");

const entrySchema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, index: true },
    childId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Child",
      required: true,
      index: true,
    },
    text: { type: String, required: true },
    childAgeLabel: { type: String },
    noteForChild: { type: String, default: null },
    mood: { type: String, default: null },

    // Media references (S3 keys)
    photoKey: { type: String, default: null },
    videoKey: { type: String, default: null },

    // For future AI integration:
    // Store text embeddings for semantic search
    // embedding: { type: [Number], default: null },
    // aiTags: [{ type: String }],
  },
  { timestamps: true }
);

// Index for listing entries by child, newest first
entrySchema.index({ childId: 1, createdAt: -1 });

// Future: vector search index for AI
// entrySchema.index({ embedding: "vectorSearch" });

module.exports = mongoose.model("Entry", entrySchema);
