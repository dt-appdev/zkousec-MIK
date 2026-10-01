// Test rozdělení okruhů, hodnocení a sestavení testu nanečisto.
// Spouští se bez instalace čehokoli:  node testy/test-zkouska.js
//
// Načte skutečný js/app.js do izolovaného prostředí s náhražkou prohlížeče
// (DOM tu nic nevykresluje) a skutečná data z otazky_data.txt.

"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var assert = require("assert");

var koren = path.join(__dirname, "..");
var kod = fs.readFileSync(path.join(koren, "js", "app.js"), "utf8");
var data = fs.readFileSync(path.join(koren, "otazky_data.txt"), "utf8");

// náhražka čehokoli z DOM: dá se volat, číst i zapisovat a nic nedělá
function nic() {
  var f = function () { return p; };
  var p = new Proxy(f, {
    get: function (t, k) {
      if (k === Symbol.toPrimitive) return function () { return ""; };
      if (k === "length") return 0;
      if (k === "then") return undefined;
      return p;
    },
    set: function () { return true; },
    apply: function () { return p; }
  });
  return p;
}

var pamet = {};
var okno = {
  __ZKOUSEC_TESTY__: true,
  document: nic(),
  localStorage: {
    getItem: function (k) { return k in pamet ? pamet[k] : null; },
    setItem: function (k, v) { pamet[k] = String(v); }
  },
  navigator: {},
  location: { protocol: "file:", hostname: "", search: "" },
  fetch: function () { return new Promise(function () {}); },   // otázky se načtou ručně
  setInterval: function () { return 0; },
  setTimeout: function () { return 0; },
  matchMedia: function () { return { matches: false }; },
  scrollTo: function () {},
  Date: Date, Math: Math, JSON: JSON, Promise: Promise, Array: Array, Object: Object,
  String: String, RegExp: RegExp, Error: Error, parseInt: parseInt, isNaN: isNaN
};
okno.window = okno;
vm.createContext(okno);
vm.runInContext(kod, okno, { filename: "app.js" });
var T = okno.__ZKOUSEC_TESTY__;
assert.ok(T && T.sestavTest, "app.js nevystavil funkce pro testy");

var chyb = 0, testu = 0;
function test(nazev, f) {
  testu++;
  try { f(); console.log("  ok    " + nazev); }
  catch (e) { chyb++; console.log("  CHYBA " + nazev + "\n        " + e.message); }
}

// ---------------------------------------------------------------- data

var sada = T.rozeber(data);
var otazky = sada.otazky;
var poOkruzich = {}, castiSoucet = { obecna: 0, oborova: 0 };
otazky.forEach(function (o) {
  poOkruzich[o.sekce] = (poOkruzich[o.sekce] || 0) + 1;
  castiSoucet[T.castOkruhu(o.sekce)]++;
});

console.log("\nOtázky po okruzích");
["obecna", "oborova"].forEach(function (c) {
  var radek = Object.keys(poOkruzich).sort()
    .filter(function (s) { return T.castOkruhu(s) === c; })
    .map(function (s) { return s + " " + poOkruzich[s]; });
  console.log("  " + (c === "obecna" ? "obecná " : "oborová") + "  " + radek.join(", ")
    + "  = " + castiSoucet[c]);
});

var maloDistraktoru = otazky.filter(function (o) { return o.spatne.length < 2; });
if (maloDistraktoru.length) {
  console.log("\nOtázky s méně než 2 distraktory (do testu se nevybírají):");
  maloDistraktoru.forEach(function (o) { console.log("  " + o.id + "  " + o.spatne.length); });
}

console.log("\nTesty");

test("parser načte všech 469 otázek", function () {
  assert.strictEqual(otazky.length, 469);
});

test("obecná část má aspoň 20 a oborová aspoň 10 otázek", function () {
  assert.ok(castiSoucet.obecna >= 20, "obecná " + castiSoucet.obecna);
  assert.ok(castiSoucet.oborova >= 10, "oborová " + castiSoucet.oborova);
});

// ---------------------------------------------------------------- rozdělení

test("okruhy A až K jsou obecné", function () {
  "ABCDEFGHIJK".split("").forEach(function (p) { assert.strictEqual(T.castOkruhu(p), "obecna", p); });
});

test("okruhy L, M, N, O, P, R a neznámé jsou oborové", function () {
  ["L", "M", "N", "O", "P", "R", "Q", "S", "Z", "AB", "—", ""].forEach(function (p) {
    assert.strictEqual(T.castOkruhu(p), "oborova", p);
  });
});

test("okruh J+ patří k J (obecná část)", function () {
  assert.strictEqual(T.pismenoOkruhu("J+"), "J");
  assert.strictEqual(T.castOkruhu("J+"), "obecna");
  var v = T.rozeber("? [J+3] Otázka?\n+ správně\n- špatně 1\n- špatně 2\n");
  assert.strictEqual(v.otazky.length, 1);
  assert.strictEqual(v.otazky[0].id, "J+3");
  assert.strictEqual(T.castOkruhu(v.otazky[0].sekce), "obecna");
});

test("malá písmena v ID se berou jako velká", function () {
  assert.strictEqual(T.castOkruhu("a"), "obecna");
  assert.strictEqual(T.castOkruhu("l"), "oborova");
});

// ---------------------------------------------------------------- hodnocení

test("hranice obecné části: 20, 16 vyhověl, 15, 11 doplňující, 10, 0 nevyhověl", function () {
  [[20, "vyhovel"], [16, "vyhovel"], [15, "doplnujici"], [11, "doplnujici"],
   [10, "nevyhovel"], [0, "nevyhovel"]].forEach(function (x) {
    assert.strictEqual(T.verdiktCasti("obecna", x[0]), x[1], x[0] + "/20");
  });
});

test("hranice oborové části: 10, 8 vyhověl, 7, 6 doplňující, 5, 0 nevyhověl", function () {
  [[10, "vyhovel"], [8, "vyhovel"], [7, "doplnujici"], [6, "doplnujici"],
   [5, "nevyhovel"], [0, "nevyhovel"]].forEach(function (x) {
    assert.strictEqual(T.verdiktCasti("oborova", x[0]), x[1], x[0] + "/10");
  });
});

test("celkový verdikt pro všechny kombinace částí", function () {
  var V = "vyhovel", D = "doplnujici", N = "nevyhovel";
  [[V, V, V], [V, D, D], [D, V, D], [D, D, D],
   [N, V, N], [V, N, N], [N, D, N], [D, N, N], [N, N, N]].forEach(function (x) {
    assert.strictEqual(T.verdiktCelkem(x[0], x[1]), x[2], x[0] + " + " + x[1]);
  });
});

test("konkrétní výsledky: 16+8, 15+8, 16+7, 16+5, 10+10, 11+6", function () {
  function cely(a, b) {
    return T.verdiktCelkem(T.verdiktCasti("obecna", a), T.verdiktCasti("oborova", b));
  }
  assert.strictEqual(cely(16, 8), "vyhovel");
  assert.strictEqual(cely(15, 8), "doplnujici");
  assert.strictEqual(cely(16, 7), "doplnujici");
  assert.strictEqual(cely(16, 5), "nevyhovel");
  assert.strictEqual(cely(10, 10), "nevyhovel");
  assert.strictEqual(cely(11, 6), "doplnujici");
});

// ---------------------------------------------------------------- sestavení

var OPAKOVANI = 2000;

test("sestavení vrátí vždy 20 obecných + 10 oborových různých otázek (" + OPAKOVANI + "×)", function () {
  for (var n = 0; n < OPAKOVANI; n++) {
    var t = T.sestavTest(otazky);
    assert.ok(t, "test se nesestavil");
    assert.strictEqual(t.length, 30);
    var obec = t.filter(function (p) { return p.cast === "obecna"; });
    var obor = t.filter(function (p) { return p.cast === "oborova"; });
    assert.strictEqual(obec.length, 20);
    assert.strictEqual(obor.length, 10);
    // nejdřív celá obecná část, potom oborová
    t.forEach(function (p, i) { assert.strictEqual(p.cast, i < 20 ? "obecna" : "oborova"); });
    obec.forEach(function (p) { assert.strictEqual(T.castOkruhu(p.o.sekce), "obecna", p.k); });
    obor.forEach(function (p) { assert.strictEqual(T.castOkruhu(p.o.sekce), "oborova", p.k); });
    var klice = {};
    t.forEach(function (p) { assert.ok(!klice[p.k], "opakuje se " + p.k); klice[p.k] = true; });
  }
});

test("každá otázka testu má 3 možnosti: 1 správnou a 2 různé distraktory", function () {
  for (var n = 0; n < 300; n++) {
    T.sestavTest(otazky).forEach(function (p) {
      assert.strictEqual(p.m.length, 3, p.k);
      var spravne = p.m.filter(function (m) { return m.spravna; });
      assert.strictEqual(spravne.length, 1, p.k);
      assert.strictEqual(spravne[0].text, p.o.spravna, p.k);
      var spatne = p.m.filter(function (m) { return !m.spravna; });
      assert.strictEqual(spatne.length, 2, p.k);
      assert.notStrictEqual(spatne[0].text, spatne[1].text, p.k);
    });
  }
});

test("výběr je rovnoměrný: v každé části se okruhy liší nejvýš o 1 otázku", function () {
  for (var n = 0; n < 500; n++) {
    var t = T.sestavTest(otazky);
    ["obecna", "oborova"].forEach(function (c) {
      var pocty = {};
      Object.keys(poOkruzich).forEach(function (s) { if (T.castOkruhu(s) === c) pocty[s] = 0; });
      t.forEach(function (p) { if (p.cast === c) pocty[p.o.sekce]++; });
      // okruh, který má méně otázek, než by mu připadlo, dá všechny
      var max = 0;
      Object.keys(pocty).forEach(function (s) { max = Math.max(max, pocty[s]); });
      Object.keys(pocty).forEach(function (s) {
        assert.ok(pocty[s] >= Math.min(poOkruzich[s], max - 1),
          c + " okruh " + s + ": " + pocty[s] + " při maximu " + max);
      });
    });
  }
});

test("otázka s jediným distraktorem se do testu nevybere", function () {
  var mala = T.rozeber(
    Array.apply(null, Array(25)).map(function (_, i) {
      return "? [A" + (i + 1) + "] Ot " + i + "\n+ ok\n- x\n" + (i === 0 ? "" : "- y\n");
    }).join("") +
    Array.apply(null, Array(10)).map(function (_, i) {
      return "? [L" + (i + 1) + "] Ot " + i + "\n+ ok\n- x\n- y\n";
    }).join("")).otazky;
  for (var n = 0; n < 200; n++) {
    T.sestavTest(mala).forEach(function (p) { assert.notStrictEqual(p.k, "A1"); });
  }
});

test("když oborová část nemá 10 otázek, test se nesestaví", function () {
  var bez = otazky.filter(function (o) { return T.castOkruhu(o.sekce) === "obecna"; })
    .concat(otazky.filter(function (o) { return o.sekce === "L"; }).slice(0, 9));
  assert.strictEqual(T.sestavTest(bez), null);
});

console.log("\n" + (testu - chyb) + " z " + testu + " testů prošlo.");
process.exit(chyb ? 1 : 0);
