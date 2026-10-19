const mongoose = require("mongoose");

const childSchema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, index: true },
    name: { type: String, required: true },
    birthDate: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Child", childSchema);
