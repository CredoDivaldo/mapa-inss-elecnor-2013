const { chromium } = require("/Users/user/10_Projects/app-inss/tests/node_modules/playwright-core");
const ALVOS = [10, 150];
(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e).slice(0, 100)));
  await page.goto("http://127.0.0.1:8791/index.html#2018-06");
  await page.waitForTimeout(2500);
  let feitos = 0;
  for (const alvo of ALVOS) {
    while (feitos < alvo) { await page.keyboard.press("ArrowDown"); feitos++; }
    await page.waitForTimeout(350);
    const d = await page.evaluate(() => ({ nome: document.querySelector("#f-nome").value, pag: document.querySelector("#pag").textContent, pos: document.querySelector("#pos").textContent }));
    console.log(`JUN ${d.pos} | ${d.nome} | pag ${d.pag}`);
    await page.locator("#well").screenshot({ path: `/tmp/jun_${alvo}.png` });
  }
  console.log("ERROS_JS", JSON.stringify(erros));
  await browser.close();
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
