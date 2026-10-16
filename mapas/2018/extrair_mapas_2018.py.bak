"""Extrai mapas de remuneração INSS 2018 a partir da CAMADA DE TEXTO dos PDFs originais.
Sem OCR e sem visão. Para cada página:
  - colunas monetárias descobertas pelos maiores espaços entre posições dos valores (5 colunas:
    salário, remuneração adicional, líquido, SS trabalhador, SS empresa);
  - linha âncora = valor da coluna de salário; campos alinhados a < 1 pt vertical;
  - NISS e categoria lidos se existirem no layout (ex.: junho tem coluna NISS).
Validações: liq == sal+rem; ss_trab == 3% liq; ss_emp == 8% liq (tolerância 0,011);
            soma por coluna comparada com a linha TOTAL do próprio PDF.
Linhas com alerta NÃO são corrigidas: vão para revisão visual.
"""
import sys, re, csv
from collections import Counter
import pdfplumber

AMT = re.compile(r"^\d{1,3}(\.\d{3})*,\d{2}$")
AMT_NOCOMMA = re.compile(r"^\d{1,3}(\.\d{3})+\d{2}$|^\d{3}$")   # vírgula perdida no texto
AMT_DOTDEC = re.compile(r"^\d{1,3}(\.\d{3})*\.\d{2}$")          # vírgula decimal lida como ponto: 83.614.33
NISS_RE = re.compile(r"^\d{2}\.\d{9}-\d{2}$|^\d{9}$|^\d{8}$")
TOL = 0.011
MONEY = ["sal", "rem", "liq", "ss_trab", "ss_emp"]

def is_amt(t, x=None):
    """x: posição. Formas sem vírgula só contam à direita (evita confundir Nº de 3 dígitos)."""
    if AMT.match(t):
        return True
    if AMT_DOTDEC.match(t) and (x is None or x >= 250):
        return True
    if AMT_NOCOMMA.match(t):
        return x is None or x >= 250
    return False

def amt(s):
    if "," not in s and AMT_DOTDEC.match(s):
        s = s[::-1].replace(".", ",", 1)[::-1]   # último ponto passa a vírgula decimal
    if "," in s:
        return round(float(s.replace(".", "").replace(",", ".")), 2)
    d = s.replace(".", "")
    return round(int(d[:-2] or "0") + int(d[-2:]) / 100, 2)

def merge_fragments(ws):  # noqa: E302
    ws = sorted(ws, key=lambda w: w["x0"])
    out = []
    for w in ws:
        if out:
            p = out[-1]
            gap = w["x0"] - p["x1"]
            joined = p["text"] + w["text"]
            if -1 <= gap < 3 and is_amt(joined, p["x0"]) and not is_amt(p["text"]) and not is_amt(w["text"]):
                out[-1] = {**p, "text": joined, "x1": w["x1"]}
                continue
        out.append(dict(w))
    return out

def money_columns(xs):
    """Divide x0 dos valores em 5 colunas pelos 4 maiores espaços."""
    xs = sorted(xs)
    if len(xs) < 5:
        return None
    gaps = sorted(((xs[i + 1] - xs[i], i) for i in range(len(xs) - 1)), reverse=True)[:4]
    cuts = sorted(i for _, i in gaps)
    groups, start = [], 0
    for c in cuts:
        groups.append(xs[start:c + 1]); start = c + 1
    groups.append(xs[start:])
    if len(groups) != 5:
        return None
    centers = [sum(g) / len(g) for g in groups]
    lows = [g[0] for g in groups]
    return {"centers": centers, "lows": lows}

def col_of(x, cols):
    c = cols["centers"]
    return min(range(5), key=lambda i: abs(x - c[i]))

def doc_category_x(pdf):
    for pg in pdf.pages:
        ws = pg.extract_words(x_tolerance=2, y_tolerance=2)
        xs = [w["x0"] for w in ws if w["text"].upper().startswith("CATEGORIA")]
        if xs:
            return min(xs)
    return None

def page_model(words, cat_doc=None):
    header_top = min((w["top"] for w in words if w["text"].upper().startswith("NOME")), default=None)
    if header_top is None:
        header_top = 70  # sem linha 'NOME' legível: o bloco de título acaba ~68 pt; as linhas começam ~87 pt
    below = [w for w in words if w["top"] > header_top + 5]
    amts = [w for w in below if is_amt(w["text"], w["x0"])]
    cols = money_columns([w["x0"] for w in amts])
    if cols is None:
        return None
    cat = min((w["x0"] for w in words if w["text"].upper().startswith("CATEGORIA")), default=cat_doc)
    niss_hdr = min((w["x0"] for w in words if w["text"].upper().startswith("SEG.SOCIAL") or w["text"].upper().startswith("SEG.SOCIAL")), default=None)
    return {"header_top": header_top, "cols": cols, "cat": cat, "niss_hdr": niss_hdr}

def parse_page(pg, pageno, cat_doc=None):
    words = merge_fragments(pg.extract_words(x_tolerance=2, y_tolerance=2))
    m = page_model(words, cat_doc)
    if m is None:
        return None, []
    cols, cat = m["cols"], m["cat"]
    sal_x_limit = cols["lows"][0] - 3
    name_right = (cat - 2) if cat else sal_x_limit - 40
    anchors = []
    for w in sorted([w for w in words if is_amt(w["text"], w["x0"]) and w["top"] > m["header_top"] + 5
                     and col_of(w["x0"], cols) == 0], key=lambda w: w["top"]):
        if anchors and abs(w["top"] - anchors[-1]["top"]) < 4:
            continue
        anchors.append(w)
    rows = []
    for a in anchors:
        t = a["top"]
        band = [w for w in words if abs(w["top"] - t) <= 6]
        name = " ".join(w["text"] for w in sorted(band, key=lambda w: w["x0"])
                        if 45 <= w["x0"] < name_right and not is_amt(w["text"], w["x0"]) and w["text"] != "kz" and not w["text"].isdigit()
                        and not NISS_RE.match(w["text"])).strip()
        categoria = " ".join(w["text"] for w in sorted(band, key=lambda w: w["x0"])
                             if cat and cat - 2 <= w["x0"] < sal_x_limit - 40 and not is_amt(w["text"], w["x0"])
                             and not NISS_RE.match(w["text"])).strip()
        niss_raw = " ".join(w["text"] for w in band if NISS_RE.match(w["text"]) and w["x0"] < sal_x_limit)
        nums = [w for w in band if re.fullmatch(r"\d{1,4}", w["text"]) and w["x0"] < 75]
        cells = {k: None for k in MONEY}
        for w in band:
            if not is_amt(w["text"], w["x0"]) or w["x0"] < sal_x_limit:
                continue
            cells[MONEY[col_of(w["x0"], cols)]] = amt(w["text"])
        if not name and (cells["sal"] or 0) < 1000:
            continue  # ruído (marcas, rubricas) sem nome nem valor de salário
        letras = len(re.findall(r"[A-Za-zÀ-ÿ]", name))
        eh_total = bool(cells["sal"] and cells["sal"] >= 1_000_000 and ("TOTAL" in name.upper() or not name))
        if not eh_total and letras < 6:
            continue  # não é trabalhador (ex.: recibos da Segurança Social)
        rows.append({"pagina": pageno + 1, "n": int(nums[0]["text"]) if nums else "",
                     "niss_pdf": niss_raw, "categoria": categoria, "nome": name,
                     "tipo": "TOTAL" if (cells["sal"] and cells["sal"] >= 1_000_000 and ("TOTAL" in name.upper() or not name)) else "TRABALHADOR",
                     **cells})
    return m, rows

def checks(r):
    e = []
    if r["sal"] is None or r["rem"] is None or r["liq"] is None:
        e.append("valor_em_falta")
    elif abs(r["sal"] + r["rem"] - r["liq"]) > TOL:
        e.append("liq!=sal+rem")
    if r["liq"] is not None:
        if r["ss_trab"] is None or abs(round(r["liq"] * 0.03, 2) - r["ss_trab"]) > TOL: e.append("ss_trab!=3%")
        if r["ss_emp"] is None or abs(round(r["liq"] * 0.08, 2) - r["ss_emp"]) > TOL: e.append("ss_emp!=8%")
    if not re.search(r"[A-Za-zÀ-ÿ]{3,}", r["nome"] or ""): e.append("nome_suspeito")
    return e

def expected(r):
    """Valor que a regra dá para as células de SS (apenas referência para revisão, nunca gravado como fonte)."""
    if r["liq"] is None: return ""
    return f"ss_trab_esperado={round(r['liq']*0.03,2)} ss_emp_esperado={round(r['liq']*0.08,2)}"

def main(pdf_path, out_csv):
    rows, totais, pages_info = [], [], []
    with pdfplumber.open(pdf_path) as pdf:
        cat_doc = doc_category_x(pdf)
        for i, pg in enumerate(pdf.pages):
            m, rs = parse_page(pg, i, cat_doc)
            if m is None:
                continue
            pages_info.append((i + 1, len(rs), [round(c) for c in m["cols"]["centers"]]))
            for r in rs:
                (totais if r["tipo"] == "TOTAL" else rows).append(r)
    for r in rows:
        r["erros"] = ";".join(checks(r))
    for r in rows:
        r["referencia_revisao"] = expected(r) if r["erros"] else ""
    fields = ["pagina", "n", "niss_pdf", "categoria", "nome", "tipo"] + MONEY + ["erros", "referencia_revisao"]
    with open(out_csv, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
    print("paginas_mapa:", [(p, n) for p, n, _ in pages_info])
    print("colunas x (sal,rem,liq,sst,sse):", pages_info[0][2] if pages_info else None)
    print(f"linhas={len(rows)} | com alertas={sum(1 for r in rows if r['erros'])}")
    print("alertas:", Counter(e for r in rows for e in r["erros"].split(";") if e).most_common())
    for k in MONEY:
        soma = round(sum((r[k] or 0) for r in rows), 2)
        ref = [t[k] for t in totais if t[k] is not None]
        print(f"soma {k}: extraido={soma} | TOTAL PDF={ref}")
    ns = [r["n"] for r in rows if r["n"] != ""]
    print("Nº repetidos:", len(ns) - len(set(ns)))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
