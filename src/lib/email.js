const nodemailer = require("nodemailer");
const config = require("../config/config");

// Настройка транспорта для отправки писем
const transporter = nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: false,
  auth: {
    user: config.smtpUser,
    pass: config.smtpPass,
  },
});

/**
 * Отправляет email напрямую или логирует, если настройки не указаны.
 * Упрощенная версия без фоновой очереди.
 */
async function sendEmailAsync({ to, subject, text, html }) {
  if (process.env.NODE_ENV === 'test' || !config.smtpUser || !config.smtpPass) {
    console.log(`[MOCK EMAIL] To: ${to}, Subject: ${subject}, Body: ${text || html}`);
    return { mock: true, message: "Email logging only (no SMTP config)" };
  }
  try {
    const info = await transporter.sendMail({
      from: config.emailFrom,
      to,
      subject,
      text,
      html,
    });
    console.log(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error("Email sending failed:", error.message);
    // Не падаем, чтобы не ломать API
    return { error: error.message };
  }
}

/**
 * Заглушка для совместимости: фоновая обработка очереди не используется.
 */
function processEmailQueue() {
  console.log("Email queue processing is disabled.");
}

module.exports = { transporter, sendEmailAsync, processEmailQueue };
