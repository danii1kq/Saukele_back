require("dotenv").config();
const { transporter } = require("../src/lib/email");
const config = require("../src/config/config");

async function verifySmtp() {
  console.log("=== Проверка подключения к SMTP серверу ===");
  console.log(`Хост: ${config.smtpHost}:${config.smtpPort}`);
  console.log(`Пользователь: ${config.smtpUser || "не указан"}`);
  console.log(`Отправитель (From): ${config.emailFrom}`);
  console.log("-------------------------------------------\n");

  try {
    console.log("⏳ Пытаемся подключиться...");
    // Метод verify() проверяет конфигурацию соединения и аутентификацию
    await transporter.verify();
    console.log("✅ Подключение успешно! SMTP сервер готов к отправке писем.");

    const testEmailTo = process.env.TEST_EMAIL_TO;
    if (testEmailTo) {
      console.log(`\n⏳ Отправляем тестовое письмо на ${testEmailTo}...`);
      const info = await transporter.sendMail({
        from: config.emailFrom,
        to: testEmailTo,
        subject: "Успешная настройка SMTP Saukele",
        text: "Если вы получили это письмо, значит ваши настройки SMTP верны и приложение может рассылать email.",
      });
      console.log(`✅ Тестовое письмо успешно отправлено! ID: ${info.messageId}`);
    } else {
      console.log("\nℹ️ Если хотите протестировать реальную отправку письма, добавьте TEST_EMAIL_TO=ваш_email в файл .env и запустите скрипт заново.");
    }
  } catch (error) {
    console.error("\n❌ Ошибка проверки SMTP:");
    console.error(error.message);
    if (error.response) {
      console.error(`Ответ сервера: ${error.response}`);
    }
  } finally {
    process.exit(0);
  }
}

verifySmtp();
