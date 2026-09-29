# Decision log — trenažér otázek ČKAIT / obor MIK

Uzavřeno 31. 8. 2026. Aplikace je hotová, dál se generuje obsah. Tenhle soubor
je závazný pro všechny další konverzace; kdo na projektu pokračuje, čte nejdřív
jeho a starší konverzace nedohledává.

> Aktualizace 26. 9. 2026: aplikace je převedená na PWA v tomto repozitáři
> a má gamifikaci. Viz kapitola **PWA a gamifikace** na konci. Popis souborů
> a postupu vkládání otázek v původních kapitolách platí pro jednosouborovou
> verzi, která je archivovaná v `puvodni/`.

## Účel

Tom se připravuje na autorizační zkoušku stavebního inženýra pro obor mosty
a inženýrské konstrukce, termín konec září 2026 (posunuto na 30. 10. 2026).
Písemná část je test, kde má každá otázka tři možnosti a právě jedna je správná.
Trenažér tenhle formát napodobuje a běží na mobilu, aby se dal používat
v krátkých úsecích.

## Zdroj dat a pravidlo doslovnosti

Autoritativním zdrojem je sekce „Obor mosty a inženýrské konstrukce (MIK)"
v souboru `OTAZKY-ke-zkouskam-vydání_2-2026__1_.md`, který je přiložený ke
znalostem projektu. Sekce obsahuje 468 otázek v okruzích A až R. Rozložení je
A 97, B 5, C 30, D 43, E 18, F 20, G 34, H 45, I 40, J 13, K 27, L 46, M 14,
N 10, O 21, P 4, R 1. Pracovat s celým dokumentem bez vyříznutí této sekce je
chyba, protože blok BOZP a další pasáže se opakují u všech čtrnácti oborů;
každá hodnota se pak v dokumentu jeví čtrnáctkrát.

Znění otázky, správná odpověď i odkaz na předpis se ze zdroje berou **doslova
a programově**. Nikdy se nepíší z paměti, nezkracují ani nepřeformulovávají.
Pravidlo vzniklo poté, co dřívější rekonstrukce znění z paměti vedla k chybám.
Model vymýšlí **výhradně špatné odpovědi**. Architektura je nastavená tak, aby
to nešlo porušit: generující model dostává jen ID a vrací jen distraktory,
zbytek doplní skript ze zdroje.

## Pracovní postup pro každý okruh

Na každý okruh se zakládá nová konverzace, aby nerostl kontext.

Nejdřív `python okruh.py zadani X` vyřízne okruh ze zdroje a zapíše
`zadani_X.txt`. Ten se vloží do chatu se slabším modelem spolu s obsahem
`PROMPT_generator.md`. Model vrátí bloky `[ID]` s distraktory, které se uloží
jako `distraktory_X.txt`.

Pak se přepne na Opus a spustí `PROMPT_kontrola.md`. Ten pustí
`python okruh.py sestav X distraktory_X.txt`, projde označené a sporné položky,
přečte náhodný vzorek deseti otázek a vynese verdikt. Když kontroly projdou,
vznikne `okruh_X.txt`, jehož obsah se vloží do bloku na začátku
`zkousec_mik.html` mezi `<script type="text/plain" id="otazky">` a `</script>`.
(V PWA verzi se místo toho upraví `otazky_data.txt`.)

Statistika v aplikaci je klíčovaná podle ID otázky, takže vložení dalšího okruhu
nesmaže dosavadní postup.

## Formát souboru otázek

Prostý text v UTF-8. Řádek `@` pojmenuje okruh ve tvaru `@ I = BOZP na
staveništi`. Řádek `?` je otázka a nese ID v hranaté závorce, tedy `? [I9] …`;
z písmene v ID se odvozuje okruh, takže filtrování funguje samo. Řádek `+` je
správná odpověď, řádek `>` odkaz na ustanovení právního předpisu, řádek `-`
špatná odpověď a řádek `-!` špatná odpověď, u které si model nebyl jistý.
Prázdné řádky a řádky začínající `#` se ignorují.

## Jak vypadá dobrý distraktor

Ke každé otázce jsou nejméně čtyři, program z nich pokaždé losuje dva, takže
otázka má víc podob a nedá se zapamatovat podle pozice. Distraktor musí být ze
stejné kategorie, ve stejných jednotkách a ve stejném mluvnickém tvaru jako
správná odpověď; řada otázek končí čárkou a odpověď na ni navazuje.

Nejlepší distraktory stavějí na záměnách, které v oboru reálně hrozí, tedy na
prohozených kompetencích úřadů, odkazu na příbuzný předpis, zaměněných lhůtách
a přehozených číselných hodnotách z jiného ustanovení.

Distraktor nesmí být nápadně kratší ani delší než správná odpověď, jinak se test
dá uhodnout pouhým pohledem. U okruhu I na tohle spadly tři otázky a musely se
přepsat.

Když si model není jistý, že je vymyšlená možnost opravdu nesprávná, označí ji
`-!`. Riziko je reálné hlavně u lhůt a kompetencí, které se prolínají mezi
předpisy, takže věrohodně znějící distraktor může být shodou okolností pravdivý.
To je nejzávažnější možná vada, protože učí správnou věc jako špatnou.

## Evidence modelů

U každé dávky se eviduje, který model ji generoval a který kontroloval. Generující
model píše jako první řádek `distraktory_X.txt` komentář `# generoval: název`,
kontrolující pod něj doplní `# kontroloval: název`. Oba řádky začínají mřížkou,
takže je `okruh.py` ignoruje a do trenažéru se nedostanou, ale v souboru
s distraktory zůstanou natrvalo.

Důvod je ten, že celý postup stojí na oddělení generování a kontroly do dvou
konverzací a na dvou různých modelech. Když obojí udělá tentýž model, kontrola je
mělčí, než jak vypadá, protože co model přehlédl při psaní, přehlédne se stejnou
pravděpodobností i při čtení. Z hotového souboru to zpětně nepoznáš, ledaže je to
zapsané. Stalo se to u okruhu G, kde generoval i kontroloval Opus 5; dávka prošla
se třinácti opravami, ale záruka nezávislé kontroly u ní neplatí.

Podpis je vlastní tvrzení modelu, ne měření zvenčí. Když by byl dotaz z bezpečnostních
důvodů přesměrován na jiný model, podpis to nezachytí. Pro účel evidence to stačí,
spoléhat se na něj jako na důkaz nelze.

## Číselné otázky

Distraktor musí být buď hodnota, která se v korpusu MIK skutečně vyskytuje, ať
už jako odpověď nebo uvnitř věty, nebo hodnota sousedící se správnou odpovědí
o jeden krok v poslední číslici. Co není ani jedno, se nepoužije, protože takové
číslo jde vyloučit bez znalosti předpisu.

V okruhu I to znamenalo přepsat dvanáct metrických otázek; skutečná zásoba
metrických hodnot je 0,30, 0,5, 0,75, 1,1, 1,3, 1,5, 1,8, 2,1 a 3 m.

Pravidlo se nedá aplikovat všude. V celém dokumentu je jediná hodnota pro hodiny
(24), jediný sklon (1:5), jediný zlomek (1/3), dvě teploty a dvě peněžní částky.
U pěti takových otázek okruhu I se distraktory vymýšlejí, protože tam neexistuje
krátký kanonický seznam, vůči kterému by vymyšlené číslo vyčnívalo. Rozdíl proti
metrům je právě tenhle: u výšek připravený člověk seznam hodnot zná, u délky
větrání nebo výše škody nikoli. Skript takové případy sám označí jako varování.

## Mechanické kontroly

Skript `okruh.py` ověřuje, že jsou distraktory ke všem otázkám okruhu a k žádné
cizí, že jich je aspoň čtyři, že mezi nimi nejsou duplicity, že se žádný
neshoduje se správnou odpovědí, že správná odpověď není nápadně nejdelší ani
nejkratší (mez je 1,6 násobek délky) a že číselné distraktory mají stejnou
jednotku a povolenou hodnotu. Při nalezení chyby soubor nesestaví.

Ověřeno, že skript reprodukuje ručně sestavený okruh I znak po znaku a že
podvržená data spadnou na šesti různých kontrolách.

## Aplikace

`zkousec_mik.html` je jednosouborová stránka bez instalace a bez připojení.
Otázky jsou vložené přímo v souboru, takže se dá poslat do telefonu a přidat na
plochu. Otázka je ukotvená nahoře, odpovědi dole v dosahu palce, nad otázkou
svítí ID. Nahoře přibývá jedna ryska za každou zodpovězenou otázku. U dlouhých
odpovědí, jakou má například I40, je tlačítko další otázky přilepené ke spodku
obrazovky, protože stránka přesahuje výšku displeje.

Tlačítkem vpravo nahoře se otevře panel s výběrem okruhů se zaškrtávacími
políčky, kde je u každého název, předpisy a počet otázek. Když není vybráno
všechno, svítí u tlačítka modrá tečka. Ze stejného místa se přepíná režim,
otevírá panel statistik a vkládá jiná sada otázek.

## Učící mód

Vedle zkoušecího módu je učící. Nezkouší se, jen se listuje otázkami vybraných
okruhů a u každé je rovnou správná odpověď a odkaz na předpis. Špatné odpovědi
se zde nezobrazují, aby si Tom nezapamatoval vymyšlené nesprávné znění. Pořadí
se přepíná mezi vzestupným podle ID a náhodným; podle ID je výchozí, protože
příbuzné otázky leží u sebe. Listování se nezapočítává do statistik a vstup do
učícího módu vždy začíná od první otázky. Ve zkoušecím módu se odkaz na předpis
ukáže až po odpovědi.

## Statistiky

Ukládají se do localStorage pod klíčem `zkousec-mik-v1`. Ověřeno, že u souboru
otevřeného z disku to v Chrome funguje a přežije zavření stránky; protože
všechny soubory z disku sdílejí stejný původ, musí být klíč pojmenovaný. Když
prohlížeč uložení nedovolí, aplikace to pozná a napíše to.

Ke každé otázce se drží počet správných, počet špatných a čas poslední odpovědi.
Klíčem je ID, takže statistika přežije opravu překlepu ve znění i výměnu sady
otázek. (Původní vážený výběr otázek byl později nahrazen Leitnerovým
plánovačem, viz kapitola níže.)

Panel statistik ukazuje celkovou úspěšnost, rozpad po okruzích s počtem otázek
k doučení a deset nejčastěji chybovaných. Zálohu lze uložit do souboru a načíst
zpět; import se přičítá, takže se dá přenést postup mezi telefonem a počítačem.

## Známé vady zdrojových dat

Ve 37 ze 468 odkazů na předpis byla přilepená patička stránky z PDF s adresou
a telefonem ČKAIT; odstraňuje se vším od slova „vydáno:" dál. V šesti odkazech
bylo rozdělení slova z konce řádku, například „bezpeč- nosti". Znění otázek ani
správné odpovědi zasažené nebyly. Odkaz chybí u C23 a M10, jinde je všude.

Pozor na past: očista se nesmí pouštět na znění otázek v podobě, která maže
koncovou interpunkci. Řada otázek končí čárkou („Zhotovitel zajistí,") a její
useknutí porušuje doslovnost. `okruh.py` proto má dvě oddělené čisticí funkce.

## Stav obsahu

Všech 17 okruhů (469 otázek) má distraktory a prošlo kontrolou. K ověření zůstávají
položky označené `-!`, zejména I5 (zařazení profesí podle přílohy nařízení vlády).

## Plánovač a historie (září 2026)

Zkoušecí mód používá Leitnerův plánovač: každá otázka má úroveň 0 až 5 s intervaly
0,35, 1, 3, 7, 14 a 21 dní. Sezení otevře 8 nových otázek, pak se na každé 4
opakované vsune jedna nová, opakované jsou seřazené podle naléhavosti. Chybná
otázka se v sezení jednou vrátí zhruba o 18 otázek později (značka „znovu").
Statistiky mají schéma verze 2 s polem `uroven`, starší zálohy bez něj se
dopočítají. Zkoušecí mód drží historii 60 otázek, dá se v ní listovat zpět,
zpětně se ale odpovídat nedá.

## PWA a gamifikace (26. 9. 2026)

Aplikace je rozdělená na `index.html`, `css/styl.css` a `js/app.js`, otázky se
načítají za běhu z `otazky_data.txt`. `build.py` a šablona odpadly, protože přes
HTTPS z GitHub Pages fetch funguje (dřívější selhání bylo jen u `content://`
na tabletu). Service worker používá network-first s pojistkou 4 s a cache,
takže úprava v repozitáři se projeví při dalším spuštění online a bez sítě běží
poslední verze. Po startu se volá `navigator.storage.persist()`. Klíče
localStorage zůstaly beze změny, ale PWA běží na jiném původu než soubor z disku,
takže statistiky je potřeba jednou přenést zálohou.

Gamifikace jen poslouchá živé odpovědi ve zkoušecím módu, na plánovač ani
statistiky nemá vliv a do učícího módu ani listování historií nezasahuje. Data
má pod vlastním klíčem `zkousec-mik-hra-v1`. Obsahuje XP (správná odpověď 10
plus bonus podle nízké úrovně otázky, oprava vrácené otázky +10, dotažení na
úroveň 5 +15, bonus za sérii, chyba 2), 12 úrovní od Praktikanta po
Autorizovaného inženýra s hvězdami nad nejvyšší, sérii správných odpovědí se
zvukem stoupajícím po půltónech, denní cíl (výchozí 40) se sérií dní, 21 odznaků,
mapu zvládnutí okruhů barvenou podle průměrné úrovně, odpočet do zkoušky
a vlastní konfety na canvasu bez knihoven. Při prvním spuštění se XP dopočítá ze
stávajících statistik (5 za správnou, 1 za chybnou odpověď). Export zálohy
obsahuje i hru; při importu se hra slučuje maximem, ne součtem, aby opakované
načtení stejné zálohy body nenafouklo. Vynulování statistik nuluje i hru,
nastavení zůstává. Respektuje `prefers-reduced-motion`.

## Kapitoly (26. 9. 2026)

Učící mód se ukázal jako nejméně oblíbená část. Kartičky se sebehodnocením
(styl Anki) Tom zkoušel a u dlouhých legislativních odpovědí mu nesedí, proto se
nezavedly. Místo toho vznikl třetí režim Kapitoly vedle Zkoušení a Učení; učící
ani zkoušecí mód se nezměnily.

Každý okruh se v pořadí podle ID rozdělí na kapitoly co nejpodobnější velikosti
s nejvýš deseti otázkami (A má deset kapitol, celkem je jich 54). V kapitole se
odpovídá jako ve zkoušení a po každé odpovědi je vidět správné znění, předpis
a případné varování u sporné možnosti. Na konci jsou hvězdičky za podíl správných
odpovědí (tři za 90 %, dvě za 70 %, jedna za 50 %), přehled chybných otázek se
správnou odpovědí a tlačítka na zopakování nebo další kapitolu. Přehled kapitol
nabízí pokračování první neotevřenou kapitolou, potom první bez tří hvězd.

Odpovědi v kapitolách se počítají jen do hry přes `hraPoOdpovedi` (XP, série,
denní cíl, odznaky). Statistiky ani Leitnerovy úrovně se nemění, takže plánovač
zkoušecího módu zůstává přesně jako dřív; úroveň otázky se pro výpočet XP jen čte.
Protože se úroveň nemění, bonus „Zvládnuto!“ ani odznak za otázku vytaženou
z chyb se v kapitolách získat nedá.

**Změna 29. 9. 2026:** chyba v kapitole se nově zapisuje do statistik stejně
jako ve zkoušecím módu, tedy přičte se k počtu chyb, úroveň otázky spadne na 0
a uloží se čas. Plánovač ji tak brzy vrátí a objeví se i v přehledu „k doučení“.
Dřív se chyba ztratila a otázka na vysoké úrovni se mohla vrátit až za dva týdny,
přestože ji Tom v kapitole zrovna spletl. Správná odpověď se dál nezapisuje,
protože kapitola jde po příbuzných otázkách za sebou a dá se hned zopakovat;
úrovně by tím vyrostly bez skutečného vybavení z paměti. Návrat chybné otázky
později v sezení (značka „znovu“) patří jen ke zkoušecímu módu a do kapitol se
nepřenáší.

Hvězdičky leží pod novým klíčem `zkousec-mik-kapitoly-v1`, klíčované rozsahem
ID kapitoly (např. „A1–A10“). Export zálohy je obsahuje v poli `kapitoly`, import
je slučuje maximem; starší zálohy bez něj se načtou jako dřív. Vynulování statistik
maže i hvězdičky.

## Pomodoro (26. 9. 2026)

Tom chtěl časovač soustředění pro učení i zkoušení. Vznikl jeden společný
časovač pro všechny tři režimy, protože při přepnutí ze zkoušení do kapitol
nebo učení se pořád učí a blok by se neměl přerušit. V liště vedle série je
tlačítko s rajčetem a zbývajícím časem, klepnutím se otevře panel s velkými
hodinami, tlačítky Start/Pozastavit, Přeskočit a Vynulovat.

Výchozí nastavení je klasické pomodoro podle Francesca Cirilla: 25 minut práce,
5 minut pauza a po čtyřech blocích 15 minut. Pro opakované vybavování
odpovědí z paměti je to rozumná délka, soustředění na dlouhé legislativní
formulace po zhruba půl hodině slábne a krátké pauzy pomáhají naučené uložit.
Na výběr
je ještě 50 + 10 minut (delší soustředění, dlouhá pauza 30) a 15 + 3 minuty
(únavné dny, dlouhá pauza 10), případně se časovač dá vypnout. Volba je
v panelu Okruhy vedle cíle.

Po skončení bloku zazní gong, tablet zavibruje a sám se otevře panel s pauzou
a radou, co během ní dělat. Pauza běží sama. Když skončí, ozve se krátká
znělka a toast, další blok ale začne až po klepnutí na Start, aby neběžel,
když Tom od tabletu odešel. Pokud je zrovna otevřený jiný panel (třeba úprava
otázek), panel pauzy se neotevře a stačí toast, aby se nic nepřekrylo. Zvuk
a vibrace se řídí stejnými přepínači jako hra.

Čas se počítá z okamžiku konce fáze, ne z počtu tiků. Android v uspané
aplikaci časovače zastavuje, takže po návratu se dopočítá, co mezitím uběhlo,
i kdyby skončil blok i pauza po něm. Oznámení mimo aplikaci (se zhasnutou
obrazovkou) spolehlivě bez serveru udělat nejde, proto se nezavádělo.

Stav časovače (fáze, konec, počet bloků v cyklu a dnešní počet bloků) leží pod
novým klíčem `zkousec-mik-pomodoro-v1`, takže přežije zavření aplikace.
Plánovač, statistiky, hra ani záloha o časovači nevědí, vynulování statistik
ho nemění.

## Sdílení zálohy (29. 9. 2026)

V panelu Statistiky přibylo tlačítko Sdílet zálohu. Otevře systémovou nabídku
sdílení Androidu, takže zálohu jde poslat rovnou na Disk Google, do OneDrivu,
e-mailem nebo kamkoli jinam, co je v tabletu nainstalované. Používá se Web Share
API, které funguje offline a bez jakékoli knihovny či přihlašování. Obsah zálohy
je stejný jako u Uložit zálohu, jen jméno souboru nese datum, aby se zálohy na
disku nepřepisovaly.

Chrome na Androidu povoluje sdílet jen vybrané typy souborů a soubor .json mezi
nimi zatím není. Aplikace proto nejdřív zkusí .json, a když ho prohlížeč
odmítne, pošle totéž jako .txt. Načíst zálohu nově nabízí i soubory .txt, takže
takovou zálohu přečte stejně jako dřív uložený .json. Kde sdílení souborů
prohlížeč neumí (třeba počítač s Linuxem), tlačítko se vůbec neukáže, a kdyby
sdílení selhalo jinak než zavřením nabídky, záloha se uloží klasicky do souboru.

## Zásady komunikace

Vysvětlivky a rozbory se píší v souvislé próze bez odrážek, šipek a podobných
značek, protože je pro Toma takový text čitelnější.
