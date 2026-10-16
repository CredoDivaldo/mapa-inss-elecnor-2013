// Teste manual: ecra de perfil, tutorial guiado e ferramentas. Nao escreve dados de equipa.
// Requer servidor: python3 -m http.server 8791 --bind 127.0.0.1 (na raiz do projecto).
const { chromium } = require("../node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const erros = []; p.on("pageerror", (e) => erros.push(String(e).slice(0, 120)));
  await p.goto("http://127.0.0.1:8791/index.html#2018-05"); await p.waitForTimeout(2500);
  console.log("ECRA_PERFIL_VISIVEL", await p.isVisible("#perfil-gate"));
  await p.click('.perfil-opcao[data-perfil="Djamila"]'); await p.waitForTimeout(1500);
  console.log("PERFIL_GATE_FECHADO", !(await p.isVisible("#perfil-gate")), "| chip:", await p.textContent("#perfil-nome"));
  console.log("TUTORIAL_ABRE", await p.isVisible(".tour-tip"), "| titulo:", await p.textContent(".tour-titulo").catch(() => "-"));
  for (let k = 0; k < 4; k++) { await p.click(".tour-seg"); await p.waitForTimeout(400); }
  console.log("PASSO_5", await p.textContent(".tour-titulo"), "| spot visivel:", await p.isVisible(".tour-spot"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  console.log("ESC_FECHA_TUTORIAL", !(await p.isVisible(".tour-tip")));
  await p.click("#btn-ferramentas"); await p.waitForTimeout(500);
  console.log("FERRAMENTAS_ABRE", await p.isVisible("#modal-ferramentas"));
  await p.locator("#modal-ferramentas .modal-card").screenshot({ path: "/tmp/ferramentas.png" });
  await p.click("#btn-fechar-ferramentas"); await p.waitForTimeout(300);
  console.log("FERRAMENTAS_FECHA", !(await p.isVisible("#modal-ferramentas")));
  await p.reload(); await p.waitForTimeout(2000);
  console.log("APOS_RECARREGAR perfil gate visivel:", await p.isVisible("#perfil-gate"), "| chip:", await p.textContent("#perfil-nome"));
  await p.screenshot({ path: "/tmp/ecra_novo.png" });
  console.log("ERROS_JS", JSON.stringify(erros));
  await b.close();
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
