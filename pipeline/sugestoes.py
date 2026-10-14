"""Sugestões para linhas por resolver. NUNCA resolve automaticamente: só propõe candidatos com motivo.
Critérios:
  - 'primeira letra em falta': nome do mapa tem as mesmas palavras finais que um nome da relação
    (ex.: 'ancisco da Trindade' ~ 'FRANCISCO DA TRINDADE') -> sugestão
  - 'homónimo com vínculo no mês': entre os NISS com o mesmo nome, só um tem vínculo que cobre o mês
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
from relacao_index import fold
from elegibilidade import vinculo_cobre, mes_limites

def sugerir(nome_mapa, ym, data, por_k, chaves):
    k = fold(nome_mapa)
    if len(k.split()) < 2:
        return []
    ini, fim = mes_limites(ym)
    out = []
    # 1) mesmas palavras, primeira palavra pode ter perdido a 1.ª letra
    resto = k.split(" ")[1:]
    if resto and len(k.split(" ")[0]) >= 3:
        for c in chaves:
            ws = c.split(" ")
            primeira = k.split(" ")[0]
            if (len(ws) == len(k.split(" ")) and ws[1:] == resto
                    and len(ws[0]) == len(primeira) + 1 and ws[0][1:] == primeira):
                for p in por_k[c]:
                    out.append((p, "primeira letra em falta no mapa"))
    # 2) homónimos: se só um NISS tem vínculo no mês, sugerir esse
    if k in por_k and len(por_k[k]) > 1:
        cobre = [p for p in por_k[k] if any(vinculo_cobre(v, ini, fim) for v in p["vinculos"])]
        if len(cobre) == 1:
            out.append((cobre[0], "homónimo: só este NISS tem vínculo no mês"))
    # dedupe
    vistos, res = set(), []
    for p, motivo in out:
        if p["niss"] not in vistos:
            vistos.add(p["niss"]); res.append((p, motivo))
    return res

if __name__ == "__main__":
    from elegibilidade import carregar_relacao
    import csv
    data, por_k = carregar_relacao("data/relacao.js")
    chaves = list(por_k.keys())
    ym = sys.argv[2]
    rev = list(csv.DictReader(open(sys.argv[1], encoding="utf-8")))
    com, sem = 0, 0
    for r in rev:
        s = sugerir(r["nome_mapa"], ym, data, por_k, chaves)
        if s: com += 1
        else: sem += 1
    print(f"{ym}: por resolver={len(rev)} | com sugestao={com} | sem sugestao={sem}")
    for r in rev:
        s = sugerir(r["nome_mapa"], ym, data, por_k, chaves)
        if s:
            print(f"  {r['nome_mapa']!r} -> " + "; ".join(f"{p['nome']} {p['niss']} [{m}]" for p, m in s[:2]))
