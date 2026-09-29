# CLAUDE.md — Zkoušeč MIK

PWA trenažér autorizační zkoušky ČKAIT, obor MIK. Hostováno na GitHub Pages
z větve `main`, cílové zařízení je Android tablet v Chrome, nainstalovaný jako PWA.

## Pravidla

- Čisté HTML/CSS/JS, žádný build krok, žádné npm, žádné externí knihovny ani CDN
  (vše musí běžet offline).
- UI česky, identifikátory v kódu česky jako doposud.
- **Znění otázek, správných odpovědí a odkazů na předpisy v `otazky_data.txt` nikdy
  neupravuj.** Zdrojem je oficiální sada ČKAIT, přebírá se doslova a programově.
  Měnit se smějí jen špatné odpovědi (distraktory), a to jen na výslovné přání.
- Klíče a schéma localStorage neměň: `zkousec-mik-v1` (statistiky, verze 2)
  a `zkousec-mik-hra-v1` (gamifikace), `zkousec-mik-kapitoly-v1` (hvězdičky kapitol).
  Starší exporty záloh musí jít dál načíst.
- Plánovač (Leitner, úrovně 0–5, fronta, relaps), historie zkoušecího módu a učící
  mód jsou odladěné. Neměnit bez výslovného zadání.
- Gamifikace jen poslouchá živé odpovědi ve zkoušecím módu a v kapitolách
  (`hraPoOdpovedi`), nikdy nesmí ovlivnit plánovač ani statistiky. Kapitoly zapisují
  do statistik jen chyby (úroveň na 0), správné odpovědi ne.
- Při přidání souboru, který má fungovat offline, ho zapiš do `SOUBORY` v `sw.js`
  a zvyš číslo v `CACHE`.
- Každá úloha má vlastní větev a pull request, do `main` nic přímo.
- Tom není profesionální programátor: vysvětluj srozumitelně, v PR popiš,
  co si má na tabletu vyzkoušet. Vysvětlivky piš v souvislé próze.

## Ověření před PR

- `node --check js/app.js sw.js`
- Parser musí načíst všech 469 otázek (panel Okruhy ukazuje počet).
- Vyzkoušet v prohlížeči přes `python3 -m http.server` a offline reload.

## Struktura

`index.html` kostra, `css/styl.css`, `js/app.js` (jedna IIFE, sekce oddělené
komentáři: úložiště, načtení, okruhy, výběr otázky, učící mód, vykreslení,
kapitoly, statistiky, panely, gamifikace, ovládání, start, PWA), `otazky_data.txt`,
`sw.js`, `manifest.json`, `ikony/`, `docs/DECISION_LOG.md`.
