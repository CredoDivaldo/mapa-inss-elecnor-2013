"""Gera data/relacao.js a partir de QUALQUER relação geral (xlsx) do portal INSS.
Uma pessoa = um NISS. Cada linha da relação é um vínculo (início/fim). Fim vazio = vínculo activo.
Uso: python3 pipeline/relacao_index.py <relacao.xlsx> [data/relacao.js]
"""
import sys, re, json, unicodedata, datetime as dt
from collections import defaultdict
import openpyxl

def fold(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z ]", " ", s)).strip().upper()

def iso(v):
    if isinstance(v, dt.datetime): return v.date().isoformat()
    if isinstance(v, dt.date): return v.isoformat()
    return None

def construir(xlsx_path):
    ws = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True).worksheets[0]
    pessoas = {}
    for r in ws.iter_rows(values_only=True):
        niss_raw, nome_raw = r[0], r[1]
        if niss_raw is None or nome_raw is None: continue
        txt = str(niss_raw).strip()
        if not txt.isdigit() or len(txt) > 8: continue          # linhas de resumo ("Total de ...")
        niss = txt.zfill(8)
        nome = re.sub(r"\s+", " ", str(nome_raw)).strip()
        p = pessoas.setdefault(niss, {"niss": niss, "nome": nome, "k": fold(nome), "cat": "", "vinculos": []})
        if len(fold(nome).split()) > len(p["k"].split()):   # guarda a versão mais completa do nome
            p["nome"], p["k"] = nome, fold(nome)
        p["cat"] = p["cat"] or (r[2] or "").strip()
        p["vinculos"].append({"inicio": iso(r[5]), "fim": iso(r[6]), "estado": r[7] or ""})
    return sorted(pessoas.values(), key=lambda p: p["k"])

if __name__ == "__main__":
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else "data/relacao.js"
    lista = construir(src)
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write("// Gerado por pipeline/relacao_index.py a partir de: " + src.split("/")[-1] + "\n")
        fh.write("window.INSS_RELACAO = " + json.dumps(lista, ensure_ascii=False) + ";\n")
    print("pessoas:", len(lista), "| vínculos:", sum(len(p["vinculos"]) for p in lista), "->", dst)
