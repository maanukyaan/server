const express = require("express");
const bodyParser = require("body-parser");

const axios = require("axios");

const path = require("path");
const fs = require("fs").promises;
require("dotenv").config();

const translate = require("@iamtraction/google-translate");
const TelegramBot = require("node-telegram-bot-api");

const telegramToken = process.env.TG_API_TOKEN; // Замените на свой токен

const bot = new TelegramBot(telegramToken, { polling: true });
const chatId = process.env.TG_CHAT_ID;
bot.sendMessage(chatId, "Сервер запущен, бот работает");

const app = express();
const port = 3000;

app.use(bodyParser.json());

// app.use((req, res, next) => {
//   res.header("Access-Control-Allow-Origin", "http://127.0.0.1:5500");
//   res.header(
//     "Access-Control-Allow-Methods",
//     "GET, POST, OPTIONS, PUT, PATCH, DELETE"
//   ); // Разрешенные методы
//   res.header("Access-Control-Allow-Headers", "Content-Type, Authorization"); // Разрешенные заголовки
//   res.header("Access-Control-Allow-Credentials", true); // Разрешение передачи учетных данных (например, куки)

//   if (req.method === "OPTIONS") {
//     // Обработка предварительного запроса (preflight)
//     res.sendStatus(200);
//   } else {
//     next();
//   }
// });

const imgFolderPath = path.join(__dirname, "img");
fs.access(imgFolderPath)
  .then(() => {
    console.log("Folder 'img' exists.");
  })
  .catch(async () => {
    console.log("Folder 'img' does not exist. Creating...");
    await fs.mkdir(imgFolderPath);
    console.log("Folder 'img' created successfully.");
  });

app.use("/img", express.static(path.join(__dirname, "img/")));
app.use("/assets", express.static(path.join(__dirname, "dist/assets")));

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

function generateId(length) {
  let result = "";
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
}

async function saveBase64ImageToFile(base64String, filePath) {
  try {
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    await fs.writeFile(filePath, buffer);
    console.log("Image saved successfully:", filePath);
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

const wizModelAPIKey = process.env.WIZMODEL_API_KEY;
const wizModelUrl = "https://api.wizmodel.com/sdapi/v1/txt2img";

app.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname, "dist/index.html"));
});

app.post("/sd", async (req, res) => {
  const data = req.body;
  try {
    const russianQuery = `Fashionable outfit for ${data.gender}, кому ${data.age} лет, для ${data.event}, в стиле ${data.style}, цвет волос ${data.hairColor}, сезон ${data.season}, предпочитаемый цвет одежды ${data.favoriteColor}`;
    const translationResult = await translate(russianQuery, {
      from: "ru",
      to: "en",
    });
    const englishQuery = translationResult.text;
    console.log("Translated text: ", englishQuery);
    sd(englishQuery, res, russianQuery, data);
  } catch (err) {
    console.error("Error while translating: ", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

async function sd(englishQuery, res, russianQuery, data) {
  try {
    const payload = {
      prompt: englishQuery,
      steps: 100,
    };

    const response = await axios.post(wizModelUrl, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + wizModelAPIKey,
      },
    });

    console.log("Got response. Saving image...");
    const base64String = response.data.images[0];

    const filePath = `img/${generateId(20)}.png`;
    await saveBase64ImageToFile(base64String, filePath);

    try {
      // Отправка изображения
      await bot.sendPhoto(chatId, filePath, {
        caption: `<b>НОВАЯ ЗАЯВКА</b>\n<b>Текст запроса:</b> ${russianQuery}\n<b>Переведённый текст запроса:</b> ${englishQuery}\n<b>Сгенерирована в:</b> ${new Date().toLocaleString()}\nПол: ${
          data.gender
        }\nСтиль: ${data.style}\nМероприятие: ${data.event}\nЦвет волос: ${
          data.hairColor
        }\nСезон: ${data.season}\nЦвет: ${data.favoriteColor}\nВозраст: ${
          data.age
        }\nПочта: ${data.email}`,
        parse_mode: "HTML",
      });

      console.log("Data sent to Telegram successfully.");
      try {
        await fs.unlink(filePath);
        console.log("Image deleted successfully:", filePath);
      } catch (error) {
        console.error("Error deleting image:", error);
      }
    } catch (error) {
      console.error("Error sending image to Telegram:", error);
    }

    res.status(200).json({ link: filePath, base64: base64String });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
