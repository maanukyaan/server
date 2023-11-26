const express = require("express");
const bodyParser = require("body-parser");

const axios = require("axios");

const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
require("dotenv").config();

const { Leap } = require("@leap-ai/workflows");

const leap = new Leap({
  apiKey: process.env.LEAP_API_KEY,
});

const translate = require("@iamtraction/google-translate");
const TelegramBot = require("node-telegram-bot-api");

const telegramToken = process.env.TG_API_TOKEN;

const bot = new TelegramBot(telegramToken, { polling: true });
const chatId = process.env.TG_CHAT_ID;
bot.sendMessage(chatId, "Сервер запущен, бот работает");

const app = express();
const port = 3000;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, PATCH, DELETE"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(bodyParser.json());

const imgFolderPath = path.join(__dirname, "img");
fsp
  .access(imgFolderPath)
  .then(() => {
    console.log("Folder 'img' exists.");
  })
  .catch(async () => {
    console.log("Folder 'img' does not exist. Creating...");
    await fsp.mkdir(imgFolderPath);
    console.log("Folder 'img' created successfully.");
  });

app.use("/img", express.static(path.join(__dirname, "img/")));

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

const delay = (delayInms) => {
  return new Promise((resolve) => setTimeout(resolve, delayInms));
};

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

app.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname, "dist/index.html"));
});

app.post("/sd", async (req, res) => {
  const data = req.body;
  try {
    const russianQuery = `Fashionable outfit for ${data.gender}, for ${data.season} season, who is ${data.age} years old, for ${data.event}, in ${data.style} style, цвет волос ${data.hairColor}, предпочитаемый цвет одежды ${data.favoriteColor}`;
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
  let imgLink = "";
  try {
    try {
      const response = await leap.workflowRuns.workflow({
        workflow_id: process.env.WORKFLOW_ID,
        input: {
          height: 1000,
          width: 1000,
          num_images_per_prompt: 1,
          num_inference_steps: 100,
          prompt: englishQuery,
        },
      });
      console.log(response.data);

      const workId = response.data.id;
      console.log("Work id: ", workId);

      let workResponse;
      workResponse = await leap.workflowRuns.getWorkflowRun({
        workflowRunId: workId,
      });

      while (
        !workResponse.data.output ||
        Object.keys(workResponse.data.output).length === 0
      ) {
        await delay(3000);
        workResponse = await leap.workflowRuns.getWorkflowRun({
          workflowRunId: workId,
        });
      }
      imgLink = workResponse.data.output.step1.data.images[0];
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .json({ error: "Internal Server Error", errorMessage: error });
    }

    console.log("Got response. Saving image...");
    let localImgPath = "";
    axios({
      method: "get",
      url: imgLink,
      responseType: "stream",
    })
      .then((response) => {
        return new Promise((resolve, reject) => {
          const localImgPath = `img/${generateId(10)}.png`;
          const imageStream = response.data.pipe(
            fs.createWriteStream(localImgPath)
          );

          imageStream.on("finish", () => {
            console.log("Image saved successfully!");
            resolve(localImgPath);
          });

          imageStream.on("error", (error) => {
            console.error("Error saving the image:", error);
            reject(error);
          });
        });
      })
      .then(async (localImgPath) => {
        try {
          await bot.sendPhoto(chatId, localImgPath, {
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
            await fsp.unlink(localImgPath);
            console.log("Image deleted successfully:", localImgPath);
          } catch (error) {
            console.error("Error deleting image:", error);
          }
        } catch (error) {
          console.error("Error sending image to Telegram:", error);
        }
      })
      .catch((error) => {
        console.error("Error fetching or saving the image:", error);
        res
          .status(500)
          .json({ error: "Internal Server Error", errorMessage: error });
        return;
      });

    res.status(200).json({ imgLink: imgLink });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "Internal Server Error", errorMessage: error });
    return;
  }
}
