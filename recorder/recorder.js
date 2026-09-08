const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const cron = require('node-cron');
// Getting the retention time of logs from the settings.json
const settingsPath = '/usr/src/app/settings.json';
let settings;
// If the settings.json cannot be read, throw and error
try {
    const settingsData = fs.readFileSync(settingsPath, 'utf8');
    settings = JSON.parse(settingsData);
} catch (err) {
    console.error('Error reading settings.json:', err);
    process.exit(1);
}
const recorder_minute = settings.recorder.recorder_minute;
// If the peakfile_minute variable is not between 0 and 59 and an integer, it throws an error.
try {
    if (!Number.isInteger(recorder_minute) || recorder_minute < 0 || recorder_minute > 59) {
      throw new Error("ERROR! The recorder_minute variable in settings.json must be an integer between 0 and 59.");
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

// TOEGEVOEGD (William, 6 sept 2026): opnameduur nu instelbaar via
// settings.json ("duration_minutes" onder "recorder") in plaats van
// vast in de code te staan -- past bij het uitgangspunt dat alles
// instelbaar is via settings.json, zonder de code aan te hoeven raken.
// Origineel (Dennis) was 60 minuten; William gebruikt zelf 61 minuten,
// zodat opeenvolgende opnames elkaar 1 minuut overlappen en er nooit een
// gaatje tussen twee uren valt (zie readme.txt voor de uitleg/afweging).
// Dit veld is OPTIONEEL: ontbreekt het, of staat er iets ongeldigs in,
// dan wordt gewoon de vertrouwde 61 minuten aangehouden (dus je hoeft
// settings.json niet aan te passen om dit te blijven gebruiken).
const STANDAARD_OPNAMEDUUR_MINUTEN = 61;
let opnameduurMinuten = settings.recorder.duration_minutes;
if (!Number.isInteger(opnameduurMinuten) || opnameduurMinuten < 1 || opnameduurMinuten > 120) {
    if (opnameduurMinuten !== undefined) {
        console.error(`WAARSCHUWING: "duration_minutes" in settings.json moet een geheel getal tussen 1 en 120 zijn (nu: ${JSON.stringify(opnameduurMinuten)}) -- val terug op ${STANDAARD_OPNAMEDUUR_MINUTEN} minuten.`);
    }
    opnameduurMinuten = STANDAARD_OPNAMEDUUR_MINUTEN;
}
console.log(`Recorder gebruikt een opnameduur van ${opnameduurMinuten} minuten per opname.`);

// ============================================================================
// TOEGEVOEGD (William, 5 sept 2026): geen blinde transcoding meer.
//
// Vroeger werd IEDERE zender, ongeacht het bronformaat, geforceerd omgezet
// naar MP3 op 44.1kHz/160kbps. Dat is zonde: als een zender al MP3 (of FLAC)
// aanlevert, hoeft daar niets aan veranderd te worden - dat kost alleen maar
// kwaliteit en rekenkracht voor niets.
//
// Nieuwe aanpak (dezelfde als in William's eigen StreamLogger-project):
//   1. Vlak vóór elke opname wordt met ffprobe even "gepeild" wat de zender
//      op dat moment werkelijk aanlevert (formaat + bitrate) - dat is
//      betrouwbaarder dan het te raden of vast in te stellen, want een
//      zender kan zijn bronformaat ooit wijzigen.
//   2. Is de bron al MP3 of FLAC (allebei prima af te spelen, FLAC is zelfs
//      lossless) -> ongewijzigd opslaan, geen transcoding ("stream copy").
//   3. Is de bron AAC, Opus, Vorbis of WMA -> wel omzetten naar MP3, maar
//      met een bitrate die past bij de tabel hieronder (ronde MP3-standaard-
//      stappen: 48/64/80/96/128/160/192/224/256/320 kbps), in plaats van
//      altijd blind 160kbps.
//   4. Lukt het peilen een keer niet (bijvoorbeeld een korte hapering in de
//      stream op dat moment) -> veilige val-terug-waarde van 160kbps MP3,
//      zodat er nooit een opname compleet mislukt puur hierdoor.
// ============================================================================

// De omzettabel: per bronformaat, een reeks (drempelwaarde in kbps, doel-
// bitrate in kbps). We lopen de lijst af en pakken de eerste drempel die de
// bron-bitrate niet overschrijdt.
const BITRATE_TABLES = {
    aac:    [[24, 48], [32, 64], [48, 80], [64, 96], [96, 128], [128, 160], [160, 192], [192, 224], [256, 256], [Infinity, 320]],
    opus:   [[16, 48], [24, 64], [32, 80], [48, 96], [64, 128], [96, 160], [128, 192], [160, 224], [224, 256], [Infinity, 320]],
    vorbis: [[32, 48], [48, 64], [64, 80], [80, 96], [104, 128], [128, 160], [160, 192], [192, 224], [256, 256], [Infinity, 320]],
    wma:    [[48, 48], [64, 64], [80, 80], [96, 96], [128, 128], [160, 160], [192, 192], [224, 224], [256, 256], [Infinity, 320]],
};

// Herkent tot welke "familie" een codec-naam van ffprobe hoort. Geeft null
// terug voor iets onbekends, zodat we dan veilig kunnen terugvallen.
function codecFamily(codecName) {
    if (!codecName) return null;
    const name = codecName.toLowerCase();
    if (name === 'mp3') return 'mp3';
    if (name === 'flac') return 'flac';
    if (name === 'aac') return 'aac';
    if (name === 'opus') return 'opus';
    if (name === 'vorbis') return 'vorbis';
    if (name.startsWith('wma')) return 'wma';
    return null;
}

// Zoekt in de tabel van de betreffende codec-familie de juiste doel-bitrate
// voor MP3, op basis van de gemeten bron-bitrate.
function targetMp3Bitrate(family, sourceKbps) {
    const table = BITRATE_TABLES[family];
    for (const [maxKbps, targetKbps] of table) {
        if (sourceKbps <= maxKbps) return targetKbps;
    }
    return 320;
}

// Peilt met ffprobe wat een zender op dit moment werkelijk aanlevert.
// Geeft een Promise die oplost met { family, bitrateKbps } (bitrateKbps kan
// null zijn bij mp3/flac, want die hebben we toch niet nodig), of afwijst
// als het formaat niet te bepalen was.
function probeSourceFormat(url, name) {
    return new Promise((resolve, reject) => {
        const probeCommand = ffmpeg()
            .input(url)
            .inputOptions('-user_agent', `'${name} Logger'`);
        probeCommand.ffprobe((err, data) => {
            if (err) return reject(err);
            const audioStream = (data.streams || []).find(s => s.codec_type === 'audio');
            if (!audioStream) return reject(new Error('geen audiospoor gevonden'));
            const family = codecFamily(audioStream.codec_name);
            if (!family) {
                return reject(new Error(`onbekende codec: ${audioStream.codec_name || '?'}`));
            }
            // Bitrate: eerst op streamniveau proberen, anders op formaatniveau
            // (sommige zenders vullen alleen het één of het ander in).
            const rawBitrate = audioStream.bit_rate || (data.format && data.format.bit_rate);
            const bitrateKbps = rawBitrate ? Math.round(Number(rawBitrate) / 1000) : null;
            if (family !== 'mp3' && family !== 'flac' && bitrateKbps === null) {
                return reject(new Error(`bitrate van ${family}-bron niet te bepalen`));
            }
            resolve({ family, bitrateKbps });
        });
    });
}

// Function to execute ffmpeg command using fluent-ffmpeg
async function recordStream(name, folder, url) {
    const audioFolderPath = path.join(__dirname, `./audio/${folder}`);
    fs.mkdirSync(audioFolderPath, { recursive: true });
    const currentDate = new Date();
    const formattedDate = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}-${String(currentDate.getHours()).padStart(2, '0')}`;

    // Eerst peilen wat de bron werkelijk aanlevert - lukt dat niet, dan
    // gebruiken we verderop de veilige val-terug-waarde (160kbps MP3).
    let probeResult;
    try {
        probeResult = await probeSourceFormat(url, name);
    } catch (err) {
        console.error(`${name}: kon bronformaat niet bepalen (${err.message}), val terug op veilige 160kbps MP3.`);
        probeResult = null;
    }

    const command = ffmpeg()
        .input(url)
        .inputOptions('-user_agent', `'${name} Logger'`)
        // Opnameduur in seconden -- fluent-ffmpeg accepteert hier gewoon een
        // getal, dat scheelt zelf een tijd-tekst (zoals "01:01:00") in
        // elkaar knutselen.
        .duration(opnameduurMinuten * 60);

    let outputPath;

    if (probeResult && (probeResult.family === 'mp3' || probeResult.family === 'flac')) {
        // Bron is al MP3 of FLAC - ongewijzigd opslaan, geen transcoding.
        const ext = probeResult.family === 'flac' ? 'flac' : 'mp3';
        outputPath = `${audioFolderPath}/${folder}-${formattedDate}.${ext}`;
        command.audioCodec('copy');
        // TOEGEVOEGD (William, 6 sept 2026): ook bij MP3/FLAC de bitrate erbij
        // loggen als ffprobe die kon bepalen (niet gegarandeerd -- sommige
        // streams vermelden hun bitrate niet, dan laten we dat stukje gewoon
        // weg in plaats van "@ nullkbps" te tonen).
        const bronBitrateTekst = probeResult.bitrateKbps !== null ? ` @ ${probeResult.bitrateKbps}kbps` : '';
        console.log(`${name}: bron is ${probeResult.family.toUpperCase()}${bronBitrateTekst}, wordt ongewijzigd opgeslagen (geen transcoding).`);
    } else {
        // Bron is AAC/Opus/Vorbis/WMA, of onbekend/niet te bepalen -> omzetten
        // naar MP3, met bitrate volgens de tabel (of 160kbps als val-terug).
        const targetKbps = probeResult
            ? targetMp3Bitrate(probeResult.family, probeResult.bitrateKbps)
            : 160;
        outputPath = `${audioFolderPath}/${folder}-${formattedDate}.mp3`;
        command.audioFrequency(44100).audioBitrate(`${targetKbps}k`);
        if (probeResult) {
            console.log(`${name}: bron is ${probeResult.family.toUpperCase()} @ ${probeResult.bitrateKbps}kbps, wordt getranscodeerd naar MP3 @ ${targetKbps}kbps.`);
        }
    }

    command
        .output(outputPath)
        .on('start', (commandLine) => {
            console.log(`Started recording for ${name} in folder ${folder}.`);
        })
        .on('error', (err) => {
            console.error(`Error: ${err.message}`);
        })
        .on('end', () => {
            console.log(`Recording finished for ${name} in folder ${folder}`);
        })
        .run();
}
// Function to read settings and start recording
function startRecording() {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, '/settings.json'), 'utf8'));
    const streams = json.streams;
    streams.forEach(item => {
        recordStream(item.name, item.folder, item.url);
    });
}
// Schedule the startRecording function to run at the beginning of every hour
cron.schedule(`${recorder_minute} * * * *`, () => {
    const now = new Date;
    console.log(`Starting recording at `+String(now.getHours()).padStart(2, '0')+`:`+recorder_minute.toString().padStart(2, '0')+`.`);
    startRecording();
});
console.log(`Recorder is OK! The recorder process will run every hour at xx:`+recorder_minute.toString().padStart(2, '0')+`.`);
