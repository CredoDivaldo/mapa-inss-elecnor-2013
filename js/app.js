/* INSS light-table reviewer. CSV stays in PDF order; XLSX is alphabetical. */
(() => {
  const COLS = ["niss", "nome", "sal", "rem", "tot"];
  const $ = (id) => document.getElementById(id);

  const state = {
    months: [],
    month: null,
    rows: [],
    i: 0,
    col: 0,
    draft: false,
    peek: false,
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
    const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  const money = (v) => {
    const n = num(v);
    return n ? n.toFixed(2) : "";
  };

  const storageKey = () => `inss-${state.month.id}`;

  const saveDraft = () => {
    const payload = {
      i: state.i,
      rows: state.rows.map((r) => ({
        num: r.num,
        nome: r.nome,
        niss: r.niss,
        sal: r.sal,
        rem: r.rem,
        tot: r.tot,
        page: r.page,
        y: r.y,
        h: r.h,
      })),
    };
    localStorage.setItem(storageKey(), JSON.stringify(payload));
    state.draft = true;
    $("draft").hidden = false;
  };

  let saveTimer = 0;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 350);
  };

  const parseCsv = (text) => {
    const raw = text.replace(/^\uFEFF/, "").trim();
    const lines = raw.split(/\r?\n/);
    const header = lines.shift().split(",");
    const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
    return lines.filter(Boolean).map((line) => {
      const cells = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          q = !q;
        } else if (ch === "," && !q) {
          cells.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
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
    });
  };

  const stats = () => {
    const ok = state.rows.filter((r) => r.niss).length;
    $("nissOk").textContent = String(ok);
    $("nissMiss").textContent = String(state.rows.length - ok);
    $("pos").textContent = state.rows.length
      ? `${state.i + 1}/${state.rows.length}`
      : "0/0";
  };

  const layoutTunnel = () => {
    const row = state.rows[state.i];
    const img = $("scan");
    const well = $("well");
    if (!row || !img.naturalHeight) return;
    const wellH = well.clientHeight;
    const wellW = well.clientWidth;
    const ratio = img.naturalWidth / img.naturalHeight;
    let drawW = wellW * 0.96;
    let drawH = drawW / ratio;
    if (drawH < wellH * 1.05) {
      drawH = wellH * 1.35;
      drawW = drawH * ratio;
    }
    img.style.width = `${drawW}px`;
    img.style.height = `${drawH}px`;
    const yFrac = row.y > 0 && row.y < 1 ? row.y : 0.2;
    const hFrac = row.h > 0 && row.h < 0.2 ? row.h : 0.028;
    const slitH = Math.max(46, Math.min(90, hFrac * drawH * 1.8));
    document.documentElement.style.setProperty("--slit", `${slitH}px`);
    const slitTop = wellH * 0.36;
    $("slit").style.top = `${slitTop}px`;
    $("slit").style.height = `${slitH}px`;
    $("veilTop").style.height = `${slitTop}px`;
    $("veilBot").style.top = `${slitTop + slitH}px`;
    $("veilBot").style.height = `${Math.max(0, wellH - slitTop - slitH)}px`;
    const rowY = yFrac * drawH;
    const imgTop = slitTop + slitH / 2 - rowY;
    img.style.top = `${imgTop}px`;
    $("slitTag").textContent = String(row.num || state.i + 1).padStart(3, "0");
  };

  const showRow = () => {
    const row = state.rows[state.i];
    if (!row) return;
    $("f-niss").value = row.niss || "";
    $("f-nome").value = row.nome || "";
    $("f-sal").value = row.sal || "";
    $("f-rem").value = row.rem || "";
    $("f-tot").value = row.tot || "";
    $("f-niss").classList.toggle("empty", !row.niss);
    const page = state.month.pages[row.page] || state.month.pages[0];
    const img = $("scan");
    if (page && !img.src.endsWith(page) && !img.src.includes(encodeURI(page))) {
      img.onload = () => layoutTunnel();
      img.src = page;
    } else {
      layoutTunnel();
    }
    stats();
    const input = $(`f-${COLS[state.col]}`);
    if (input && document.activeElement && COLS.includes(document.activeElement.dataset.col)) {
      input.focus();
      input.select();
    }
  };

  const applyField = (col, value) => {
    const row = state.rows[state.i];
    if (!row) return;
    row[col] = value;
    if (col === "sal" || col === "rem") {
      row.tot = (num(row.sal) + num(row.rem)).toFixed(2);
      $("f-tot").value = row.tot;
    }
    $("f-niss").classList.toggle("empty", !row.niss);
    stats();
    scheduleSave();
  };

  const goto = (i) => {
    if (!state.rows.length) return;
    state.i = Math.max(0, Math.min(state.rows.length - 1, i));
    showRow();
    scheduleSave();
  };

  const loadMonth = async (month) => {
    state.month = month;
    if (location.hash !== `#${month.id}`) location.hash = month.id;
    $("empresa").textContent = `${month.empresa || "ELECNOR"} · NISS ${month.niss_empresa} · ${month.label}`;
    $("filehint").textContent = `Ficheiro final: ${month.filename} (alfabético)`;
    document.querySelectorAll(".months button").forEach((b) => {
      b.setAttribute("aria-current", b.dataset.id === month.id ? "true" : "false");
    });
    const res = await fetch(month.csv);
    if (!res.ok) {
      toast(`CSV em falta: ${month.csv}`);
      state.rows = [];
      showRow();
      return;
    }
    const text = await res.text();
    let rows = parseCsv(text);
    const saved = localStorage.getItem(storageKey());
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        if (draft.rows && draft.rows.length === rows.length) {
          rows = draft.rows;
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
    state.rows = rows;
    state.col = 0;
    const list = $("niss-list");
    list.innerHTML = "";
    const seen = new Set();
    for (const r of rows) {
      if (r.niss && !seen.has(r.niss)) {
        seen.add(r.niss);
        const opt = document.createElement("option");
        opt.value = r.niss;
        opt.label = r.nome;
        list.appendChild(opt);
      }
    }
    showRow();
  };

  const buildMonths = () => {
    const cfg = window.INSS_CONFIG || { months: [] };
    state.months = cfg.months || [];
    const nav = $("months");
    nav.innerHTML = "";
    for (const m of state.months) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.id = m.id;
      b.textContent = String(m.mes).padStart(2, "0");
      b.title = m.label;
      b.addEventListener("click", () => loadMonth(m));
      nav.appendChild(b);
    }
  };

  const generateXlsx = () => {
    if (typeof XLSX === "undefined") {
      toast("Biblioteca Excel em falta.");
      return;
    }
    const m = state.month;
    const rows = state.rows
      .filter((r) => (r.nome || "").trim())
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt", { sensitivity: "base" }));
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
      aoa[10 + idx] = [
        r.niss || "",
        r.nome,
        num(r.sal),
        num(r.rem),
        { t: "n", f: `C${excelRow}+D${excelRow}` },
      ];
    });
    const lastData = 10 + rows.length; // 1-based last worker row
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
    toast(`Gerado ${m.filename} · ${rows.length} trabalhadores`);
  };

  const bind = () => {
    COLS.forEach((col, idx) => {
      const el = $(`f-${col}`);
      el.addEventListener("focus", () => {
        state.col = idx;
        el.select();
      });
      el.addEventListener("input", () => applyField(col, el.value));
    });
    $("btn-prev").addEventListener("click", () => goto(state.i - 1));
    $("btn-next").addEventListener("click", () => goto(state.i + 1));
    $("btn-xlsx").addEventListener("click", generateXlsx);
    $("btn-discard").addEventListener("click", () => {
      localStorage.removeItem(storageKey());
      state.draft = false;
      $("draft").hidden = true;
      loadMonth(state.month);
      toast("Rascunho descartado");
    });
    window.addEventListener("resize", layoutTunnel);
    window.addEventListener("beforeunload", saveDraft);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Shift" || (e.code === "Space" && document.activeElement.tagName !== "INPUT")) {
        if (e.code === "Space") e.preventDefault();
        $("well").classList.add("peek");
        state.peek = true;
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        goto(state.i + 1);
      } else if (e.key === "ArrowUp") {
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
          $(`f-${COLS[0]}`).focus();
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
    buildMonths();
    bind();
    window.addEventListener("hashchange", () => {
      const id = location.hash.replace("#", "");
      const m = state.months.find((x) => x.id === id);
      if (m && (!state.month || m.id !== state.month.id)) loadMonth(m);
    });
    const wanted = location.hash.replace("#", "");
    const first = state.months.find((m) => m.id === wanted) || state.months[0];
    if (first) await loadMonth(first);
    else toast("config.js sem meses");
  };

  boot();
})();
