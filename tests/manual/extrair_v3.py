"""Extrator v3 de mapas INSS (camada de texto). Mesma saída que v2.
Passos por página:
  1. agrupa palavras por linha (tolerância vertical de 3 pt);
  2. em cada linha, identifica tokens monetários (com ou sem 'kz') e atribui a coluna pela posição x mais próxima
     das colunas descobertas no próprio PDF (histograma de posições dos valores);
  3. nome = tokens não monetários à esquerda da primeira coluna monetária (sem o nº de ordem);
  4. valida: liq=sal+rem; ss_trab=3%liq; ss_emp=8%liq; somas vs linha TOTAL do PDF.
Uso: python3 extrair_v3.py "originais/<pdf>" saida.csv
"""
import sys, re, csv
from collections import Counter
import pdfplumber

MONEY_RE = re.compile(r"^-?\d{1,3}(\.\d{3})*,\d{2}$")
MONEY_NOCOMMA = re.compile(r"^\d{1,3}(\.\d{3})+\d{2}$")   # vírgula perdida: 6.11523 (ambíguo) / 76440,35 sem vírgula
MONEY_DOT = re.compile(r"^\d{1,3}(\.\d{3})*\.\d{2}$")     # vírgula lida como ponto: 6.750.31
NUM_ORDER = re.compile(r"^\d{1,3}$")
TOL_V = 3.0
TOL = 0.02
COLS = ["sal", "rem", "liq", "ss_trab", "ss_emp"]

KZ = re.compile(r"(?i)kz$")
def norm(t):
    t = t.strip().replace(" ", "")
    t = KZ.sub("", t)
    t = t.replace(":", "").replace(";", "")   # ruído de impressão dentro de números
    if re.fullmatch(r"[0-9OoIl.,]+", t):
        t = t.replace("O", "0").replace("o", "0").replace("I", "1").replace("l", "1")
    return t

GARBLE5 = re.compile(r"^\d{1,3}\.\d{5}$")
def to_num(t):
    t = norm(t)
    if GARBLE5.match(t):
        d = t.replace(".", "")
        return float(d[:-2] + "." + d[-2:])
    if MONEY_RE.match(t):
        return float(t.replace(".", "").replace(",", "."))
    if MONEY_DOT.match(t):
        parts = t.split(".")
        return float(".".join(parts[:-2]).replace(".", "") + parts[-2] + "." + parts[-1])
    return None

def is_money(t):
    t = norm(t)
    return bool(MONEY_RE.match(t) or MONEY_DOT.match(t) or GARBLE5.match(t))

FRAG = re.compile(r"^[,.]\d{1,2}$")
def juntar_fragmentos(ln):
    out = []
    for w in sorted(ln, key=lambda x: x["x0"]):
        if out and FRAG.match(w["text"]) and (w["x0"] - out[-1]["x1"]) < 3.0 and re.search(r"\d$", out[-1]["text"]):
            prev = dict(out[-1]); prev["text"] = out[-1]["text"] + w["text"]; prev["x1"] = w["x1"]
            prev["bottom"] = max(prev["bottom"], w["bottom"]); prev["top"] = min(prev["top"], w["top"])
            out[-1] = prev
        else:
            out.append(dict(w))
    return out

def lines_of(words):
    words = sorted(words, key=lambda w: (round(w["top"]), w["x0"]))
    lines, cur, top = [], [], None
    for w in words:
        if top is None or abs(w["top"] - top) <= TOL_V:
            cur.append(w)
            top = w["top"] if top is None else (top + w["top"]) / 2
        else:
            lines.append(sorted(cur, key=lambda x: x["x0"]))
            cur, top = [w], w["top"]
    if cur:
        lines.append(sorted(cur, key=lambda x: x["x0"]))
    return lines

def descobrir_colunas(pag_lines):
    """Agrupa as posições direitas (x1) dos valores monetários por proximidade horizontal.
    Cada grupo com pelo menos 5 valores é uma coluna. Ordem esquerda->direita = sal, rem, liq, ss_trab, ss_emp.
    Se só houver 4 colunas, assume-se que falta a SS da empresa (ss_emp fica vazia e é assinalada)."""
    xs = []
    for ln in pag_lines:
        for w in ln:
            if w["x1"] > 250 and is_money(w["text"]):
                xs.append(w["x1"])
    xs.sort()
    grupos = []
    for x in xs:
        if grupos and x - grupos[-1][-1] <= 20:
            grupos[-1].append(x)
        else:
            grupos.append([x])
    grupos = [g for g in grupos if len(g) >= 5]
    if len(grupos) > 5:
        grupos = sorted(sorted(grupos, key=len, reverse=True)[:5], key=lambda g: g[0])
    return [round(sum(g) / len(g)) for g in grupos]


CATEGORIAS = {"EMPREGADA", "EMPREGADO", "PINTOR", "MONTADOR", "ELECTRICISTA", "ELECTRICISTA", "AJUDANTE",
    "OTORISTA", "MOTORISTA", "CHEFE", "ENCARREGADO", "TECNICO", "TÉCNICO", "TÉCNICO", "SERRALHEIRO", "CANALIZADOR",
    "SERVENTE", "CIVIL", "PEDREIRO", "SOLDADOR", "TORNEIRO", "OPERADOR", "GRUA", "CARPINTEIRO", "AUTO", "ESTRUTURAS",
    "ANDAIME", "COZINHA", "LIMPEZA", "DOMESTICA", "DOMÉSTICA", "FRIO", "EQUIPA", "ISOLADOR", "ARMADOR", "MECANICO", "MECÂNICO"}
TOTAIS = []   # linhas sem nome = linhas de total do mapa (referência oficial do PDF)

def extrair_pagina(page, cols_hint=None):
    words = page.extract_words(x_tolerance=1.5, keep_blank_chars=False)
    lines = [juntar_fragmentos(ln) for ln in lines_of(words)]
    cols = cols_hint or descobrir_colunas(lines)
    rows = []
    if not cols:
        return rows, cols
    for ln in lines:
        PALAVRAS_RESUMO = ("TOTAL", "SUBTOTAL", "PROCESSADOS", "SOCIAL", "SEGURAN", "PAGAR", "DEPOSITAR",
                           "SOBRE", "SALARIOS", "ILIQUIDOS", "PARCELA", "CONTRIBUINTE", "SEGURADO", "CONTRIBUIR")
        resumo = any(w["text"].upper().startswith(PALAVRAS_RESUMO) or w["text"].upper().startswith("SALARI") for w in ln)
        monies = [w for w in ln if is_money(w["text"]) and w["x1"] > 250]
        if len(monies) < 2:
            continue
        slots = {}
        for w in monies:
            # coluna mais próxima pelo bordo direito
            j = min(range(len(cols)), key=lambda i: abs(cols[i] - w["x1"]))
            slots.setdefault(COLS[j] if j < len(COLS) else "x", []).append(w["text"])
        name_words = [w["text"] for w in ln if w["x1"] < (cols[0] - 40 if cols else 250) and not NUM_ORDER.match(w["text"])]
        nome = " ".join(name_words).strip()
        toks = nome.split()
        def _corta(i, t):
            u = t.upper().strip(".,")
            if u in CATEGORIAS or re.search(r"\d", t):
                return True
            if re.search(r"JUDANTE|MAQUINISTA|COZINH|MONTADOR|ELECTRIC|SERRALH|PINTOR|MOTORISTA|OTORISTA|CHEFE|ENCARREG|TECNIC|TÉCNIC|SERVENTE|CANALIZ|CIVIL|EMPREG|OPERADOR", u):
                return True
            return i >= 2 and len(u) <= 2
        cut = next((i for i, t in enumerate(toks) if _corta(i, t)), len(toks))
        if cut > 0:
            nome = " ".join(toks[:cut])
        top = min(w["top"] for w in ln)
        bottom = max(w["bottom"] for w in ln)
        H = page.height
        linha = {"nome": nome, "y": round(top / H, 5), "h": round((bottom - top) / H, 5),
                     **{c: (slots.get(c, [""])[0] if slots.get(c) else "") for c in COLS}}
        if not nome or resumo:
            TOTAIS.append(linha)
            continue
        rows.append(linha)
    return rows, cols

def main(pdf_path, out_csv):
    pdf = pdfplumber.open(pdf_path)
    todas = []
    total_pdf = {}
    for i, page in enumerate(pdf.pages):
        rows, cols = extrair_pagina(page)
        for r in rows:
            r["pagina"] = i + 1
            todas.append(r)
        txt = page.extract_text() or ""
        if "TOTAL" in txt.upper():
            for ln in [juntar_fragmentos(l) for l in lines_of(page.extract_words(x_tolerance=1.5))]:
                if any(w["text"].upper().startswith("TOTAL") for w in ln):
                    vals = [to_num(w["text"]) for w in ln if to_num(w["text"]) is not None]
                    if len(vals) >= 3:
                        total_pdf = {"row": vals}
    with open(out_csv, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["pagina", "nome"] + COLS + ["y", "h"])
        for r in todas:
            w.writerow([r["pagina"], r["nome"]] + [r.get(c, "") for c in COLS] + [r.get("y", ""), r.get("h", "")])
    print(f"linhas={len(todas)}")
    print("TOTAL PDF (valores na linha TOTAL):", total_pdf.get("row"))
    s = {c: sum(to_num(r[c]) or 0 for r in todas) for c in COLS}
    print("somas:", {c: round(v, 2) for c, v in s.items()})
    alerts = Counter()
    for r in todas:
        sal, rem, liq = to_num(r["sal"]) or 0, to_num(r["rem"]) or 0, to_num(r["liq"]) or 0
        if abs(sal + rem - liq) > TOL: alerts["liq!=sal+rem"] += 1
        st, se = to_num(r["ss_trab"]), to_num(r["ss_emp"])
        if st is None: alerts["ss_trab_vazio"] += 1
        elif abs(st - 0.03 * liq) > 0.02 * max(1, liq * 0.0005) + 0.02: alerts["ss_trab!=3%"] += 1
        if se is None: alerts["ss_emp_vazio"] += 1
        elif abs(se - 0.08 * liq) > 0.02: alerts["ss_emp!=8%"] += 1
    print("alertas:", dict(alerts))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
