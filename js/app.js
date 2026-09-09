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
    const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  const storageKey = () => `inss-${state.month.id}`;
  const viewKey = () => `inss-view-${state.month.id}`;

  const isTotalRow = (row) => {
    const n = String(row.nome || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/^[^\w]+/, "")
      .trim();
    if (!n) return false;
    if (/^(TOTAL|TOTALL|TOTS|TOIZANGO|ROTAL|RATAL|RESUMO|TOM |TOR |TOI|ETEATAL|TOTAIG)/.test(n)) return true;
    if (/\b(TOTAL|DEPOSITAR|ILIQUIDOS|ILLQUIDOS|RESUMO|ESCRITORIO CENTRAL)\b/.test(n)) return true;
    if (/SOBRA TOTAL|SOBREO TOTAL|SOTERO TOTAL|ESTALEIRO DE/.test(n)) return true;
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

  const saveDraft = () => {
    if (!state.month) return;
    localStorage.setItem(
      storageKey(),
      JSON.stringify({
        i: state.i,
        rows: state.rows,
      })
    );
    localStorage.setItem(viewKey(), JSON.stringify(state.view));
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
    $("f-nome").value = row.nome || "";
    $("f-sal").value = row.sal || "";
    $("f-rem").value = row.rem || "";
    $("f-tot").value = row.tot || "";
    $("f-niss").classList.toggle("empty", !row.niss);
    const page = state.month.pages[row.page] || state.month.pages[0];
    const img = $("scan");
    const want = page || "";
    const loaded = decodeURI(img.src || "");
    if (want && !loaded.endsWith(want) && !loaded.includes(encodeURI(want))) {
      img.onload = () => {
        layoutTunnel();
        if (!opts.keepFocus) focusField();
      };
      img.src = want;
    } else {
      layoutTunnel();
    }
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
    if (location.hash !== `#${month.id}`) location.hash = month.id;
    $("empresa").textContent = `${month.empresa || "ELECNOR"} · NISS ${month.niss_empresa} · ${month.label}`;
    $("filehint").textContent = `Ficheiro final: ${month.filename} (alfabético)`;
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
    const saved = localStorage.getItem(storageKey());
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
      .filter((r) => (r.nome || "").trim() && !isTotalRow(r))
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
    const lastData = 10 + rows.length;
    aoa[lastData] = [
      "Fim Informações dos Trabalhadores",
      "",
      "",
      "",
      { t: "n", f: `SUM(E11:E${lastData})` },
    ];
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

  const bind = () => {
    ALL.forEach((col, idx) => {
      const el = $(`f-${col}`);
      el.addEventListener("focus", () => {
        if (col !== "tot") state.col = Math.max(0, COLS.indexOf(col));
        el.select();
      });
      el.addEventListener("input", () => applyField(col, el.value));
    });
    $("btn-prev").addEventListener("click", () => goto(state.i - 1));
    $("btn-next").addEventListener("click", () => goto(state.i + 1));
    $("btn-page-prev").addEventListener("click", () => gotoPage(-1));
    $("btn-page-next").addEventListener("click", () => gotoPage(1));
    $("btn-ins-above").addEventListener("click", () => insertAt(-1));
    $("btn-ins-below").addEventListener("click", () => insertAt(1));
    $("btn-del").addEventListener("click", () => deleteRow());
    $("btn-xlsx").addEventListener("click", generateXlsx);
    $("btn-discard").addEventListener("click", () => {
      localStorage.removeItem(storageKey());
      state.draft = false;
      $("draft").hidden = true;
      loadMonth(state.month);
      toast("Rascunho descartado");
    });
    bindView();
    window.addEventListener("resize", layoutTunnel);
    window.addEventListener("beforeunload", saveDraft);

    document.addEventListener("keydown", (e) => {
      if (e.target && e.target.type === "range") return;
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
