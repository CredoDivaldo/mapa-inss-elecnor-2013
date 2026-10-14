"""Candidatos com confiança para linhas por resolver. Nunca resolve sozinho: produz uma lista para confirmação em lote.
Sinais usados:
  - semelhança de nomes por palavra (letras iguais = 1.0; diferença de uma letra ~0.9; acentos já removidos)
  - cobertura: quantas palavras do mapa encontram par na relação
  - vínculo cobre o mês do mapa
  - categoria profissional igual (só quando o mapa a tem, ex.: junho)
Níveis:
  'forte'    : todas as palavras com par >= 0.85, vínculo cobre o mês, (categoria igual se existir)
  'provavel' : cobertura >= 0.75 e score >= 0.85, mas falta um sinal
  'fraco'    : mostrado só como apoio
  'nenhum'   : sem candidato plausível -> provável que não esteja na relação
"""
import sys, os, csv, difflib
sys.path.insert(0, os.path.dirname(__file__))
from relacao_index import fold
from elegibilidade import carregar_relacao, mes_limites, vinculo_cobre

def sim(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()

def score_nomes(toks_mapa, toks_rel):
    melhores = []
    for a in toks_mapa:
        melhores.append(max((sim(a, b) for b in toks_rel), default=0.0))
    cobertura = sum(1 for m in melhores if m >= 0.8) / len(melhores)
    return sum(melhores) / len(melhores), cobertura, melhores

def candidatos(nome_mapa, ym, categoria, data):
    ini, fim = mes_limites(ym)
    tm = fold(nome_mapa).split()
    if len(tm) < 2:
        return []
    out = []
    for p in data:
        tr = p["k"].split()
        if len(tr) < 2:
            continue
        s, cob, _ = score_nomes(tm, tr)
        if cob < 0.75 or s < 0.80:
            continue
        cobre = any(vinculo_cobre(v, ini, fim) for v in p["vinculos"])
        cat_igual = (not categoria) or (fold(categoria) and fold(categoria)[:8] == fold(p.get("cat", ""))[:8])
        if s >= 0.85 and cob >= 0.75 and cobre and (cat_igual or not categoria):
            nivel = "forte" if (cob == 1.0 and s >= 0.92) else "provavel"
        elif s >= 0.85:
            nivel = "provavel" if cobre else "fraco"
        else:
            nivel = "fraco"
        out.append({"niss": p["niss"], "nome_relacao": p["nome"], "score": round(s, 3), "cobertura": round(cob, 2),
                    "vinculo_cobre_mes": cobre, "categoria_igual": bool(cat_igual) if categoria else None, "nivel": nivel})
    ordem = {"forte": 0, "provavel": 1, "fraco": 2}
    out.sort(key=lambda x: (ordem[x["nivel"]], -x["score"]))
    return out[:3]

if __name__ == "__main__":
    extr, ym, rev, saida = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    data, _ = carregar_relacao(os.path.join(os.path.dirname(__file__), "..", "data", "relacao.js"))
    cats = {}
    for r in csv.DictReader(open(extr, encoding="utf-8")):
        cats[(r["pagina"], r["nome"])] = r.get("categoria", "")
    linhas = list(csv.DictReader(open(rev, encoding="utf-8")))
    resumo = {"forte": 0, "provavel": 0, "fraco": 0, "nenhum": 0}
    with open(saida, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["nome_mapa", "pagina", "categoria_mapa", "confianca", "niss", "nome_relacao", "score", "cobertura", "vinculo_cobre_mes", "categoria_igual", "motivo_original"])
        for r in linhas:
            cat = cats.get((r["pagina"], r["nome_mapa"]), "")
            cs = candidatos(r["nome_mapa"], ym, cat, data)
            if not cs:
                resumo["nenhum"] += 1
                w.writerow([r["nome_mapa"], r["pagina"], cat, "nenhum", "", "", "", "", "", "", r["motivo"]])
                continue
            top = cs[0]
            resumo[top["nivel"]] += 1
            for c in cs:
                w.writerow([r["nome_mapa"], r["pagina"], cat, c["nivel"], c["niss"], c["nome_relacao"], c["score"], c["cobertura"], c["vinculo_cobre_mes"], c["categoria_igual"], r["motivo"]])
    print(f"{ym} ({len(linhas)} por resolver): {resumo}")
