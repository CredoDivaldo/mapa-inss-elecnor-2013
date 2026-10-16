// Teste manual: gravacao na nuvem e recuperacao. ESCREVE em meses/rascunhos/historico do Supabase.
// Usar com conta de teste e apagar os dados depois. Variaveis: TESTE_EMAIL, TESTE_PASS, SUPABASE_SERVICE_KEY, SUPABASE_REF.
const { chromium } = require("../node_modules/playwright-core");
const REF = process.env.SUPABASE_REF || "cbbnrjsszgkmqvijfdxq", SR = process.env.SUPABASE_SERVICE_KEY;
const EMAIL = process.env.TESTE_EMAIL, PASS = process.env.TESTE_PASS;
const api = (p) => fetch(`https://${REF}.supabase.co/rest/v1/${p}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } }).then((r) => r.json());
(async () => {
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
  const A = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await A.goto("http://127.0.0.1:8791/index.html#2018-05"); await A.waitForTimeout(2000);
  await A.fill("#lg-email", EMAIL); await A.fill("#lg-pass", PASS); await A.click("#lg-entrar"); await A.waitForTimeout(3000);
  // alteracao de teste: primeiro pendente recebe um NISS
  await A.evaluate(() => { const r = state && state.rows; });
  await A.waitForTimeout(4000);
  const m = await api("meses?id=eq.2018-05");
  console.log("NUVEM_MES", JSON.stringify(m[0] || null));
  await b.close();
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
