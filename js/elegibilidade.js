/* Lógica pura de elegibilidade e geração do TXT INSS.
 * Sem DOM: testável em node. Fonte de verdade para nome e NISS: a relação geral.
 * Regras:
 *  - nome e NISS vêm da relação (nunca do mapa), em maiúsculas sem acentos (formato do portal)
 *  - só entra no TXT quem tem vínculo que cubra o mês do mapa (ou está marcado como já inscrito)
 *  - quem não tem NISS ou não existe na relação BLOQUEIA a exportação
 *  - quem consta no mapa mas o vínculo não cobre o mês vai para a lista de excluídos (alfabética)
 */
(function (root) {
  "use strict";

  const fold = (s) =>
    String(s || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const onlyDigits = (s) => String(s == null ? "" : s).replace(/\D/g, "");

  const isoFromAny = (v) => {
    if (v == null || v === "") return null;
    if (v instanceof Date && !isNaN(v)) {
      // SheetJS (cellDates) cria a data à meia-noite LOCAL: usar componentes locais evita o recuo de um dia
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    }
    if (typeof v === "number") {
      // número de série do Excel -> data civil, sem passar por objetos Date locais (independente do fuso)
      return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    }
    const m = String(v).trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const iso = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? iso[0] : null;
  };

  /* Constrói o índice a partir das linhas (matriz) da relação geral.
   * Colunas esperadas: 0 NISS, 1 Nome, 2 Categoria, 5 Início, 6 Fim, 7 Estado. */
  const construirIndice = (linhas) => {
    const porNiss = new Map();
    for (const r of linhas) {
      if (!r || r[0] == null || r[1] == null) continue;
      const txt = String(r[0]).trim();
      if (!/^\d{1,8}$/.test(txt)) continue; // linhas de resumo e cabeçalhos
      const niss = txt.padStart(8, "0");
      const nome = String(r[1]).replace(/\s+/g, " ").trim();
      if (!nome) continue;
      let p = porNiss.get(niss);
      if (!p) {
        p = { niss, nome, k: fold(nome), cat: String(r[2] || "").trim(), vinculos: [] };
        porNiss.set(niss, p);
      }
      if (fold(nome).split(" ").length > p.k.split(" ").length) {
        p.nome = nome;
        p.k = fold(nome);
      }
      p.vinculos.push({ inicio: isoFromAny(r[5]), fim: isoFromAny(r[6]), estado: String(r[7] || "") });
    }
    return [...porNiss.values()].sort((a, b) => a.k.localeCompare(b.k, "pt"));
  };

  const limitesMes = (ano, mes) => {
    const pad = (n) => String(n).padStart(2, "0");
    const ini = `${ano}-${pad(mes)}-01`;
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const fim = `${ano}-${pad(mes)}-${pad(ultimo)}`;
    return { ini, fim };
  };

  /* Um vínculo cobre o mês se começa até ao último dia e não acaba antes do primeiro dia. */
  const vinculoCobre = (v, ini, fim) => {
    if (v.inicio && v.inicio > fim) return false;
    if (v.fim && v.fim < ini) return false;
    return true;
  };

  const pessoaCobreMes = (p, ano, mes) => {
    const { ini, fim } = limitesMes(ano, mes);
    return p.vinculos.some((v) => vinculoCobre(v, ini, fim));
  };

  const descreverVinculos = (p) =>
    p.vinculos.map((v) => `${v.inicio || "?"}..${v.fim || "activo"}`).join("; ");

  /* Classifica uma linha do mês.
   * ctx: { index: Map<niss8, pessoa>, ja: Set<niss8>, ano, mes } */
  const classificarLinha = (row, ctx) => {
    const digitos = onlyDigits(row.niss);
    // Regra: nenhum TXT/Excel pode conter NISS 00000000 (esses registos vão só para a lista de inscrições)
    if (!digitos || /^0+$/.test(digitos)) return { estado: "sem_niss", motivo: "sem NISS (00000000 não pode ir para o TXT/Excel)" };
    if (digitos.length > 8) return { estado: "niss_invalido", motivo: "NISS com mais de 8 dígitos" };
    const niss = digitos.padStart(8, "0");
    const pessoa = ctx.index.get(niss);
    if (!pessoa) return { estado: "niss_fora_relacao", motivo: "NISS não existe na relação", niss };
    if (fold(pessoa.nome).split(" ").length < 2)
      return { estado: "nome_incompleto", motivo: "nome na relação com menos de duas palavras", niss, pessoa };
    if (ctx.ja && ctx.ja.has(niss)) return { estado: "ja_inscrito", niss, pessoa };
    if (pessoaCobreMes(pessoa, ctx.ano, ctx.mes)) return { estado: "ok", niss, pessoa };
    return {
      estado: "excluido_periodo",
      motivo: `Consta no mapa de ${ctx.ano}-${String(ctx.mes).padStart(2, "0")} mas o vínculo não cobre o período (vínculo: ${descreverVinculos(pessoa)})`,
      niss,
      pessoa,
    };
  };

  /* ---- Formato TXT (180 caracteres por linha, ASCII) ---- */
  const pad = (s, n) => String(s).slice(0, n).padEnd(n, " ");
  const digitsPad = (n, w) => String(n).replace(/\D/g, "").padStart(w, "0").slice(-w);
  const money14 = (v) => {
    const cents = Math.round((Number(String(v == null ? "" : v).replace(",", ".")) || 0) * 100);
    return cents < 0 ? "00000000000000" : digitsPad(cents, 14);
  };
  const nomeTxt = (nome) => pad(fold(nome), 70);

  /* Separa as linhas do mês em: incluidos (entram no ficheiro), excluidos (período) e bloqueados (por resolver). */
  const prepararLinhas = (rows, mes, ctx) => {
    const incluidos = [], excluidos = [], bloqueados = [];
    const contagem = { ok: 0, ja_inscrito: 0, excluido_periodo: 0, sem_niss: 0, niss_fora_relacao: 0, nome_incompleto: 0, niss_invalido: 0 };
    for (const row of rows) {
      if (!String(row.nome || "").trim() && !onlyDigits(row.niss)) continue; // linha vazia
      const c = classificarLinha(row, ctx);
      contagem[c.estado] = (contagem[c.estado] || 0) + 1;
      const base = { nome_mapa: row.nome, niss: c.niss || onlyDigits(row.niss), sal: row.sal, rem: row.rem, pagina: (Number(row.page) || 0) + 1 };
      if (c.estado === "ok" || c.estado === "ja_inscrito") incluidos.push({ ...base, pessoa: c.pessoa });
      else if (c.estado === "excluido_periodo") excluidos.push({ ...base, pessoa: c.pessoa, motivo: c.motivo });
      else bloqueados.push({ ...base, motivo: c.motivo });
    }
    return { incluidos, excluidos, bloqueados, estatisticas: { total: rows.length, ...contagem } };
  };

  /* Gera as linhas do TXT (180 caracteres, CRLF). Se houver bloqueados, ok=false e não há ficheiro.
   * opcoes.ordem: "nome" (alfabética, por omissão) ou "original" (ordem recebida). */
  const gerarTxt = (rows, mes, ctx, opcoes) => {
    const ordem = (opcoes && opcoes.ordem) || "nome";
    const prep = prepararLinhas(rows, mes, ctx);
    const { excluidos, bloqueados, estatisticas } = prep;
    const incluidos = prep.incluidos.slice();
    if (bloqueados.length) {
      return { ok: false, bloqueados, excluidos, incluidos, estatisticas, linhas: [], conteudo: "", nomeFicheiro: null };
    }
    if (ordem === "nome") incluidos.sort((a, b) => fold(a.pessoa.nome).localeCompare(fold(b.pessoa.nome), "pt"));
    const dd = "01";
    const mm = String(mes.mes).padStart(2, "0");
    const yyyy = String(mes.ano);
    const nissEmp = digitsPad(mes.niss_empresa, 9);
    const nif = digitsPad(mes.nif, 10);
    const empresa = pad(fold(mes.empresa), 70);
    const header = "00" + dd + mm + yyyy + "N" + nissEmp + " ".repeat(20) + nif + " ".repeat(10) + empresa + "00000" + " ".repeat(45);
    const data = dd + mm + yyyy;
    let sumA = 0, sumB = 0;
    const corpo = incluidos.map((r) => {
      const sal = money14(r.sal), rem = money14(r.rem);
      sumA += Number(sal); sumB += Number(rem);
      return "100" + r.niss + " ".repeat(20) + nomeTxt(r.pessoa.nome) + "00000" + sal + rem + data + " ".repeat(38);
    });
    const trailer = "99" + digitsPad(incluidos.length, 10) + digitsPad(sumA, 24) + digitsPad(sumB, 14) + " ".repeat(130);
    const linhas = [header, ...corpo, trailer];
    const errados = linhas.filter((l) => l.length !== 180);
    if (errados.length) {
      return { ok: false, erro: `${errados.length} linhas com tamanho diferente de 180`, bloqueados: [], excluidos, incluidos, estatisticas, linhas: [], conteudo: "", nomeFicheiro: null };
    }
    const nomeFicheiro = `${String(mes.niss_empresa).replace(/^0+/, "")}${yyyy}${mm}0.TXT`;
    const conteudo = linhas.join("\r\n") + "\r\n"; // o portal usa CRLF (verificado no TXT de 2014)
    return { ok: true, linhas, conteudo, nomeFicheiro, incluidos, excluidos, bloqueados: [], estatisticas, sumA, sumB };
  };

  const excluidosCsv = (excluidos) => {
    const ordenados = [...excluidos].sort((a, b) => fold(a.pessoa.nome).localeCompare(fold(b.pessoa.nome), "pt"));
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const cab = ["Nome (relação)", "NISS", "Vínculos", "Motivo", "Página", "Nome no mapa", "Salário", "Remuneração adicional"];
    const linhas = ordenados.map((r) => [
      r.pessoa.nome, r.niss, descreverVinculos(r.pessoa), r.motivo, r.pagina, r.nome_mapa, r.sal, r.rem,
    ].map(esc).join(","));
    return "\uFEFF" + [cab.map(esc).join(","), ...linhas].join("\r\n") + "\r\n";
  };

  const api = {
    fold, onlyDigits, isoFromAny, construirIndice, limitesMes, vinculoCobre, pessoaCobreMes,
    classificarLinha, prepararLinhas, gerarTxt, excluidosCsv, money14, nomeTxt, descreverVinculos,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.INSS_ELEG = api;
})(typeof window !== "undefined" ? window : globalThis);
