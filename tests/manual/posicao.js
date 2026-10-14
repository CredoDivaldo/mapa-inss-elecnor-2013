const { chromium } = require("/Users/user/10_Projects/app-inss/tests/node_modules/playwright-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MESES = ["01","05","06","07"];
const PASSOS = [0, 4, 9];
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  for (const mm of MESES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:8791/index.html#2018-${mm}`);
    await page.waitForTimeout(2500);
    let feitos = 0;
    for (const alvo of PASSOS) {
      while (feitos < alvo) { await page.keyboard.press("ArrowDown"); feitos++; await page.waitForTimeout(150); }
      await page.waitForTimeout(400);
      const d = await page.evaluate(() => {
        const img = document.querySelector("#scan");
        return { nome: document.querySelector("#f-nome").value, pag: document.querySelector("#pag").textContent, top: img.style.top, h: img.style.height, src: (img.getAttribute("src")||"").split("/").pop(), linha: document.querySelector("#pos").textContent };
      });
      console.log(`MES ${mm} ${d.linha} | ${d.nome} | pag ${d.pag} | ${d.src} | top ${d.top}`);
      await page.locator("#well").screenshot({ path: `/tmp/pos_${mm}_${alvo}.png` });
    }
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error("ERRO", e.message); process.exit(1); });
