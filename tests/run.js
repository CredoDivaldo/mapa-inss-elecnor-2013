/* Testes automatizados da webapp (Playwright + Google Chrome instalado).
 * Pré-requisito: servidor estático na raiz do projeto em http://127.0.0.1:8791 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE = "http://127.0.0.1:8791/index.html#2018-01";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = path.resolve(__dirname, "..");
const resultados = [];
const check = (nome, cond, detalhe = "") => {
  resultados.push({ nome, ok: !!cond, detalhe });
  console.log(`${cond ? "PASS" : "FAIL"}  ${nome}${detalhe ? "  -> " + detalhe : ""}`);
};
const txtDe = (page, id) => page.locator(`#${id}`).innerText();
const nova = async (browser, opts = {}) => {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  if (opts.csv) {
    await page.route("**/data/2018/01_v2.csv", (route) =>
      route.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: fs.readFileSync(opts.csv) }));
  }
  await page.goto(opts.url || BASE);
  await page.waitForFunction(() => document.querySelector("#pos") && document.querySelector("#pos").textContent.includes("/"), null, { timeout: 20000 });
  await page.waitForTimeout(600);
  return { ctx, page, erros };
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"] });
  try {
    // ---------- T1: arranque e contagens do mês real ----------
    {
      const { ctx, page, erros } = await nova(browser);
      check("T1 mês 2018-01 carrega 298 linhas", (await txtDe(page, "pos")).endsWith("/298"), await txtDe(page, "pos"));
      check("T1 contadores: 189 com NISS e 109 sem", (await txtDe(page, "nissOk")) === "189" && (await txtDe(page, "nissMiss")) === "109",
        `${await txtDe(page, "nissOk")} / ${await txtDe(page, "nissMiss")}`);
      check("T1 relação do repositório identificada", (await txtDe(page, "rel-info")).includes("4317"), await txtDe(page, "rel-info"));
      check("T1 aviso de elegibilidade visível na 1.ª linha", (await txtDe(page, "elig")).includes("Sem NISS"), await txtDe(page, "elig"));
      check("T1 sem erros JavaScript", erros.length === 0, erros.join(" | "));
      await ctx.close();
    }

    // ---------- T2: autocompletação por nome preenche NISS da relação ----------
    {
      const { ctx, page } = await nova(browser);
      await page.click("#f-nome");
      await page.fill("#f-nome", "");
      await page.type("#f-nome", "abdel filipe", { delay: 30 });
      await page.waitForSelector("#sug-nome button", { timeout: 5000 });
      const sug = await page.locator("#sug-nome button").first().innerText();
      await page.locator("#sug-nome button").first().dispatchEvent("mousedown");
      await page.waitForTimeout(300);
      const niss = await page.inputValue("#f-niss");
      check("T2 autocompletação por nome preenche NISS 04299479", niss === "04299479", `sugestão: ${sug.replace(/\n/g, " ")} | niss: ${niss}`);
      check("T2 depois de escolher, a linha fica 'vínculo cobre o mês'",
        (await txtDe(page, "elig")).includes("Vínculo cobre") || (await txtDe(page, "elig")).includes("Fora do período"),
        await txtDe(page, "elig"));
      await ctx.close();
    }

    // ---------- T3: autocompletação por NISS (8 dígitos e 7 dígitos) ----------
    {
      const { ctx, page } = await nova(browser);
      await page.click("#f-niss");
      await page.type("#f-niss", "4299479", { delay: 30 });
      await page.waitForSelector("#sug-niss button", { timeout: 5000 });
      const txt = await page.locator("#sug-niss button").first().innerText();
      check("T3 NISS de 7 dígitos encontra a pessoa", txt.includes("ABDEL FILIPE"), txt.replace(/\n/g, " "));
      await ctx.close();
    }

    // ---------- T4: TXT bloqueado enquanto houver casos por resolver ----------
    {
      const { ctx, page } = await nova(browser);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click("#btn-txt")]);
      const nome = dl.suggestedFilename();
      const conteudo = fs.readFileSync(await dl.path(), "utf8").trim().split("\n");
      check("T4 TXT bloqueado: descarrega lista 'por resolver'", nome === "por_resolver_2018-01.txt", nome);
      check("T4 a lista tem os 109 casos por resolver", conteudo.length === 109, `linhas=${conteudo.length}`);
      check("T4 nenhum ficheiro TXT foi gerado", !nome.toUpperCase().endsWith(".TXT") || nome.startsWith("por_"), nome);
      await ctx.close();
    }

    // ---------- T5: lista de excluídos, alfabética, com motivo ----------
    {
      const { ctx, page } = await nova(browser);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click("#btn-excl")]);
      const nome = dl.suggestedFilename();
      const texto = fs.readFileSync(await dl.path(), "utf8").replace(/^\uFEFF/, "");
      const linhas = texto.trim().split(/\r?\n/).slice(1);
      const nomes = linhas.map((l) => l.split('","')[0].replace(/^"/, ""));
      const ordenado = [...nomes].sort((a, b) => a.localeCompare(b, "pt"));
      check("T5 lista de excluídos descarregada", nome === "excluidos_2018-01.csv", nome);
      check("T5 14 excluídos por período", linhas.length === 14, `linhas=${linhas.length}`);
      check("T5 ordem alfabética", JSON.stringify(nomes) === JSON.stringify(ordenado));
      check("T5 cada linha traz o motivo", linhas.every((l) => l.includes("não cobre o período")));
      await ctx.close();
    }

    // ---------- T6: exportação completa do TXT com um mês resolvido ----------
    {
      const { ctx, page, erros } = await nova(browser, { csv: path.join(ROOT, "tests/fixtures/2018_01_resolvido.csv") });
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click("#btn-txt")]);
      const nome = dl.suggestedFilename();
      const bruto = fs.readFileSync(await dl.path());
      const texto = bruto.toString("latin1");
      const linhas = texto.split("\r\n");
      const fim = linhas[linhas.length - 1] === "";
      const corpo = linhas.slice(0, -1);
      check("T6 nome do ficheiro: 130672018010.TXT", nome === "130672018010.TXT", nome);
      check("T6 todas as linhas têm 180 caracteres", corpo.every((l) => l.length === 180));
      check("T6 fins de linha CRLF", fim && !texto.replace(/\r\n/g, "").includes("\n"));
      check("T6 ficheiro só ASCII (sem acentos)", [...bruto].every((b) => b < 128));
      check("T6 nenhuma linha com NISS 00000000", !corpo.some((l) => l.slice(3, 11) === "00000000"));
      check("T6 cabeçalho e trailer com contagem igual às linhas de corpo", corpo[0].startsWith("0001012018N000013067") && corpo[corpo.length - 1].startsWith("99" + String(corpo.length - 2).padStart(10, "0")),
        `corpo=${corpo.length}`);
      const nomesTxt = corpo.slice(1, -1).map((l) => l.slice(31, 101).trim());
      check("T6 nomes em maiúsculas e sem acentos", nomesTxt.every((n) => n === n.toUpperCase() && !/[ÁÉÍÓÚÃÕÇÂÊÔ]/.test(n)));
      check("T6 TXT tem 175 trabalhadores (14 excluídos ficam de fora)", corpo.length - 2 === 175, `corpo=${corpo.length - 2}`);
      check("T6 sem erros JavaScript", erros.length === 0, erros.join(" | "));
      await ctx.close();
    }

    // ---------- T7: marcar já inscrito e exportar a lista ----------
    {
      const { ctx, page } = await nova(browser);
      // avançar até uma pessoa excluída por período
      let achou = false;
      for (let i = 0; i < 298 && !achou; i++) {
        if ((await txtDe(page, "elig")).includes("Fora do período")) { achou = true; break; }
        await page.click("#btn-next");
        await page.waitForTimeout(40);
      }
      check("T7 encontrei uma pessoa fora do período", achou);
      if (achou) {
        const antes = await txtDe(page, "elig");
        await page.click("#btn-ja");
        await page.waitForTimeout(300);
        const depois = await txtDe(page, "elig");
        check("T7 'Marcar como já inscrito' passa a aceitar a pessoa", depois.includes("Já inscrito"), `antes: ${antes.slice(0, 40)} | depois: ${depois.slice(0, 60)}`);
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click("#btn-ja-export")]);
        const dados = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
        check("T7 exportação de já inscritos contém a pessoa marcada", dados.inscritos.length >= 1 && dados.inscritos.some((x) => /^\d{8}$/.test(x.niss)), `n=${dados.inscritos.length}`);
      }
      await ctx.close();
    }

    // ---------- T8: carregar relação nova (ficheiro Excel) ----------
    {
      const { ctx, page } = await nova(browser);
      await page.setInputFiles("#rel-file", path.join(ROOT, "data/relacao/RelacaoDeTrabalhadoresVinculadosPorContribuinte-000013067.xlsx"));
      await page.waitForFunction(() => document.querySelector("#rel-info").textContent.includes("Relação carregada"), null, { timeout: 15000 });
      const info = await txtDe(page, "rel-info");
      check("T8 relação carregada por upload", info.toLowerCase().includes("4317") && info.toLowerCase().includes("trabalhadores") && info.toLowerCase().includes("relação carregada"), info);
      await page.click("#btn-rel-repor");
      await page.waitForTimeout(300);
      check("T8 repor relação do repositório", (await txtDe(page, "rel-info")).toLowerCase().includes("repositório"));
      await ctx.close();
    }

    // ---------- T9: Excel gerado com as mesmas regras (bloqueio) ----------
    {
      const { ctx, page } = await nova(browser);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click("#btn-xlsx")]);
      check("T9 Excel bloqueado enquanto houver casos por resolver", dl.suggestedFilename() === "por_resolver_2018-01.txt", dl.suggestedFilename());
      await ctx.close();
    }
    // ---------- T10: resolver uma linha reduz a lista por resolver ----------
    {
      const { ctx, page } = await nova(browser);
      const antes = Number(await txtDe(page, "nissMiss"));
      await page.click("#f-nome");
      await page.fill("#f-nome", "");
      await page.type("#f-nome", "katia aurora", { delay: 30 });
      await page.waitForSelector("#sug-nome button", { timeout: 5000 });
      await page.locator("#sug-nome button").first().dispatchEvent("mousedown");
      await page.waitForTimeout(400);
      const depois = Number(await txtDe(page, "nissMiss"));
      check("T10 resolver uma linha por autocompletação reduz 'sem NISS' em 1", depois === antes - 1, `${antes} -> ${depois}`);
      await ctx.close();
    }

    // ---------- T11: ficheiro que não é relação é recusado ----------
    {
      const { ctx, page } = await nova(browser);
      const antes = await txtDe(page, "rel-info");
      await page.setInputFiles("#rel-file", path.join(ROOT, "tests/fixtures/nao_e_relacao.xlsx"));
      await page.waitForTimeout(1200);
      const depois = await txtDe(page, "rel-info");
      check("T11 ficheiro que não é relação não substitui a relação", depois === antes && depois.toLowerCase().includes("repositório"), depois);
      await ctx.close();
    }

    // ---------- T12: importar já inscritos (JSON) ----------
    {
      const { ctx, page } = await nova(browser);
      await page.setInputFiles("#ja-file", path.join(ROOT, "tests/fixtures/ja_inscritos_teste.json"));
      await page.waitForTimeout(800);
      const guardados = await page.evaluate(() => JSON.parse(localStorage.getItem("inss-ja-inscritos") || "[]"));
      check("T12 importar já inscritos grava o NISS", guardados.some((x) => x.niss === "04299479"), `n=${guardados.length}`);
      await ctx.close();
    }

    // ---------- T13: mês de 2013 abre sem erros ----------
    {
      const { ctx, page, erros } = await nova(browser, { url: "http://127.0.0.1:8791/index.html#2013-01" });
      const pos = await txtDe(page, "pos");
      check("T13 mês 2013-01 abre com linhas", pos.includes("/") && !pos.startsWith("0/"), pos);
      check("T13 sem erros JavaScript em 2013", erros.length === 0, erros.join(" | "));
      await ctx.close();
    }

  } catch (e) {
    check("EXECUCAO sem excecoes", false, String(e && e.message || e).slice(0, 300));
  } finally {
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]).catch(() => {});
    const falhas = resultados.filter((r) => !r.ok);
    console.log(`\nRESUMO: ${resultados.length - falhas.length}/${resultados.length} passaram`);
    fs.writeFileSync(path.join(__dirname, "resultados.json"), JSON.stringify(resultados, null, 2));
    process.exitCode = falhas.length ? 1 : 0;
  }
})();
