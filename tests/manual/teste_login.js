// Teste manual: ecrã de login (nao escreve dados). Requer servidor em 127.0.0.1:8791 (python3 -m http.server 8791).
const { chromium } = require("../node_modules/playwright-core");
const EMAIL = process.env.TESTE_EMAIL || "credolopes@icloud.com";
const PASS = process.env.TESTE_PASS;
(async () => {
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const erros = []; p.on("pageerror", (e) => erros.push(String(e).slice(0, 100)));
  await p.goto("http://127.0.0.1:8791/index.html#2018-05"); await p.waitForTimeout(2500);
  console.log("GATE_SEM_SESSAO_VISIVEL", await p.isVisible("#login-gate"));
  await p.fill("#lg-email", EMAIL); await p.fill("#lg-pass", "errada-1234"); await p.click("#lg-entrar"); await p.waitForTimeout(2500);
  console.log("ERRO_PASS_ERRADA", await p.textContent("#lg-erro"));
  await p.fill("#lg-pass", PASS || ""); await p.click("#lg-entrar"); await p.waitForTimeout(3500);
  console.log("LOGIN_OK gate visivel:", await p.isVisible("#login-gate"), "| info:", await p.textContent("#conta-info"));
  await p.click("#btn-sair"); await p.waitForTimeout(1000);
  console.log("APOS_SAIR gate visivel:", await p.isVisible("#login-gate"), "| erros:", JSON.stringify(erros));
  await b.close();
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
