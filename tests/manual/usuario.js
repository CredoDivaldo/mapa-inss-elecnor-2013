const path = require("path");
const fs = require("fs");
const { chromium } = require("/Users/user/10_Projects/app-inss/tests/node_modules/playwright-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE || "http://127.0.0.1:8791/index.html";
const MESES = ["01","02","03","05","06","07","08","09","10","11","12"];
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const resumo = [];
  for (const mm of MESES) {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    const erros = [];
    page.on("pageerror", (e) => erros.push(String(e).slice(0, 120)));
    await page.goto(`${BASE}#2018-${mm}`);
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => {
      const cfg = window.INSS_CONFIG.anos["2018"];
      return { pos: document.querySelector("#pos").textContent, nissOk: document.querySelector("#nissOk").textContent, nissMiss: document.querySelector("#nissMiss").textContent, pag: document.querySelector("#pag").textContent, nome: document.querySelector("#f-nome").value, src: (document.querySelector("#scan").getAttribute("src") || "") , cfgPages: null };
    });
    // mês actual pela config
    const cfgPages = await page.evaluate((mm) => {
      const m = window.INSS_CONFIG.anos["2018"].find((x) => x.mes === Number(mm));
      return m ? m.pages : [];
    }, mm);
    const total = parseInt(info.pos.split("/")[1] || "0", 10);
    const alvos = [];
    const passos = Math.min(total, 20);
    let semPagina = 0, semMovimento = 0, mudouPagina = 0, comVerificacao = 0, linhasComYDiferente = 0;
    let prev = null;
    for (let i = 0; i < passos; i++) {
      const dados = await page.evaluate(() => {
        const img = document.querySelector("#scan");
        const pag = document.querySelector("#pag").textContent;
        return { pag, src: img.getAttribute("src") || "", top: img.style.top, nome: document.querySelector("#f-nome").value, pos: document.querySelector("#pos").textContent, naturalH: img.naturalHeight };
      });
      const k = parseInt(dados.pag.split("/")[0], 10) - 1;
      const esperado = cfgPages[k] || "";
      if (!dados.src || !dados.src.endsWith(esperado)) semPagina++;
      comVerificacao++;
      if (prev && prev.pag !== dados.pag) mudouPagina++;
      if (prev && prev.top === dados.top && prev.pag === dados.pag && i > 0 && prev.nome !== dados.nome) semMovimento++;
      prev = dados;
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(120);
    }
    // exportação
    let txtOk = "", excl = "", resolver = "";
    try {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 2000 }), page.click("#btn-txt")]);
      txtOk = "TXT: " + dl.suggestedFilename();
    } catch (e) {
      const toast = await page.evaluate(() => document.querySelector("#toast") && document.querySelector("#toast").textContent);
      txtOk = "TXT bloqueado/sem download. Aviso: " + (toast || "").slice(0, 140);
    }
    try {
      const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 2000 }), page.click("#btn-excl")]);
      excl = dl2.suggestedFilename();
    } catch (e) { excl = "sem lista excluidos"; }
    console.log("MES_OK", mm, JSON.stringify({ pos: info.pos, pag_errada: semPagina, mudou_pagina: mudouPagina, sem_mover: semMovimento, erros: erros.slice(0,1), exp: txtOk, excl }));
    resumo.push({ mes: mm, pos: info.pos, nissOk: info.nissOk, nissMiss: info.nissMiss, rel: null, testadas: passos, pag_errada: semPagina, mudou_pagina: mudouPagina, linhas_sem_mover_mapa: semMovimento, erros_js: erros.slice(0,2), exportacao: txtOk, excluidos: excl });
    await ctx.close();
  }
  console.log(JSON.stringify(resumo, null, 1));
  await browser.close();
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
