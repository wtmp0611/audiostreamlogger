const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

router.get('/settings', (req, res) => {
    const filePath = path.join(__dirname, '../settings.json');

    fs.readFile(filePath, 'utf-8', (err, fileContent) => {
        if (err) {
            console.error('Error reading settings.json:', err);
            return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
        }

        try {
            const settingsData = JSON.parse(fileContent);
            res.json(settingsData.streams);
        } catch (jsonError) {
            console.error('Error parsing JSON:', jsonError);
            res.status(500).json({ error: `Internal Server Error: ${jsonError.message}` });
        }
    });
});

// TOEGEVOEGD (William, 6 sept 2026): deze /settings2 bestond al, maar werkte
// nog nooit -- hij deed "settingsData.map(...)" op het HELE settings.json-
// bestand, terwijl de lijst met zenders altijd al in settingsData.streams
// heeft gezeten (zie /settings hierboven, die dat wel goed doet). Vandaar de
// foutmelding "settingsData.map is not a function" (settingsData is namelijk
// een object met streams/recorder/cleaner/etc erin, geen kale lijst).
// Verder is dit verder hetzelfde gebleven als het al was: per zender de
// audio-map uitlezen en teruggeven welke jaar/maand/dag/uur-combinaties er
// echt aan opnames bestaan. Dat gebruiken we zo als basis voor de
// datum/tijd-kiezer, die daarmee alleen echt bestaande uren kan aanbieden.
router.get('/settings2', async (req, res) => {
    const filePath = path.join(__dirname, '../settings.json');

    try {
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        const settingsData = JSON.parse(fileContent);

        const promises = settingsData.streams.map(async (station) => {
            const folder = station['folder'];
            const audioFolderPath = path.join(__dirname, '../audio');
            const folderPath = path.join(audioFolderPath, folder);

            const logs = await folderContent(folderPath);
            station['logs'] = logs;
        });

        await Promise.all(promises);
        let transformedJson = {};
        settingsData.streams.forEach((item) => {
            const key = item.name;
            transformedJson[key] = { ...item };
            delete transformedJson[key].name;
        });
        function transformData(originalData) {
            const transformedData = {};

            for (const station in originalData) {
                const stationData = originalData[station].logs;
                transformedData[station] = {};

                for (const year in stationData) {
                    transformedData[station][year] = {};

                    for (const month in stationData[year]) {
                        transformedData[station][year][month] = {};
                        const days = Object.keys(stationData[year][month]);

                        for (const day of days) {
                            transformedData[station][year][month][day] = stationData[year][month][day];
                        }
                    }
                }
            }
            return transformedData;
        }
        transformedJson = transformData(transformedJson);
        const transformedData = {};

        for (const key in transformedJson) {
            const newKey = key.replace(/_/g, ' ');
            transformedData[newKey] = transformedJson[key];
        }
        res.json(transformedData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: `Internal Server Error: ${error.message}` });
    }
});

async function folderContent(folderPath) {
    try {
      const files = await fs.promises.readdir(folderPath);

      const dateMap = new Map();

      files.forEach((file) => {
        const match = file.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})\.mp3$/);
        if (match) {
          const [year, month, day, hour] = match.slice(1);

          if (!dateMap.has(year)) {
            dateMap.set(year, new Map());
          }

          const yearMap = dateMap.get(year);

          if (!yearMap.has(month)) {
            yearMap.set(month, new Map());
          }

          const monthMap = yearMap.get(month);

          if (!monthMap.has(day)) {
            monthMap.set(day, new Set());
          }

          const daySet = monthMap.get(day);
          daySet.add(hour);
        }
      });

      const result = {};

      for (const [year, yearMap] of dateMap) {
        result[year] = {};

        for (const [month, monthMap] of yearMap) {
          result[year][month] = {};

          for (const [day, daySet] of monthMap) {
            result[year][month][day] = Array.from(daySet);
          }
        }
      }

      return result;
    } catch (err) {
      // TOEGEVOEGD (William, 6 sept 2026): een enkele zender zonder eigen
      // audio-map (bijvoorbeeld net toegevoegd, nog geen eerste opname
      // gehad) mag niet de hele datum/tijd-kiezer voor ALLE zenders laten
      // mislukken. Vandaar: gewoon "geen opnames" teruggeven voor die ene
      // zender, in plaats van de hele /settings2-aanvraag te laten klappen.
      console.error(`Error reading folder ${folderPath}: ${err}`);
      return {};
    }
  }

  module.exports = router;
