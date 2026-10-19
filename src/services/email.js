const nodemailer = require("nodemailer");

// Gmail SMTP with App Password
// To set up:
// 1. Enable 2-Step Verification on your Google account
// 2. Go to Google Account > Security > App Passwords
// 3. Generate a new App Password for "Mail"
// 4. Copy the 16-character password into GMAIL_APP_PASSWORD
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const FROM_ADDRESS = process.env.GMAIL_USER;
const APP_URL = process.env.APP_URL || "https://mysunshine.app";

/**
 * Send a magic sign-in link.
 * @param {string} email - Recipient email
 * @param {string} token - Magic link token
 */
async function sendMagicLinkEmail(email, token) {
  const link = `${APP_URL}/auth/magic-link/verify?token=${token}`;

  const info = await transporter.sendMail({
    from: `"mySunshine" <${FROM_ADDRESS}>`,
    to: email,
    subject: "Your sign-in link for mySunshine",
    text: [
      "Hi there!",
      "",
      "Tap this link to sign in to mySunshine:",
      link,
      "",
      "This link expires in 15 minutes and can only be used once.",
      "",
      "If you didn't request this, just ignore this email.",
      "",
      "— mySunshine",
    ].join("\n"),
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #FF9500;">☀️ mySunshine</h2>
        <p>Hi there!</p>
        <p>Tap the button below to sign in:</p>
        <a href="${link}"
           style="display: inline-block; background: #FF9500; color: white;
                  padding: 14px 32px; border-radius: 8px; text-decoration: none;
                  font-weight: 600; font-size: 16px;">
          Sign in to mySunshine
        </a>
        <p style="color: #888; font-size: 13px; margin-top: 20px;">
          This link expires in 15 minutes and can only be used once.<br>
          If you didn't request this, just ignore this email.
        </p>
      </div>
    `,
  });

  console.log("Magic link email sent:", info.messageId);
  return info;
}

/**
 * Send a password reset link.
 * @param {string} email - Recipient email
 * @param {string} token - Reset token
 */
async function sendPasswordResetEmail(email, token) {
  const link = `${APP_URL}/auth/reset-password?token=${token}`;

  const info = await transporter.sendMail({
    from: `"mySunshine" <${FROM_ADDRESS}>`,
    to: email,
    subject: "Reset your mySunshine password",
    text: [
      "Hi there!",
      "",
      "Someone requested a password reset for your mySunshine account.",
      "Tap this link to set a new password:",
      link,
      "",
      "This link expires in 30 minutes and can only be used once.",
      "",
      "If you didn't request this, just ignore this email.",
      "",
      "— mySunshine",
    ].join("\n"),
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #FF9500;">☀️ mySunshine</h2>
        <p>Hi there!</p>
        <p>Someone requested a password reset for your account.</p>
        <a href="${link}"
           style="display: inline-block; background: #FF9500; color: white;
                  padding: 14px 32px; border-radius: 8px; text-decoration: none;
                  font-weight: 600; font-size: 16px;">
          Reset Password
        </a>
        <p style="color: #888; font-size: 13px; margin-top: 20px;">
          This link expires in 30 minutes and can only be used once.<br>
          If you didn't request this, just ignore this email.
        </p>
      </div>
    `,
  });

  console.log("Password reset email sent:", info.messageId);
  return info;
}

module.exports = { sendMagicLinkEmail, sendPasswordResetEmail };
