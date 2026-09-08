// =====================================================================
// achtergrondkleur.js
//
// TOEGEVOEGD (William, 6 sept 2026): een eigen achtergrondkleur kiezen --
// de standaard witte achtergrond was te fel voor jouw omgeving. Gebruikt
// de kleurenkiezer die elke browser/elk besturingssysteem al standaard
// ingebouwd heeft (<input type="color">): daar zit al een volwaardige
// RGB-kiezer mét helderheid/verzadiging in, dus daar hoefden we zelf
// niets voor te bouwen.
//
// De keuze wordt bewaard in een cookie (zoals gevraagd), 1 jaar geldig,
// zodat 'm ook na het sluiten van de browser onthouden wordt. Dit is een
// blijvend onderdeel van de pagina: elke bezoeker kan zijn eigen kleur
// kiezen, onafhankelijk van ieder ander (de cookie zit alleen in die ene
// browser, wordt nergens gedeeld).
// =====================================================================

const COOKIE_NAAM = 'achtergrondkleur';
const COOKIE_DAGEN = 365;

function leesCookie(naam) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + naam + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

function schrijfCookie(naam, waarde, dagen) {
    const verloopt = new Date(Date.now() + dagen * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${naam}=${encodeURIComponent(waarde)}; expires=${verloopt}; path=/; SameSite=Lax`;
}

function verwijderCookie(naam) {
    document.cookie = `${naam}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
}

const kiezer = document.getElementById('achtergrondKleurKiezer');
const resetLink = document.getElementById('achtergrondKleurStandaard');

// Bij het openen van de pagina: een eerder opgeslagen kleur (voor deze
// browser) meteen weer toepassen.
const opgeslagenKleur = leesCookie(COOKIE_NAAM);
if (opgeslagenKleur) {
    document.body.style.backgroundColor = opgeslagenKleur;
    kiezer.value = opgeslagenKleur;
}

// 'input' (niet 'change') zodat de kleur al live meeverandert terwijl je
// nog aan het schuiven/kiezen bent in de kleurenkiezer, niet pas achteraf.
kiezer.addEventListener('input', () => {
    document.body.style.backgroundColor = kiezer.value;
    schrijfCookie(COOKIE_NAAM, kiezer.value, COOKIE_DAGEN);
});

resetLink.addEventListener('click', (e) => {
    e.preventDefault();
    document.body.style.backgroundColor = '';
    verwijderCookie(COOKIE_NAAM);
    kiezer.value = '#ffffff';
});
