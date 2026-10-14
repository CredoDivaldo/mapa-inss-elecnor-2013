"""Gera o CSV de um mês de 2018 no formato que a webapp lê (num,nome,niss,sal,rem,tot,page,y,h).
- nome e NISS vêm da relação quando a ligação é segura (exata ou palavras-chave); caso contrário ficam em branco
  para resolução manual com a autocompletação.
- 'page' = índice da página (0 = primeira), igual ao índice do array de páginas da configuração.
- Inclui as correções lidas na imagem (correcoes_visuais_*.csv), marcadas no campo origem.
Uso: python3 pipeline/gerar_csv_webapp.py <extracao.csv> <AAAA-MM> <saida.csv> [correcoes.csv]
"""
import sys, os, csv
sys.path.insert(0, os.path.dirname(__file__))
from elegibilidade import carregar_relacao, ligar
from relacao_index import fold

def main(extr, ym, saida, correcoes=None):
    data, por_k = carregar_relacao(os.path.join(os.path.dirname(__file__), "..", "data", "relacao.js"))
    chaves = list(por_k.keys())
    linhas = [r for r in csv.DictReader(open(extr, encoding="utf-8")) if r.get("tipo") != "TOTAL"]
    if correcoes and os.path.exists(correcoes):
        for c in csv.DictReader(open(correcoes, encoding="utf-8")):
            linhas.append({"pagina": c["pagina"], "nome": c["nome_mapa"], "sal": c["sal"], "rem": c["rem"],
                           "liq": c["liq"], "erros": "lido_na_imagem", "tipo": "TRABALHADOR"})
    out, est = [], {"ligado": 0, "por_resolver": 0}
    for i, r in enumerate(linhas, 1):
        nivel, cands, motivo = ligar(r["nome"], data, por_k, chaves)
        if nivel == "ligado":
            p = cands[0]; nome, niss = p["nome"], p["niss"]; est["ligado"] += 1
        else:
            nome, niss = r["nome"], ""; est["por_resolver"] += 1
        out.append({"num": i, "nome": nome, "niss": niss, "sal": r["sal"] or "0", "rem": r["rem"] or "0",
                    "tot": r["liq"] or "0", "page": int(r["pagina"]) - 1,
                    "y": r.get("y") or 0, "h": r.get("h") or 0})
    with open(saida, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=["num", "nome", "niss", "sal", "rem", "tot", "page", "y", "h"])
        w.writeheader(); w.writerows(out)
    print(f"{ym}: linhas={len(out)} ligadas={est['ligado']} por_resolver={est['por_resolver']} -> {saida}")

if __name__ == "__main__":
    a = sys.argv
    main(a[1], a[2], a[3], a[4] if len(a) > 4 else None)
