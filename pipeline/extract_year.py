#!/usr/bin/env python3
"""Extract 2013 Elecnor payroll tables from scanned PDFs into review CSVs.

CSV stays in PDF order (for the tunnel-vision reviewer). The web app sorts
alphabetically only when generating the TPA XLSX. Never writes TXT.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import unicodedata
from pathlib import Path

import cv2
import fitz
import numpy as np
import openpyxl

ROOT = Path("/Users/user/20_Areas/Ellocene")
APP = ROOT / "app-inss"
WORK = ROOT / ".tmp_inss" / "work"
PDF_DIR = Path("/Users/user/Documents/Mapas de remuneração INSS/2013")
VINCULOS = Path(
    "/Users/user/Downloads/RelacaoDeTrabalhadoresVinculadosPorContribuinte-000013067.xlsx"
)
PORTAL_JAN = Path("/Users/user/Downloads/FolhaDeRemuneracao-2013_01.xlsx")

DPI_ZOOM = 2.6
TESS_LANG = "por"
CROP_DIR = WORK / "crops"

MONTHS = [
    (1, "jan", "Janeiro", "01 JANEIRO 2013 (2).pdf"),
    (2, "fev", "Fevereiro", "02 FEVEREIRO 2013 (6)-1-9 (1).pdf"),
    (3, "mar", "Março", "03 MARCO 2013.pdf"),
    (4, "abr", "Abril", "04 ABRIL 2013.pdf"),
    (5, "mai", "Maio", "05 MAIO 2013.pdf"),
    (6, "jun", "Junho", "06 JUNHO 2013.pdf"),
    (7, "jul", "Julho", "07 JULHO 2013.pdf"),
    (8, "ago", "Agosto", "08 AGOSTO 2013.pdf"),
    (9, "set", "Setembro", "09 SETEMBRO 2013.pdf"),
    (10, "out", "Outubro", "10 OUTUBRO 2013 (1).pdf"),
    (11, "nov", "Novembro", "11NOVENBRO 2013 (2).pdf"),
    (12, "dez", "Dezembro", "12 DEZEMBRO 2013 (1).pdf"),
]

ANEXO_RE = re.compile(
    r"RECIBO DE ENTREGA|GUIA DE PAGAMENTO|GUIA DE DEPOSITO|GUIA DE DEP|"
    r"RESUMO GERAL|INSTITUTO NACIONAL DE SEGURAN|BOLETIM DE IDENTIFICAC|"
    r"FORMULARIO DE PAGAMENTO|VALOR A PAGAR SEGURAN|CERTIFICADO DO BANCO",
    re.I,
)
HEADER_RE = re.compile(
    r"NOME COMPLETO|CATEGORIA OCUPACIONAL|MAPA DE SALAR|SALARIO LIQUIDO|"
    r"REMUNERACAO ADICIONAL",
    re.I,
)
JUNK_ROW_RE = re.compile(
    r"SOBRE O TOTAL|SOBREO TOTAL|TOTAL A DEPOSITAR|TOTAL DEPOSITAR|"
    r"ILIQUIDOS|VALOR A PAGAR|TOTAL DE TRABALHADO|TOTAL QUE AFECTA|"
    r"RESUMO\b|PARASCREDITO|GUIA DE",
    re.I,
)
TOTAL_RE = re.compile(r"^\s*(TOTAL|RESUMO)\b", re.I)
MONEY_RE = re.compile(
    r"\d{1,3}(?:[.\s]\d{3})+,\d{2}"
    r"|\d{1,6},\d{2}"
    r"|\d{1,3}(?:\.\d{3})+\.\d{2}"
    r"|\d{4,8}(?=\s*k?z\b)",
    re.I,
)
NUM_RE = re.compile(r"^\s*[\[|]?\s*(\d{1,3})\b")

STOP = {
    "EMPREGADA", "EMPREGADO", "DOMESTICA", "DOMESTICO", "LIMPEZA", "MOTORISTA",
    "LIGEIRO", "LIGEIROS", "PESADO", "PESADOS", "SERVICOS", "SERVICO", "GERAIS",
    "ELETRICISTA", "ELECTRICISTA", "MONTADOR", "MECANICO", "MECANECA", "PEDREIRO",
    "SERRALHEIRO", "CARPINTEIRO", "CARPINTEIROS", "ARMADOR", "FERRO", "FERREIRO",
    "OPERADOR", "GRUA", "RETRO", "ESCAVADORA", "MAQUINAS", "TRATOR", "AGRICOLA",
    "ENCARREGADO", "ARMAZEM", "FIEL", "TECNICO", "SEGURANCA", "TRABALHO",
    "PLANEAMENTO", "VIGILANTE", "GUARDA", "JARDINEIRO", "AUXILIAR",
    "ADMINISTRATIVO", "ADMINISTRATIVA", "CHEFE", "SOLDADOR", "CANALIZADOR",
    "COZINHEIRA", "SECRETARIA", "TOPOGRAFO", "ESTRUTURAS", "ESTRUCTURAS",
    "LADRILHADOR", "CIVIL", "CONSTRUCAO", "PINTOR", "CONTINUO", "ELECTROTECNICO",
    "ESTAGIARIO", "PRODUCAO", "VEICULOS", "ELECTRICO", "AJUDANTE", "FUNILEIRO",
    "SOLDADOR", "CAPATAZ", "ENGENHEIRO", "ENCARREGADA", "TESOUREIRO",
    "TESOUREIRA", "ESCRAVADORA", "INDUSTRIAL", "OBRA", "OBRAS", "SEDE",
    "DE", "DA", "DO", "DOS", "DAS", "E", "A", "O", "AO", "EM",
}

LIXO = {
    "PATO", "N", "NO", "NA", "Nº", "N°", "KZ", "IL", "II", "III", "LT",
    "AHE", "SSEE", "BPC", "TESOURARIA",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.upper().replace(".", " ").replace("'", " ").replace("`", " ")
    s = s.replace("-", " ").replace("|", " ")
    return re.sub(r"\s+", " ", s).strip()


def parse_money(token: str) -> float | None:
    t = token.strip().replace(" ", "").replace("kz", "").replace("KZ", "")
    t = re.sub(r"[^\d.,]", "", t)
    if not t:
        return None
    try:
        if "." in t and "," in t:
            t = t.replace(".", "").replace(",", ".")
        elif t.count(",") == 1:
            t = t.replace(".", "").replace(",", ".")
        elif t.count(".") == 1:
            left, right = t.split(".")
            if len(right) == 2:
                pass  # 25594.75
            elif len(right) == 3 and len(left) <= 3:
                t = left + right  # 25.594 thousands without cents
                if len(t) >= 4:
                    t = t[:-2] + "." + t[-2:]
            elif len(right) >= 3:
                # 63.65385 → 63653.85
                digits = left + right
                t = digits[:-2] + "." + digits[-2:]
            else:
                return None
        elif t.isdigit() and len(t) >= 4:
            t = t[:-2] + "." + t[-2:]
        val = round(float(t), 2)
        if val > 50_000_000 or val < 0:
            return None
        return val
    except ValueError:
        return None


def load_niss_maps() -> dict[str, str]:
    mapping: dict[str, str] = {}

    def add(nome: str, niss: str) -> None:
        niss = re.sub(r"\D", "", str(niss))
        key = norm(nome)
        if niss and key and key not in mapping:
            mapping[key] = niss

    if VINCULOS.exists():
        wb = openpyxl.load_workbook(VINCULOS, data_only=True, read_only=True)
        ws = wb.active
        for i, row in enumerate(ws.iter_rows(min_row=11, values_only=True), 11):
            if not row or not row[0] or not row[1]:
                continue
            if str(row[0]).lower().startswith("fim"):
                break
            add(str(row[1]), str(row[0]))
        wb.close()

    extra = WORK / "niss_fev2013.json"
    if extra.exists():
        data = json.loads(extra.read_text())
        if isinstance(data, dict):
            for nome, niss in data.items():
                add(nome, niss)

    if PORTAL_JAN.exists():
        wb = openpyxl.load_workbook(PORTAL_JAN, data_only=True)
        ws = wb.active
        for row in ws.iter_rows(min_row=11, values_only=True):
            if not row or not row[0] or not row[1]:
                continue
            if "total" in str(row[0]).lower() or "fim" in str(row[0]).lower():
                break
            add(str(row[1]), str(row[0]))
        wb.close()

    return mapping


def limpar_nome(s: str) -> str:
    t = norm(s)
    t = re.sub(r"\b\d+\b", " ", t)
    toks = [x for x in t.split() if x not in LIXO and not re.match(r"^[\W_]+$", x)]
    while toks and (toks[0] in STOP or toks[0] in LIXO or len(toks[0]) <= 1):
        toks.pop(0)
    # drop trailing job title
    while toks and (toks[-1] in STOP or len(toks[-1]) <= 1):
        toks.pop()
    # keep inner stop-words that belong to names (DA, DO, DE)
    cleaned = []
    for x in toks:
        if x in STOP and x not in {"DA", "DO", "DE", "DOS", "DAS", "E"}:
            # job title in the middle — stop before it if we already have 2 tokens
            if len(cleaned) >= 2:
                break
            continue
        cleaned.append(x)
    return " ".join(cleaned)


def build_niss_index(vin_norm: dict[str, str]) -> dict[str, list[tuple[str, str, list[str]]]]:
    idx: dict[str, list[tuple[str, str, list[str]]]] = {}
    for k, niss in vin_norm.items():
        kt = k.split()
        if not kt:
            continue
        idx.setdefault(kt[0], []).append((k, niss, kt))
    return idx


def casar_niss(nome: str, vin_norm: dict[str, str], vin_index: dict) -> str:
    toks = limpar_nome(nome).split()
    if len(toks) < 2:
        return ""
    key = " ".join(toks)
    if key in vin_norm:
        return vin_norm[key]
    common = {"JOSE", "ANTONIO", "JOAO", "MANUEL", "PEDRO", "CARLOS", "FRANCISCO"}
    best = ""
    best_score = 0
    tset = set(toks)
    for k, niss, kt in vin_index.get(toks[0], []):
        shared = tset & set(kt)
        if len(shared) < 2:
            continue
        score = len(shared)
        if kt[-1] == toks[-1]:
            score += 2
        if len(kt) >= 2 and kt[1] == toks[1]:
            score += 2
        if toks[0] in common and score < 4 and len(shared) < 3:
            continue
        if score > best_score:
            best_score = score
            best = niss
    return best if best_score >= 3 or (best_score >= 2 and toks[0] not in common) else ""


def tess(image_path: Path, psm: int = 6, tsv: bool = False) -> str:
    out_base = CROP_DIR / f"_ocr_{os.getpid()}"
    cmd = [
        "tesseract",
        str(image_path),
        str(out_base),
        "-l",
        TESS_LANG,
        "--psm",
        str(psm),
        "--oem",
        "1",
    ]
    if tsv:
        cmd.append("tsv")
    subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    suffix = ".tsv" if tsv else ".txt"
    target = Path(str(out_base) + suffix)
    text = target.read_text(errors="replace") if target.exists() else ""
    for p in (target, Path(str(out_base) + ".txt")):
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass
    return text


def save_png(img: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img)


def count_axis_lines(gray: np.ndarray, horizontal: bool) -> list[int]:
    h, w = gray.shape
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    if horizontal:
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (max(40, w // 28), 1))
        opened = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k)
        proj = opened.sum(axis=1)
        limit = w * 255 * 0.12
        merge = 4
    else:
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(40, h // 28)))
        opened = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k)
        proj = opened.sum(axis=0)
        limit = h * 255 * 0.10
        merge = 6
    idx = np.where(proj > limit)[0]
    if len(idx) == 0:
        return []
    groups = [[int(idx[0])]]
    for v in idx[1:]:
        v = int(v)
        if v - groups[-1][-1] <= merge:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [int(sum(g) / len(g)) for g in groups]


def _header_score(gray: np.ndarray) -> int:
    """Prefer the orientation whose top band has the Elecnor table title."""
    h, w = gray.shape
    crop = gray[: max(80, h // 5), :]
    small = cv2.resize(crop, (min(1400, w), 220), interpolation=cv2.INTER_AREA)
    path = CROP_DIR / f"head_{os.getpid()}.png"
    save_png(small, path)
    n = norm(tess(path, psm=6))
    try:
        path.unlink()
    except OSError:
        pass
    score = 0
    for word, pts in (
        ("ELECNOR", 4),
        ("MAPA DE SALAR", 5),
        ("NOME COMPLETO", 4),
        ("NOME", 2),
        ("SALARIO", 2),
        ("CATEGORIA", 2),
        ("INSCRICAO", 2),
    ):
        if word in n:
            score += pts
    return score


def upright(gray: np.ndarray, bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray, int]:
    """Rotate so payroll row rules are horizontal and N° is on the left."""
    variants = [
        (0, gray, bgr),
        (
            90,
            cv2.rotate(gray, cv2.ROTATE_90_COUNTERCLOCKWISE),
            cv2.rotate(bgr, cv2.ROTATE_90_COUNTERCLOCKWISE),
        ),
        (
            180,
            cv2.rotate(gray, cv2.ROTATE_180),
            cv2.rotate(bgr, cv2.ROTATE_180),
        ),
        (
            270,
            cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE),
            cv2.rotate(bgr, cv2.ROTATE_90_CLOCKWISE),
        ),
    ]
    scored = []
    for deg, g, b in variants:
        n = len(count_axis_lines(g, True))
        scored.append((n, deg, g, b))
    scored.sort(key=lambda x: x[0], reverse=True)
    best_n = scored[0][0]
    tied = [s for s in scored if s[0] >= best_n - 2]
    if len(tied) == 1:
        n, deg, g, b = tied[0]
        return g, b, deg
    ranked = []
    for n, deg, g, b in tied:
        ranked.append((_header_score(g), n, deg, g, b))
    ranked.sort(reverse=True)
    _, n, deg, g, b = ranked[0]
    return g, b, deg


def is_anexo(gray: np.ndarray, probe_path: Path) -> bool:
    hors = count_axis_lines(gray, True)
    if len(hors) >= 30:
        return False
    h, w = gray.shape
    band = gray[: min(h, int(h * 0.48)), :]
    small = cv2.resize(band, (min(1400, band.shape[1]), min(480, band.shape[0])), interpolation=cv2.INTER_AREA)
    save_png(small, probe_path)
    text = tess(probe_path, psm=6)
    n = norm(text)
    if ANEXO_RE.search(n) and not HEADER_RE.search(n):
        return True
    if HEADER_RE.search(n) or ("NOME" in n and "SALARIO" in n):
        return False
    if len(hors) >= 8:
        return False
    if re.search(r"\bKZ\b|\d,\d{2}", n) and "INSTITUTO NACIONAL" not in n:
        return False
    return True


def row_bands(gray: np.ndarray) -> list[tuple[int, int]]:
    ys = count_axis_lines(gray, True)
    if len(ys) < 3:
        return []
    # merge double lines
    merged = [ys[0]]
    for y in ys[1:]:
        if y - merged[-1] < 12:
            merged[-1] = int((merged[-1] + y) / 2)
        else:
            merged.append(y)
    bands = []
    h = gray.shape[0]
    for a, b in zip(merged, merged[1:]):
        height = b - a
        if 16 <= height <= 140:
            bands.append((a, b))
    # if last content extends below last line a bit, ignore
    return bands


def pick_sal_rem_tot(amounts: list[float]) -> tuple[float | None, float | None, float | None]:
    if not amounts:
        return None, None, None
    if len(amounts) == 1:
        return amounts[0], 0.0, amounts[0]
    if len(amounts) == 2:
        return amounts[0], amounts[1], round(amounts[0] + amounts[1], 2)
    if len(amounts) == 3:
        return amounts[0], amounts[1], amounts[2]
    # 5-value classic: sal, rem, tot, sst, sse
    if len(amounts) == 5:
        sal, rem, tot = amounts[0], amounts[1], amounts[2]
        if abs((sal + rem) - tot) <= max(1.0, 0.02 * tot):
            return sal, rem, tot
    # 6+ : valor-dias, sal, rem, liquido, ...
    # find consecutive pair whose sum matches a later amount
    best = None
    for i in range(len(amounts) - 2):
        sal, rem = amounts[i], amounts[i + 1]
        soma = round(sal + rem, 2)
        for tot in amounts[i + 2 :]:
            if abs(soma - tot) <= max(1.0, 0.015 * max(tot, 1)):
                # prefer later tot (líquido) over SS
                score = (i == 0) + (tot >= sal)
                cand = (score, i, sal, rem, tot)
                if best is None or cand[0] > best[0] or (cand[0] == best[0] and cand[1] < best[1]):
                    best = cand
    if best:
        return best[2], best[3], best[4]
    return amounts[0], amounts[1] if len(amounts) > 1 else 0.0, amounts[2] if len(amounts) > 2 else amounts[0]


def parse_row_text(text: str) -> dict | None:
    raw = " ".join(text.split())
    if not raw:
        return None
    n = norm(raw)
    if HEADER_RE.search(n) or n.startswith("N NOME") or "CATEGORIA OCUPACIONAL" in n:
        return None
    if TOTAL_RE.search(raw) or n.startswith("TOTAL ") or JUNK_ROW_RE.search(raw):
        return None
    if "VALOR A PAGAR" in n or n.startswith("RESUMO"):
        return None

    moneys = [parse_money(m) for m in MONEY_RE.findall(raw)]
    moneys = [m for m in moneys if m is not None]

    first = MONEY_RE.search(raw)
    head = raw[: first.start()] if first else raw
    head = head.replace("|", " ").replace("[", " ").replace("]", " ")
    num_m = NUM_RE.match(head)
    num = int(num_m.group(1)) if num_m else None
    if num is not None and not (1 <= num <= 800):
        num = None
    nome_src = NUM_RE.sub(" ", head, count=1) if num_m else head
    nome = limpar_nome(nome_src)
    if len(nome.split()) < 2:
        nome = limpar_nome(head)
    # a worker row has a real name and at least one payroll amount
    if len(nome.split()) < 2:
        return None
    if not moneys and num is None:
        return None

    sal, rem, tot = pick_sal_rem_tot(moneys)
    return {
        "num": num,
        "nome": nome if nome else limpar_nome(head),
        "sal": sal,
        "rem": rem,
        "tot": tot,
        "raw": raw,
    }


def extract_table_page(gray: np.ndarray, page_index: int, tag: str) -> list[dict]:
    bands = row_bands(gray)
    rows = []
    for i, (y0, y1) in enumerate(bands):
        pad = 1
        crop = gray[max(0, y0 + pad) : y1 - pad, :]
        if crop.size == 0 or crop.shape[0] < 10:
            continue
        # upscale thin rows
        if crop.shape[0] < 36:
            crop = cv2.resize(
                crop,
                (crop.shape[1] * 2, crop.shape[0] * 2),
                interpolation=cv2.INTER_CUBIC,
            )
        crop_path = CROP_DIR / f"{tag}_r{i:03d}.png"
        save_png(crop, crop_path)
        text = tess(crop_path, psm=7)
        try:
            crop_path.unlink()
        except OSError:
            pass
        parsed = parse_row_text(text)
        if not parsed:
            continue
        parsed["page"] = page_index
        parsed["y"] = round(((y0 + y1) / 2) / gray.shape[0], 4)
        parsed["h"] = round((y1 - y0) / gray.shape[0], 4)
        rows.append(parsed)
    return rows


def render_pdf(pdf_path: Path, dest_dir: Path) -> list[Path]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(dest_dir.glob("src_*.png"))
    if existing:
        print(f"  reutilizar {len(existing)} rasters em {dest_dir}")
        return existing
    doc = fitz.open(pdf_path)
    paths = []
    mat = fitz.Matrix(DPI_ZOOM, DPI_ZOOM)
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=mat, alpha=False)
        out = dest_dir / f"src_{i + 1:02d}.png"
        pix.save(str(out))
        paths.append(out)
    doc.close()
    return paths


def process_month(
    mes: int,
    slug: str,
    label: str,
    pdf_name: str,
    vin_norm: dict[str, str],
    vin_index: dict,
) -> dict:
    pdf_path = PDF_DIR / pdf_name
    if not pdf_path.exists():
        raise FileNotFoundError(pdf_path)

    src_dir = WORK / "pages" / f"{mes:02d}"
    print(f"\n=== {label} 2013 — {pdf_name} ===")
    sources = render_pdf(pdf_path, src_dir)

    table_pages: list[Path] = []
    workers: list[dict] = []
    app_page_dir = APP / "data" / "2013" / f"{mes:02d}"
    if app_page_dir.exists():
        shutil.rmtree(app_page_dir)
    app_page_dir.mkdir(parents=True, exist_ok=True)

    for src in sources:
        bgr = cv2.imread(str(src))
        if bgr is None:
            print(f"  skip unreadable {src.name}")
            continue
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        gray, bgr, rot = upright(gray, bgr)
        probe = CROP_DIR / f"probe_{mes:02d}_{src.stem}.png"
        anexo = is_anexo(gray, probe)
        if probe.exists():
            try:
                probe.unlink()
            except OSError:
                pass
        if anexo:
            print(f"  {src.name} rot={rot} ANEXO")
            continue
        print(f"  {src.name} rot={rot} a ler tabela ...", flush=True)
        rows = extract_table_page(gray, 0, f"{mes:02d}_{src.stem}")
        if len(rows) < 2:
            print(f"    {len(rows)} linhas — ignorada")
            continue
        page_idx = len(table_pages)
        for r in rows:
            r["page"] = page_idx
        dest = app_page_dir / f"p{page_idx + 1:02d}.png"
        save_png(bgr, dest)
        table_pages.append(dest)
        print(f"    {len(rows)} linhas -> {dest.name}")
        workers.extend(rows)

    # NISS match + format
    for w in workers:
        w["niss"] = casar_niss(w.get("nome") or "", vin_norm, vin_index)

    csv_path = APP / "data" / "2013" / f"{mes:02d}_semifinal.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["num", "nome", "niss", "sal", "rem", "tot", "page", "y", "h"])
        for w in workers:
            writer.writerow(
                [
                    w.get("num") or "",
                    w.get("nome") or "",
                    w.get("niss") or "",
                    "" if w.get("sal") is None else f"{w['sal']:.2f}",
                    "" if w.get("rem") is None else f"{w['rem']:.2f}",
                    "" if w.get("tot") is None else f"{w['tot']:.2f}",
                    w.get("page", 0),
                    w.get("y", ""),
                    w.get("h", ""),
                ]
            )

    com = sum(1 for w in workers if w.get("niss"))
    print(
        f"  CSV {csv_path.name}: {len(workers)} trabalhadores, "
        f"{com} com NISS, {len(table_pages)} páginas de tabela"
    )
    debug = WORK / f"{mes:02d}_extract.json"
    debug.write_text(json.dumps(workers, ensure_ascii=False, indent=1), encoding="utf-8")
    return {
        "id": f"2013-{mes:02d}",
        "label": f"{label.upper()} 2013",
        "empresa": "ELECNOR S.A. SUCURSAL DE ANGOLA",
        "niss_empresa": "13067",
        "nif": "5402106223",
        "ano": 2013,
        "mes": mes,
        "csv": f"data/2013/{mes:02d}_semifinal.csv",
        "pages": [f"data/2013/{mes:02d}/p{i + 1:02d}.png" for i in range(len(table_pages))],
        "scrollPx": 48,
        "filename": f"130672013{mes:02d}1.XLSX",
        "workers": len(workers),
        "with_niss": com,
    }


def write_config(months_meta: list[dict]) -> None:
    payload = {
        "empresa": "ELECNOR S.A. SUCURSAL DE ANGOLA",
        "niss_empresa": "13067",
        "nif": "5402106223",
        "months": [
            {k: v for k, v in m.items() if k not in {"workers", "with_niss"}}
            for m in months_meta
        ],
    }
    path = APP / "data" / "config.js"
    path.write_text(
        "window.INSS_CONFIG = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"config.js -> {path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--month", type=int, nargs="*", help="Month numbers 1-12")
    args = parser.parse_args()
    CROP_DIR.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)

    print("A carregar mapa NISS (vínculos + portal janeiro)...")
    vin = load_niss_maps()
    vin_index = build_niss_index(vin)
    print(f"  {len(vin)} nomes únicos")

    wanted = set(args.month) if args.month else {m[0] for m in MONTHS}
    metas = []
    config_path = APP / "data" / "config.js"
    existing = []
    if config_path.exists():
        raw = config_path.read_text()
        raw = raw.split("=", 1)[-1].strip().rstrip(";")
        try:
            existing = json.loads(raw).get("months", [])
        except json.JSONDecodeError:
            existing = []

    by_id = {m["id"]: m for m in existing}
    for mes, slug, label, pdf_name in MONTHS:
        if mes not in wanted:
            continue
        meta = process_month(mes, slug, label, pdf_name, vin, vin_index)
        by_id[meta["id"]] = meta

    ordered = [by_id[f"2013-{m[0]:02d}"] for m in MONTHS if f"2013-{m[0]:02d}" in by_id]
    write_config(ordered)
    print("\nResumo:")
    for m in ordered:
        print(
            f"  {m['id']}: {m.get('workers', '?')} linhas, "
            f"{m.get('with_niss', '?')} NISS, {len(m.get('pages', []))} págs"
        )


if __name__ == "__main__":
    main()
