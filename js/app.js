(function () {
  "use strict";

  var MAX_RYSEK = 30;
  var MAX_HISTORIE = 60;    // kolik zodpovězených otázek jde v sezení dolistovat zpět

  // plánovač: intervaly Leitnerových úrovní ve dnech (úroveň 0 až 5)
  var INTERVALY = [0.35, 1, 3, 7, 14, 21];
  var NOVYCH_NA_ZACATKU = 8;   // kolik nových otázek otevře frontu
  var NA_JEDNU_NOVOU = 4;      // po kolika opakovaných se vsune další nová
  var RELAPS_ODSTUP = 18;      // o kolik otázek dál se vrátí chybná otázka
  var DEN = 86400000;

  var vsechny = [];         // všechny načtené otázky
  var nazvy = {};           // písmeno okruhu -> název
  var vybrane = {};         // písmeno okruhu -> true/false
  var aktivni = [];         // otázky vybraných okruhů

  var statistika = {};
  var fronta = [];          // naplánované pořadí otázek pro toto sezení
  var sezeni = {};          // klíče otázek, které v tomto sezení už padly
  var relaps = {};          // klíče otázek už jednou vrácených po chybě
  var kolo = 1;
  var ohlasitKolo = false;
  var prubeh = [];
  var spravne = 0, celkem = 0;
  var aktualni = null, predchozi = null;

  // historie zkoušecího sezení: každý záznam je jedna zobrazená otázka
  // { o: otázka, moznosti: [], spravnaPoz: index, vybrano: index nebo null }
  // Poslední záznam je ten živý, starší jsou jen k prohlížení.
  var historie = [], pozice = -1;

  var rezim = "zkouseni";          // "zkouseni" | "uceni"
  var poradiNahodne = false;
  var ucSeznam = [], ucPozice = 0;

  var ULOZISTE = "zkousec-mik-v1";
  var ulozeniFunguje = true;

  var el = {};
  ["rysky","skore","idcko","otazka","odpovedi","sporne","napoveda","souhrn",
   "seznamOkruhu","vstup","hlaska","panelOkruhy","panelOtazky",
   "panelStat","statSouhrn","statSeznam","statHlaska","statPozn",
   "odkazPredpis","patickaZk","patickaUc","prepinacPoradi","popisUceni",
   "hlaskaKolo","kapObsah","patickaKap","popisKapitol","napovedaKap"].forEach(function (id) {
    el[id] = document.getElementById(id);
  });
  el.app = document.getElementById("app");
  el.dalsi = document.getElementById("btnDalsi");
  el.zpetZk = document.getElementById("btnZpetZk");
  el.kapDalsi = document.getElementById("btnKapDalsi");

  // ---------------------------------------------------------- úložiště

  function nactiUlozene() {
    try {
      var raw = localStorage.getItem(ULOZISTE);
      if (!raw) return {};
      var d = JSON.parse(raw);
      return (d && d.statistika) || {};
    } catch (e) { ulozeniFunguje = false; return {}; }
  }

  function ulozUlozene() {
    try {
      localStorage.setItem(ULOZISTE, JSON.stringify({
        verze: 2, ulozeno: Date.now(), statistika: statistika
      }));
      ulozeniFunguje = true;
    } catch (e) { ulozeniFunguje = false; }
  }

  // ---------------------------------------------------------- načtení

  var reId = /^\[([A-Za-z]+\d+)\]\s*(.*)$/;

  function rozeber(text) {
    var otazky = [], jmena = {}, akt = null;
    var radky = String(text).split(/\r?\n/);

    for (var i = 0; i < radky.length; i++) {
      var radek = radky[i].trim();
      if (!radek || radek.charAt(0) === "#") continue;

      var znacka = radek.charAt(0);
      var obsah = radek.slice(1).trim();

      if (znacka === "@") {
        var d = obsah.indexOf("=");
        if (d > 0) jmena[obsah.slice(0, d).trim().toUpperCase()] = obsah.slice(d + 1).trim();
      } else if (znacka === "?") {
        var id = null, sekce = "—", m = reId.exec(obsah);
        if (m) {
          id = m[1].toUpperCase();
          sekce = id.replace(/\d+$/, "");
          obsah = m[2];
        }
        akt = { id: id, sekce: sekce, otazka: obsah, spravna: null,
                odkaz: "", spatne: [] };
        otazky.push(akt);
      } else if (znacka === "+" && akt) {
        if (akt.spravna === null) akt.spravna = obsah;
      } else if (znacka === ">" && akt) {
        akt.odkaz = akt.odkaz ? akt.odkaz + " " + obsah : obsah;
      } else if (znacka === "-" && akt) {
        var sporny = obsah.charAt(0) === "!";
        akt.spatne.push({ text: sporny ? obsah.slice(1).trim() : obsah, sporny: sporny });
      }
    }

    return {
      otazky: otazky.filter(function (o) {
        return o.otazka && o.spravna && o.spatne.length >= 1;
      }),
      nazvy: jmena
    };
  }

  function slozText(sada) {
    var out = [];
    Object.keys(nazvy).sort().forEach(function (k) {
      out.push("@ " + k + " = " + nazvy[k]);
    });
    if (out.length) out.push("");
    sada.forEach(function (o) {
      out.push("? " + (o.id ? "[" + o.id + "] " : "") + o.otazka);
      out.push("+ " + o.spravna);
      if (o.odkaz) out.push("> " + o.odkaz);
      o.spatne.forEach(function (s) { out.push((s.sporny ? "-! " : "- ") + s.text); });
      out.push("");
    });
    return out.join("\n").trim();
  }

  // ---------------------------------------------------------- okruhy

  function okruhy() {
    var poradi = [], pocty = {};
    vsechny.forEach(function (o) {
      if (!(o.sekce in pocty)) { pocty[o.sekce] = 0; poradi.push(o.sekce); }
      pocty[o.sekce]++;
    });
    poradi.sort();
    return poradi.map(function (s) { return { sekce: s, pocet: pocty[s] }; });
  }

  function prepocitejAktivni() {
    aktivni = vsechny.filter(function (o) { return vybrane[o.sekce]; });
    predchozi = null;
    sestavFrontu();
    if (rezim === "uceni") sestavUcSeznam(aktualni);
    if (rezim === "kapitoly" && !kapBeh) vykresliKapitoly();
    var vsechnyOkruhy = okruhy();
    var kolik = vsechnyOkruhy.filter(function (k) { return vybrane[k.sekce]; }).length;
    document.getElementById("btnNabidka")
      .classList.toggle("filtr", kolik < vsechnyOkruhy.length);
  }

  function vykresliOkruhy() {
    var sez = okruhy();
    var zv = prehled().mapa;
    el.seznamOkruhu.textContent = "";
    vykresliOdpocet();

    sez.forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "okruh";
      b.setAttribute("aria-pressed", vybrane[k.sekce] ? "true" : "false");

      var z = document.createElement("span");
      z.className = "znacka";
      z.textContent = "\u2713";

      var j = document.createElement("span");
      j.className = "jmeno";
      j.textContent = "Okruh " + k.sekce;
      if (nazvy[k.sekce]) {
        var s = document.createElement("small");
        s.textContent = nazvy[k.sekce];
        j.appendChild(s);
      }
      var kz = zv[k.sekce];
      if (kz) {
        var mini = document.createElement("span");
        mini.className = "mini";
        var vypl = document.createElement("i");
        vypl.style.width = (100 * kz.nad3 / kz.celkem).toFixed(1) + "%";
        vypl.style.background = barvaZvladnuti(kz) || "var(--linka)";
        mini.appendChild(vypl);
        j.appendChild(mini);
        b.title = kz.nad3 + " z " + kz.celkem + " otázek na úrovni 3 a výš";
      }

      var p = document.createElement("span");
      p.className = "pocet";
      p.textContent = k.pocet;

      b.appendChild(z); b.appendChild(j); b.appendChild(p);
      b.addEventListener("click", function () {
        vybrane[k.sekce] = !vybrane[k.sekce];
        b.setAttribute("aria-pressed", vybrane[k.sekce] ? "true" : "false");
        prepocitejAktivni();
        vykresliSouhrn();
      });
      el.seznamOkruhu.appendChild(b);
    });

    vykresliSouhrn();
  }

  function vykresliSouhrn() {
    var sez = okruhy();
    var vyb = sez.filter(function (k) { return vybrane[k.sekce]; });
    var otazek = vyb.reduce(function (a, k) { return a + k.pocet; }, 0);
    var nove = vsechny.filter(function (o) {
      return vybrane[o.sekce] && !videna(o);
    }).length;
    el.souhrn.textContent = "Vybráno " + vyb.length + " z " + sez.length
      + " okruhů, " + otazek + " otázek"
      + (nove ? ", z toho " + nove + " dosud nezkoušených." : ".");
  }

  // ---------------------------------------------------------- výběr otázky

  function klic(o) { return o.id || o.otazka; }

  // statZaznam se jmenuje takhle, aby se nepletl se zaznam() z historie sezení
  function statZaznam(o) {
    var k = klic(o), s = statistika[k];
    if (!s) s = statistika[k] = { ano: 0, ne: 0, kdy: 0, uroven: 0 };
    if (typeof s.uroven !== "number") {        // starší zálohy úroveň neznají
      s.uroven = Math.max(0, Math.min(INTERVALY.length - 1, (s.ano || 0) - (s.ne || 0)));
    }
    return s;
  }

  function videna(o) {
    var s = statistika[klic(o)];
    return !!(s && (s.ano || s.ne));
  }

  // poměr uplynulého času k intervalu úrovně; 1 a víc znamená splatnou otázku
  function urgence(o) {
    var s = statZaznam(o);
    var iv = INTERVALY[Math.min(s.uroven, INTERVALY.length - 1)] * DEN;
    return (Date.now() - (s.kdy || 0)) / iv;
  }

  function sestavFrontu() {
    var nove = [], drive = [];
    aktivni.forEach(function (o) {
      if (sezeni[klic(o)]) return;             // v tomto sezení už padla
      (videna(o) ? drive : nove).push(o);
    });

    zamichej(nove);
    drive = drive
      .map(function (o) {                      // drobný rozhoz, ať pořadí není mechanické
        return { o: o, u: urgence(o) * (0.9 + 0.2 * Math.random()) };
      })
      .sort(function (a, b) { return b.u - a.u; })
      .map(function (x) { return x.o; });

    fronta = nove.splice(0, NOVYCH_NA_ZACATKU);
    while (drive.length || nove.length) {
      for (var i = 0; i < NA_JEDNU_NOVOU && drive.length; i++) fronta.push(drive.shift());
      if (nove.length) fronta.push(nove.shift());
      if (!drive.length) { fronta = fronta.concat(nove); nove.length = 0; }
    }
  }

  function vyberOtazku() {
    if (!fronta.length) sestavFrontu();
    if (!fronta.length && aktivni.length) {    // celý fond projitý, začíná další kolo
      sezeni = {}; relaps = {}; kolo++; ohlasitKolo = true;
      sestavFrontu();
    }
    return fronta.shift() || null;
  }

  function zamichej(pole) {
    for (var i = pole.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pole[i]; pole[i] = pole[j]; pole[j] = t;
    }
    return pole;
  }

  function sestavMoznosti(o) {
    var spatne = zamichej(o.spatne.slice()).slice(0, 2);
    var vse = spatne.concat([{ text: o.spravna, sporny: false, spravna: true }]);
    return zamichej(vse);
  }

  // ---------------------------------------------------------- učící mód

  function cisloId(id) {
    var m = /(\d+)$/.exec(id || "");
    return m ? parseInt(m[1], 10) : 0;
  }

  function sestavUcSeznam(ponechat) {
    ucSeznam = aktivni.slice();
    if (poradiNahodne) {
      zamichej(ucSeznam);
    } else {
      ucSeznam.sort(function (a, b) {
        if (a.sekce !== b.sekce) return a.sekce < b.sekce ? -1 : 1;
        return cisloId(a.id) - cisloId(b.id);
      });
    }
    var i = ponechat ? ucSeznam.indexOf(ponechat) : -1;
    ucPozice = i >= 0 ? i : 0;
  }

  function vykresliUceni() {
    if (!ucSeznam.length) {
      prazdno(vsechny.length
        ? "Není vybraný žádný okruh. Vyber ho tlačítkem \u2261 vpravo nahoře."
        : "Zatím tu nejsou žádné otázky. Vlož je tlačítkem \u2261 vpravo nahoře.");
      return;
    }
    if (ucPozice < 0) ucPozice = ucSeznam.length - 1;
    if (ucPozice >= ucSeznam.length) ucPozice = 0;

    var o = ucSeznam[ucPozice];
    aktualni = o;

    el.idcko.textContent = o.id || "";
    el.otazka.textContent = o.otazka;
    el.skore.innerHTML = "<b>" + (ucPozice + 1) + "</b> / " + ucSeznam.length;
    el.rysky.textContent = "";

    el.odpovedi.textContent = "";
    var b = document.createElement("div");
    b.className = "odpoved uceni";
    var p = document.createElement("span");
    p.className = "pismeno";
    p.textContent = "\u2713";
    var t = document.createElement("span");
    t.className = "text";
    t.textContent = o.spravna;
    b.appendChild(p); b.appendChild(t);
    el.odpovedi.appendChild(b);

    el.odkazPredpis.textContent = o.odkaz || "";
    el.odkazPredpis.classList.toggle("skryte", !o.odkaz);
    el.sporne.classList.add("skryte");
    window.scrollTo(0, 0);
  }

  function posunUceni(o) {
    ucPozice += o;
    vykresliUceni();
  }

  function nastavRezim(novy) {
    rezim = novy;
    var uceni = rezim === "uceni", kapitoly = rezim === "kapitoly";
    el.patickaZk.classList.toggle("skryte", uceni || kapitoly);
    el.patickaUc.classList.toggle("skryte", !uceni);
    el.patickaKap.classList.toggle("skryte", !kapitoly);
    el.prepinacPoradi.classList.toggle("skryte", !uceni);
    el.popisUceni.classList.toggle("skryte", !uceni);
    el.popisKapitol.classList.toggle("skryte", !kapitoly);
    el.app.classList.remove("zodpovezeno");
    el.app.classList.toggle("rezim-kapitoly", kapitoly);
    el.app.classList.remove("kap-prehled");
    if (uceni) {
      sestavUcSeznam(null);        // vstup do učení začíná od první otázky
      vykresliUceni();
    } else if (kapitoly) {
      kapBeh = null;
      vykresliKapitoly();
    } else {
      predchozi = null;
      vykresliRysky();
      dalsiOtazka();
    }
  }

  function oznacPrepinac(prvek, atribut, hodnota) {
    Array.prototype.forEach.call(prvek.children, function (b) {
      b.classList.toggle("akt", b.getAttribute(atribut) === hodnota);
    });
  }

  // ---------------------------------------------------------- kapitoly
  //
  // Kapitola je nejvýš deset po sobě jdoucích otázek jednoho okruhu v pořadí
  // podle ID, takže příbuzné otázky jdou za sebou. Odpovídá se hned jako ve
  // zkoušecím módu a po každé odpovědi je vidět správné znění i předpis.
  // Odpovědi se počítají jen do hry (XP, série, denní cíl, odznaky), statistiky
  // ani Leitnerovy úrovně se nemění, takže plánovač o kapitolách neví.
  // Hvězdičky za nejlepší průchod kapitolou leží pod vlastním klíčem.

  var KAP_ULOZISTE = "zkousec-mik-kapitoly-v1";
  var KAP_VELIKOST = 10;
  var kapHvezdy = {};       // klíč kapitoly -> { hvezdy, nejlepsi, pocet, pokusu, kdy }
  var kapBeh = null;        // rozehraná kapitola: { k: kapitola, zaznamy: [], pozice: index }

  function nactiKapitoly() {
    try {
      var raw = localStorage.getItem(KAP_ULOZISTE);
      var d = raw ? JSON.parse(raw) : null;
      return (d && d.kapitoly && typeof d.kapitoly === "object") ? d.kapitoly : {};
    } catch (e) { return {}; }
  }

  function ulozKapitoly() {
    try {
      localStorage.setItem(KAP_ULOZISTE, JSON.stringify({ verze: 1, kapitoly: kapHvezdy }));
    } catch (e) { /* nevadí */ }
  }

  // sloučení ze zálohy maximem, aby opakovaný import nic nenafukoval
  function slucKapitoly(cizi) {
    Object.keys(cizi).forEach(function (k) {
      var b = cizi[k] || {};
      var a = kapHvezdy[k] || (kapHvezdy[k] = { hvezdy: 0, nejlepsi: 0, pocet: 0, pokusu: 0, kdy: 0 });
      ["hvezdy", "nejlepsi", "pocet", "pokusu", "kdy"].forEach(function (p) {
        a[p] = Math.max(+a[p] || 0, +b[p] || 0);
      });
    });
  }

  // okruh rozdělím na kapitoly co nejpodobnější velikosti (97 otázek = 7×10 + 3×9)
  function kapitolyOkruhu(sekce) {
    var ot = vsechny
      .filter(function (o) { return o.sekce === sekce; })
      .sort(function (a, b) { return cisloId(a.id) - cisloId(b.id); });
    var n = ot.length, pocet = Math.ceil(n / KAP_VELIKOST), vysl = [], od = 0;
    for (var i = 0; i < pocet; i++) {
      var velikost = Math.floor(n / pocet) + (i < n % pocet ? 1 : 0);
      var cast = ot.slice(od, od + velikost);
      od += velikost;
      var prvni = cast[0].id, posledni = cast[cast.length - 1].id;
      var rozsah = prvni && posledni
        ? (prvni === posledni ? prvni : prvni + "–" + posledni) : "";
      vysl.push({ sekce: sekce, cislo: i + 1, otazky: cast, rozsah: rozsah,
                  klic: rozsah || sekce + "#" + (i + 1) });
    }
    return vysl;
  }

  function vybraneKapitoly() {
    return okruhy()
      .filter(function (k) { return vybrane[k.sekce]; })
      .map(function (k) { return { sekce: k.sekce, kapitoly: kapitolyOkruhu(k.sekce) }; });
  }

  function hvezdyZa(spravne, pocet) {
    var p = pocet ? spravne / pocet : 0;
    return p >= 0.9 ? 3 : p >= 0.7 ? 2 : p >= 0.5 ? 1 : 0;
  }

  function hvezdyText(h) {
    return "★★★".slice(0, h) + "☆☆☆".slice(h);
  }

  function nazevKapitoly(k) { return "Kapitola " + k.sekce + " " + k.cislo; }

  // kam pokračovat: první neotevřená kapitola, jinak první bez tří hvězd
  function doporucenaKapitola(ploche) {
    var i;
    for (i = 0; i < ploche.length; i++) if (!kapHvezdy[ploche[i].klic]) return ploche[i];
    for (i = 0; i < ploche.length; i++) if (kapHvezdy[ploche[i].klic].hvezdy < 3) return ploche[i];
    return null;
  }

  function tlacitkoKap(text, hlavni, akce) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (hlavni) b.className = "hlavni";
    b.addEventListener("click", akce);
    return b;
  }

  function prehledKapitol() {
    kapBeh = null;
    aktualni = null;
    el.app.classList.add("kap-prehled");
    el.app.classList.remove("zodpovezeno");
    el.rysky.textContent = "";
    el.kapObsah.textContent = "";
    window.scrollTo(0, 0);
  }

  function vykresliKapitoly() {
    prehledKapitol();
    var skupiny = vybraneKapitoly();
    var ploche = [];
    skupiny.forEach(function (s) { ploche = ploche.concat(s.kapitoly); });

    var ziskano = 0;
    ploche.forEach(function (k) { ziskano += (kapHvezdy[k.klic] || {}).hvezdy || 0; });
    el.skore.innerHTML = "★ <b>" + ziskano + "</b> / " + 3 * ploche.length;

    var uvod = document.createElement("p");
    uvod.className = "kap-uvod";
    if (!ploche.length) {
      uvod.textContent = vsechny.length
        ? "Není vybraný žádný okruh. Vyber ho tlačítkem ≡ vpravo nahoře."
        : "Zatím tu nejsou žádné otázky.";
      el.kapObsah.appendChild(uvod);
      return;
    }
    uvod.textContent = "Odpovídej hned, i když si nejsi jistý. Po každé odpovědi uvidíš "
      + "správné znění a paragraf. Tři hvězdy za 90 % správně, dvě za 70 %, jedna za 50 %.";
    el.kapObsah.appendChild(uvod);

    var doporucena = doporucenaKapitola(ploche);
    if (doporucena) {
      var dal = document.createElement("button");
      dal.type = "button";
      dal.className = "kap-pokracovat";
      dal.textContent = (kapHvezdy[doporucena.klic] ? "Dotáhnout: " : "Pokračovat: ")
        + nazevKapitoly(doporucena) + (doporucena.rozsah ? " · " + doporucena.rozsah : "");
      dal.addEventListener("click", function () { spustKapitolu(doporucena); });
      el.kapObsah.appendChild(dal);
    }

    skupiny.forEach(function (s) {
      var blok = document.createElement("div");
      blok.className = "kap-okruh";

      var hl = document.createElement("div");
      hl.className = "kap-hlavicka";
      var jm = document.createElement("span");
      jm.className = "kdo";
      jm.textContent = "Okruh " + s.sekce;
      if (nazvy[s.sekce]) {
        var sm = document.createElement("small");
        sm.textContent = nazvy[s.sekce];
        jm.appendChild(sm);
      }
      var hv = 0;
      s.kapitoly.forEach(function (k) { hv += (kapHvezdy[k.klic] || {}).hvezdy || 0; });
      var ci = document.createElement("span");
      ci.className = "cislo";
      ci.textContent = "★ " + hv + " / " + 3 * s.kapitoly.length;
      hl.appendChild(jm); hl.appendChild(ci);
      blok.appendChild(hl);

      var mriz = document.createElement("div");
      mriz.className = "kap-mriz";
      s.kapitoly.forEach(function (k) {
        var z = kapHvezdy[k.klic];
        var t = document.createElement("button");
        t.type = "button";
        t.className = "kap-dlazdice";
        if (z) t.classList.add("zacato");
        if (z && z.hvezdy === 3) t.classList.add("tri");
        if (k === doporucena) t.classList.add("doporucena");
        var c = document.createElement("b");
        c.textContent = k.cislo;
        var h = document.createElement("span");
        h.className = "hv";
        h.textContent = hvezdyText(z ? z.hvezdy : 0);
        var r = document.createElement("small");
        r.textContent = k.rozsah;
        t.appendChild(c); t.appendChild(h); t.appendChild(r);
        t.title = nazevKapitoly(k) + ", " + k.otazky.length + " otázek"
          + (z ? ", nejlépe " + z.nejlepsi + " správně" : "");
        t.addEventListener("click", function () { spustKapitolu(k); });
        mriz.appendChild(t);
      });
      blok.appendChild(mriz);
      el.kapObsah.appendChild(blok);
    });
  }

  function spustKapitolu(k) {
    kapBeh = {
      k: k,
      pozice: 0,
      zaznamy: k.otazky.map(function (o) {
        var m = sestavMoznosti(o);
        return { o: o, moznosti: m, spravnaPoz: m.findIndex(function (x) { return x.spravna; }),
                 vybrano: null };
      })
    };
    vykresliKapOtazku(true);
  }

  function vykresliKapOtazku(posunout) {
    var b = kapBeh, z = b.zaznamy[b.pozice], hotovo = z.vybrano !== null;
    aktualni = z.o;
    el.app.classList.remove("kap-prehled");
    el.app.classList.toggle("zodpovezeno", hotovo);

    el.idcko.textContent = z.o.id || "";
    var zn = document.createElement("span");
    zn.className = "prohlizeni";
    zn.textContent = (z.o.id ? "  ·  " : "") + "kapitola " + b.k.sekce + " " + b.k.cislo;
    el.idcko.appendChild(zn);

    el.otazka.textContent = z.o.otazka;
    el.odpovedi.textContent = "";
    z.moznosti.forEach(function (m, i) {
      var t = document.createElement("button");
      t.className = "odpoved";
      t.type = "button";
      if (hotovo) {
        if (i === z.vybrano) t.classList.add(i === z.spravnaPoz ? "vybrana-ano" : "vybrana-ne");
        else if (i === z.spravnaPoz) t.classList.add("ukazana");
      }
      var p = document.createElement("span");
      p.className = "pismeno";
      p.textContent = "abc".charAt(i);
      var x = document.createElement("span");
      x.className = "text";
      x.textContent = m.text;
      t.appendChild(p); t.appendChild(x);
      t.addEventListener("click", function () { odpovezKap(i); });
      el.odpovedi.appendChild(t);
    });

    var sporna = [];
    if (hotovo) {
      z.moznosti.forEach(function (m, i) { if (m.sporny) sporna.push("abc".charAt(i)); });
    }
    if (sporna.length) {
      el.sporne.textContent = "Možnost " + sporna.join(" a ")
        + " jsem si nebyl jistý — ověř si ji v předpisu, než se ji naučíš jako špatnou.";
    }
    el.sporne.classList.toggle("skryte", !sporna.length);
    el.odkazPredpis.textContent = hotovo ? (z.o.odkaz || "") : "";
    el.odkazPredpis.classList.toggle("skryte", !(hotovo && z.o.odkaz));

    // rysky ukazují průběh kapitoly, šedé jsou otázky, které teprve přijdou
    el.rysky.textContent = "";
    var ok = 0;
    b.zaznamy.forEach(function (zz) {
      var d = document.createElement("div");
      d.className = "ryska";
      if (zz.vybrano !== null) {
        var t = zz.vybrano === zz.spravnaPoz;
        if (t) ok++;
        d.classList.add(t ? "ano" : "ne");
      }
      el.rysky.appendChild(d);
    });
    el.skore.innerHTML = "<b>" + (b.pozice + 1) + "</b> / " + b.zaznamy.length
      + "<span class=\"zbyva\"> · správně " + ok + "</span>";

    el.kapDalsi.classList.toggle("skryte", !hotovo);
    el.napovedaKap.classList.toggle("skryte", hotovo);
    el.kapDalsi.textContent = b.pozice < b.zaznamy.length - 1 ? "Další otázka" : "Výsledek kapitoly";

    if (posunout) window.scrollTo(0, 0);
  }

  function odpovezKap(index) {
    if (!kapBeh) return;
    var z = kapBeh.zaznamy[kapBeh.pozice];
    if (z.vybrano !== null) return;
    z.vybrano = index;
    var trefa = index === z.spravnaPoz;
    vykresliKapOtazku(false);
    el.kapDalsi.focus({ preventScroll: true });

    // jen do hry; úroveň otázky se jen čte, statistika zůstává netknutá
    var s = statistika[klic(z.o)];
    var u = urovenOtazky(z.o);
    hraPoOdpovedi({
      trefa: trefa, urovenPred: u, urovenPo: u, neCelkem: s ? s.ne || 0 : 0,
      znovu: false, tlacitko: el.odpovedi.children[index]
    });
  }

  function kapitolaDal() {
    if (!kapBeh) return;
    if (kapBeh.zaznamy[kapBeh.pozice].vybrano === null) return;
    if (kapBeh.pozice < kapBeh.zaznamy.length - 1) {
      kapBeh.pozice++;
      vykresliKapOtazku(true);
    } else {
      dokonciKapitolu();
    }
  }

  function dokonciKapitolu() {
    var b = kapBeh, k = b.k, n = b.zaznamy.length;
    var chyby = b.zaznamy.filter(function (z) { return z.vybrano !== z.spravnaPoz; });
    var spravne = n - chyby.length, h = hvezdyZa(spravne, n);

    var pred = kapHvezdy[k.klic];
    var predHvezdy = pred ? pred.hvezdy : 0;
    var zapis = pred || { hvezdy: 0, nejlepsi: 0, pocet: n, pokusu: 0, kdy: 0 };
    zapis.hvezdy = Math.max(zapis.hvezdy, h);
    zapis.nejlepsi = Math.max(zapis.nejlepsi, spravne);
    zapis.pocet = n;
    zapis.pokusu++;
    zapis.kdy = Date.now();
    kapHvezdy[k.klic] = zapis;
    ulozKapitoly();

    prehledKapitol();
    el.skore.innerHTML = "<b>" + spravne + "</b> / " + n;

    var hl = document.createElement("div");
    hl.className = "kap-vysledek";
    var nad = document.createElement("h2");
    nad.textContent = nazevKapitoly(k);
    var roz = document.createElement("small");
    roz.textContent = k.rozsah + (nazvy[k.sekce] ? " · " + nazvy[k.sekce] : "");
    nad.appendChild(roz);
    var hv = document.createElement("div");
    hv.className = "kap-hvezdy";
    for (var i = 0; i < 3; i++) {
      var s = document.createElement("span");
      s.textContent = i < h ? "★" : "☆";
      if (i < h) s.className = "sviti";
      hv.appendChild(s);
    }
    var sk = document.createElement("div");
    sk.className = "kap-skore";
    sk.innerHTML = "<b>" + spravne + "</b> z " + n + " správně";
    var poz = document.createElement("p");
    var natri = Math.ceil(0.9 * n - 1e-9);
    poz.textContent = h === 3
      ? (predHvezdy < 3 ? "Kapitola je na tři hvězdy." : "Pořád na tři hvězdy. Drží to.")
      : (h > predHvezdy && pred ? "Zlepšení oproti minule. " : "")
        + "Na tři hvězdy potřebuješ aspoň " + natri + " z " + n + " správně."
        + (pred && predHvezdy > h ? " Nejlepší výsledek zůstává " + hvezdyText(predHvezdy) + "." : "");
    hl.appendChild(nad); hl.appendChild(hv); hl.appendChild(sk); hl.appendChild(poz);
    el.kapObsah.appendChild(hl);

    if (chyby.length) {
      var sez = document.createElement("div");
      sez.className = "seznam kap-chyby";
      var t = document.createElement("div");
      t.className = "radek";
      t.innerHTML = "<span class=\"kdo\"><b>Kde to ujelo</b></span>";
      sez.appendChild(t);
      chyby.forEach(function (z) {
        var r = document.createElement("div");
        r.className = "radek";
        var kdo = document.createElement("span");
        kdo.className = "kdo";
        var id = document.createElement("b");
        id.textContent = (z.o.id ? z.o.id + "  " : "");
        kdo.appendChild(id);
        kdo.appendChild(document.createTextNode(z.o.otazka));
        var spr = document.createElement("small");
        spr.className = "kap-spravna";
        spr.textContent = "✓ " + z.o.spravna;
        kdo.appendChild(spr);
        r.appendChild(kdo);
        sez.appendChild(r);
      });
      el.kapObsah.appendChild(sez);
    }

    var ploche = [];
    vybraneKapitoly().forEach(function (s) { ploche = ploche.concat(s.kapitoly); });
    var idx = -1;
    ploche.forEach(function (x, i) { if (x.klic === k.klic) idx = i; });
    var dalsi = idx >= 0 ? ploche[idx + 1] : null;

    var tl = document.createElement("div");
    tl.className = "tlacitka";
    tl.appendChild(tlacitkoKap("Zopakovat", !dalsi || h < 2, function () { spustKapitolu(k); }));
    if (dalsi) {
      tl.appendChild(tlacitkoKap("Další kapitola", h >= 2, function () { spustKapitolu(dalsi); }));
    }
    el.kapObsah.appendChild(tl);
    var od = document.createElement("div");
    od.className = "odkaz";
    od.appendChild(tlacitkoKap("Všechny kapitoly", false, vykresliKapitoly));
    el.kapObsah.appendChild(od);

    if (h === 3) { zvuk("fanfara"); konfetyVelke(); vibruj([40, 60, 40, 60, 120]); }
    else if (h > predHvezdy) zvuk("milnik");
  }

  // ---------------------------------------------------------- vykreslení

  function vykresliRysky() {
    if (rezim !== "zkouseni") return;
    var vzorek = prubeh.slice(-MAX_RYSEK);
    el.rysky.textContent = "";
    for (var i = 0; i < vzorek.length; i++) {
      var d = document.createElement("div");
      d.className = "ryska " + (vzorek[i] ? "ano" : "ne");
      el.rysky.appendChild(d);
    }
    el.skore.innerHTML = "<b>" + spravne + "</b> / " + celkem
      + "<span class=\"zbyva\"> \u00b7 v kole " + fronta.length + "</span>";
  }

  function prazdno(zprava) {
    el.idcko.textContent = "";
    el.otazka.textContent = zprava;
    el.odpovedi.textContent = "";
    el.sporne.classList.add("skryte");
    el.odkazPredpis.classList.add("skryte");
    el.dalsi.classList.add("skryte");
    el.zpetZk.classList.add("skryte");
    el.napoveda.classList.remove("skryte");
    el.napoveda.textContent = "";
    aktualni = null;
  }

  function zaznam() { return pozice >= 0 ? historie[pozice] : null; }

  function naKonci() { return pozice >= historie.length - 1; }

  function dalsiOtazka() {
    if (!vsechny.length) { prazdno("Zatím tu nejsou žádné otázky. Vlož je tlačítkem ≡ vpravo nahoře."); return; }
    if (!aktivni.length) { prazdno("Není vybraný žádný okruh. Vyber ho tlačítkem ≡ vpravo nahoře."); return; }

    var o = vyberOtazku();
    if (!o) { prazdno("Není vybraný žádný okruh. Vyber ho tlačítkem \u2261 vpravo nahoře."); return; }
    predchozi = o;
    var kO = klic(o);

    var m = sestavMoznosti(o);
    historie.push({
      o: o,
      moznosti: m,
      spravnaPoz: m.findIndex(function (x) { return x.spravna; }),
      vybrano: null,
      znamka: !videna(o) ? "nová"
              : (relaps[kO] && sezeni[kO] ? "znovu" : ""),
      kolo: ohlasitKolo
        ? "Prošel jsi všechny vybrané otázky. Začíná " + kolo
          + ". kolo, pořadí se přepočítalo podle toho, co ti dělá potíže."
        : ""
    });
    ohlasitKolo = false;
    while (historie.length > MAX_HISTORIE) historie.shift();

    pozice = historie.length - 1;
    vykresliRysky();
    vykresliZaznam();
  }

  function vykresliZaznam() {
    var z = zaznam();
    if (!z) return;

    aktualni = z.o;
    var hotovo = z.vybrano !== null;
    var zive = naKonci();

    el.app.classList.toggle("zodpovezeno", hotovo);

    el.hlaskaKolo.textContent = z.kolo || "";
    el.hlaskaKolo.classList.toggle("skryte", !z.kolo);

    el.idcko.textContent = z.o.id || "";
    if (z.znamka) {
      var zn = document.createElement("span");
      zn.className = "znamka";
      zn.textContent = z.znamka;
      el.idcko.appendChild(zn);
    }
    if (!zive) {
      var znacka = document.createElement("span");
      znacka.className = "prohlizeni";
      znacka.textContent = (z.o.id ? "  ·  " : "")
        + "prohlížení " + (pozice + 1) + " z " + historie.length;
      el.idcko.appendChild(znacka);
    }

    el.otazka.textContent = z.o.otazka;
    el.odpovedi.textContent = "";

    z.moznosti.forEach(function (m, i) {
      var b = document.createElement("button");
      b.className = "odpoved";
      b.type = "button";

      if (hotovo) {
        if (i === z.vybrano) {
          b.classList.add(z.vybrano === z.spravnaPoz ? "vybrana-ano" : "vybrana-ne");
        } else if (i === z.spravnaPoz) {
          b.classList.add("ukazana");
        }
      }

      var p = document.createElement("span");
      p.className = "pismeno";
      p.textContent = "abc".charAt(i);

      var t = document.createElement("span");
      t.className = "text";
      t.textContent = m.text;

      b.appendChild(p); b.appendChild(t);
      b.addEventListener("click", function () { odpovez(i); });
      el.odpovedi.appendChild(b);
    });

    var sporna = [];
    if (hotovo) {
      z.moznosti.forEach(function (m, i) {
        if (m.sporny) sporna.push("abc".charAt(i));
      });
    }
    if (sporna.length) {
      el.sporne.textContent = "Možnost " + sporna.join(" a ")
        + " jsem si nebyl jistý — ověř si ji v předpisu, než se ji naučíš jako špatnou.";
    }
    el.sporne.classList.toggle("skryte", !sporna.length);

    el.odkazPredpis.textContent = hotovo ? (z.o.odkaz || "") : "";
    el.odkazPredpis.classList.toggle("skryte", !(hotovo && z.o.odkaz));

    vykresliPatickuZk();
    window.scrollTo(0, 0);
  }

  function vykresliPatickuZk() {
    var z = zaznam();
    var hotovo = z && z.vybrano !== null;

    el.zpetZk.classList.remove("skryte");
    el.zpetZk.disabled = pozice <= 0;

    if (!naKonci()) {
      el.dalsi.textContent = "Vpřed";
      el.dalsi.classList.remove("skryte");
      el.napoveda.classList.add("skryte");
    } else if (hotovo) {
      el.dalsi.textContent = "Další otázka";
      el.dalsi.classList.remove("skryte");
      el.napoveda.classList.add("skryte");
    } else {
      el.dalsi.classList.add("skryte");
      el.napoveda.classList.remove("skryte");
      el.napoveda.textContent = "Vyber jednu z možností";
    }
  }

  function vpred() {
    if (!naKonci()) { pozice++; vykresliZaznam(); return; }
    var z = zaznam();
    if (z && z.vybrano !== null) dalsiOtazka();
  }

  function zpetVHistorii() {
    if (pozice > 0) { pozice--; vykresliZaznam(); }
  }

  function odpovez(index) {
    var z = zaznam();
    if (!z || !naKonci() || z.vybrano !== null) return;   // zpětně se neodpovídá
    z.vybrano = index;
    el.app.classList.add("zodpovezeno");

    var trefa = index === z.spravnaPoz;
    celkem++;
    if (trefa) spravne++;
    prubeh.push(trefa);

    var k = klic(z.o);
    var s = statZaznam(z.o);
    var urovenPred = s.uroven;
    if (trefa) {
      s.ano++;
      s.uroven = Math.min(INTERVALY.length - 1, s.uroven + 1);
    } else {
      s.ne++;
      s.uroven = 0;
    }
    s.kdy = Date.now();
    sezeni[k] = true;
    ulozUlozene();

    // chybnou otázku vrátím ještě v tomto sezení, ale jen jednou a s odstupem
    if (!trefa && !relaps[k]) {
      relaps[k] = true;
      var kam = Math.min(fronta.length,
        RELAPS_ODSTUP - 2 + Math.floor(Math.random() * 5));
      fronta.splice(kam, 0, z.o);
    }

    var tlacitka = el.odpovedi.children;
    tlacitka[index].classList.add(trefa ? "vybrana-ano" : "vybrana-ne");
    if (!trefa) tlacitka[z.spravnaPoz].classList.add("ukazana");

    var sporna = [];
    z.moznosti.forEach(function (m, i) {
      if (m.sporny) sporna.push("abc".charAt(i));
    });
    if (sporna.length) {
      el.sporne.textContent = "Možnost " + sporna.join(" a ")
        + " jsem si nebyl jistý — ověř si ji v předpisu, než se ji naučíš jako špatnou.";
      el.sporne.classList.remove("skryte");
    }

    if (z.o.odkaz) {
      el.odkazPredpis.textContent = z.o.odkaz;
      el.odkazPredpis.classList.remove("skryte");
    }

    vykresliRysky();
    vykresliPatickuZk();
    el.dalsi.focus({ preventScroll: true });

    hraPoOdpovedi({
      trefa: trefa, urovenPred: urovenPred, urovenPo: s.uroven, neCelkem: s.ne,
      znovu: z.znamka === "znovu", tlacitko: tlacitka[index]
    });
  }

  // ---------------------------------------------------------- statistiky

  function radek(jmeno, podtitulek, cislo, slabe) {
    var d = document.createElement("div");
    d.className = "radek" + (slabe ? " slabe" : "");
    var k = document.createElement("span");
    k.className = "kdo";
    k.textContent = jmeno;
    if (podtitulek) {
      var m = document.createElement("small");
      m.textContent = podtitulek;
      k.appendChild(m);
    }
    var c = document.createElement("span");
    c.className = "cislo";
    c.innerHTML = cislo;
    d.appendChild(k); d.appendChild(c);
    return d;
  }

  function vykresliStatistiky() {
    vykresliHru();
    el.statSeznam.textContent = "";
    el.statHlaska.textContent = "";

    el.statPozn.classList.toggle("skryte", ulozeniFunguje);
    if (!ulozeniFunguje) {
      el.statPozn.textContent = "Prohlížeč tady neumožnil trvalé uložení, "
        + "statistika platí jen do zavření stránky. Ulož si zálohu do souboru.";
    }

    // souhrn počítám jen z otázek, které jsou právě načtené
    var celkemAno = 0, celkemNe = 0, dotcenych = 0;
    vsechny.forEach(function (o) {
      var st = statistika[klic(o)];
      if (st && (st.ano || st.ne)) {
        celkemAno += st.ano; celkemNe += st.ne; dotcenych++;
      }
    });
    var vsehoOdpovedi = celkemAno + celkemNe;

    var zname = {};
    vsechny.forEach(function (o) { zname[klic(o)] = true; });
    var cizich = Object.keys(statistika).filter(function (k) {
      return !zname[k] && (statistika[k].ano || statistika[k].ne);
    }).length;

    el.statSouhrn.textContent = vsehoOdpovedi
      ? vsehoOdpovedi + " odpovědí, úspěšnost "
        + Math.round(100 * celkemAno / vsehoOdpovedi) + " %. Projito "
        + dotcenych + " ze " + vsechny.length + " načtených otázek."
        + (cizich ? " Dalších " + cizich + " otázek mám uložených z jiné sady." : "")
      : (cizich
          ? "K načteným otázkám zatím nemám žádnou odpověď. Z jiné sady mám uloženo "
            + cizich + " otázek."
          : "Zatím žádná zodpovězená otázka.");

    if (!vsehoOdpovedi) return;

    // po okruzích
    var poOkruzich = {};
    vsechny.forEach(function (o) {
      var b = poOkruzich[o.sekce] || (poOkruzich[o.sekce] =
        { ano: 0, ne: 0, dotcenych: 0, celkem: 0, slabych: 0 });
      b.celkem++;
      var st = statistika[klic(o)];
      if (st && (st.ano || st.ne)) {
        b.dotcenych++; b.ano += st.ano; b.ne += st.ne;
        if (st.ne > st.ano) b.slabych++;
      }
    });

    Object.keys(poOkruzich).sort().forEach(function (sek) {
      var b = poOkruzich[sek];
      if (!b.ano && !b.ne) return;
      var pct = Math.round(100 * b.ano / (b.ano + b.ne));
      el.statSeznam.appendChild(radek(
        "Okruh " + sek,
        (nazvy[sek] || "") + " · projito " + b.dotcenych + " z " + b.celkem
          + (b.slabych ? ", k doučení " + b.slabych : ""),
        "<b>" + pct + " %</b>",
        pct < 70
      ));
    });

    // nejhorší otázky
    var nejhorsi = vsechny
      .map(function (o) { return { o: o, st: statistika[klic(o)] }; })
      .filter(function (x) { return x.st && x.st.ne > 0; })
      .sort(function (a, b) {
        return (b.st.ne - b.st.ano) - (a.st.ne - a.st.ano) || b.st.ne - a.st.ne;
      })
      .slice(0, 10);

    if (nejhorsi.length) {
      var nadpis = document.createElement("div");
      nadpis.className = "radek";
      nadpis.innerHTML = "<span class=\"kdo\"><b>Nejčastěji chybované</b></span>";
      el.statSeznam.appendChild(nadpis);

      nejhorsi.forEach(function (x) {
        var t = x.o.otazka;
        el.statSeznam.appendChild(radek(
          x.o.id || "—",
          t.length > 70 ? t.slice(0, 67) + "…" : t,
          "<b>" + x.st.ne + "</b>&thinsp;/&thinsp;" + (x.st.ano + x.st.ne),
          true
        ));
      });
    }
  }

  function exportujStatistiku() {
    try {
      var blob = new Blob(
        [JSON.stringify({ verze: 2, ulozeno: Date.now(), statistika: statistika, hra: hra,
                         kapitoly: kapHvezdy }, null, 1)],
        { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "zkousec-statistika.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      el.statHlaska.textContent = "";
    } catch (e) {
      el.statHlaska.textContent = "Zálohu se nepodařilo vytvořit.";
    }
  }

  function nactiZalohu(soubor) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result);
        var st = d && d.statistika;
        if (!st || typeof st !== "object") throw new Error("bez statistiky");
        var pridano = 0;
        Object.keys(st).forEach(function (k) {
          var c = statistika[k] || (statistika[k] = { ano: 0, ne: 0, kdy: 0, uroven: 0 });
          var novejsi = (st[k].kdy || 0) > (c.kdy || 0);
          c.ano += st[k].ano || 0;
          c.ne  += st[k].ne  || 0;
          if (novejsi && typeof st[k].uroven === "number") c.uroven = st[k].uroven;
          else if (typeof c.uroven !== "number") c.uroven = 0;
          c.kdy = Math.max(c.kdy || 0, st[k].kdy || 0);
          pridano++;
        });
        ulozUlozene();
        // hra: starší zálohy ji neobsahují, pak se body dopočtou ze statistik
        if (d.hra && typeof d.hra === "object") sloucHru(d.hra);
        else hra.xp = Math.max(hra.xp, semeno());
        zkontrolujOdznaky(kontext(), true);
        ulozHru();
        if (d.kapitoly && typeof d.kapitoly === "object") { slucKapitoly(d.kapitoly); ulozKapitoly(); }
        vykresliListu();
        vykresliStatistiky();
        el.statHlaska.textContent = "Přičteno " + pridano + " záznamů"
          + (d.hra ? ", sloučeny body a odznaky." : ".");
      } catch (e) {
        el.statHlaska.textContent = "Soubor se nepodařilo přečíst.";
      }
    };
    r.onerror = function () { el.statHlaska.textContent = "Soubor se nepodařilo přečíst."; };
    r.readAsText(soubor);
  }

  // ---------------------------------------------------------- panely

  function zobraz(panel) {
    el.panelOkruhy.classList.toggle("skryte", panel !== "okruhy");
    el.panelOtazky.classList.toggle("skryte", panel !== "otazky");
    el.panelStat.classList.toggle("skryte", panel !== "statistiky");
    el.panelPomodoro.classList.toggle("skryte", panel !== "pomodoro");
  }

  function panelOtevreny() {
    return !el.panelOkruhy.classList.contains("skryte")
        || !el.panelOtazky.classList.contains("skryte")
        || !el.panelStat.classList.contains("skryte")
        || !el.panelPomodoro.classList.contains("skryte");
  }

  function zavri() {
    zobraz(null);
    if (rezim === "uceni") {
      vykresliUceni();
    } else if (rezim === "kapitoly") {
      if (!kapBeh) vykresliKapitoly();
    } else if (!aktualni || aktivni.indexOf(aktualni) < 0) {
      dalsiOtazka();
    }
  }

  function nastavOtazky(vysledek) {
    vsechny = vysledek.otazky;
    nazvy = vysledek.nazvy;
    vybrane = {};
    okruhy().forEach(function (k) { vybrane[k.sekce] = true; });
    prepocitejAktivni();
    vykresliOkruhy();
  }

  function nactiZPanelu() {
    var v = rozeber(el.vstup.value);
    if (!v.otazky.length) {
      el.hlaska.textContent = "Nenašel jsem žádnou použitelnou otázku. "
        + "Každá potřebuje řádek ?, řádek + a aspoň jeden řádek -.";
      return;
    }
    nastavOtazky(v);
    prubeh = []; spravne = celkem = 0;
    historie = []; pozice = -1;
    sezeni = {}; relaps = {}; kolo = 1; sestavFrontu();
    zobraz(null);
    vykresliRysky();
    if (rezim === "uceni") { sestavUcSeznam(null); vykresliUceni(); }
    else if (rezim === "kapitoly") { kapBeh = null; vykresliKapitoly(); }
    else dalsiOtazka();
  }

  // ---------------------------------------------------------- gamifikace
  //
  // Hra jen poslouchá výsledky živých odpovědí ve zkoušecím módu. Plánovač,
  // historie ani statistiky na ní nijak nezávisí. Data hry leží pod vlastním
  // klíčem, schéma statistik (verze 2) zůstává beze změny.

  var HRA_ULOZISTE = "zkousec-mik-hra-v1";
  var OBVOD_KRUHU = 87.96;                     // 2·π·14 pro kroužek denního cíle

  var UROVNE = [
    { xp: 0,     jmeno: "Praktikant",              ikona: "🎒" },
    { xp: 250,   jmeno: "Pomocný dělník",          ikona: "⛏️" },
    { xp: 600,   jmeno: "Zedník",                  ikona: "🧱" },
    { xp: 1100,  jmeno: "Tesař",                   ikona: "🪚" },
    { xp: 1800,  jmeno: "Železář",                 ikona: "🔩" },
    { xp: 2700,  jmeno: "Montér",                  ikona: "🔧" },
    { xp: 3900,  jmeno: "Mistr",                   ikona: "🦺" },
    { xp: 5500,  jmeno: "Stavbyvedoucí",           ikona: "📋" },
    { xp: 7600,  jmeno: "Projektant",              ikona: "📐" },
    { xp: 10400, jmeno: "Statik",                  ikona: "🧮" },
    { xp: 14000, jmeno: "Hlavní inženýr projektu", ikona: "🌉" },
    { xp: 19000, jmeno: "Autorizovaný inženýr",    ikona: "🏅" }
  ];
  var PRESTIZ = 5000;                          // nad nejvyšší úrovní hvězda za každých 5000 XP
  var MILNIKY_SERIE = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
  var POCHVALY = [
    "Jedeš jako po kolejích.",
    "Nosná konstrukce drží.",
    "Únosnost prokázána.",
    "Paragrafy se tě začínají bát.",
    "Bez jediné trhliny.",
    "Tohle by komise podepsala bez připomínek.",
    "Mezní stav použitelnosti v pohodě splněn."
  ];

  var ODZNAKY = [
    { id: "prvni",   ikona: "👣", jmeno: "První krok",          popis: "První odpověď",
      test: function (c) { return c.z.odpovedi >= 1; } },
    { id: "serie5",  ikona: "🔥", jmeno: "Rozjezd",             popis: "5 správně v řadě",
      test: function (c) { return c.nejSerie >= 5; } },
    { id: "serie10", ikona: "🔥", jmeno: "V ráži",              popis: "10 správně v řadě",
      test: function (c) { return c.nejSerie >= 10; } },
    { id: "serie20", ikona: "💥", jmeno: "Neomylný",            popis: "20 správně v řadě",
      test: function (c) { return c.nejSerie >= 20; } },
    { id: "serie50", ikona: "🤖", jmeno: "Stroj na paragrafy",  popis: "50 správně v řadě",
      test: function (c) { return c.nejSerie >= 50; } },
    { id: "nemesis", ikona: "⚔️", jmeno: "Nemesis poražena",    popis: "Dřív pokažená otázka 3× správně po sobě",
      test: function (c) { return c.nemesis; } },
    { id: "oprava",  ikona: "🩹", jmeno: "Poučen z chyb",       popis: "10× správně otázka vrácená po chybě",
      test: function (c) { return c.opravy >= 10; } },
    { id: "cil",     ikona: "🎯", jmeno: "Splněno",             popis: "Poprvé splněný denní cíl",
      test: function (c) { return c.dnySerie >= 1; } },
    { id: "tyden",   ikona: "📅", jmeno: "Týden v kuse",        popis: "Denní cíl 7 dní po sobě",
      test: function (c) { return c.dnySerie >= 7; } },
    { id: "dvatydny",ikona: "🗓️", jmeno: "Neúnavný",            popis: "Denní cíl 14 dní po sobě",
      test: function (c) { return c.dnySerie >= 14; } },
    { id: "maraton", ikona: "🏃", jmeno: "Maraton",             popis: "50 odpovědí za jeden den",
      test: function (c) { return c.den >= 50; } },
    { id: "ultra",   ikona: "🦾", jmeno: "Ultramaraton",        popis: "150 odpovědí za jeden den",
      test: function (c) { return c.den >= 150; } },
    { id: "rano",    ikona: "🐦", jmeno: "Ranní ptáče",         popis: "Odpověď mezi 4. a 7. hodinou ráno",
      test: function (c) { return c.hodina >= 4 && c.hodina < 7; } },
    { id: "sova",    ikona: "🦉", jmeno: "Noční sova",          popis: "Odpověď po 23. hodině",
      test: function (c) { return c.hodina >= 23 || (c.hodina >= 0 && c.hodina < 4); } },
    { id: "pruzkum", ikona: "🧭", jmeno: "Průzkumník",          popis: "Každá otázka aspoň jednou",
      test: function (c) { return c.z.celkem > 0 && c.z.videno === c.z.celkem; } },
    { id: "stit",    ikona: "🛡️", jmeno: "Čistý štít",          popis: "Celý okruh na úrovni 3 a výš",
      test: function (c) { return c.z.okruhy.some(function (k) { return k.nad3 === k.celkem; }); } },
    { id: "zlato",   ikona: "🏆", jmeno: "Zlatý okruh",         popis: "Celý okruh na nejvyšší úrovni 5",
      test: function (c) { return c.z.okruhy.some(function (k) { return k.nad5 === k.celkem; }); } },
    { id: "pulka",   ikona: "⛰️", jmeno: "Půlka cesty",         popis: "Polovina otázek na úrovni 3 a výš",
      test: function (c) { return c.z.celkem > 0 && c.z.nad3 >= c.z.celkem / 2; } },
    { id: "pripraven", ikona: "🎓", jmeno: "Připraven",         popis: "90 % otázek na úrovni 3 a výš",
      test: function (c) { return c.z.celkem > 0 && c.z.nad3 >= 0.9 * c.z.celkem; } },
    { id: "tisic",   ikona: "💯", jmeno: "Tisícovka",           popis: "1000 odpovědí celkem",
      test: function (c) { return c.z.odpovedi >= 1000; } },
    { id: "autor",   ikona: "🏅", jmeno: "Autorizovaný",        popis: "Nejvyšší úroveň hry",
      test: function (c) { return c.uroven.i === UROVNE.length - 1; } }
  ];

  var hra = novaHra();     // uložená data hry; skutečná se načtou po otázkách
  var serie = 0;           // správně v řadě v tomto sezení
  var mene = !!(window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  ["hraLista","cilKruh","cilPostup","cilCislo","urovenIkona","urovenJmeno",
   "xpText","xpLista","serie","odpocet","cipZvuk","cipVibrace","volbaCil",
   "hraPrehled","toasty","konfety"].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  // ---------------------------------------------------------- hra: data

  function novaHra() {
    return {
      verze: 1, xp: 0, odznaky: {}, dny: {}, nejSerie: 0, opravy: 0,
      nastaveni: { zvuk: true, vibrace: true, cil: 40, zkouska: "2026-10-30" }
    };
  }

  function doplnHru(d) {
    var h = novaHra();
    if (!d || typeof d !== "object") return h;
    h.xp = Math.max(0, +d.xp || 0);
    h.odznaky = (d.odznaky && typeof d.odznaky === "object") ? d.odznaky : {};
    h.dny = (d.dny && typeof d.dny === "object") ? d.dny : {};
    h.nejSerie = +d.nejSerie || 0;
    h.opravy = +d.opravy || 0;
    var n = d.nastaveni || {};
    if (typeof n.zvuk === "boolean") h.nastaveni.zvuk = n.zvuk;
    if (typeof n.vibrace === "boolean") h.nastaveni.vibrace = n.vibrace;
    if (+n.cil > 0) h.nastaveni.cil = +n.cil;
    if (/^\d{4}-\d{2}-\d{2}$/.test(n.zkouska || "")) h.nastaveni.zkouska = n.zkouska;
    return h;
  }

  function nactiHru() {
    try {
      var raw = localStorage.getItem(HRA_ULOZISTE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function ulozHru() {
    try { localStorage.setItem(HRA_ULOZISTE, JSON.stringify(hra)); } catch (e) { /* nevadí */ }
  }

  // body za práci odvedenou před zavedením hry (nebo ze zálohy bez hry)
  function semeno() {
    var xp = 0;
    Object.keys(statistika).forEach(function (k) {
      xp += 5 * (statistika[k].ano || 0) + (statistika[k].ne || 0);
    });
    return xp;
  }

  function inicializujHru() {
    var ulozena = nactiHru();
    if (ulozena) { hra = doplnHru(ulozena); return; }

    hra = novaHra();
    hra.xp = semeno();
    var nove = zkontrolujOdznaky(kontext(), true);
    ulozHru();
    if (hra.xp || nove.length) {
      setTimeout(function () {
        toast("🎮", "Hra začíná",
          "Za dosavadní práci máš " + cislo(hra.xp) + " XP"
          + (nove.length ? " a " + nove.length + " "
             + sklon(nove.length, "odznak", "odznaky", "odznaků") : "")
          + ". Úroveň: " + urovenZXp(hra.xp).jmeno + ".");
      }, 500);
    }
  }

  // ---------------------------------------------------------- hra: výpočty

  function cislo(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }

  function sklon(n, jeden, dva, pet) { return n === 1 ? jeden : (n >= 2 && n <= 4 ? dva : pet); }

  function denKlic(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2)
      + "-" + ("0" + d.getDate()).slice(-2);
  }

  function dnes() {
    var k = denKlic(new Date());
    return hra.dny[k] || { n: 0, ok: 0 };
  }

  function splnenoDne(k) { return !!(hra.dny[k] && hra.dny[k].n >= hra.nastaveni.cil); }

  // kolik dní po sobě je splněný denní cíl; dnešek se počítá, jakmile je splněný
  function serieDnu() {
    var d = new Date(), n = 0;
    if (!splnenoDne(denKlic(d))) d.setDate(d.getDate() - 1);
    while (splnenoDne(denKlic(d)) && n < 3660) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function urovenZXp(xp) {
    var i = 0;
    while (i + 1 < UROVNE.length && xp >= UROVNE[i + 1].xp) i++;
    var u = UROVNE[i], od = u.xp, dal, hvezdy = 0;
    if (i + 1 < UROVNE.length) {
      dal = UROVNE[i + 1].xp;
    } else {
      hvezdy = Math.floor((xp - u.xp) / PRESTIZ);
      od = u.xp + hvezdy * PRESTIZ;
      dal = od + PRESTIZ;
    }
    return {
      i: i, hvezdy: hvezdy, klic: i + "/" + hvezdy, ikona: u.ikona,
      jmeno: u.jmeno + (hvezdy ? " ★" + hvezdy : ""),
      od: od, dal: dal, podil: Math.max(0, Math.min(1, (xp - od) / (dal - od))),
      dalsi: UROVNE[i + 1] || null
    };
  }

  // úroveň otázky jen pro čtení, na rozdíl od statZaznam nic nezakládá
  function urovenOtazky(o) {
    var s = statistika[klic(o)];
    if (!s || !(s.ano || s.ne)) return 0;
    if (typeof s.uroven === "number") return s.uroven;
    return Math.max(0, Math.min(INTERVALY.length - 1, (s.ano || 0) - (s.ne || 0)));
  }

  function prehled() {
    var mapa = {}, poradi = [], celkem = 0, videno = 0, nad3 = 0, odpovedi = 0;
    vsechny.forEach(function (o) {
      var k = mapa[o.sekce];
      if (!k) {
        k = mapa[o.sekce] = { sekce: o.sekce, celkem: 0, videno: 0, nad3: 0, nad5: 0, soucet: 0 };
        poradi.push(o.sekce);
      }
      var u = urovenOtazky(o);
      k.celkem++; celkem++;
      k.soucet += u;
      if (videna(o)) { k.videno++; videno++; }
      if (u >= 3) { k.nad3++; nad3++; }
      if (u >= 5) k.nad5++;
    });
    Object.keys(statistika).forEach(function (k) {
      odpovedi += (statistika[k].ano || 0) + (statistika[k].ne || 0);
    });
    poradi.sort();
    return {
      okruhy: poradi.map(function (s) { return mapa[s]; }), mapa: mapa,
      celkem: celkem, videno: videno, nad3: nad3, odpovedi: odpovedi
    };
  }

  function kontext(ud) {
    ud = ud || {};
    return {
      z: prehled(), nejSerie: hra.nejSerie, den: dnes().n, dnySerie: serieDnu(),
      opravy: hra.opravy, uroven: urovenZXp(hra.xp),
      hodina: typeof ud.hodina === "number" ? ud.hodina : -1,
      nemesis: !!ud.nemesis
    };
  }

  function zkontrolujOdznaky(c, tise) {
    var nove = [];
    ODZNAKY.forEach(function (b) {
      if (hra.odznaky[b.id]) return;
      var ok = false;
      try { ok = !!b.test(c); } catch (e) { ok = false; }
      if (ok) { hra.odznaky[b.id] = Date.now(); nove.push(b); }
    });
    return nove;
  }

  function barvaZvladnuti(k) {
    if (!k.videno) return "";
    if (k.nad5 === k.celkem) return "linear-gradient(135deg, #f0c75e, #b8860b)";
    var p = k.soucet / (5 * k.celkem);          // průměrná úroveň 0 až 1
    return "hsl(" + Math.round(6 + p * 134) + " 60% 42%)";
  }

  function dnuDoZkousky() {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hra.nastaveni.zkouska || "");
    if (!m) return null;
    var zk = new Date(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(); d.setHours(0, 0, 0, 0);
    return Math.round((zk - d) / DEN);
  }

  // ---------------------------------------------------------- hra: efekty

  var audio = null;

  function ton(f, t0, delka, typ, sila) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = typ || "sine";
    o.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(sila || 0.15, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + delka);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + delka + 0.03);
  }

  function zvuk(druh, vyska) {
    if (!hra.nastaveni.zvuk) return;
    try {
      if (!audio) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audio = new AC();
      }
      if (audio.state === "suspended") audio.resume();
      var t = audio.currentTime + 0.01;
      if (druh === "ano") {
        // s rostoucí sérií tón stoupá po půltónech, strop je oktáva
        var k = Math.pow(2, Math.min(Math.max(0, (vyska || 1) - 1), 12) / 12);
        ton(660 * k, t, 0.09, "sine", 0.14);
        ton(990 * k, t + 0.07, 0.16, "sine", 0.12);
      } else if (druh === "ne") {
        ton(220, t, 0.16, "triangle", 0.15);
        ton(165, t + 0.1, 0.24, "triangle", 0.13);
      } else if (druh === "milnik") {
        [523, 659, 784, 1047].forEach(function (f, i) { ton(f, t + i * 0.07, 0.18, "triangle", 0.14); });
      } else if (druh === "fanfara") {
        [523, 659, 784, 1047].forEach(function (f, i) { ton(f, t + i * 0.09, 0.2, "square", 0.05); });
        ton(784, t + 0.38, 0.5, "triangle", 0.12);
        ton(1047, t + 0.38, 0.6, "triangle", 0.12);
      } else if (druh === "odznak") {
        [880, 1175, 1397, 1760, 2349].forEach(function (f, i) { ton(f, t + i * 0.06, 0.28, "sine", 0.1); });
      } else if (druh === "gong") {
        // konec bloku: tři klidné údery, sestupně
        [1175, 988, 784].forEach(function (f, i) { ton(f, t + i * 0.45, 1.1, "sine", 0.16); });
      } else if (druh === "budicek") {
        // konec pauzy: krátce a vzestupně, ať je jasné, že se jde zpátky do práce
        [587, 784, 988, 1175].forEach(function (f, i) { ton(f, t + i * 0.12, 0.3, "triangle", 0.13); });
      }
    } catch (e) { /* zvuk není podstatný */ }
  }

  function vibruj(vzor) {
    if (!hra.nastaveni.vibrace || !navigator.vibrate) return;
    try { navigator.vibrate(vzor); } catch (e) { /* nevadí */ }
  }

  function animuj(prvek, trida) {
    if (!prvek || mene) return;
    prvek.classList.remove(trida);
    void prvek.offsetWidth;                    // restart CSS animace
    prvek.classList.add(trida);
  }

  function plovouciXp(prvek, xp, stitek, trefa) {
    if (!prvek || !prvek.getBoundingClientRect) return;
    var r = prvek.getBoundingClientRect();
    var d = document.createElement("div");
    d.className = "plovouci-xp";
    d.style.left = (r.left + r.width - 44) + "px";
    d.style.top = (r.top + 6) + "px";
    if (!trefa) d.style.color = "var(--tlumene)";
    d.textContent = "+" + xp + " XP";
    if (stitek) {
      var s = document.createElement("small");
      s.textContent = stitek;
      d.appendChild(s);
    }
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 1200);
  }

  function toast(ikona, titulek, popis) {
    var t = document.createElement("div");
    t.className = "toast";
    var i = document.createElement("span");
    i.className = "ikona";
    i.textContent = ikona;
    var txt = document.createElement("div");
    var b = document.createElement("b");
    b.textContent = titulek;
    txt.appendChild(b);
    if (popis) {
      var p = document.createElement("span");
      p.className = "popis";
      p.textContent = popis;
      txt.appendChild(p);
    }
    t.appendChild(i); t.appendChild(txt);
    el.toasty.appendChild(t);
    while (el.toasty.children.length > 2) el.toasty.firstChild.remove();
    setTimeout(function () {
      t.classList.add("pryc");
      setTimeout(function () { t.remove(); }, 320);
    }, 2800);
  }

  // konfety: malý vlastní částicový systém na canvasu, žádná knihovna
  var kf = { ctx: null, castice: [], bezi: false, w: 0, h: 0 };
  var BARVY = ["#e3b341", "#58c19a", "#6fa8d0", "#e8756c", "#b48ead", "#ff8a4c", "#ffffff"];

  function pripravKonfety() {
    if (!el.konfety || !el.konfety.getContext) return false;
    if (!kf.ctx) {
      try { kf.ctx = el.konfety.getContext("2d"); } catch (e) { kf.ctx = null; }
    }
    if (!kf.ctx) return false;
    var dpr = window.devicePixelRatio || 1;
    kf.w = window.innerWidth; kf.h = window.innerHeight;
    el.konfety.width = kf.w * dpr; el.konfety.height = kf.h * dpr;
    kf.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function vystrel(x, y, pocet, uhel, rozptyl, sila) {
    for (var i = 0; i < pocet; i++) {
      var a = uhel + (Math.random() - 0.5) * rozptyl;
      var v = sila * (0.55 + Math.random() * 0.6);
      kf.castice.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
        w: 5 + Math.random() * 6, h: 3 + Math.random() * 4,
        barva: BARVY[Math.floor(Math.random() * BARVY.length)], vek: 0
      });
    }
  }

  function krokKonfet() {
    var c = kf.ctx;
    c.clearRect(0, 0, kf.w, kf.h);
    kf.castice = kf.castice.filter(function (p) {
      p.vek++;
      p.vy += 0.28; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      var alfa = p.vek > 70 ? Math.max(0, 1 - (p.vek - 70) / 25) : 1;
      if (alfa <= 0 || p.y > kf.h + 30) return false;
      c.save();
      c.globalAlpha = alfa;
      c.translate(p.x, p.y); c.rotate(p.r);
      c.fillStyle = p.barva;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
      c.restore();
      return true;
    });
    if (kf.castice.length) requestAnimationFrame(krokKonfet);
    else { kf.bezi = false; c.clearRect(0, 0, kf.w, kf.h); }
  }

  function spustKonfety() {
    if (!kf.bezi) { kf.bezi = true; requestAnimationFrame(krokKonfet); }
  }

  function konfetyMale(prvek) {
    if (mene) { animuj(el.hraLista, "zare"); return; }
    if (!prvek || !pripravKonfety()) return;
    var r = prvek.getBoundingClientRect();
    vystrel(r.left + r.width / 2, r.top + r.height / 2, 30, -Math.PI / 2, 2.2, 9);
    spustKonfety();
  }

  function konfetyVelke() {
    if (mene) { animuj(el.hraLista, "zare"); return; }
    if (!pripravKonfety()) return;
    vystrel(0, kf.h * 0.9, 80, -Math.PI / 3, 0.9, 17);
    vystrel(kf.w, kf.h * 0.9, 80, -2 * Math.PI / 3, 0.9, 17);
    spustKonfety();
  }

  // ---------------------------------------------------------- hra: po odpovědi

  function hraPoOdpovedi(u) {
    var klicDne = denKlic(new Date());
    var den = hra.dny[klicDne] || (hra.dny[klicDne] = { n: 0, ok: 0 });
    var cilPred = den.n >= hra.nastaveni.cil;
    var urovenPred = urovenZXp(hra.xp);
    var xp, stitek = "";

    den.n++;
    if (u.trefa) {
      den.ok++;
      serie++;
      xp = 10 + [8, 5, 3, 1, 1, 1][Math.min(5, Math.max(0, u.urovenPred))];
      if (u.znovu) { xp += 10; stitek = "Oprava!"; hra.opravy++; }
      if (u.urovenPred === 4 && u.urovenPo === 5) { xp += 15; stitek = "Zvládnuto!"; }
      xp += Math.min(10, Math.floor(serie / 5) * 2);
    } else {
      serie = 0;
      xp = 2;                                  // i chyba je práce
    }
    if (serie > hra.nejSerie) hra.nejSerie = serie;
    hra.xp += xp;

    var urovenPo = urovenZXp(hra.xp);
    var nove = zkontrolujOdznaky(kontext({
      hodina: new Date().getHours(),
      nemesis: u.trefa && u.neCelkem >= 1 && u.urovenPred === 2 && u.urovenPo >= 3
    }), false);
    ulozHru();

    // efekty: jeden hlavní zvuk podle toho, co se stalo nejvýznamnějšího
    var hlavni = u.trefa ? "ano" : "ne";
    plovouciXp(u.tlacitko, xp, stitek, u.trefa);
    if (u.trefa) { animuj(u.tlacitko, "pop"); vibruj(14); }
    else { animuj(u.tlacitko, "tres"); vibruj([30, 60, 30]); }

    if (u.trefa && MILNIKY_SERIE.indexOf(serie) >= 0) {
      hlavni = "milnik";
      animuj(el.serie, "pulz");
      konfetyMale(el.serie);
      vibruj([20, 40, 20, 40, 50]);
      if (serie >= 10 && !nove.length) {        // odznak za sérii má přednost
        toast("🔥", serie + " správně v řadě!",
          POCHVALY[Math.floor(Math.random() * POCHVALY.length)]);
      }
    }

    if (!cilPred && den.n >= hra.nastaveni.cil) {
      hlavni = "fanfara";
      var sd = serieDnu();
      toast("🎯", "Denní cíl splněn!",
        sd > 1 ? "Už " + sd + " " + sklon(sd, "den", "dny", "dní") + " v kuse. Nepřeruš to."
               : "Zítra zase a rozjedeš sérii dní.");
      konfetyVelke();
      vibruj([40, 60, 40, 60, 120]);
    }

    if (urovenPo.klic !== urovenPred.klic) {
      hlavni = "fanfara";
      toast(urovenPo.ikona, "Nová úroveň: " + urovenPo.jmeno,
        urovenPo.dalsi
          ? "Další: " + urovenPo.dalsi.jmeno + " za " + cislo(urovenPo.dal - hra.xp) + " XP."
          : "Nejvyšší hodnost. Teď už jen razítko od komise.");
      konfetyVelke();
      vibruj([40, 60, 40, 60, 120]);
    }

    if (nove.length) {
      if (hlavni !== "fanfara") hlavni = "odznak";
      nove.forEach(function (b) { toast(b.ikona, "Odznak: " + b.jmeno, b.popis); });
      konfetyVelke();
    }

    zvuk(hlavni, serie);
    vykresliListu();
  }

  // ---------------------------------------------------------- hra: vykreslení

  function vykresliListu() {
    if (!hra) return;
    var u = urovenZXp(hra.xp);
    el.urovenIkona.textContent = u.ikona;
    el.urovenJmeno.textContent = u.jmeno;
    el.xpText.textContent = cislo(hra.xp - u.od) + " / " + cislo(u.dal - u.od) + " XP";
    el.xpLista.style.width = (100 * u.podil).toFixed(1) + "%";

    el.serie.textContent = "🔥 " + serie;
    el.serie.classList.toggle("hori", serie >= 5);

    var d = dnes(), cil = hra.nastaveni.cil;
    el.cilPostup.setAttribute("stroke-dashoffset",
      (OBVOD_KRUHU * (1 - Math.min(1, d.n / cil))).toFixed(2));
    el.cilCislo.textContent = d.n;
    el.cilKruh.classList.toggle("splneno", d.n >= cil);
    var sd = serieDnu();
    el.cilKruh.title = "Dnes " + d.n + " z " + cil + " odpovědí"
      + (sd ? " · cíl splněn " + sd + " " + sklon(sd, "den", "dny", "dní") + " v kuse" : "");
  }

  function vykresliOdpocet() {
    if (!hra) return;
    var dni = dnuDoZkousky();
    var zbyva = vsechny.filter(function (o) { return urovenOtazky(o) < 3; }).length;
    el.odpocet.textContent = "";
    var hlavni = document.createElement("div");
    var pod = document.createElement("small");
    if (dni === null) {
      hlavni.textContent = "Datum zkoušky nastavíš ve Statistikách.";
    } else if (dni > 0) {
      hlavni.innerHTML = "Do zkoušky zbývá <b>" + dni + "</b> "
        + sklon(dni, "den", "dny", "dní") + " ⏳";
      pod.textContent = zbyva
        ? "Na úroveň 3 a výš zbývá dostat " + zbyva + " "
          + sklon(zbyva, "otázku", "otázky", "otázek") + ", to je asi "
          + Math.ceil(zbyva / dni) + " denně."
        : "Všechny otázky máš na úrovni 3 a výš. Teď už jen udržovat.";
    } else if (dni === 0) {
      hlavni.textContent = "Zkouška je dnes. Držím palce! 🍀";
    } else {
      hlavni.textContent = "Zkouška proběhla před " + (-dni) + " "
        + sklon(-dni, "dnem", "dny", "dny") + ".";
    }
    el.odpocet.appendChild(hlavni);
    if (pod.textContent) el.odpocet.appendChild(pod);
  }

  function blok(nadpis) {
    var b = document.createElement("div");
    b.className = "hra-blok";
    if (nadpis) {
      var h = document.createElement("h3");
      h.textContent = nadpis;
      b.appendChild(h);
    }
    return b;
  }

  function vykresliHru() {
    if (!hra) return;
    var c = kontext(), u = c.uroven, p = el.hraPrehled;
    p.textContent = "";

    // profil
    var b1 = blok("");
    var prof = document.createElement("div");
    prof.className = "profil";
    var ik = document.createElement("span");
    ik.className = "velka-ikona";
    ik.textContent = u.ikona;
    var kdo = document.createElement("div");
    kdo.className = "kdo";
    var jm = document.createElement("b");
    jm.textContent = u.jmeno;
    var sm = document.createElement("small");
    sm.textContent = cislo(hra.xp) + " XP"
      + (u.dalsi ? " · do úrovně " + u.dalsi.jmeno + " chybí " + cislo(u.dal - hra.xp) : "");
    kdo.appendChild(jm); kdo.appendChild(sm);
    var lista = document.createElement("div");
    lista.className = "xp-lista";
    var vypln = document.createElement("div");
    vypln.style.width = (100 * u.podil).toFixed(1) + "%";
    lista.appendChild(vypln);
    kdo.appendChild(lista);
    prof.appendChild(ik); prof.appendChild(kdo);
    b1.appendChild(prof);

    var ziskano = ODZNAKY.filter(function (x) { return hra.odznaky[x.id]; }).length;
    var d = dnes();
    var cisla = document.createElement("div");
    cisla.className = "profil-cisla";
    [[d.n + "/" + hra.nastaveni.cil, "dnes"],
     [c.dnySerie, sklon(c.dnySerie, "den", "dny", "dní") + " v kuse"],
     [hra.nejSerie, "nejdelší série"],
     [ziskano + "/" + ODZNAKY.length, "odznaky"],
     [c.z.nad3 + "/" + c.z.celkem, "na úrovni 3+"],
     [cislo(c.z.odpovedi), "odpovědí celkem"]].forEach(function (x) {
      var dd = document.createElement("div");
      var bb = document.createElement("b");
      bb.textContent = x[0];
      dd.appendChild(bb);
      dd.appendChild(document.createTextNode(x[1]));
      cisla.appendChild(dd);
    });
    b1.appendChild(cisla);
    p.appendChild(b1);

    // mapa zvládnutí
    var b2 = blok("Mapa zvládnutí");
    var mapa = document.createElement("div");
    mapa.className = "mapa";
    c.z.okruhy.forEach(function (k) {
      var t = document.createElement("button");
      t.type = "button";
      t.className = "dlazdice";
      var barva = barvaZvladnuti(k);
      if (!barva) t.classList.add("nevideno");
      else t.style.background = barva;
      if (k.nad5 === k.celkem) t.classList.add("zlata");
      var pis = document.createElement("b");
      pis.textContent = k.sekce;
      var pr = document.createElement("small");
      pr.textContent = Math.round(100 * k.nad3 / k.celkem) + " %";
      t.appendChild(pis); t.appendChild(pr);
      t.title = (nazvy[k.sekce] || "Okruh " + k.sekce) + " · průměrná úroveň "
        + (k.soucet / k.celkem).toFixed(1) + " · viděno " + k.videno + " z " + k.celkem;
      t.addEventListener("click", function () {
        okruhy().forEach(function (x) { vybrane[x.sekce] = x.sekce === k.sekce; });
        prepocitejAktivni();
        zavri();
        toast("🎯", "Procvičuješ okruh " + k.sekce, nazvy[k.sekce] || "");
      });
      mapa.appendChild(t);
    });
    b2.appendChild(mapa);
    var pm = document.createElement("p");
    pm.className = "pozn-mala";
    pm.textContent = "Barva podle průměrné úrovně otázek (červená 0, zelená 4, zlatá celý okruh na 5), "
      + "číslo je podíl otázek na úrovni 3 a výš. Klepnutím procvičíš jen ten okruh.";
    b2.appendChild(pm);
    p.appendChild(b2);

    // odznaky
    var b3 = blok("Odznaky " + ziskano + " z " + ODZNAKY.length);
    var mriz = document.createElement("div");
    mriz.className = "odznaky";
    ODZNAKY.forEach(function (x) {
      var o = document.createElement("div");
      o.className = "odznak" + (hra.odznaky[x.id] ? "" : " zamceno");
      var i2 = document.createElement("span");
      i2.className = "ik";
      i2.textContent = x.ikona;
      var tx = document.createElement("div");
      var nb = document.createElement("b");
      nb.textContent = x.jmeno;
      var ns = document.createElement("small");
      ns.textContent = x.popis;
      tx.appendChild(nb); tx.appendChild(ns);
      o.appendChild(i2); o.appendChild(tx);
      if (hra.odznaky[x.id]) {
        o.title = "Získáno " + new Date(hra.odznaky[x.id]).toLocaleDateString("cs-CZ");
      }
      mriz.appendChild(o);
    });
    b3.appendChild(mriz);
    p.appendChild(b3);

    // datum zkoušky
    var b4 = blok("Zkouška");
    var radekD = document.createElement("label");
    radekD.className = "datum-zkousky";
    radekD.appendChild(document.createTextNode("Datum zkoušky"));
    var vstupD = document.createElement("input");
    vstupD.type = "date";
    vstupD.value = hra.nastaveni.zkouska;
    vstupD.addEventListener("change", function () {
      if (/^\d{4}-\d{2}-\d{2}$/.test(vstupD.value)) {
        hra.nastaveni.zkouska = vstupD.value;
        ulozHru();
        vykresliOdpocet();
      }
    });
    radekD.appendChild(vstupD);
    b4.appendChild(radekD);
    p.appendChild(b4);
  }

  function vykresliNastaveni() {
    el.cipZvuk.setAttribute("aria-pressed", hra.nastaveni.zvuk ? "true" : "false");
    el.cipVibrace.setAttribute("aria-pressed", hra.nastaveni.vibrace ? "true" : "false");
    var v = String(hra.nastaveni.cil);
    if (!Array.prototype.some.call(el.volbaCil.options, function (o) { return o.value === v; })) {
      var o = document.createElement("option");
      o.value = v; o.textContent = v;
      el.volbaCil.appendChild(o);
    }
    el.volbaCil.value = v;
  }

  function nastavOvladaniHry() {
    el.cipZvuk.addEventListener("click", function () {
      hra.nastaveni.zvuk = !hra.nastaveni.zvuk;
      ulozHru(); vykresliNastaveni();
      if (hra.nastaveni.zvuk) zvuk("ano", 1);
    });
    el.cipVibrace.addEventListener("click", function () {
      hra.nastaveni.vibrace = !hra.nastaveni.vibrace;
      ulozHru(); vykresliNastaveni();
      vibruj(40);
    });
    el.volbaCil.addEventListener("change", function () {
      var n = parseInt(el.volbaCil.value, 10);
      if (n > 0) { hra.nastaveni.cil = n; ulozHru(); vykresliListu(); }
    });
  }

  // sloučení hry ze zálohy: nic se nesčítá, aby opakovaný import nenafukoval body
  function sloucHru(cizi) {
    var h = doplnHru(cizi);
    hra.xp = Math.max(hra.xp, h.xp);
    hra.nejSerie = Math.max(hra.nejSerie, h.nejSerie);
    hra.opravy = Math.max(hra.opravy, h.opravy);
    Object.keys(h.odznaky).forEach(function (k) {
      if (!hra.odznaky[k] || h.odznaky[k] < hra.odznaky[k]) hra.odznaky[k] = h.odznaky[k];
    });
    Object.keys(h.dny).forEach(function (k) {
      var a = hra.dny[k] || { n: 0, ok: 0 }, b = h.dny[k] || {};
      hra.dny[k] = { n: Math.max(a.n || 0, b.n || 0), ok: Math.max(a.ok || 0, b.ok || 0) };
    });
  }

  // ---------------------------------------------------------- pomodoro
  //
  // Časovač soustředění sdílený všemi režimy. Blok práce, krátká pauza a po
  // čtyřech blocích dlouhá pauza. Čas se počítá z okamžiku konce (Date.now()),
  // ne z počtu tiků, protože Android v uspané aplikaci časovače zastavuje.
  // Po návratu do aplikace se tak dopočítá, co mezitím uběhlo. Na plánovač,
  // statistiky ani hru časovač nemá vliv, stav leží pod vlastním klíčem.

  var POM_ULOZISTE = "zkousec-mik-pomodoro-v1";
  var MINUTA = 60000;
  var POM_DO_DLOUHE = 4;                        // po kolika blocích přijde dlouhá pauza
  var POM_DELKY = {                             // klíč je délka bloku v minutách
    25: { prace: 25, pauza: 5,  dlouha: 15 },   // výchozí, klasické pomodoro
    50: { prace: 50, pauza: 10, dlouha: 30 },
    15: { prace: 15, pauza: 3,  dlouha: 10 }
  };

  var pom = novePom();

  ["pomodoro","panelPomodoro","pomHodiny","pomFaze","pomCas","pomTecky","pomRada",
   "volbaPomodoro"].forEach(function (id) {
    el[id] = document.getElementById(id);
  });
  el.pomStart = document.getElementById("btnPomStart");

  function novePom() {
    // faze: "prace" | "pauza" | "dlouha"; hotovo = bloky v rozběhnutém cyklu
    return { verze: 1, delka: 25, faze: "prace", bezi: false, konec: 0,
             zbyva: 25 * MINUTA, hotovo: 0, den: "", dnes: 0 };
  }

  function nactiPom() {
    var p = novePom();
    try {
      var d = JSON.parse(localStorage.getItem(POM_ULOZISTE) || "null");
      if (!d || typeof d !== "object") return p;
      if (d.delka === 0 || POM_DELKY[d.delka]) p.delka = d.delka;
      if (d.faze === "pauza" || d.faze === "dlouha") p.faze = d.faze;
      p.bezi = d.bezi === true && +d.konec > 0;
      p.konec = +d.konec || 0;
      p.zbyva = +d.zbyva > 0 ? +d.zbyva : delkaFaze(p);
      p.hotovo = Math.min(POM_DO_DLOUHE - 1, Math.max(0, +d.hotovo || 0));
      if (typeof d.den === "string") { p.den = d.den; p.dnes = +d.dnes || 0; }
    } catch (e) { /* začne se nanovo */ }
    return p;
  }

  function ulozPom() {
    try { localStorage.setItem(POM_ULOZISTE, JSON.stringify(pom)); } catch (e) { /* nevadí */ }
  }

  function delkaFaze(p) {
    var d = POM_DELKY[p.delka] || POM_DELKY[25];
    return d[p.faze] * MINUTA;
  }

  function pomZbyva() {
    return pom.bezi ? Math.max(0, pom.konec - Date.now()) : pom.zbyva;
  }

  function pomDnes() {
    return pom.den === denKlic(new Date()) ? pom.dnes : 0;
  }

  function mmss(ms) {
    var s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }

  function pomFaze(faze, od, spustit) {
    pom.faze = faze;
    pom.zbyva = delkaFaze(pom);
    pom.bezi = spustit;
    pom.konec = spustit ? od + pom.zbyva : 0;
  }

  function pomSpust() {
    if (pom.bezi) return;
    pom.bezi = true;
    pom.konec = Date.now() + pom.zbyva;
  }

  function pomPozastav() {
    if (!pom.bezi) return;
    pom.zbyva = pomZbyva();
    pom.bezi = false;
    pom.konec = 0;
  }

  // Konec fáze v čase kdy. Po bloku práce se pauza rozběhne sama, po pauze
  // časovač počká, až se k tabletu vrátíš a klepneš na Start.
  function pomDalsiFaze(kdy, dokoncen) {
    if (pom.faze === "prace") {
      if (dokoncen) {
        var k = denKlic(new Date(kdy));
        if (pom.den !== k) { pom.den = k; pom.dnes = 0; }
        pom.dnes++;
      }
      pom.hotovo++;
      if (pom.hotovo >= POM_DO_DLOUHE) { pom.hotovo = 0; pomFaze("dlouha", kdy, true); }
      else pomFaze("pauza", kdy, true);
    } else {
      pomFaze("prace", kdy, false);
    }
  }

  function pomTik() {
    if (!pom.delka) return;
    var skoncila = null;
    // cyklus kvůli návratu z pozadí: mohl mezitím skončit blok i pauza po něm
    while (pom.bezi && Date.now() >= pom.konec) {
      skoncila = pom.faze;
      pomDalsiFaze(pom.konec, true);
    }
    if (skoncila) {
      ulozPom();
      pomOznam(skoncila);
    }
    vykresliPom();
  }

  function pomOznam(skoncila) {
    var jinyPanel = panelOtevreny() && el.panelPomodoro.classList.contains("skryte");
    if (pom.faze !== "prace") {
      zvuk("gong");
      vibruj([300, 150, 300]);
      // panel s pauzou se otevře sám, jen když tím nic nepřekryju
      if (!jinyPanel) zobraz("pomodoro");
      else toast("☕", "Blok hotový", "Dej si pauzu, časovač běží.");
    } else {
      zvuk("budicek");
      vibruj([120, 80, 120, 80, 120]);
      toast("🍅", skoncila === "prace" ? "Blok i pauza uběhly" : "Pauza skončila",
        "Klepni na 🍅 a začni další blok.");
      animuj(el.pomodoro, "pulz");
    }
  }

  function vykresliPom() {
    var vyp = !pom.delka;
    el.pomodoro.classList.toggle("skryte", vyp);
    el.volbaPomodoro.value = String(pom.delka);
    if (vyp) return;

    var zbyva = pomZbyva(), plna = delkaFaze(pom);
    var pauza = pom.faze !== "prace";
    var cas = mmss(zbyva);

    el.pomodoro.textContent = (pauza ? "☕ " : "🍅 ") + cas;
    el.pomodoro.classList.toggle("bezi", pom.bezi && !pauza);
    el.pomodoro.classList.toggle("pauza", pauza);

    if (el.panelPomodoro.classList.contains("skryte")) return;

    el.pomCas.textContent = cas;
    el.pomHodiny.className = "pom-hodiny" + (pauza ? " pauza" : pom.bezi ? " bezi" : "");
    var blok = pom.hotovo + 1, d = POM_DELKY[pom.delka];
    var faze, rada;
    if (pom.faze === "pauza") {
      faze = "Krátká pauza";
      rada = "Vstaň od tabletu, protáhni se, napij se a podívej se z okna do dálky. "
        + "Další otázky teď nečti, mozek si právě ukládá, co ses naučil.";
    } else if (pom.faze === "dlouha") {
      faze = "Dlouhá pauza";
      rada = "Čtyři bloky za sebou, zasloužená delší pauza. Projdi se nebo si dej něco k jídlu.";
    } else if (pom.bezi) {
      faze = "Soustředění · blok " + blok + " ze " + POM_DO_DLOUHE;
      rada = "Jen otázky. Telefon a zprávy počkají do pauzy.";
    } else if (zbyva < plna) {
      faze = "Pozastaveno · blok " + blok + " ze " + POM_DO_DLOUHE;
      rada = "Pokračuj, až budeš mít klid.";
    } else {
      faze = "Připraveno · blok " + blok + " ze " + POM_DO_DLOUHE;
      rada = d.prace + " minut soustředění, potom " + d.pauza + " minut pauza. "
        + "Po čtvrtém bloku přijde delší pauza " + d.dlouha + " minut.";
    }
    var n = pomDnes();
    if (n) rada += " Dnes máš za sebou " + n + " " + sklon(n, "blok", "bloky", "bloků") + ".";
    el.pomFaze.textContent = faze;
    el.pomRada.textContent = rada;

    el.pomTecky.textContent = "";
    var plnych = pom.faze === "dlouha" ? POM_DO_DLOUHE : pom.hotovo;
    for (var i = 0; i < POM_DO_DLOUHE; i++) {
      var t = document.createElement("span");
      if (i < plnych) t.className = "plna";
      else if (i === plnych && pom.faze === "prace" && (pom.bezi || zbyva < plna)) t.className = "tato";
      el.pomTecky.appendChild(t);
    }

    el.pomStart.textContent = pom.bezi ? "Pozastavit" : (zbyva < plna ? "Pokračovat" : "Start");
    var preskocit = document.getElementById("btnPomPreskocit");
    preskocit.textContent = pauza ? "Konec pauzy" : "Přeskočit";
    preskocit.disabled = !pauza && !pom.bezi && zbyva >= plna;   // nezačatý blok není co přeskočit
  }

  function nastavPomodoro() {
    pom = nactiPom();
    el.pomodoro.addEventListener("click", function () {
      zobraz("pomodoro");
      vykresliPom();
    });
    el.pomStart.addEventListener("click", function () {
      if (pom.bezi) pomPozastav(); else pomSpust();
      ulozPom(); vykresliPom();
    });
    document.getElementById("btnPomPreskocit").addEventListener("click", function () {
      var bylaPauza = pom.faze !== "prace";
      pomDalsiFaze(Date.now(), false);
      if (bylaPauza) pomSpust();            // konec pauzy znamená rovnou do práce
      ulozPom(); vykresliPom();
    });
    document.getElementById("btnPomReset").addEventListener("click", function () {
      pom.hotovo = 0;
      pomFaze("prace", 0, false);
      ulozPom(); vykresliPom();
    });
    document.getElementById("btnPomZavrit").addEventListener("click", zavri);
    el.volbaPomodoro.addEventListener("change", function () {
      var n = parseInt(el.volbaPomodoro.value, 10);
      if (n !== 0 && !POM_DELKY[n]) return;
      pom.delka = n;
      pom.hotovo = 0;
      pomFaze("prace", 0, false);
      ulozPom(); vykresliPom();
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) pomTik();
    });
    setInterval(pomTik, 1000);
    pomTik();
  }

  // ---------------------------------------------------------- ovládání

  el.dalsi.addEventListener("click", vpred);
  el.zpetZk.addEventListener("click", zpetVHistorii);

  document.getElementById("btnNabidka").addEventListener("click", function () {
    vykresliOkruhy();
    zobraz("okruhy");
  });
  document.getElementById("btnHotovo").addEventListener("click", zavri);
  document.getElementById("btnVse").addEventListener("click", function () {
    okruhy().forEach(function (k) { vybrane[k.sekce] = true; });
    prepocitejAktivni(); vykresliOkruhy();
  });
  document.getElementById("btnZadny").addEventListener("click", function () {
    okruhy().forEach(function (k) { vybrane[k.sekce] = false; });
    prepocitejAktivni(); vykresliOkruhy();
  });
  document.getElementById("btnKOtazkam").addEventListener("click", function () {
    el.vstup.value = slozText(vsechny);
    el.hlaska.textContent = "";
    zobraz("otazky");
  });
  document.getElementById("btnZpet").addEventListener("click", function () {
    vykresliOkruhy(); zobraz("okruhy");
  });
  document.getElementById("btnNacist").addEventListener("click", nactiZPanelu);

  document.getElementById("btnDalsiUc").addEventListener("click", function () { posunUceni(1); });
  document.getElementById("btnPredchozi").addEventListener("click", function () { posunUceni(-1); });

  el.kapDalsi.addEventListener("click", kapitolaDal);
  document.getElementById("btnKapZpet").addEventListener("click", function () {
    kapBeh = null;
    vykresliKapitoly();
  });

  document.getElementById("prepinacRezim").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    oznacPrepinac(this, "data-rezim", b.getAttribute("data-rezim"));
    nastavRezim(b.getAttribute("data-rezim"));
  });

  document.getElementById("prepinacPoradi").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var p = b.getAttribute("data-poradi");
    oznacPrepinac(this, "data-poradi", p);
    poradiNahodne = p === "nahodne";
    sestavUcSeznam(aktualni);
    vykresliUceni();
  });

  document.getElementById("btnKStatistice").addEventListener("click", function () {
    vykresliStatistiky(); zobraz("statistiky");
  });
  document.getElementById("btnStatZpet").addEventListener("click", function () {
    vykresliOkruhy(); zobraz("okruhy");
  });
  document.getElementById("btnStatExport").addEventListener("click", exportujStatistiku);
  document.getElementById("btnStatImport").addEventListener("click", function () {
    document.getElementById("statSoubor").click();
  });
  document.getElementById("statSoubor").addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) nactiZalohu(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("btnStatReset").addEventListener("click", function () {
    if (!window.confirm("Opravdu vynulovat všechny statistiky včetně bodů, úrovně, odznaků a hvězdiček z kapitol? Nejde to vzít zpět.")) return;
    var nastaveniHry = hra.nastaveni;
    hra = novaHra(); hra.nastaveni = nastaveniHry; serie = 0; ulozHru(); vykresliListu();
    statistika = {}; prubeh = []; spravne = celkem = 0;
    historie = []; pozice = -1; aktualni = null;
    sezeni = {}; relaps = {}; kolo = 1; sestavFrontu();
    kapHvezdy = {}; kapBeh = null; ulozKapitoly();
    if (rezim === "kapitoly") vykresliKapitoly();
    ulozUlozene(); vykresliRysky(); vykresliStatistiky();
  });

  document.addEventListener("keydown", function (e) {
    if (panelOtevreny()) {
      if (e.key === "Escape") zavri();
      return;
    }
    var k = e.key.toLowerCase();

    if (rezim === "kapitoly") {
      if (!kapBeh) return;
      var zk = kapBeh.zaznamy[kapBeh.pozice];
      if (zk.vybrano === null) {
        var ik = "abc".indexOf(k);
        if (ik < 0) ik = "123".indexOf(k);
        if (ik >= 0 && ik < zk.moznosti.length) { e.preventDefault(); odpovezKap(ik); }
      } else if (k === "enter" || k === " " || k === "arrowright") {
        e.preventDefault(); kapitolaDal();
      }
      return;
    }

    if (rezim === "uceni") {
      if (k === "arrowright" || k === "enter" || k === " ") { e.preventDefault(); posunUceni(1); }
      else if (k === "arrowleft") { e.preventDefault(); posunUceni(-1); }
      return;
    }

    if (k === "arrowleft") { e.preventDefault(); zpetVHistorii(); return; }

    var z = zaznam();
    var hotovo = z && z.vybrano !== null;

    if (naKonci() && !hotovo) {
      var i = "abc".indexOf(k);
      if (i < 0) i = "123".indexOf(k);
      if (i >= 0 && i < el.odpovedi.children.length) { e.preventDefault(); odpovez(i); }
    } else if (k === "enter" || k === " " || k === "arrowright") {
      e.preventDefault(); vpred();
    }
  });

  // ---------------------------------------------------------- start

  function spustAplikaci(text) {
    nastavOtazky(rozeber(text));
    inicializujHru();
    vykresliNastaveni();
    vykresliListu();
    vykresliRysky();
    dalsiOtazka();
  }

  statistika = nactiUlozene();
  kapHvezdy = nactiKapitoly();
  oznacPrepinac(document.getElementById("prepinacRezim"), "data-rezim", "zkouseni");
  oznacPrepinac(document.getElementById("prepinacPoradi"), "data-poradi", "id");
  nastavOvladaniHry();
  nastavPomodoro();
  prazdno("Načítám otázky\u2026");

  // Otázky leží v otazky_data.txt vedle aplikace. Service worker je drží
  // v cache, takže načtení funguje i offline.
  fetch("otazky_data.txt", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    })
    .then(spustAplikaci)
    .catch(function () {
      prazdno("Otázky se nepodařilo načíst. Zkontroluj připojení a spusť aplikaci znovu.");
    });

  // ---------------------------------------------------------- PWA

  var bezpecne = location.protocol === "https:"
    || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if ("serviceWorker" in navigator && bezpecne) {
    navigator.serviceWorker.register("sw.js").catch(function () { /* běží i bez něj */ });
  }
  // požádá prohlížeč, aby statistiky při nedostatku místa nemazal
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () { /* nevadí */ });
  }
})();
