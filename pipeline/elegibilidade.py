"""Liga as linhas do mapa à relação e separa o que entra no TXT do que não entra.
Categorias de saída (por linha do mapa):
  - ok               : nome/NISS ligados com segurança E vínculo activo no mês do mapa
  - ja_inscrito      : confirmado pelo contabilista (data/ja_inscritos.json) — passa sem filtro de período
  - excluido_periodo : ligado à relação, mas nenhum vínculo cobre o mês do mapa (vai para a lista de excluídos)
  - revisar          : grafia diferente (letras), homónimo ou sem ligação — não entra no TXT até decisão humana
Acentos apenas NÃO geram revisão: o nome sem acentos é igual.
Uso: python3 pipeline/elegibilidade.py <mapa.csv> <AAAA-MM> [data/relacao.js] [data/ja_inscritos.json] [saida_dir]
"""
import sys, os, csv, json, datetime as dt
from collections import defaultdict
import difflib
sys.path.insert(0, os.path.dirname(__file__))
from relacao_index import fold

def carregar_relacao(path):
    txt = open(path, encoding="utf-8").read()
    data = json.loads(txt[txt.index("["): txt.rindex("]") + 1])
    por_k = defaultdict(list)
    for p in data: por_k[p["k"]].append(p)
    return data, por_k

def mes_limites(ym):
    a, m = map(int, ym.split("-"))
    ini = dt.date(a, m, 1)
    fim = (dt.date(a + (m == 12), (m % 12) + 1, 1) - dt.timedelta(days=1))
    return ini, fim

def vinculo_cobre(v, ini, fim):
    vi = dt.date.fromisoformat(v["inicio"]) if v.get("inicio") else None
    vf = dt.date.fromisoformat(v["fim"]) if v.get("fim") else None
    if vi and vi > fim: return False          # começa depois do mês
    if vf and vf < ini: return False          # acaba antes do mês
    return True

def ligar(nome, data, por_k, chaves):
    k = fold(nome)
    if not k or len(k.split()) < 2:
        return "revisar", [], "nome incompleto (menos de duas palavras)"
    if k in por_k:
        c = por_k[k]
        if len(c) == 1: return "ligado", c, ""
        return "revisar", c, "homónimo (vários NISS com este nome)"
    toks = k.split()
    cands = [p for p in data if all(t in p["k"].split() for t in toks)]
    if len(cands) == 1: return "ligado", cands, "por palavras-chave"
    close = difflib.get_close_matches(k, chaves, n=3, cutoff=0.88)
    if len(close) == 1: return "revisar", por_k[close[0]], "grafia diferente (letras): confirmar"
    if close: return "revisar", [p for c in close for p in por_k[c]], "grafia diferente: escolher"
    return "revisar", [], "sem ligação na relação"

def processar(mapa_csv, ym, rel_path, ja_path, out_dir):
    data, por_k = carregar_relacao(rel_path)
    chaves = list(por_k.keys())
    ja = {}
    if ja_path and os.path.exists(ja_path):
        ja = {x["niss"]: x for x in json.load(open(ja_path, encoding="utf-8")).get("inscritos", [])}
    ini, fim = mes_limites(ym)
    rows = [r for r in csv.DictReader(open(mapa_csv, encoding="utf-8")) if r.get("tipo") != "TOTAL"]
    saida = defaultdict(list)
    for r in rows:
        nivel, cands, motivo = ligar(r["nome"], data, por_k, chaves)
        base = {"pagina": r["pagina"], "nome_mapa": r["nome"], "sal": r["sal"], "rem": r["rem"],
                "liq": r["liq"], "ss_trab": r["ss_trab"], "ss_emp": r["ss_emp"], "erros_extracao": r.get("erros", "")}
        if nivel != "ligado":
            saida["revisar"].append({**base, "motivo": motivo, "candidatos": "; ".join(f"{c['nome']} {c['niss']}" for c in cands[:3])})
            continue
        p = cands[0]
        base.update({"niss": p["niss"], "nome_relacao": p["nome"], "vinculos": "; ".join(f"{v['inicio']}..{v['fim'] or 'activo'}" for v in p["vinculos"])})
        if p["niss"] in ja:
            saida["ok"].append({**base, "origem": "ja_inscrito"}); continue
        if any(vinculo_cobre(v, ini, fim) for v in p["vinculos"]):
            saida["ok"].append({**base, "origem": "relacao"})
        else:
            saida["excluido_periodo"].append({**base, "motivo": f"Consta no mapa de {ym} mas o vínculo não cobre o período"})
    os.makedirs(out_dir, exist_ok=True)
    tag = ym.replace("-", "_")
    campos_ok = ["pagina", "niss", "nome_relacao", "nome_mapa", "sal", "rem", "liq", "ss_trab", "ss_emp", "origem", "vinculos", "erros_extracao"]
    with open(f"{out_dir}/ok_{tag}.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=campos_ok, extrasaction="ignore"); w.writeheader()
        w.writerows(sorted(saida["ok"], key=lambda r: r["nome_relacao"]))
    campos_ex = ["nome_relacao", "niss", "vinculos", "motivo", "pagina", "nome_mapa", "sal", "rem", "liq", "ss_trab", "ss_emp"]
    with open(f"{out_dir}/excluidos_{tag}.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=campos_ex, extrasaction="ignore"); w.writeheader()
        w.writerows(sorted(saida["excluido_periodo"], key=lambda r: r["nome_relacao"]))
    campos_rev = ["nome_mapa", "motivo", "candidatos", "pagina", "sal", "rem", "liq", "ss_trab", "ss_emp", "erros_extracao"]
    with open(f"{out_dir}/revisar_{tag}.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=campos_rev, extrasaction="ignore"); w.writeheader()
        w.writerows(sorted(saida["revisar"], key=lambda r: r["nome_mapa"]))
    print(f"{ym}: ok={len(saida['ok'])} excluidos_periodo={len(saida['excluido_periodo'])} revisar={len(saida['revisar'])}")
    return saida

if __name__ == "__main__":
    a = sys.argv
    processar(a[1], a[2], a[3] if len(a) > 3 else "data/relacao.js",
              a[4] if len(a) > 4 else "data/ja_inscritos.json",
              a[5] if len(a) > 5 else "outputs_txt")
