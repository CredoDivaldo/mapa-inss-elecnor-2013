const fs = require("fs");
const { chromium } = require("/Users/user/10_Projects/app-inss/tests/node_modules/playwright-core");
(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const erros = []; page.on("pageerror", (e) => erros.push(String(e).slice(0, 120)));
  await page.goto("http://127.0.0.1:8791/index.html#2018-05");
  await page.waitForTimeout(2500);
  const ind0 = await page.evaluate(() => ({ hidden: document.querySelector("#draft").hidden, txt: document.querySelector("#draft").textContent }));
  console.log("INDICADOR_INICIAL", JSON.stringify(ind0));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-pend")]);
  const pend = "/tmp/pendentes_teste.csv"; await dl.saveAs(pend);
  console.log("PENDENTES_FICHEIRO", dl.suggestedFilename());
  const linhas = fs.readFileSync(pend, "utf8").split(/\r?\n/).filter(Boolean);
  console.log("PENDENTES_LINHAS", linhas.length - 1, "CAB", linhas[0]);
  // preenche NISS nas 2 primeiras pendentes
  const novas = linhas.map((ln, i) => {
    if (i === 1) return ln.replace(/,""$/, ',"01514754"');
    if (i === 2) return ln.replace(/,""$/, ',"10000001"');
    return ln;
  });
  fs.writeFileSync("/tmp/nissimp.csv", novas.join("\r\n"));
  await page.setInputFiles("#nissimp-file", "/tmp/nissimp.csv");
  await page.waitForTimeout(800);
  const toast = await page.evaluate(() => (document.querySelector("#toast") || {}).textContent || "");
  console.log("TOAST_IMPORT", toast.slice(0, 160));
  const ind1 = await page.evaluate(() => ({ hidden: document.querySelector("#draft").hidden, txt: document.querySelector("#draft").textContent, nissMiss: document.querySelector("#nissMiss").textContent }));
  console.log("INDICADOR_APOS_IMPORT", JSON.stringify(ind1));
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#btn-draft-save")]);
  console.log("RASCUNHO_FICHEIRO", dl2.suggestedFilename());
  const ind2 = await page.evaluate(() => document.querySelector("#draft").textContent);
  console.log("INDICADOR_APOS_GUARDAR", ind2);
  await page.locator(".relacao-bar").screenshot({ path: "/tmp/barra.png" });
  await page.screenshot({ path: "/tmp/ecra_completo.png" });
  console.log("ERROS_JS", JSON.stringify(erros));
  await browser.close();
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
