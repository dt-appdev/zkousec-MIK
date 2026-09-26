# Zkoušeč MIK

Trenažér písemného testu autorizační zkoušky ČKAIT, obor mosty a inženýrské
konstrukce (MIK). Obsahuje 469 otázek z oficiální sady vydání 2/2026, okruhy A až R.
Běží jako PWA z GitHub Pages: dá se nainstalovat na plochu tabletu a funguje offline.

**Adresa:** https://dt-appdev.github.io/zkousec-mik/

## Co umí

Zkoušecí mód s Leitnerovým plánovačem opakování (úrovně 0 až 5, chybné otázky se
v sezení jednou vrátí), historie sezení s listováním zpět, učící mód se správnými
odpověďmi a odkazy na předpisy, filtr okruhů, statistiky se zálohou do souboru.
Navíc gamifikace: XP a úrovně, série správných odpovědí, denní cíl, odznaky,
mapa zvládnutí okruhů, odpočet do zkoušky, zvuky, vibrace a konfety.

## Soubory

| Soubor | Co v něm je |
|---|---|
| `index.html` | kostra stránky |
| `css/styl.css` | vzhled |
| `js/app.js` | celá logika aplikace |
| `otazky_data.txt` | otázky, správné a špatné odpovědi, odkazy na předpisy |
| `sw.js` | service worker pro offline běh |
| `manifest.json`, `ikony/` | údaje pro instalaci na plochu |
| `puvodni/zkousec_mik.html` | poslední jednosouborová verze, funguje i bez internetu z disku |
| `docs/DECISION_LOG.md` | historie rozhodnutí v projektu |

## Úprava otázek

Stačí upravit `otazky_data.txt` a uložit do větve `main`. Nic se nesestavuje.
Formát: `@ X = název okruhu`, `? [X1] otázka`, `+ správná odpověď`,
`> odkaz na předpis`, `- špatná odpověď`, `-! sporná špatná odpověď`.
Znění otázek a správných odpovědí se nikdy nemění ručně, přebírá se doslova ze zdroje.

## Nasazení

Settings → Pages → Source: *Deploy from a branch*, větev `main`, složka `/ (root)`.
Po každé změně v `main` se nová verze na tabletu projeví při dalším spuštění
s připojením (service worker používá network-first).

Když přidáš nový soubor, který má fungovat offline, připiš ho do seznamu
`SOUBORY` v `sw.js` a zvyš číslo v `CACHE`.

## Data na zařízení

Statistiky a herní postup se ukládají jen v prohlížeči zařízení (localStorage,
klíče `zkousec-mik-v1` a `zkousec-mik-hra-v1`). V repozitáři nic osobního není.
Přenos mezi zařízeními: Statistiky → Uložit zálohu, na druhém zařízení Načíst zálohu.
