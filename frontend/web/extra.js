// =====================================================================
// extra.js
//
// TOEGEVOEGD (William, 5 sept 2026), overgenomen uit het idee/de aanpak
// van StreamLogger. Twee dingen:
//   1) Laat zien welk bestand er nu geladen wordt / speelt (#huidigBestand).
//   2) Een voortgangsbalk over de golfvorm heen tijdens het laden/
//      downloaden van een opname (#laadVoortgang).
//
// Dit bestand raakt main.js NIET aan. main.js is bij dit project een
// samengeperst ("geminificeerd") bestand zonder leesbare broncode erbij --
// daar wil je met de hand niks in gaan zitten schrijven. In plaats daarvan
// is in main.js.nieuw precies ÉÉN regel toegevoegd, vlak nadat de golfvorm-
// speler (wavesurfer) wordt aangemaakt:
//
//     window.wavesurfer = ot;
//
// ("ot" is gewoon de interne naam die het samenpers-programma toevallig
// aan de golfvorm-speler heeft gegeven -- verder verandert die ene regel
// niets aan de werking van main.js.) Die ene regel maakt de al bestaande
// speler bereikbaar voor dit bestand hier, zodat AL het nieuwe, leesbare
// werk hieronder kan staan, in plaats van verstopt in dat samengeperste
// bestand.
//
// De golfvorm-bibliotheek (wavesurfer.js) stuurt zelf drie meldingen
// ("events") uit op precies de momenten die we nodig hebben, zonder dat we
// zelf iets van downloaden hoeven te regelen:
//   - 'load'    : het moment dat er een nieuwe opname wordt aangevraagd.
//                 We krijgen de url van het bestand mee -- daar halen we
//                 gewoon de bestandsnaam uit.
//   - 'loading' : tijdens het downloaden, met het percentage erbij. De
//                 bibliotheek berekent dit zelf uit de bestandsgrootte
//                 (de "Content-Length" die de webserver meestuurt).
//   - 'ready'   : de opname is volledig gedownload, verwerkt en getekend.
//
// TOEGEVOEGD (William, 6 sept 2026), fix nummer 3: als er voor de gekozen
// zender/datum/tijd geen opname bestaat, blijft de balk nu voor altijd op
// het scherm staan. Uitgezocht (rechtstreeks in de browser meegekeken
// wat er precies gebeurt): main.js probeert eerst het bijbehorende
// piekbestand (.json, voor een snelle golfvorm) op te halen, en als dat
// niet lukt, valt het terug op het geluidsbestand zelf zonder piekbestand.
// Bestaat het geluidsbestand OOK niet (HTTP 404), dan stuurt de golfvorm-
// bibliotheek in dat geval geen 'error'-melding uit -- er gebeurt daarna
// gewoon he-le-maal niets meer. Vandaar de balk die eeuwig blijft staan.
// Oplossing: we controleren het zelf, onafhankelijk van main.js, door
// meteen bij 'load' zelf even (met een lichtgewicht "HEAD"-verzoek, dat
// alleen vraagt "bestaat dit?" zonder het bestand te downloaden) te
// checken of het bestand er echt is.
// =====================================================================

// main.js maakt de golfvorm-speler pas aan zodra de pagina geladen is.
// Dat gaat razendsnel, maar om zeker te weten dat "window.wavesurfer" er
// al staat voor we 'm gebruiken, proberen we het gewoon een paar keer
// kort na elkaar totdat het lukt.
function wachtOpWavesurfer() {
    if (!window.wavesurfer) {
        setTimeout(wachtOpWavesurfer, 50);
        return;
    }
    initFeedback(window.wavesurfer);
}

function initFeedback(wavesurfer) {
    const huidigBestandEl = document.getElementById('huidigBestand');
    const laadVoortgang = document.getElementById('laadVoortgang');
    const laadVoortgangTekst = document.getElementById('laadVoortgangTekst');
    const laadVoortgangBalkVulling = document.getElementById('laadVoortgangBalkVulling');
    const laadFoutEl = document.getElementById('laadFout');

    // Haalt alleen de bestandsnaam uit een volledige url, bijvoorbeeld
    // "http://192.168.3.166:9703/audio/glowfm/glowfm-2026-09-05-14.mp3"
    // wordt gewoon "glowfm-2026-09-05-14.mp3".
    function bestandsNaamUitUrl(url) {
        try {
            return decodeURIComponent(new URL(url, window.location.origin).pathname.split('/').pop());
        } catch (err) {
            return url;
        }
    }

    let huidigeBestandsnaam = '';
    let laatstBekendPercentage = 0;
    let schermUpdateGepland = false;
    // Telt elke nieuwe laad-poging -- zo kan een trage controle van een
    // OUDE poging nooit per ongeluk nog de melding van een NIEUWERE,
    // ondertussen wel gelukte poging overschrijven.
    let laadPogingNummer = 0;

    function toonLaadFout(tekst) {
        laadFoutEl.textContent = tekst;
        laadFoutEl.style.display = tekst ? 'block' : 'none';
    }

    // Het 'loading'-event kan bij een lange opname en/of een snelle
    // verbinding heel vaak per seconde binnenkomen. Direct bij elke
    // melding het scherm bijwerken kan de browser zo druk houden dat er
    // geen rustig moment meer overblijft om dat ook echt te SCHILDEREN op
    // het scherm. Daarom: alle percentages gewoon meteen verwerken, maar
    // het scherm zelf hooguit 1x per beeldverversing bijwerken
    // (requestAnimationFrame, vanzelf zo'n 60x per seconde).
    function werkSchermVoortgangBij() {
        schermUpdateGepland = false;
        laadVoortgangTekst.textContent = `Downloading... ${laatstBekendPercentage}%`;
        laadVoortgangBalkVulling.style.width = `${laatstBekendPercentage}%`;
    }

    wavesurfer.on('load', (url) => {
        huidigeBestandsnaam = bestandsNaamUitUrl(url);
        laatstBekendPercentage = 0;
        laadVoortgangTekst.textContent = 'Downloading... 0%';
        laadVoortgangBalkVulling.style.width = '0%';
        laadVoortgang.style.display = 'flex';
        huidigBestandEl.textContent = `Loading: ${huidigeBestandsnaam}`;
        toonLaadFout('');

        laadPogingNummer += 1;
        const dezeLaadPoging = laadPogingNummer;
        fetch(url, { method: 'HEAD' })
            .then((resp) => {
                // Ondertussen is er misschien al een NIEUWERE poging gestart
                // (een andere zender/tijd aangeklikt) -- deze uitslag is dan
                // verouderd en mag niets meer op het scherm veranderen.
                if (dezeLaadPoging !== laadPogingNummer) return;
                if (!resp.ok) {
                    laadVoortgang.style.display = 'none';
                    huidigBestandEl.textContent = '';
                    toonLaadFout(`Recording not found: ${huidigeBestandsnaam}`);
                }
            })
            .catch(() => {
                // Netwerkfout bij onze eigen controle -- gewoon negeren, dan
                // probeert main.js het zelf ook nog gewoon op de normale manier.
            });
    });

    wavesurfer.on('loading', (percent) => {
        laatstBekendPercentage = percent;
        if (!schermUpdateGepland) {
            schermUpdateGepland = true;
            requestAnimationFrame(werkSchermVoortgangBij);
        }
    });

    wavesurfer.on('ready', () => {
        laadVoortgang.style.display = 'none';
        huidigBestandEl.textContent = `Loaded: ${huidigeBestandsnaam}`;
    });
}

wachtOpWavesurfer();
