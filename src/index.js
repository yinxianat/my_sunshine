require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { connectPostgres, initTables } = require("./services/postgres");
const { connectMongo } = require("./services/mongo");
const authRoutes = require("./routes/auth");
const childrenRoutes = require("./routes/children");
const entriesRoutes = require("./routes/entries");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Health check (App Runner pings this)
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "mysunshine-backend" });
});

// Serve apple-app-site-association for Universal Links
app.get("/.well-known/apple-app-site-association", (req, res) => {
  res.set("Content-Type", "application/json");
  res.sendFile(
    path.join(__dirname, "../public/.well-known/apple-app-site-association")
  );
});

// GET routes for Universal Link interception (iOS) with web fallback
app.get("/auth/magic-link/verify", (req, res) => {
  const token = req.query.token;
  const webApp = process.env.WEB_APP_URL || process.env.APP_URL || "https://mysunshine.app";
  res.redirect(webApp + "/verify-magic-link?token=" + encodeURIComponent(token));
});

app.get("/auth/reset-password", (req, res) => {
  const token = req.query.token;
  const webApp = process.env.WEB_APP_URL || process.env.APP_URL || "https://mysunshine.app";
  res.redirect(webApp + "/reset-password?token=" + encodeURIComponent(token));
});

// Routes
app.use("/auth", authRoutes);
app.use("/children", childrenRoutes);
app.use("/entries", entriesRoutes);

// Start
async function start() {
  try {
    await connectPostgres();
    await initTables();
    await connectMongo();
    app.listen(PORT, () => {
      console.log(`mySunshine API running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start:", err);
    process.exit(1);
  }
}

start();
