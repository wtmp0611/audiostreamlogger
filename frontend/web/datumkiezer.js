// =====================================================================
// datumkiezer.js
//
// TOEGEVOEGD (William, 6 sept 2026). Vervangt het vrije tekstveld voor
// datum/tijd door een nette keuzelijst: een zender-lijst, een datumveld
// (begrensd op dagen waarvoor ECHT opnames bestaan -- lost gelijk het
// "kalender staat vast op 7 dagen, retentie is 10 dagen"-verschil op) en
// een uren-lijst die ALTIJD alle 24 uren toont, met de ontbrekende uren
// grijs/niet-aanklikbaar (optie B uit de demo's die je gezien hebt).
//
// Dit bestand doet zelf GEEN opname laden. Het vult alleen de bestaande,
// nu verborgen bediening (stringSelector/dateTimeSelector/load) in en
// "klikt" daarna op die verborgen knop -- main.js pakt het vanaf daar
// precies zo op als altijd (url opbouwen, piekbestand ophalen, golfvorm
// laden). Zo blijven alle bestaande knoppen (skip, selectie, download)
// gewoon werken zonder dat we ze opnieuw hoeven te bouwen.
//
// Gegevens komen van twee loketjes die al in DA's eigen server zaten:
//   /api/settings  -> lijst met zenders (naam + mapnaam)
//   /api/settings2 -> per zender welke jaar/maand/dag/uur-combinaties er
//                     echt aan opnamebestanden staan (deze werkte tot nu
//                     toe niet -- zie de toelichting in routes/api.js)
// =====================================================================

const zenderSelect = document.getElementById('zenderKeuzeNieuw');
const datumInput = document.getElementById('datumKeuzeNieuw');
const datumDagNaamEl = document.getElementById('datumDagNaam');
const uurSelect = document.getElementById('uurKeuzeNieuw');
const uurTriggerKnop = document.getElementById('uurTriggerKnop');
const uurPaneel = document.getElementById('uurPaneel');
const laadKnop = document.getElementById('laadKnopNieuw');
const geenOpnamesMelding = document.getElementById('geenOpnamesDieDag');

// De verborgen, originele bediening die main.js al kent en gebruikt.
const oudeZenderSelect = document.getElementById('stringSelector');
const oudeDatumTijdInput = document.getElementById('dateTimeSelector');
const oudeLaadKnop = document.getElementById('load');

// Per zender (mapnaam/"folder"): { "2026-09-05": Set([0,1,2, ...]), ... }
let opnamesPerZender = {};

function tweeCijfers(n) {
    return String(n).padStart(2, '0');
}

// /api/settings2 groepeert per zendernaam met spaties (onderstrepingen
// vervangen door spaties -- zie routes/api.js), terwijl de zender in de
// rest van de pagina bij zijn "folder" (mapnaam) hoort. Deze functie zet
// de ruwe /api/settings2-data om naar iets dat we per FOLDER kunnen
// opzoeken: { "YYYY-MM-DD": Set(uren) }.
function bouwOpnamesPerZender(settings, settings2) {
    const resultaat = {};
    settings.forEach((zender) => {
        const sleutel = zender.name.replace(/_/g, ' ');
        const ruweData = settings2[sleutel] || {};
        const perDatum = {};
        Object.entries(ruweData).forEach(([jaar, perMaand]) => {
            Object.entries(perMaand).forEach(([maand, perDag]) => {
                Object.entries(perDag).forEach(([dag, uren]) => {
                    const datumTekst = `${jaar}-${maand}-${dag}`;
                    perDatum[datumTekst] = new Set(uren.map(Number));
                });
            });
        });
        resultaat[zender.folder] = perDatum;
    });
    return resultaat;
}

function beschikbareDatums(folder) {
    return Object.keys(opnamesPerZender[folder] || {}).sort();
}

// TOEGEVOEGD (William, 6 sept 2026): laat de dagnaam zien naast de datum
// (bijv. "Saturday" naast 05-09-2026) -- het native datumveld (<input
// type="date">) kan zelf geen extra tekst tonen, dus dit is een los
// tekstveldje ernaast dat we zelf bijwerken. "T00:00:00" erachter voorkomt
// dat de browser de datumtekst als UTC-middernacht leest en er, afhankelijk
// van de tijdzone, per ongeluk de vorige dag van maakt.
function werkDagNaamBij() {
    if (!datumInput.value) {
        datumDagNaamEl.textContent = '';
        return;
    }
    const datum = new Date(`${datumInput.value}T00:00:00`);
    datumDagNaamEl.textContent = datum.toLocaleDateString('en-US', { weekday: 'long' });
}

function werkDatumGrenzenBij() {
    const folder = zenderSelect.value;
    const datums = beschikbareDatums(folder);
    if (datums.length === 0) {
        datumInput.min = '';
        datumInput.max = '';
        datumInput.value = '';
        werkDagNaamBij();
        return;
    }
    datumInput.min = datums[0];
    datumInput.max = datums[datums.length - 1];
    // Als er nog geen (geldige) datum gekozen is, of de gekozen datum valt
    // buiten het bereik van deze zender: automatisch de laatst bekende dag
    // met opnames kiezen -- meestal precies wat je wilt zien.
    if (!datumInput.value || datumInput.value < datumInput.min || datumInput.value > datumInput.max) {
        datumInput.value = datums[datums.length - 1];
    }
    werkDagNaamBij();
}

// Vult de uren-lijst: ALTIJD alle 24 uren, ontbrekende grijs/uitgeschakeld,
// bestaande gewoon aan te klikken (optie B).
function werkUrenLijstBij() {
    const folder = zenderSelect.value;
    const datumTekst = datumInput.value;
    const bestaandeUren = (opnamesPerZender[folder] || {})[datumTekst] || new Set();

    // GEVONDEN DOOR WILLIAM (6 sept 2026): het al gekozen uur (bijv. 20:00)
    // sprong steeds terug naar het laatste uur van de dag zodra je van
    // zender of datum wisselde, ook als dat uur bij de nieuwe keuze ook
    // gewoon bestond. Oorzaak: hieronder werd altijd blind het laatste uur
    // gekozen, ongeacht wat er al stond. Oplossing: eerst onthouden wat er
    // NU gekozen staat, en dat na het herbouwen van de lijst gewoon weer
    // proberen aan te houden -- alleen als dat uur niet meer bestaat,
    // springen we (zoals eerst) naar het laatste beschikbare uur.
    const vorigGekozenUur = uurSelect.value !== '' ? Number(uurSelect.value) : null;

    uurSelect.innerHTML = '';
    for (let uur = 0; uur < 24; uur++) {
        const optie = document.createElement('option');
        optie.value = uur;
        optie.textContent = `${tweeCijfers(uur)}:00`;
        if (!bestaandeUren.has(uur)) {
            optie.disabled = true;
        }
        uurSelect.appendChild(optie);
    }

    if (bestaandeUren.size === 0) {
        geenOpnamesMelding.style.display = 'block';
        laadKnop.disabled = true;
        bouwUurGrid();
        return;
    }
    geenOpnamesMelding.style.display = 'none';
    laadKnop.disabled = false;

    if (vorigGekozenUur !== null && bestaandeUren.has(vorigGekozenUur)) {
        uurSelect.value = vorigGekozenUur;
    } else {
        // Het eerder gekozen uur bestaat hier niet (of er was nog niets
        // gekozen) -- dan het laatste (meest recente) bestaande uur van
        // die dag alvast selecteren, zodat er nooit een grijze
        // (niet-klikbare) optie blijft "hangen" als standaardkeuze.
        const bestaandeUrenGesorteerd = Array.from(bestaandeUren).sort((a, b) => a - b);
        uurSelect.value = bestaandeUrenGesorteerd[bestaandeUrenGesorteerd.length - 1];
    }
    bouwUurGrid();
}
// TOEGEVOEGD (William, 8 sept 2026): het zichtbare "pulldownblok" -- 4
// rijen van 6 uur-knoppen -- als laag boven op de (nu verborgen)
// uurSelect hierboven. uurSelect blijft de "echte" waarde bevatten;
// alles verderop (laadKnop, main.js) leest gewoon uurSelect.value zoals
// altijd. Dit blok is dus puur de zichtbare/klikbare schil eromheen.
function bouwUurGrid() {
    uurPaneel.innerHTML = '';
    for (let uur = 0; uur < 24; uur++) {
        const optie = uurSelect.options[uur];
        const cel = document.createElement('button');
        cel.type = 'button';
        cel.className = 'uurCel';
        cel.textContent = tweeCijfers(uur);
        cel.disabled = optie.disabled;
        if (!optie.disabled && Number(uurSelect.value) === uur) {
            cel.classList.add('actief');
        }
        cel.addEventListener('click', () => {
            uurSelect.value = uur;
            uurPaneel.style.display = 'none';
            bouwUurGrid();
        });
        uurPaneel.appendChild(cel);
    }
    const huidigeOptie = uurSelect.options[Number(uurSelect.value)];
    uurTriggerKnop.textContent = (huidigeOptie && !huidigeOptie.disabled)
        ? `${tweeCijfers(Number(uurSelect.value))}:00`
        : 'Kies uur';
    uurTriggerKnop.disabled = laadKnop.disabled;
}
uurTriggerKnop.addEventListener('click', () => {
    uurPaneel.style.display = uurPaneel.style.display === 'grid' ? 'none' : 'grid';
});
document.addEventListener('click', (e) => {
    if (!uurPaneel.contains(e.target) && e.target !== uurTriggerKnop) {
        uurPaneel.style.display = 'none';
    }
});
zenderSelect.addEventListener('change', () => {
    werkDatumGrenzenBij();
    werkUrenLijstBij();
});
datumInput.addEventListener('change', () => {
    werkDagNaamBij();
    werkUrenLijstBij();
});

laadKnop.addEventListener('click', () => {
    const folder = zenderSelect.value;
    const datumTekst = datumInput.value;
    const uur = uurSelect.value;
    if (!folder || !datumTekst || uurSelect.selectedOptions[0]?.disabled) {
        return;
    }

    // De oude, verborgen bediening invullen precies zoals main.js 'm
    // verwacht: stringSelector = mapnaam, dateTimeSelector = een tekst die
    // "new Date(...)" correct kan lezen (main.js haalt daar zelf jaar/
    // maand/dag/uur weer uit met .getFullYear()/.getHours()/etc.).
    oudeZenderSelect.innerHTML = `<option value="${folder}">${folder}</option>`;
    oudeZenderSelect.value = folder;
    oudeDatumTijdInput.value = `${datumTekst}T${tweeCijfers(uur)}:00`;
    oudeLaadKnop.click();
});

// =====================================================================
// Opstarten: zender-lijst vullen en de echte opname-gegevens ophalen.
// =====================================================================
Promise.all([
    fetch('/api/settings').then((r) => r.json()),
    fetch('/api/settings2').then((r) => r.json()),
])
    .then(([settings, settings2]) => {
        opnamesPerZender = bouwOpnamesPerZender(settings, settings2);

        zenderSelect.innerHTML = '';
        settings.forEach((zender) => {
            const optie = document.createElement('option');
            optie.value = zender.folder;
            optie.textContent = zender.name.replace(/_/g, ' ');
            zenderSelect.appendChild(optie);
        });

        werkDatumGrenzenBij();
        werkUrenLijstBij();
    })
    .catch((err) => {
        console.error('Kon zender-/opnamegegevens niet ophalen:', err);
        geenOpnamesMelding.textContent = 'Could not load the station/recording list.';
        geenOpnamesMelding.style.display = 'block';
        laadKnop.disabled = true;
    });
