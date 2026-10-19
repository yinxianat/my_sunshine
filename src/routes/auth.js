const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../services/postgres");
const { signToken } = require("../services/jwt");
const { requireAuth } = require("../middleware/auth");
const { sendMagicLinkEmail, sendPasswordResetEmail } = require("../services/email");

const router = express.Router();

// ─── POST /auth/register ────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
      [email.toLowerCase(), hash, displayName || null]
    );
    const user = result.rows[0];

    await pool.query(
      "INSERT INTO subscriptions (user_id, tier) VALUES ($1, 'free')",
      [user.id]
    );

    const token = signToken({ userId: user.id, email: user.email });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// ─── POST /auth/login ───────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const result = await pool.query(
      "SELECT id, email, password_hash, display_name FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "No account found with this email. Would you like to sign up?" });
    }

    const user = result.rows[0];

    // User might have signed up with Apple (no password)
    if (!user.password_hash) {
      return res.status(401).json({
        error: "This account uses Sign in with Apple. Please use that to log in.",
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Incorrect password. Forgot it? Use the reset link below." });
    }

    const token = signToken({ userId: user.id, email: user.email });

    const sub = await pool.query(
      "SELECT tier FROM subscriptions WHERE user_id = $1",
      [user.id]
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tier: sub.rows[0]?.tier || "free",
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// ─── POST /auth/check-email ────────────────────────────────────────
// Returns whether an email is already registered (for login vs register UI)
router.post("/check-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const result = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    console.error("Check email error:", err);
    res.status(500).json({ error: "Could not check email." });
  }
});

// ─── POST /auth/magic-link ─────────────────────────────────────────
// Sends a magic sign-in link. Creates the account if it doesn't exist.
router.post("/magic-link", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const normalizedEmail = email.toLowerCase();

    // Rate limit: max 5 magic links per email per hour
    const recentCount = await pool.query(
      `SELECT COUNT(*) FROM magic_link_tokens
       WHERE email = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [normalizedEmail]
    );
    if (parseInt(recentCount.rows[0].count) >= 5) {
      return res.status(429).json({
        error: "Too many sign-in links requested. Please try again in an hour.",
      });
    }

    // Generate a secure token (48 bytes = 64 chars in base64url)
    const token = crypto.randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await pool.query(
      `INSERT INTO magic_link_tokens (email, token, expires_at)
       VALUES ($1, $2, $3)`,
      [normalizedEmail, token, expiresAt]
    );

    // Send the email
    await sendMagicLinkEmail(normalizedEmail, token);

    res.json({ message: "Sign-in link sent! Check your email." });
  } catch (err) {
    console.error("Magic link error:", err);
    res.status(500).json({ error: "Could not send sign-in link. Please try again." });
  }
});

// ─── POST /auth/magic-link/verify ──────────────────────────────────
// Verifies a magic link token and logs the user in (or creates account).
router.post("/magic-link/verify", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token is required." });

    // Find the token
    const result = await pool.query(
      `SELECT id, email, expires_at, used FROM magic_link_tokens
       WHERE token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid sign-in link." });
    }

    const record = result.rows[0];

    if (record.used) {
      return res.status(400).json({ error: "This sign-in link has already been used." });
    }
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: "This sign-in link has expired. Please request a new one." });
    }

    // Mark token as used
    await pool.query(
      "UPDATE magic_link_tokens SET used = TRUE WHERE id = $1",
      [record.id]
    );

    // Find or create user
    let userResult = await pool.query(
      "SELECT id, email, display_name FROM users WHERE email = $1",
      [record.email]
    );

    let user;
    if (userResult.rows.length === 0) {
      // Create new user (no password — they're using magic link)
      const newUser = await pool.query(
        `INSERT INTO users (email) VALUES ($1)
         RETURNING id, email, display_name`,
        [record.email]
      );
      user = newUser.rows[0];

      // Create free subscription
      await pool.query(
        "INSERT INTO subscriptions (user_id, tier) VALUES ($1, 'free')",
        [user.id]
      );
    } else {
      user = userResult.rows[0];
    }

    const authToken = signToken({ userId: user.id, email: user.email });

    const sub = await pool.query(
      "SELECT tier FROM subscriptions WHERE user_id = $1",
      [user.id]
    );

    res.json({
      token: authToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tier: sub.rows[0]?.tier || "free",
      },
    });
  } catch (err) {
    console.error("Magic link verify error:", err);
    res.status(500).json({ error: "Could not verify sign-in link." });
  }
});

// ─── POST /auth/apple ──────────────────────────────────────────────
// Sign in (or register) with Apple's identity token.
router.post("/apple", async (req, res) => {
  try {
    const { identityToken, displayName } = req.body;
    if (!identityToken) {
      return res.status(400).json({ error: "Apple identity token is required." });
    }

    // Decode the Apple identity token (JWT) to get email and sub
    // In production, verify the token signature against Apple's public keys
    const decoded = jwt.decode(identityToken);
    if (!decoded || !decoded.sub) {
      return res.status(400).json({ error: "Invalid Apple identity token." });
    }

    const appleSub = decoded.sub;
    const appleEmail = decoded.email || null;

    // Look up user by Apple sub first
    let userResult = await pool.query(
      "SELECT id, email, display_name FROM users WHERE apple_sub = $1",
      [appleSub]
    );

    let user;
    if (userResult.rows.length > 0) {
      // Existing Apple user — log them in
      user = userResult.rows[0];
    } else if (appleEmail) {
      // Check if email already exists (user might have registered with email first)
      userResult = await pool.query(
        "SELECT id, email, display_name FROM users WHERE email = $1",
        [appleEmail.toLowerCase()]
      );

      if (userResult.rows.length > 0) {
        // Link Apple sub to existing account
        user = userResult.rows[0];
        await pool.query(
          "UPDATE users SET apple_sub = $1 WHERE id = $2",
          [appleSub, user.id]
        );
      } else {
        // New user — create account
        const newUser = await pool.query(
          `INSERT INTO users (email, apple_sub, display_name)
           VALUES ($1, $2, $3)
           RETURNING id, email, display_name`,
          [appleEmail.toLowerCase(), appleSub, displayName || null]
        );
        user = newUser.rows[0];

        await pool.query(
          "INSERT INTO subscriptions (user_id, tier) VALUES ($1, 'free')",
          [user.id]
        );
      }
    } else {
      return res.status(400).json({
        error: "Email is required. Please allow email access when signing in with Apple.",
      });
    }

    const token = signToken({ userId: user.id, email: user.email });

    const sub = await pool.query(
      "SELECT tier FROM subscriptions WHERE user_id = $1",
      [user.id]
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tier: sub.rows[0]?.tier || "free",
      },
    });
  } catch (err) {
    console.error("Apple auth error:", err);
    res.status(500).json({ error: "Apple sign-in failed. Please try again." });
  }
});

// ─── POST /auth/forgot-password ────────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const normalizedEmail = email.toLowerCase();

    // Rate limit: max 3 reset requests per email per hour
    const recentCount = await pool.query(
      `SELECT COUNT(*) FROM password_reset_tokens
       WHERE user_id IN (SELECT id FROM users WHERE email = $1)
       AND created_at > NOW() - INTERVAL '1 hour'`,
      [normalizedEmail]
    );
    if (parseInt(recentCount.rows[0].count) >= 3) {
      return res.status(429).json({
        error: "Too many reset requests. Please try again in an hour.",
      });
    }

    // Find the user
    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    // Always return success (don't reveal if email exists for security)
    if (userResult.rows.length === 0) {
      return res.json({ message: "If that email is registered, we sent a reset link." });
    }

    const userId = userResult.rows[0].id;

    // Generate token
    const token = crypto.randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, token, expiresAt]
    );

    await sendPasswordResetEmail(normalizedEmail, token);

    res.json({ message: "If that email is registered, we sent a reset link." });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Could not process request. Please try again." });
  }
});

// ─── POST /auth/reset-password ─────────────────────────────────────
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    // Find the token
    const result = await pool.query(
      `SELECT id, user_id, expires_at, used FROM password_reset_tokens
       WHERE token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid reset link." });
    }

    const record = result.rows[0];

    if (record.used) {
      return res.status(400).json({ error: "This reset link has already been used." });
    }
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: "This reset link has expired. Please request a new one." });
    }

    // Mark token as used
    await pool.query(
      "UPDATE password_reset_tokens SET used = TRUE WHERE id = $1",
      [record.id]
    );

    // Update password
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
      [hash, record.user_id]
    );

    // Log the user in right away
    const userResult = await pool.query(
      "SELECT id, email, display_name FROM users WHERE id = $1",
      [record.user_id]
    );
    const user = userResult.rows[0];
    const authToken = signToken({ userId: user.id, email: user.email });

    const sub = await pool.query(
      "SELECT tier FROM subscriptions WHERE user_id = $1",
      [user.id]
    );

    res.json({
      token: authToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tier: sub.rows[0]?.tier || "free",
      },
    });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Could not reset password. Please try again." });
  }
});

// ─── GET /auth/me ───────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.created_at, s.tier
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      tier: row.tier || "free",
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Failed to get profile." });
  }
});

module.exports = router;
