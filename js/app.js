/* INSS light-table reviewer. CSV stays in PDF order; XLSX is alphabetical. */
(() => {
  const COLS = ["niss", "nome", "sal", "rem"];
  const ALL = ["niss", "nome", "sal", "rem", "tot"];
  const $ = (id) => document.getElementById(id);

  const defaultView = () => ({
    zoom: 1.55,
    cropL: 0.06,
    cropR: 0.26,
    rotate: 0,
    panX: 0,
    panY: 0,
    slitTop: 0.52,
    slitH: 36,
    veil: 0.82,
  });

  const state = {
    years: [],
    year: null,
    months: [],
    month: null,
    rows: [],
    i: 0,
    col: 0,
    draft: false,
    peek: false,
    view: defaultView(),
    dragging: false,
    dragX: 0,
    dragY: 0,
    pan0x: 0,
    pan0y: 0,
  };

  const toast = (msg) => {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2800);
  };

  const num = (v) => {
    if (v == null || v === "") return 0;
    let s = String(v).replace(/\s/g, "");
    if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
    else if (s.includes(",")) s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };

  const fold = (s) =>
    String(s || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const formatKz = (v) => {
    if (v == null || v === "") return "";
    const n = typeof v === "number" ? v : num(v);
    if (!Number.isFinite(n)) return "";
    const [int, dec] = n.toFixed(2).split(".");
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + dec;
  };

  const digitsToKz = (digits) => {
    const d = String(digits || "").replace(/\D/g, "");
    if (!d) return "";
    return formatKz(Number(d) / 100);
  };

  const kzToStore = (display) => {
    const d = String(display || "").replace(/\D/g, "");
    if (!d) return "";
    return (Number(d) / 100).toFixed(2);
  };

  const toPortalName = (s) => String(s || "").toLocaleUpperCase("pt-PT");

  const relacao = () => window.INSS_RELACAO || [];

  const searchRelacao = (q, by) => {
    if (by === "niss") {
      const d = String(q || "").replace(/\D/g, "");
      if (d.length < 2) return [];
      const out = [];
      // NISS na relação tem 8 dígitos; aceitar também o formato sem zero à frente
      const alt = d.length >= 5 ? d.padStart(8, "0") : d;
      for (const r of relacao()) {
        if (String(r.niss).startsWith(d) || String(r.niss).startsWith(alt)) {
          out.push(r);
          if (out.length >= 8) break;
        }
      }
      return out;
    }
    const query = fold(q);
    if (query.length < 2) return [];
    const toks = query.split(" ");
    const exact = [];
    const rest = [];
    for (const r of relacao()) {
      const key = r.k || fold(r.nome);
      if (key === query) exact.push(r);
      else if (toks.every((t) => key.includes(t))) rest.push(r);
      if (exact.length + rest.length >= 24) break;
    }
    return exact.concat(rest).slice(0, 8);
  };

  let sugIndex = { niss: -1, nome: -1 };

  const hideSuggest = (which) => {
    ["niss", "nome"].forEach((k) => {
      if (which && k !== which) return;
      const box = $(`sug-${k}`);
      box.hidden = true;
      box.innerHTML = "";
      sugIndex[k] = -1;
    });
  };

  const pickRelacao = (item) => {
    const row = state.rows[state.i];
    if (!row || !item) return;
    row.niss = item.niss;
    row.nome = item.nome;
    $("f-niss").value = item.niss;
    $("f-nome").value = item.nome;
    $("f-niss").classList.toggle("empty", false);
    hideSuggest();
    renderElig();
    stats();
    scheduleSave();
    focusField();
  };

  const renderSuggest = (kind, items) => {
    const box = $(`sug-${kind}`);
    if (!items.length) {
      hideSuggest(kind);
      return;
    }
    box.hidden = false;
    box.innerHTML = items
      .map((r, i) => {
        const main = kind === "nome" ? r.nome : r.niss;
        const sub = kind === "nome" ? r.niss : r.nome;
        return `<button type="button" data-i="${i}" ${i === 0 ? 'aria-selected="true"' : ""}><span>${main}</span><small>${sub}</small></button>`;
      })
      .join("");
    sugIndex[kind] = 0;
    box.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pickRelacao(items[Number(btn.dataset.i)]);
      });
    });
  };

  const autoFillFromNome = (nome) => {
    const q = fold(nome);
    if (q.split(" ").length < 2) return;
    const hits = relacao().filter((r) => (r.k || fold(r.nome)) === q);
    if (hits.length === 1) {
      const row = state.rows[state.i];
      if (row && !row.niss) {
        row.niss = hits[0].niss;
        $("f-niss").value = hits[0].niss;
        $("f-niss").classList.toggle("empty", false);
        if (hits[0].nome) {
          row.nome = hits[0].nome;
          $("f-nome").value = hits[0].nome;
        }
      }
    }
  };

  /* ---------- Relação, já inscritos e elegibilidade ---------- */
  const REL_KEY = "inss-relacao-upload";
  const JA_KEY = "inss-ja-inscritos";
  const RELACAO_REPO = window.INSS_RELACAO || [];
  let relacaoMeta = null;
  let jaRepo = [];
  let idxCache = { ref: null, map: null };
  const elig = () => window.INSS_ELEG;

  const relacaoIndex = () => {
    const lista = window.INSS_RELACAO || [];
    if (idxCache.ref !== lista) {
      const map = new Map();
      for (const p of lista) map.set(p.niss, p);
      idxCache = { ref: lista, map };
    }
    return idxCache.map;
  };

  const readJa = () => {
    try {
      const v = JSON.parse(localStorage.getItem(JA_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };

  const jaSet = () => {
    const s = new Set();
    [...jaRepo, ...readJa()].forEach((x) => {
      if (x && x.niss) s.add(String(x.niss).replace(/\D/g, "").padStart(8, "0"));
    });
    return s;
  };

  const ctxElig = () => ({
    index: relacaoIndex(),
    ja: jaSet(),
    ano: Number(state.month.ano),
    mes: Number(state.month.mes),
  });

  const download = (conteudo, nome, tipo) => {
    const blob = new Blob([conteudo], { type: tipo });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = nome;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const relacaoInfo = () => {
    const el = $("rel-info");
    if (relacaoMeta) {
      el.textContent = `Relação carregada: ${relacaoMeta.ficheiro} · ${relacaoMeta.pessoas} trabalhadores · ${relacaoMeta.carregado_em}`;
    } else {
      el.textContent = `Relação do repositório (data/relacao.js) · ${RELACAO_REPO.length} trabalhadores`;
    }
  };

  const ESTADO_AVISO = {
    ok: ["ok", "✓ Vínculo cobre o mês"],
    ja_inscrito: ["ok", "✓ Já inscrito (confirmado)"],
    excluido_periodo: ["warn", "⚠ Fora do período: não entra no TXT"],
    sem_niss: ["err", "✖ Sem NISS: escolha na relação"],
    niss_fora_relacao: ["err", "✖ NISS não existe na relação"],
    nome_incompleto: ["err", "✖ Nome incompleto na relação"],
    niss_invalido: ["err", "✖ NISS inválido"],
  };

  const renderElig = () => {
    const box = $("elig");
    const row = state.rows[state.i];
    if (!row || !state.month || !elig()) {
      box.hidden = true;
      return;
    }
    const c = elig().classificarLinha(row, ctxElig());
    const [cls, texto] = ESTADO_AVISO[c.estado] || ["err", c.estado];
    let detalhe = "";
    if (c.estado === "excluido_periodo" && c.pessoa) {
      detalhe = ` · vínculo: ${elig().descreverVinculos(c.pessoa)}`;
    }
    box.hidden = false;
    box.className = `elig ${cls}`;
    box.textContent = texto + detalhe;
  };

  const marcarJaInscrito = () => {
    const row = state.rows[state.i];
    if (!row) return;
    const niss = String(row.niss || "").replace(/\D/g, "").padStart(8, "0");
    if (!String(row.niss || "").replace(/\D/g, "")) {
      toast("Escolha primeiro o NISS deste trabalhador (pela relação).");
      return;
    }
    const pessoa = relacaoIndex().get(niss);
    if (!pessoa) {
      toast("Este NISS não está na relação. Não pode ser marcado.");
      return;
    }
    const lista = readJa();
    if (!lista.some((x) => String(x.niss).padStart(8, "0") === niss)) {
      lista.push({ niss, nome: pessoa.nome, marcado_em: new Date().toISOString().slice(0, 10), mes: state.month.id });
      localStorage.setItem(JA_KEY, JSON.stringify(lista));
    }
    toast(`${pessoa.nome} marcado como já inscrito.`);
    renderElig();
    stats();
  };

  const exportarJa = () => {
    const dados = {
      descricao: "Já inscritos confirmados pelo contabilista. Passam sem filtro de período.",
      exportado_em: new Date().toISOString().slice(0, 16).replace("T", " "),
      inscritos: readJa(),
    };
    download(JSON.stringify(dados, null, 2), "ja_inscritos.json", "application/json");
    toast(`Exportados ${dados.inscritos.length} já inscritos.`);
  };

  const importarJa = async (file) => {
    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch {
      toast("Ficheiro JSON inválido.");
      return;
    }
    const novos = Array.isArray(obj) ? obj : obj.inscritos || [];
    const lista = readJa();
    const set = new Set(lista.map((x) => String(x.niss).padStart(8, "0")));
    let add = 0;
    for (const x of novos) {
      const n = String(x && x.niss ? x.niss : "").replace(/\D/g, "").padStart(8, "0");
      if (n.length === 8 && !set.has(n)) {
        lista.push({ ...x, niss: n });
        set.add(n);
        add++;
      }
    }
    localStorage.setItem(JA_KEY, JSON.stringify(lista));
    toast(`${add} já inscritos importados (${lista.length} no total).`);
    renderElig();
    stats();
  };

  const carregarRelacao = async (file) => {
    if (typeof XLSX === "undefined") {
      toast("Biblioteca Excel em falta.");
      return;
    }
    let linhas;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false }); // datas como número de série: sem fuso horário
      const ws = wb.Sheets[wb.SheetNames[0]];
      linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    } catch {
      toast("Não consegui ler esse ficheiro Excel.");
      return;
    }
    const lista = elig().construirIndice(linhas);
    if (lista.length < 100) {
      toast("Este ficheiro não parece uma relação geral (poucos trabalhadores).");
      return;
    }
    const meta = {
      ficheiro: file.name,
      carregado_em: new Date().toISOString().slice(0, 16).replace("T", " "),
      pessoas: lista.length,
      vinculos: lista.reduce((a, p) => a + p.vinculos.length, 0),
    };
    try {
      localStorage.setItem(REL_KEY, JSON.stringify({ meta, dados: lista }));
    } catch {
      toast("Relação grande demais para guardar neste browser. Usada só nesta sessão.");
    }
    window.INSS_RELACAO = lista;
    relacaoMeta = meta;
    idxCache = { ref: null, map: null };
    relacaoInfo();
    renderElig();
    stats();
    toast(`Relação atualizada: ${meta.pessoas} trabalhadores, ${meta.vinculos} vínculos.`);
  };

  const reporRelacao = () => {
    localStorage.removeItem(REL_KEY);
    window.INSS_RELACAO = RELACAO_REPO;
    relacaoMeta = null;
    idxCache = { ref: null, map: null };
    relacaoInfo();
    renderElig();
    stats();
    toast("Relação do repositório reposta.");
  };

  const baixarExcluidos = () => {
    if (!state.month || !state.rows.length) {
      toast("Sem linhas carregadas.");
      return;
    }
    const prep = elig().prepararLinhas(state.rows, state.month, ctxElig());
    if (!prep.excluidos.length) {
      toast("Nenhum excluído por período neste mês.");
      return;
    }
    download(elig().excluidosCsv(prep.excluidos), `excluidos_${state.month.id}.csv`, "text/csv;charset=utf-8");
    toast(`${prep.excluidos.length} excluídos por período (lista descarregada).`);
  };

  const avisarBloqueio = (bloqueados) => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const cab = ["nome_mapa", "pagina", "motivo"].join(",");
    const linhas = bloqueados.map((b) => [b.nome_mapa || "(sem nome)", b.pagina, b.motivo].map(esc).join(","));
    toast(`⚠️ ${bloqueados.length} trabalhador(es) por resolver. Exportação bloqueada.`);
    download([cab, ...linhas].join("\r\n"), `por_resolver_${state.month.id}.csv`, "text/csv;charset=utf-8");
  };


  const initRelacaoStore = async () => {
    try {
      const raw = localStorage.getItem(REL_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && Array.isArray(o.dados) && o.dados.length) {
          window.INSS_RELACAO = o.dados;
          relacaoMeta = o.meta || null;
        }
      }
    } catch {
      relacaoMeta = null;
    }
    try {
      const r = await fetch("data/ja_inscritos.json");
      if (r.ok) {
        const o = await r.json();
        jaRepo = Array.isArray(o.inscritos) ? o.inscritos : [];
      }
    } catch {
      jaRepo = [];
    }
    relacaoInfo();
    renderElig();
  };

  const storageKey = () => `inss-v3-${state.year}-${state.month?.id}`;
  const viewKey = () => `inss-view-v3-${state.year}-${state.month?.id}`;

  const isTotalRow = (row) => {
    const n = fold(row && row.nome);
    if (!n) return false;
    if (/^(TOTAL|TOTALL|TOTS|TOIZANGO|ROTAL|RATAL|RESUMO|TOM |TOR |TOI|ETEATAL|TOTAIG|TOTA )/.test(n)) return true;
    if (/\b(TOTAL|DEPOSITAR|ILIQUIDOS|ILLQUIDOS|RESUMO|ESCRITORIO CENTRAL)\b/.test(n)) return true;
    if (/SOBRA TOTAL|SOBREO TOTAL|SOTERO TOTAL|ESTALEIRO DE/.test(n)) return true;
    if (/\b(ESCRITORIO|ESTALEIRO|CAMAMA|ZANGO|CACUACO|CAMBAMBE)\b/.test(n) && n.split(" ").length <= 6) {
      if (/^(TOT|TOM|TOR|TOI|PO |ETEATAL)/.test(n) || /\bTOTAL\b/.test(n)) return true;
    }
    return false;
  };

  const emptyRow = (from, y) => ({
    num: "",
    nome: "",
    niss: "",
    sal: "",
    rem: "",
    tot: "",
    page: from ? from.page : 0,
    y: y == null ? (from ? from.y : 0.2) : y,
    h: from && from.h ? from.h : 0.014,
  });

  const calcularAlteracoes = () => {
    const snap = state.snapshot || [];
    let n = Math.abs(state.rows.length - snap.length);
    const m = Math.min(state.rows.length, snap.length);
    for (let k = 0; k < m; k++) if (JSON.stringify(state.rows[k]) !== snap[k]) n++;
    return n;
  };

  const atualizarIndicador = () => {
    const el = $("draft");
    if (!el) return;
    if (!state.draft && !state.naoExportado) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle("alerta", !!state.naoExportado);
    el.textContent = state.naoExportado
      ? `⚠ ${state.alteracoes} alteração(ões) só neste navegador — guarde o rascunho em ficheiro`
      : "✓ Rascunho guardado em ficheiro";
  };

  const saveDraft = () => {
    if (!state.month) return;
    const obj = { mes: state.month.id, i: state.i, rows: state.rows, guardado_em: new Date().toISOString() };
    localStorage.setItem(storageKey(), JSON.stringify(obj));
    if (window.NUVEM) NUVEM.gravar(state.month.id, obj, { pendentes: state.rows.filter((r) => !r.niss).length, alteracoes: calcularAlteracoes() });
    localStorage.setItem(viewKey(), JSON.stringify(state.view));
    state.draft = true;
    state.alteracoes = calcularAlteracoes();
    state.naoExportado = state.alteracoes > 0;
    atualizarIndicador();
  };

  let saveTimer = 0;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 350);
  };

  const guardarRascunhoFicheiro = () => {
    if (!state.month) return;
    const dados = { versao: 1, mes: state.month.id, i: state.i, rows: state.rows, guardado_em: new Date().toISOString() };
    const hora = new Date().toTimeString().slice(0, 5).replace(":", "h");
    download(JSON.stringify(dados), `rascunho_${state.month.id}_${hora}.json`, "application/json");
    state.snapshot = state.rows.map((r) => JSON.stringify(r));
    state.alteracoes = 0;
    state.naoExportado = false;
    atualizarIndicador();
    toast("Rascunho guardado em ficheiro. Guarde este ficheiro em lugar seguro.");
  };

  const carregarRascunhoFicheiro = async (file) => {
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.rows)) throw new Error("o ficheiro não tem linhas");
      if (state.month && d.mes && d.mes !== state.month.id) {
        if (!window.confirm(`Este rascunho é de ${d.mes}, e o mês aberto é ${state.month.id}. Carregar mesmo assim?`)) return;
      }
      state.rows = d.rows.map((r) => ({ ...r, nome: toPortalName(r.nome) }));
      state.i = Math.min(d.i || 0, Math.max(0, state.rows.length - 1));
      state.snapshot = state.rows.map((r) => JSON.stringify(r));
      state.alteracoes = 0;
      state.naoExportado = false;
      saveDraft();
      showRow();
      toast(`Rascunho carregado: ${state.rows.length} linhas`);
    } catch (e) {
      toast("Ficheiro de rascunho inválido: " + e.message);
    }
  };

  const exportarPendentes = () => {
    if (!state.month) return;
    const prep = elig().prepararLinhas(state.rows, state.month, ctxElig());
    const pend = prep.bloqueados;
    if (!pend.length) { toast("Não há trabalhadores por resolver. Pode exportar o TXT."); return; }
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const acaoDe = (motivo) => {
      const m = String(motivo || "");
      if (/sem NISS/i.test(m)) return "obter NISS (a pessoa não tem NISS no mapa)";
      if (/não existe na relação/i.test(m)) return "verificar NISS (não existe na relação)";
      if (/duas palavras/i.test(m)) return "completar nome na relação";
      if (/8 dígitos/i.test(m)) return "corrigir NISS";
      return "resolver";
    };
    const cab = ["pagina", "nome_mapa", "sal", "motivo", "niss", "acao"].join(",");
    const linhas = pend.map((b) => [b.pagina, b.nome_mapa, b.sal, b.motivo, b.niss || "", acaoDe(b.motivo)].map(esc).join(","));
    download([cab, ...linhas].join("\r\n"), `pendentes_${state.month.id}.csv`, "text/csv;charset=utf-8");
    toast(`${pend.length} por resolver exportados. Preencha a coluna niss e importe.`);
  };

  const parseCsvLinhas = (texto) => {
    const linhas = [];
    texto.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((ln) => {
      if (!ln.trim()) return;
      const campos = []; let cur = ""; let q = false;
      for (let k = 0; k < ln.length; k++) {
        const ch = ln[k];
        if (q) {
          if (ch === '"' && ln[k + 1] === '"') { cur += '"'; k++; }
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") { campos.push(cur); cur = ""; }
        else cur += ch;
      }
      campos.push(cur);
      linhas.push(campos);
    });
    return linhas;
  };

  const importarNissResolvidos = async (file) => {
    if (!state.month) return;
    const linhas = parseCsvLinhas(await file.text());
    if (!linhas.length) { toast("Ficheiro vazio"); return; }
    const cab = linhas.shift().map((c) => c.trim().toLowerCase());
    const iP = cab.indexOf("pagina"), iN = cab.indexOf("nome_mapa"), iS = cab.indexOf("niss");
    if (iN < 0 || iS < 0) { toast("Ficheiro sem as colunas nome_mapa e niss"); return; }
    let aplicados = 0; const naoEnc = []; const invalidos = [];
    for (const c of linhas) {
      const niss = String(c[iS] || "").replace(/\D/g, "");
      if (!niss) continue;
      if (niss.length > 8 || /^0+$/.test(niss)) { invalidos.push(c[iN]); continue; }
      const nome = toPortalName(c[iN]);
      const pag = iP >= 0 ? Number(c[iP]) : null;
      const idx = state.rows.findIndex((r) => r.nome === nome && (pag == null || Number(r.page) + 1 === pag));
      if (idx < 0) { naoEnc.push(c); continue; }
      state.rows[idx].niss = niss.padStart(8, "0");
      aplicados++;
    }
    saveDraft();
    showRow();
    if (naoEnc.length) {
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      download([linhas.length ? cab.join(",") : "", ...naoEnc.map((c) => c.map(esc).join(","))].join("\r\n"), `nao_importados_${state.month.id}.csv`, "text/csv;charset=utf-8");
    }
    toast(`NISS aplicados: ${aplicados} · não encontrados: ${naoEnc.length} · inválidos: ${invalidos.length}`);
  };

  const parseCsv = (text) => {
    const raw = text.replace(/^\uFEFF/, "").trim();
    const lines = raw.split(/\r?\n/);
    const header = lines.shift().split(",");
    const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
    return lines
      .filter(Boolean)
      .map((line) => {
        const cells = [];
        let cur = "";
        let q = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') q = !q;
          else if (ch === "," && !q) {
            cells.push(cur);
            cur = "";
          } else cur += ch;
        }
        cells.push(cur);
        const get = (k) => (cells[idx[k]] || "").trim();
        const sal = get("sal");
        const rem = get("rem");
        let tot = get("tot");
        if (sal && rem && !tot) tot = (num(sal) + num(rem)).toFixed(2);
        return {
          num: get("num"),
          nome: get("nome"),
          niss: get("niss"),
          sal,
          rem,
          tot,
          page: Number(get("page") || 0),
          y: Number(get("y") || 0),
          h: Number(get("h") || 0),
        };
      })
      .filter((r) => !isTotalRow(r));
  };

  const syncToolbar = () => {
    const v = state.view;
    $("v-zoom").value = Math.round(v.zoom * 100);
    $("v-zoom-v").textContent = `${Math.round(v.zoom * 100)}%`;
    $("v-cropL").value = Math.round(v.cropL * 100);
    $("v-cropL-v").textContent = `${Math.round(v.cropL * 100)}%`;
    $("v-cropR").value = Math.round(v.cropR * 100);
    $("v-cropR-v").textContent = `${Math.round(v.cropR * 100)}%`;
    $("v-rot").value = v.rotate;
    $("v-rot-v").textContent = `${Number(v.rotate).toFixed(1)}°`;
    $("v-slitH").value = v.slitH;
    $("v-slitH-v").textContent = String(Math.round(v.slitH));
    $("v-slitTop").value = Math.round(v.slitTop * 100);
    $("v-slitTop-v").textContent = `${Math.round(v.slitTop * 100)}%`;
    $("v-veil").value = Math.round(v.veil * 100);
    $("v-veil-v").textContent = `${Math.round(v.veil * 100)}%`;
  };

  const stats = () => {
    const ok = state.rows.filter((r) => r.niss).length;
    $("nissOk").textContent = String(ok);
    $("nissMiss").textContent = String(state.rows.length - ok);
    $("pos").textContent = state.rows.length ? `${state.i + 1}/${state.rows.length}` : "0/0";
    const pages = (state.month && state.month.pages) || [];
    const row = state.rows[state.i];
    $("pag").textContent = pages.length ? `${(row ? row.page : 0) + 1}/${pages.length}` : "0/0";
  };

  const layoutTunnel = () => {
    const row = state.rows[state.i];
    const img = $("scan");
    const well = $("well");
    const v = state.view;
    if (!img.naturalHeight) return;
    const wellH = well.clientHeight;
    const wellW = well.clientWidth;
    const vis = Math.max(0.25, 1 - v.cropL - v.cropR);
    const drawW = (wellW / vis) * v.zoom;
    const drawH = drawW * (img.naturalHeight / img.naturalWidth);
    img.style.width = `${drawW}px`;
    img.style.height = `${drawH}px`;

    const slitH = v.slitH;
    const slitTop = wellH * v.slitTop;
    document.documentElement.style.setProperty("--slit", `${slitH}px`);
    document.documentElement.style.setProperty("--veil", String(v.veil));
    $("slit").style.top = `${slitTop}px`;
    $("slit").style.height = `${slitH}px`;
    $("veilTop").style.height = `${slitTop}px`;
    $("veilBot").style.top = `${slitTop + slitH}px`;
    $("veilBot").style.height = `${Math.max(0, wellH - slitTop - slitH)}px`;

    const yFrac = row && row.y > 0 && row.y < 1 ? row.y : 0.2;
    const rowY = yFrac * drawH;
    const left = -v.cropL * drawW + v.panX;
    const top = slitTop + slitH / 2 - rowY + v.panY;
    img.style.left = `${left}px`;
    img.style.top = `${top}px`;
    img.style.transformOrigin = `${(v.cropL + vis / 2) * 100}% ${yFrac * 100}%`;
    img.style.transform = `rotate(${v.rotate}deg)`;
    $("slitTag").textContent = String((row && (row.num || state.i + 1)) || 1)
      .toString()
      .padStart(3, "0");
  };

  const focusField = () => {
    const row = state.rows[state.i];
    if (!row) return;
    if (!row.niss) state.col = 0;
    const el = $(`f-${COLS[state.col]}`) || $("f-niss");
    el.focus();
    el.select();
  };

  const showRow = (opts = {}) => {
    const row = state.rows[state.i];
    if (!row) {
      ALL.forEach((c) => ($(`f-${c}`).value = ""));
      stats();
      return;
    }
    $("f-niss").value = row.niss || "";
    $("f-nome").value = toPortalName(row.nome || "");
    $("f-sal").value = formatKz(row.sal);
    $("f-rem").value = formatKz(row.rem === "" || row.rem == null ? "" : row.rem);
    $("f-tot").value = formatKz(row.tot);
    hideSuggest();
    $("f-niss").classList.toggle("empty", !row.niss);
    const page = state.month.pages[row.page] || state.month.pages[0];
    const img = $("scan");
    const want = page || "";
    if (want) {
      const loaded = decodeURI(img.src || "");
      if (!loaded.endsWith(want) && !loaded.includes(encodeURI(want))) {
        img.onload = () => {
          layoutTunnel();
          if (!opts.keepFocus) focusField();
        };
        img.src = want;
      } else {
        layoutTunnel();
      }
    } else {
      // Clear image when no pages available (e.g., 2018)
      img.src = "";
      img.removeAttribute("src");
      layoutTunnel();
    }
    renderElig();
    stats();
    if (!opts.keepFocus) {
      requestAnimationFrame(focusField);
    }
  };

  const applyField = (col, value) => {
    const row = state.rows[state.i];
    if (!row) return;
    row[col] = value;
    if (col === "sal" || col === "rem") {
      row.tot = (num(row.sal) + num(row.rem)).toFixed(2);
      $("f-tot").value = formatKz(row.tot);
    }
    $("f-niss").classList.toggle("empty", !row.niss);
    renderElig();
    stats();
    scheduleSave();
  };

  const goto = (i) => {
    if (!state.rows.length) return;
    const dir = i >= state.i ? 1 : -1;
    let j = Math.max(0, Math.min(state.rows.length - 1, i));
    while (j >= 0 && j < state.rows.length && isTotalRow(state.rows[j])) {
      j += dir;
    }
    if (j < 0 || j >= state.rows.length) return;
    state.i = j;
    showRow();
    scheduleSave();
  };

  const gotoPage = (delta) => {
    const row = state.rows[state.i];
    if (!row) return;
    const pages = state.month.pages.length;
    const target = Math.max(0, Math.min(pages - 1, row.page + delta));
    let idx = state.rows.findIndex((r) => r.page === target);
    if (delta < 0) {
      for (let i = state.rows.length - 1; i >= 0; i--) {
        if (state.rows[i].page === target) {
          idx = i;
          break;
        }
      }
    }
    if (idx >= 0) goto(idx);
    else toast("Não há mais páginas");
  };

  const insertAt = (offset) => {
    const cur = state.rows[state.i] || emptyRow(null, 0.2);
    const y =
      offset < 0
        ? Math.max(0.02, (cur.y || 0.2) - (cur.h || 0.014))
        : Math.min(0.98, (cur.y || 0.2) + (cur.h || 0.014));
    const row = emptyRow(cur, y);
    const at = Math.max(0, state.i + (offset < 0 ? 0 : 1));
    state.rows.splice(at, 0, row);
    state.i = at;
    state.col = 1;
    showRow();
    scheduleSave();
    toast(offset < 0 ? "Linha inserida acima" : "Linha inserida abaixo");
  };

  const deleteRow = () => {
    if (!state.rows.length) return;
    state.rows.splice(state.i, 1);
    if (state.i >= state.rows.length) state.i = Math.max(0, state.rows.length - 1);
    showRow();
    scheduleSave();
    toast("Linha apagada");
  };

  const loadView = () => {
    try {
      const raw = localStorage.getItem(viewKey());
      state.view = raw ? { ...defaultView(), ...JSON.parse(raw) } : defaultView();
    } catch {
      state.view = defaultView();
    }
    syncToolbar();
  };

  const loadMonth = async (month) => {
    state.month = month;
    state.year = String(month.ano);
    if (location.hash !== `#${month.id}`) location.hash = month.id;
    $("empresa").textContent = `NISS ${month.niss_empresa}`;
    $("filehint").textContent = `Ficheiro final: ${month.filename} (alfabético)`;
    const hasImages = state.month.pages && state.month.pages.length > 0;
    if (!hasImages) {
      $("filehint").textContent = "Mapa original não disponível para este mês. Use apenas os dados extraídos.";
    }
    document.querySelectorAll(".months button").forEach((b) => {
      b.setAttribute("aria-current", b.dataset.id === month.id ? "true" : "false");
    });
    loadView();
    const res = await fetch(month.csv);
    if (!res.ok) {
      toast(`CSV em falta: ${month.csv}`);
      state.rows = [];
      showRow();
      return;
    }
    const text = await res.text();
    let rows = parseCsv(text);
    let saved = localStorage.getItem(storageKey());
    if (window.NUVEM && NUVEM.utilizador()) {
      const remoto = await NUVEM.carregarRascunho(month.id).catch((e) => { toast("Nuvem: " + e.message); return null; });
      let dataLocal = new Date(0);
      try { if (saved) dataLocal = new Date(JSON.parse(saved).guardado_em || 0); } catch { dataLocal = new Date(0); }
      if (remoto && Array.isArray(remoto.rows) && new Date(remoto.atualizado_em) > dataLocal) {
        saved = JSON.stringify({ mes: remoto.mes, i: remoto.i, rows: remoto.rows, guardado_em: remoto.atualizado_em });
        toast(`Rascunho da nuvem (por ${remoto.atualizado_por}) carregado.`);
      }
    }
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        if (Array.isArray(draft.rows) && draft.rows.length) {
          rows = draft.rows.filter((r) => !isTotalRow(r));
          state.i = Math.min(draft.i || 0, rows.length - 1);
          state.draft = true;
          $("draft").hidden = false;
        }
      } catch {
        state.draft = false;
      }
    } else {
      state.draft = false;
      $("draft").hidden = true;
      state.i = 0;
    }
    state.rows = rows.map((r) => ({ ...r, nome: toPortalName(r.nome) }));
    state.snapshot = parseCsv(text).filter((r) => !isTotalRow(r)).map((r) => JSON.stringify({ ...r, nome: toPortalName(r.nome) }));
    state.alteracoes = calcularAlteracoes();
    state.naoExportado = state.alteracoes > 0;
    atualizarIndicador();
    state.col = 0;
    showRow();
  };

  const renderConta = () => {
    const u = window.NUVEM && NUVEM.utilizador();
    const nome = u ? u.nome : "";
    $("perfil-nome").textContent = nome || "Sem perfil";
    $("perfil-avatar").textContent = nome ? nome[0] : "?";
    $("perfil-gate").hidden = !!u;
  };

  const escolherPerfil = (nome) => {
    if (!window.NUVEM) return;
    NUVEM.definirPerfil(nome);
    $("perfil-gate").hidden = true;
    renderConta();
    renderEquipa();
    toast(`Bem-vindo, ${nome}`);
    if (state.month) loadMonth(state.month);
    if (window.TOUR && TOUR.primeiraVisita()) setTimeout(() => TOUR.start(), 600);
  };

  const renderEquipa = async () => {
    const box = $("equipa-lista");
    if (!window.NUVEM || !NUVEM.utilizador()) { box.textContent = "Entre na sua conta para ver o estado da equipa."; return; }
    try {
      const meses = await NUVEM.listarMeses();
      box.innerHTML = "";
      if (!meses.length) { box.textContent = "Ainda não há meses registados."; return; }
      meses.forEach((m) => {
        const linha = document.createElement("div");
        const quando = m.atualizado_em ? new Date(m.atualizado_em).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "";
        const estado = m.estado === "em_edicao" ? `em edição por ${m.em_edicao_por || "?"}` : m.estado.replace("_", " ");
        linha.textContent = `${m.id} · ${estado} · ${m.pendentes} por resolver · ${m.alteracoes} alterações · última gravação: ${m.atualizado_por || "?"} ${quando}`;
        box.appendChild(linha);
      });
    } catch (e) { box.textContent = "Erro ao ler a equipa: " + e.message; }
  };

  const buildYears = () => {
    const cfg = window.INSS_CONFIG || { anos: {} };
    state.years = Object.keys(cfg.anos).map(Number).sort((a, b) => a - b);
    const yearSelector = $("yearSelector");
    yearSelector.innerHTML = "";
    state.years.forEach((ano) => {
      const btn = document.createElement("button");
      btn.textContent = ano;
      btn.dataset.year = ano;
      btn.addEventListener("click", () => {
        state.year = String(ano);
        document.querySelectorAll(".year-selector button").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
        buildMonths(ano);
      });
      yearSelector.appendChild(btn);
    });
    if (state.years.length) {
      // Se o link indicar um mês (#AAAA-MM), abre o ano desse mês; senão, o primeiro ano
      const hashAno = (location.hash.match(/^#(\d{4})-\d{2}$/) || [])[1];
      const anoInicial = state.years.map(String).includes(hashAno) ? hashAno : String(state.years[0]);
      state.year = anoInicial;
      document.querySelector(`.year-selector button[data-year="${anoInicial}"]`).classList.add("active");
    }
  };

  const buildMonths = (ano) => {
    const cfg = window.INSS_CONFIG || { anos: {} };
    state.months = (cfg.anos[String(ano)] || []);
    const nav = $("months");
    nav.innerHTML = "";
    state.months.forEach((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.id = m.id;
      b.textContent = String(m.mes).padStart(2, "0");
      b.title = m.label;
      b.addEventListener("click", () => loadMonth(m));
      nav.appendChild(b);
    });
  };

  const generateXlsx = () => {
    if (typeof XLSX === "undefined") {
      toast("Biblioteca Excel em falta.");
      return;
    }
    const m = state.month;
    const prep = elig().prepararLinhas(state.rows, m, ctxElig());
    if (prep.bloqueados.length) {
      avisarBloqueio(prep.bloqueados);
      return;
    }
    const rows = prep.incluidos
      .map((x) => ({ niss: x.niss, nome: x.pessoa.nome, sal: x.sal, rem: x.rem }))
      .sort((a, b) => fold(a.nome).localeCompare(fold(b.nome), "pt"));
    const aoa = [];
    aoa[0] = ["Folha de Remuneração Normal | Complementar"];
    aoa[1] = [" Mês de referência: ", `${m.ano}-${String(m.mes).padStart(2, "0")}`];
    aoa[2] = ["Tipo Ficheiro:", "Normal"];
    aoa[3] = ["Informações do Contribuinte"];
    aoa[4] = ["Nome:", m.empresa];
    aoa[5] = ["NISS:", m.niss_empresa];
    aoa[6] = ["NIF:", m.nif];
    aoa[8] = ["Informações dos Trabalhadores"];
    aoa[9] = ["Inscrição Inss", "Nome", "Salário Base", "Remunerações Adicionais", "Total"];
    rows.forEach((r, idx) => {
      const excelRow = 11 + idx;
      aoa[10 + idx] = [r.niss, toPortalName(r.nome), num(r.sal), num(r.rem), { t: "n", f: `C${excelRow}+D${excelRow}` }];
    });
    const lastData = 10 + rows.length;
    aoa[lastData] = ["Fim Informações dos Trabalhadores", "", "", "", { t: "n", f: `SUM(E11:E${lastData})` }];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 16 }, { wch: 42 }, { wch: 16 }, { wch: 24 }, { wch: 16 }];
    for (let R = 10; R < lastData; R++) {
      for (const C of [2, 3, 4]) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[addr]) ws[addr].z = "#,##0.00";
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Folha");
    XLSX.writeFile(wb, m.filename || "mapa.xlsx");
    const extra = prep.excluidos.length ? ` · ${prep.excluidos.length} excluídos por período (ver lista)` : "";
    toast(`Gerado ${m.filename} · ${rows.length} trabalhadores${extra}`);
  };

  const pad = (s, n) => String(s).slice(0, n).padEnd(n, " ");
  const digits = (n, w) => String(n).replace(/\D/g, "").padStart(w, "0").slice(-w);

  const txtName = (s) => {
    const particles = new Set(["DA", "DE", "DO", "DOS", "DAS", "E", "Y", "DEL"]);
    const folded = fold(s);
    const titled = folded
      .split(" ")
      .filter(Boolean)
      .map((w, i) => {
        if (i > 0 && particles.has(w)) return w.toLowerCase();
        return w.charAt(0) + w.slice(1).toLowerCase();
      })
      .join(" ");
    return pad(titled, 70);
  };

  const money14 = (v) => {
    const cents = Math.round(num(v) * 100);
    if (cents < 0) return "00000000000000";
    return digits(cents, 14);
  };

  const generateTxt = () => {
    const m = state.month;
    const res = elig().gerarTxt(state.rows, m, ctxElig(), { ordem: "nome" });
    if (!res.ok) {
      if (res.bloqueados && res.bloqueados.length) {
        avisarBloqueio(res.bloqueados);
      } else {
        toast(`Erro interno: ${res.erro || "não foi possível gerar o ficheiro"}`);
      }
      return;
    }
    download(res.conteudo, res.nomeFicheiro, "text/plain;charset=US-ASCII");
    const extra = res.excluidos.length ? ` · ${res.excluidos.length} excluídos por período (ver lista)` : "";
    toast(`Gerado ${res.nomeFicheiro} · ${res.incluidos.length} trabalhadores${extra}`);
  };

  const bindView = () => {
    const map = [
      ["v-zoom", (v) => (state.view.zoom = Number(v) / 100)],
      ["v-cropL", (v) => (state.view.cropL = Number(v) / 100)],
      ["v-cropR", (v) => (state.view.cropR = Number(v) / 100)],
      ["v-rot", (v) => (state.view.rotate = Number(v))],
      ["v-slitH", (v) => (state.view.slitH = Number(v))],
      ["v-slitTop", (v) => (state.view.slitTop = Number(v) / 100)],
      ["v-veil", (v) => (state.view.veil = Number(v) / 100)],
    ];
    map.forEach(([id, apply]) => {
      $(id).addEventListener("input", (e) => {
        apply(e.target.value);
        syncToolbar();
        layoutTunnel();
        scheduleSave();
      });
      $(id).addEventListener("change", () => focusField());
    });
    $("btn-reset-view").addEventListener("click", () => {
      state.view = defaultView();
      syncToolbar();
      layoutTunnel();
      scheduleSave();
    });

    const well = $("well");
    well.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".toolbar")) return;
      state.dragging = true;
      well.classList.add("drag");
      state.dragX = e.clientX;
      state.dragY = e.clientY;
      state.pan0x = state.view.panX;
      state.pan0y = state.view.panY;
      well.setPointerCapture(e.pointerId);
    });
    well.addEventListener("pointermove", (e) => {
      if (!state.dragging) return;
      state.view.panX = state.pan0x + (e.clientX - state.dragX);
      state.view.panY = state.pan0y + (e.clientY - state.dragY);
      layoutTunnel();
    });
    well.addEventListener("pointerup", () => {
      if (!state.dragging) return;
      state.dragging = false;
      well.classList.remove("drag");
      scheduleSave();
    });
    well.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.94 : 1.06;
        state.view.zoom = Math.min(3.2, Math.max(0.9, state.view.zoom * factor));
        syncToolbar();
        layoutTunnel();
        scheduleSave();
      },
      { passive: false }
    );
  };

  const sugKind = () => {
    if (!$("sug-nome").hidden) return "nome";
    if (!$("sug-niss").hidden) return "niss";
    return null;
  };

  const moveSuggest = (kind, dir) => {
    const box = $(`sug-${kind}`);
    const btns = [...box.querySelectorAll("button")];
    if (!btns.length) return;
    sugIndex[kind] = (sugIndex[kind] + dir + btns.length) % btns.length;
    btns.forEach((b, i) => b.setAttribute("aria-selected", i === sugIndex[kind] ? "true" : "false"));
    btns[sugIndex[kind]].scrollIntoView({ block: "nearest" });
  };

  const bind = () => {
    $("f-niss").addEventListener("focus", () => {
      state.col = 0;
      $("f-niss").select();
    });
    $("f-niss").addEventListener("blur", () => setTimeout(() => hideSuggest("niss"), 150));
    $("f-niss").addEventListener("input", () => {
      const v = $("f-niss").value.replace(/\D/g, "");
      $("f-niss").value = v;
      applyField("niss", v);
      const items = searchRelacao(v, "niss");
      renderSuggest("niss", items);
      if (items.length === 1 && v.length >= 5 && items[0].niss === v) pickRelacao(items[0]);
    });

    $("f-nome").addEventListener("focus", () => {
      state.col = 1;
      $("f-nome").select();
    });
    $("f-nome").addEventListener("blur", () => setTimeout(() => hideSuggest("nome"), 150));
    $("f-nome").addEventListener("input", () => {
      const up = toPortalName($("f-nome").value);
      $("f-nome").value = up;
      applyField("nome", up);
      const items = searchRelacao(up, "nome");
      renderSuggest("nome", items);
      autoFillFromNome(up);
    });

    ["sal", "rem"].forEach((col) => {
      const el = $(`f-${col}`);
      el.addEventListener("focus", () => {
        state.col = COLS.indexOf(col);
        el.select();
      });
      el.addEventListener("input", () => {
        const formatted = digitsToKz(el.value);
        el.value = formatted;
        applyField(col, kzToStore(formatted));
      });
    });
    $("f-tot").addEventListener("focus", () => $("f-tot").select());
    $("btn-prev").addEventListener("click", () => goto(state.i - 1));
    $("btn-next").addEventListener("click", () => goto(state.i + 1));
    $("btn-page-prev").addEventListener("click", () => gotoPage(-1));
    $("btn-page-next").addEventListener("click", () => gotoPage(1));
    $("btn-ins-above").addEventListener("click", () => insertAt(-1));
    $("btn-ins-below").addEventListener("click", () => insertAt(1));
    $("btn-del").addEventListener("click", () => deleteRow());
    $("rel-file").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) carregarRelacao(f);
      e.target.value = "";
    });
    $("btn-rel-repor").addEventListener("click", reporRelacao);
    document.querySelectorAll(".perfil-opcao").forEach((b) => b.addEventListener("click", () => escolherPerfil(b.dataset.perfil)));
    $("perfil-chip").addEventListener("click", () => { $("perfil-gate").hidden = false; });
    $("btn-ferramentas").addEventListener("click", () => { $("modal-ferramentas").hidden = false; renderEquipa(); });
    $("btn-fechar-ferramentas").addEventListener("click", () => { $("modal-ferramentas").hidden = true; });
    $("modal-ferramentas").addEventListener("click", (e) => { if (e.target.id === "modal-ferramentas") $("modal-ferramentas").hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("modal-ferramentas").hidden = true; });
    $("btn-tutorial").addEventListener("click", () => { if (window.TOUR) TOUR.start(); });
    $("btn-equipa-atualizar").addEventListener("click", renderEquipa);
    if (window.NUVEM) {
      NUVEM.init().then(() => { renderConta(); renderEquipa(); }).catch(() => renderConta());
      setInterval(renderEquipa, 60000);
    }
    renderConta();
    $("btn-draft-save").addEventListener("click", guardarRascunhoFicheiro);
    $("draft-file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) carregarRascunhoFicheiro(f); e.target.value = ""; });
    $("btn-pend").addEventListener("click", exportarPendentes);
    $("nissimp-file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importarNissResolvidos(f); e.target.value = ""; });
    $("btn-ja").addEventListener("click", marcarJaInscrito);
    $("btn-ja-export").addEventListener("click", exportarJa);
    $("ja-file").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) importarJa(f);
      e.target.value = "";
    });
    $("btn-excl").addEventListener("click", baixarExcluidos);
    initRelacaoStore();
    $("btn-xlsx").addEventListener("click", generateXlsx);
    $("btn-txt").addEventListener("click", generateTxt);
    $("btn-discard").addEventListener("click", () => {
      localStorage.removeItem(storageKey());
      state.draft = false;
      $("draft").hidden = true;
      loadMonth(state.month);
      toast("Rascunho descartado");
    });
    bindView();
    window.addEventListener("resize", layoutTunnel);
    window.addEventListener("beforeunload", (e) => {
      saveDraft();
      if (state.naoExportado) { e.preventDefault(); e.returnValue = ""; }
    });

    document.addEventListener("keydown", (e) => {
      if (e.target && e.target.type === "range") return;
      const kind = sugKind();
      if (kind && ["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(e.key)) {
        if (e.key === "Escape" || e.key === "Tab") {
          hideSuggest(kind);
          if (e.key === "Escape") e.preventDefault();
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveSuggest(kind, 1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          moveSuggest(kind, -1);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const btn = $(`sug-${kind}`).querySelector('button[aria-selected="true"]');
          if (btn) btn.dispatchEvent(new Event("mousedown"));
          return;
        }
      }
      if (e.key === "Shift" && !e.ctrlKey && !e.metaKey) {
        $("well").classList.add("peek");
        state.peek = true;
      }
      if ((e.code === "Space" || e.key === "Shift") && e.code === "Space" && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        $("well").classList.add("peek");
        state.peek = true;
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          insertAt(-1);
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          insertAt(1);
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          deleteRow();
          return;
        }
      }
      if (e.key === "PageDown") {
        e.preventDefault();
        gotoPage(1);
        return;
      }
      if (e.key === "PageUp") {
        e.preventDefault();
        gotoPage(-1);
        return;
      }
      if (e.key === "ArrowDown" && !e.ctrlKey) {
        e.preventDefault();
        goto(state.i + 1);
      } else if (e.key === "ArrowUp" && !e.ctrlKey) {
        e.preventDefault();
        goto(state.i - 1);
      } else if (e.key === "ArrowLeft" && document.activeElement.tagName === "INPUT") {
        if (document.activeElement.selectionStart === 0) {
          e.preventDefault();
          state.col = (state.col + COLS.length - 1) % COLS.length;
          $(`f-${COLS[state.col]}`).focus();
        }
      } else if (e.key === "ArrowRight" && document.activeElement.tagName === "INPUT") {
        const el = document.activeElement;
        if (el.selectionEnd === el.value.length) {
          e.preventDefault();
          state.col = (state.col + 1) % COLS.length;
          $(`f-${COLS[state.col]}`).focus();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (state.col < COLS.length - 1) {
          state.col += 1;
          $(`f-${COLS[state.col]}`).focus();
        } else {
          state.col = 0;
          goto(state.i + 1);
        }
      }
    });
    document.addEventListener("keyup", (e) => {
      if (e.key === "Shift" || e.code === "Space") {
        $("well").classList.remove("peek");
        state.peek = false;
      }
    });
  };

  const boot = async () => {
    buildYears();
    if (state.year) {
      buildMonths(state.year);
      const hashMonth = location.hash.replace("#", "");
      const firstMonth = state.months.find((m) => m.id === hashMonth) || state.months[0];
      if (firstMonth) {
        await loadMonth(firstMonth);
      }
    }
    bind();
    window.addEventListener("hashchange", () => {
      const id = location.hash.replace("#", "");
      const m = state.months.find((x) => x.id === id);
      if (m && (!state.month || m.id !== state.month.id)) loadMonth(m);
    });
  };

  boot();
})();
