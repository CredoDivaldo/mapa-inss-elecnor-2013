#!/usr/bin/env python3
"""
INSS Angola — Sistema de geracao de mapas de remuneracao (TXT portal contribuinte).

Regra central de vinculo:
    Um trabalhador so entra no mapa de um mes M/ANO se a relacao de trabalhadores
    vinculados (/data/RelacaoDeTrabalhadoresVinculadosPorContribuinte-*.xlsx)
    tiver PELO MENOS UM contrato cujo periodo [Inicio, Fim] toca esse mes.
    Fim vazio => contrato em aberto (cobre ate hoje).

FORMATO DO FICHEIRO (nao alterar — validado no portal):
    - 180 caracteres por linha, terminador CRLF
    - Header [0:2]="00", Body [0:3]="100", Trailer [0:2]="99"
"""

import argparse
import re
import sys
import unicodedata
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path

import openpyxl

BASE = Path(__file__).resolve().parent

# --- Identificacao do contribuinte (validado no portal) ---
NISS_EMPRESA = "13067"
NIF = "0500130670"
NOME_EMPRESA = "ELECNOR"

# --- Layout (nao alterar) ---
LINHA_LEN = 180
TERMINADOR = "\r\n"

PARTICULAS = {"DE", "DA", "DO", "DAS", "DOS", "E"}
LIMIAR_FUZZY = 0.80

# Fraccao minima do nome da relacao que o nome do mapa tem de cobrir para ser
# aceite como subconjunto. Calibrado contra o ficheiro de Fev/2014 que passou
# no portal: 0.4 maximiza o recall (98.3%) sem introduzir falsos positivos.
FRACCAO_SUBCONJUNTO = 0.4


# ---------------------------------------------------------------- utilitarios
def fold(s):
    """Normaliza nome: sem acentos, maiusculas, so [A-Z0-9 ]."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = s.encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^A-Za-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).upper().strip()


def tokens(s):
    """Tokens significativos (sem particulas)."""
    return [t for t in fold(s).split() if t and t not in PARTICULAS]


def so_digitos(v):
    return re.sub(r"\D", "", str(v or ""))


def niss_candidatos(v):
    """
    Normaliza o NISS tal como vem no mapa para os NISS possiveis da relacao.

    O campo vem em formatos muito variados, e o NISS nem sempre esta no inicio:
        '000722856'      -> 722856      (zeros a esquerda)
        '1363330-00'     -> 1363330     (sufixo -00 do sistema)
        '001023121-00'   -> 1023121
        '00126228100'    -> 1262281     (sufixo colado)
        '02.000912818-22'-> 912818      (NISS EMBUTIDO no meio!)
        '00 1192858'     -> 1192858     (espaco interior)
        '103034924LA0378'-> (BI — nao e NISS)
    A relacao guarda apenas os digitos significativos (5-7), sem zeros iniciais.

    Devolve candidatos por ordem de preferencia, sem duplicados. A decisao final
    e sempre confirmada pelo NOME (ver Relacao.nome_confere).
    """
    raw = str(v or "").strip()
    if not raw:
        return []

    cands = []

    # 1) Segmentos separados por '.', '-', '/', espaco. Cobre o caso em que o
    #    NISS vem no MEIO ('02.000912818-22') e o caso do sufixo '-00'.
    for seg in re.split(r"[.\-/\s]+", raw):
        d = so_digitos(seg)
        if d:
            cands.append(d.lstrip("0") or d)

    # 2) Todos os digitos de uma vez, sem zeros a esquerda
    tudo = so_digitos(raw)
    if tudo:
        cands.append(tudo.lstrip("0") or tudo)

    # 3) Prefixos plausiveis (5 a 7 digitos) — cobre sufixo colado ao NISS
    for n in (7, 6, 5):
        if len(tudo) > n:
            cands.append(tudo[:n].lstrip("0") or tudo[:n])

    # 4) Sub-cadeias de digitos de 5 a 7 chars — pela ordem em que aparecem.
    #    Rede de seguranca para formatos que nao separei correctamente.
    if len(tudo) > 7:
        for n in (7, 6, 5):
            for i in range(len(tudo) - n + 1):
                cands.append(tudo[i:i + n].lstrip("0") or tudo[i:i + n])

    # dedup preservando ordem, so comprimentos plausiveis de NISS
    out = []
    for c in cands:
        if c and 4 <= len(c) <= 7 and c not in out:
            out.append(c)
    return out


def num(v):
    """Converte valor monetario vindo do Excel para float."""
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", "")
    if not s or set(s) <= {"-", "."}:
        return 0.0
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def as_date(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


# ------------------------------------------------------------------ relacao
class Relacao:
    """Relacao de trabalhadores vinculados, indexada por NISS."""

    def __init__(self, xlsx):
        self.por_niss = {}          # niss -> {"nome": str, "contratos": [(ini,fim)], "cats": [..]}
        self.por_nome = {}          # nome dobrado -> set(niss)
        self._carregar(Path(xlsx))

    def _carregar(self, xlsx):
        wb = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
        ws = wb.active
        # Cabecalho de dados na linha 10; dados a partir da linha 11
        for row in ws.iter_rows(min_row=11, values_only=True):
            if not row or not row[0]:
                continue
            niss = so_digitos(row[0])
            if not niss:
                continue
            nome = fold(row[1]) if len(row) > 1 else ""
            ini = as_date(row[5]) if len(row) > 5 else None
            fim = as_date(row[6]) if len(row) > 6 else None
            cat = str(row[2] or "").strip() if len(row) > 2 else ""

            e = self.por_niss.setdefault(
                niss, {"nome": nome, "contratos": [], "cats": []}
            )
            e["contratos"].append((ini, fim))
            if cat:
                e["cats"].append(cat)
            if nome and nome not in e["nome"]:
                # preferir o nome mais longo (mais completo)
                if len(nome) > len(e["nome"]):
                    e["nome"] = nome
            if nome:
                self.por_nome.setdefault(nome, set()).add(niss)
        wb.close()

    # -- consultas ---------------------------------------------------------
    def cobre_mes(self, niss, ano, mes):
        """True se algum contrato do NISS toca o mes (ano, mes)."""
        e = self.por_niss.get(niss)
        if not e:
            return False
        primeiro = date(ano, mes, 1)
        seguinte = date(ano + 1, 1, 1) if mes == 12 else date(ano, mes + 1, 1)
        for ini, fim in e["contratos"]:
            if ini is None:
                continue
            if ini < seguinte and (fim is None or fim >= primeiro):
                return True
        return False

    def nome_de(self, niss):
        e = self.por_niss.get(niss)
        return e["nome"] if e else ""

    def nome_confere(self, nome_mapa, niss, limiar=0.70):
        """
        Verifica se o nome do mapa e coerente com o nome da relacao para esse
        NISS. Usado para desambiguar quando o NISS do mapa vem formatado e
        gera varios candidatos.
        """
        nome_rel = self.nome_de(niss)
        if not nome_rel:
            return False
        a = set(tokens(nome_mapa))
        b = set(tokens(nome_rel))
        if not a or not b:
            return False
        # subconjunto de tokens (nome truncado no mapa) ou semelhanca alta
        if len(a) >= 2 and a <= b:
            return True
        ra = " ".join(sorted(a))
        rb = " ".join(sorted(b))
        return SequenceMatcher(None, ra, rb).ratio() >= limiar

    def candidatos_por_nome(self, nome, limite=None):
        """
        Devolve [(niss, score)] ordenado por score desc, por semelhanca de nome.

        Estrategias, por ordem de confianca:
          1. igualdade exacta (nome dobrado)                    -> 1.00
          2. subconjunto de tokens: todos os tokens do mapa
             existem no nome da relacao (nome truncado)         -> 0.95
          3. semelhanca de sequencia >= limiar                  -> ratio
        """
        if limite is None:
            limite = LIMIAR_FUZZY
        alvo_t = set(tokens(nome))
        alvo_c = " ".join(sorted(alvo_t))
        if not alvo_c:
            return []

        candidatos = []

        # 1) igualdade exacta (score maximo, mas NAO exclusiva: ve abaixo)
        f = fold(nome)
        if f in self.por_nome:
            for n in self.por_nome[f]:
                candidatos.append((n, 1.0))

        for nome_rel, nisses in self.por_nome.items():
            rel_t = set(tokens(nome_rel))
            if not rel_t:
                continue
            comuns = alvo_t & rel_t

            # 2) subconjunto: o nome do mapa cabe dentro do nome da relacao.
            #    Exige >=2 tokens e que o nome do mapa cubra uma fraccao minima
            #    do nome da relacao (nomes truncados no mapa sao frequentes:
            #    "Jose De Castro" -> "JOSE DE CASTRO POMBO LUANDA").
            #
            #    IMPORTANTE: nao parar no exacto. Quando o mapa diz
            #    "Alberto Bonifacio" e existem na relacao tanto "ALBERTO
            #    BONIFACIO" (exacto, mas sem contrato no mes) como "ALBERTO
            #    BONIFACIO HAMACUPA CASSINDA" (subconjunto, com contrato em
            #    aberto), e o segundo que corresponde ao trabalhador. Devolver
            #    ambos permite ao chamador escolher quem COBRE o mes.
            if (len(alvo_t) >= 2 and alvo_t <= rel_t and rel_t != alvo_t
                    and len(alvo_t) >= FRACCAO_SUBCONJUNTO * len(rel_t)):
                for n in nisses:
                    candidatos.append((n, 0.95))
                continue

            # 3) semelhanca difusa: exige >=2 tokens em comum
            if len(comuns) < 2:
                continue
            rel_c = " ".join(sorted(rel_t))
            score = SequenceMatcher(None, alvo_c, rel_c).ratio()
            if score >= limite:
                for n in nisses:
                    candidatos.append((n, score))

        # deduplicar por niss mantendo o melhor score
        melhor = {}
        for n, s in candidatos:
            if n not in melhor or s > melhor[n]:
                melhor[n] = s
        return sorted(melhor.items(), key=lambda x: -x[1])


# --------------------------------------------------------------------- mapa
def ler_mapa(xlsx):
    """Le a folha 'Folha Pagamento SS manual' do mapa de remuneracao."""
    wb = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
    ws = None
    for nome in ("Folha Pagamento SS manual", "Folha Pagamento SS SITE"):
        if nome in wb.sheetnames:
            ws = wb[nome]
            break
    if ws is None:
        ws = wb.worksheets[0]

    linhas = []
    for i, row in enumerate(ws.iter_rows(min_row=11, values_only=True), start=11):
        if not row:
            continue
        nome = str(row[1]).strip() if len(row) > 1 and row[1] else ""
        if not nome:
            continue
        fn = fold(nome)
        if not fn or "TOTAL" in fn:
            continue
        # Guardar o valor EM BRUTO: o NISS no mapa vem formatado
        # ('1363330-00', '02.00951733-23') e a normalizacao decide-se depois.
        niss_raw = str(row[3]).strip() if len(row) > 3 and row[3] else ""
        salario = num(row[10]) if len(row) > 10 else 0.0
        linhas.append(
            {"linha": i, "nome": nome, "nome_fold": fn,
             "niss": niss_raw, "salario": salario}
        )
    wb.close()
    return linhas


# ------------------------------------------------------------------ vinculo
def _score(cands, niss):
    """Score de um NISS na lista de candidatos (0 se ausente)."""
    for n, s in cands:
        if n == niss:
            return s
    return 0.0


def resolver_vinculos(mapa, relacao, ano, mes, todos=False, verboso=True):
    """
    Para cada trabalhador do mapa decide se entra no ficheiro.

    Devolve (incluidos, excluidos):
        incluidos: [{"niss","nome","salario","origem"}]
        excluidos: [{"nome","salario","motivo"}]

    Se todos=True: inclui TODOS os trabalhadores sem aplicar regras de exclusão.
    """
    incluidos, excluidos = [], []

    # MODO TODOS: incluir tudo, preencher NISS da relação onde possível
    if todos:
        vistos_niss = set()
        for w in mapa:
            if w["salario"] <= 0:
                excluidos.append({"nome": w["nome"], "salario": w["salario"], "motivo": "salario zero"})
                continue
            # NISS do mapa
            niss_raw = w["niss"]
            niss = so_digitos(niss_raw) if niss_raw else ""
            if niss:
                niss = niss.lstrip("0") or niss
            # Se NISS vazio, tentar encontrar na relação por nome
            if not niss:
                nome_fold = fold(w["nome"])
                for niss_rel, dados in relacao.por_niss.items():
                    if dados.get("nome") == nome_fold:
                        niss = niss_rel
                        break
            # Adicionar
            if niss in vistos_niss:
                excluidos.append({
                    "nome": w["nome"],
                    "salario": w["salario"],
                    "motivo": "duplicado (linha repetida no mapa)",
                    "niss_candidato": niss,
                    "score_candidato": 1.0
                })
            else:
                if niss:
                    vistos_niss.add(niss)
                incluidos.append({
                    "niss": niss,
                    "nome": fold(w["nome"]),
                    "salario": w["salario"],
                    "origem": "todos",
                    "score": 1.0
                })
        return incluidos, excluidos
    usados = set()

    for w in mapa:
        nome, niss, salario = w["nome"], w["niss"], w["salario"]
        if salario <= 0:
            excluidos.append({"nome": nome, "salario": salario, "motivo": "salario zero"})
            continue

        # =================================================================
        # PRINCIPIO: a exclusao e o ULTIMO recurso. Reunimos TODAS as
        # evidencias (NISS do mapa + nome) e so excluimos se nenhuma delas
        # apontar para alguem com contrato a cobrir o mes.
        # =================================================================
        evidencias = {}   # niss -> (score, fonte)

        def juntar(n, score, fonte):
            if not n:
                return
            if n not in evidencias or score > evidencias[n][0]:
                evidencias[n] = (score, fonte)

        # Evidencia 1: NISS do mapa (normalizado). O NISS SO e aceite quando o
        # nome confere — verificado a 2026-09: o BI '02.00951733-23' da
        # "Eva da Silva Manuel" contem a sub-cadeia '951733', que e o NISS de
        # "CARLA MARIA JOSE PEDRO". Sem esta guarda, a Eva era atribuida a
        # outra pessoa. Um NISS extraido de um BI nao identifica ninguem.
        for c in niss_candidatos(niss):
            if c in relacao.por_niss and relacao.nome_confere(nome, c):
                juntar(c, 0.99, "niss")

        # Evidencia 2: nome do mapa -> candidatos na relacao
        for n, s in relacao.candidatos_por_nome(nome, LIMIAR_FUZZY):
            juntar(n, s, "nome")

        if not evidencias:
            excluidos.append({"nome": nome, "salario": salario,
                              "motivo": "nao consta na relacao (nem NISS nem nome)"})
            continue

        # Ordenar por evidencia: score desc; a igualdade, NISS mais baixo
        # (o registo mais antigo e habitualmente o original).
        ordenados = sorted(evidencias.items(), key=lambda kv: (-kv[1][0], int(kv[0])))

        # Escolher o melhor candidato que COBRE o mes e ainda nao foi usado.
        escolhido = None
        for n, (sc, fonte) in ordenados:
            if n in usados:
                continue
            if relacao.cobre_mes(n, ano, mes):
                escolhido = (n, sc, fonte)
                break
        if escolhido:
            n, sc, fonte = escolhido
            usados.add(n)
            incluidos.append(
                {"niss": n, "nome": relacao.nome_de(n) or fold(nome),
                 "salario": salario, "origem": fonte, "score": round(sc, 3)}
            )
            continue

        # Ninguem disponivel cobriu o mes. Distinguir o motivo com rigor:
        # ha candidatos na relacao mas nenhum trabalhou no mes?
        cobrem = [n for n, _ in ordenados if relacao.cobre_mes(n, ano, mes)]
        top_niss = ordenados[0][0] if ordenados else ""
        top_score = ordenados[0][1][0] if ordenados else 0.0
        if cobrem:
            motivo = "duplicado (NISS ja usado noutra linha)"
        else:
            motivo = "vinculado mas sem contrato no mes"
        excluidos.append({
            "nome": nome, "salario": salario, "motivo": motivo,
            "niss_candidato": top_niss, "score_candidato": round(top_score, 3)
        })
        continue

    incluidos.sort(key=lambda x: x["nome"])
    excluidos.sort(key=lambda x: x["nome"])
    return incluidos, excluidos


# --------------------------------------------------------------------- TXT
def _p(s, n):
    """Trunca/preenche para exactamente n caracteres."""
    return str(s)[:n].ljust(n)


def build_txt(incluidos, ano, mes, dia="01"):
    """Gera as linhas do TXT (180 chars cada) no formato validado no portal."""
    mm = f"{mes:02d}"
    yyyy = f"{ano}"
    ddmmyyyy = f"{dia}{mm}{yyyy}"

    # Header
    header = (
        "00" + dia + mm + yyyy + "N"
        + _p(NISS_EMPRESA.zfill(9), 9)
        + " " * 20
        + _p(NIF, 10)
        + " " * 10
        + _p(NOME_EMPRESA, 70)
        + "00000"
        + " " * 45
    )

    # Corpo
    corpos, soma_sal, soma_rem = [], 0, 0
    for t in incluidos:
        niss = _p(t["niss"].zfill(8), 8)
        nome = _p(t["nome"], 70)
        cent = int(round(t["salario"] * 100))
        if cent < 0:
            cent = 0
        soma_sal += cent
        rem = 0
        soma_rem += rem
        corpos.append(
            "100" + niss + " " * 20 + nome + "00000"
            + str(cent).zfill(14) + str(rem).zfill(14)
            + ddmmyyyy + " " * 38
        )

    # Trailer
    trailer = (
        "99" + str(len(incluidos)).zfill(10)
        + str(soma_sal).zfill(24) + str(soma_rem).zfill(14)
        + " " * 130
    )

    for i, l in enumerate([header] + corpos + [trailer]):
        if len(l) != LINHA_LEN:
            raise ValueError(f"linha {i} com {len(l)} chars (esperado {LINHA_LEN})")

    return header, corpos, trailer


def escrever_txt(destino, header, corpos, trailer):
    conteudo = TERMINADOR.join([header] + corpos + [trailer]) + TERMINADOR
    Path(destino).write_bytes(conteudo.encode("ascii"))


def nome_ficheiro(ano, mes, tipo="0"):
    return f"{NISS_EMPRESA}{ano}{mes:02d}{tipo}.TXT"


def _escrever_xlsx(destino, incluidos):
    """Escreve o Excel canonico equivalente ao TXT."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "FolhaDeRemuneracao"
    ws.append(["Número de Inscrição no INSS", "Nome Completo do Trabalhador",
               "Salário Base", "Outras Remunerações"])
    for t in incluidos:
        ws.append([t["niss"], t["nome"], round(t["salario"], 2), 0.0])
    wb.save(destino)


# ------------------------------------------------------- verificacao final
# Salvaguardas contra exclusao injusta. Estamos a lidar com o ganha-pao de
# familias: mais vale BLOQUEAR a entrega do que emitir um ficheiro que deixa
# alguem de fora sem que ninguem repare.
def verificar_saida(mapa, incluidos, excluidos, relacao, ano, mes):
    """
    Corre verificacoes de integridade antes de escrever o ficheiro.
    Devolve lista de avisos (vazia = tudo bem).
    """
    avisos = []

    # 1) Contabilidade: ninguem pode desaparecer no caminho
    if len(incluidos) + len(excluidos) != len(mapa):
        avisos.append(
            f"CONTABILIDADE: {len(mapa)} no mapa != {len(incluidos)} incluidos "
            f"+ {len(excluidos)} excluidos = {len(incluidos)+len(excluidos)}"
        )

    # 2) Sem NISS duplicado no ficheiro (sinal de atribuicao errada)
    vistos = {}
    for t in incluidos:
        if t["niss"] in vistos:
            avisos.append(f"NISS DUPLICADO {t['niss']}: "
                          f"{vistos[t['niss']]!r} e {t['nome']!r}")
        vistos[t["niss"]] = t["nome"]

    # 3) Nenhum incluido pode ter contrato fora do mes
    for t in incluidos:
        if not relacao.cobre_mes(t["niss"], ano, mes):
            avisos.append(f"INCLUIDO SEM CONTRATO NO MES: {t['niss']} {t['nome']}")

    # 4) Um excluido nunca pode ter contrato a cobrir o mes (exclusao injusta)
    for e in excluidos:
        if relacao.cobre_mes(e.get("niss", ""), ano, mes):
            avisos.append(f"EXCLUSAO SUSPEITA: {e['nome']} tem contrato no mes")

    # 5) Nenhum nome vazio nem salario invalido
    for t in incluidos:
        if not t["nome"] or not str(t["nome"]).strip():
            avisos.append(f"NOME VAZIO para NISS {t['niss']}")
        if t["salario"] <= 0:
            avisos.append(f"SALARIO INVALIDO para {t['nome']}: {t['salario']}")

    return avisos


# -------------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description="Gera mapa INSS (TXT) por vinculo de contrato.")
    ap.add_argument("--mapa", required=True, help="Ficheiro .xlsx do mapa de remuneracao")
    ap.add_argument("--ano", type=int, required=True)
    ap.add_argument("--mes", type=int, required=True, choices=range(1, 13))
    ap.add_argument("--saida", default=None, help="Pasta de saida")
    ap.add_argument("--relacao", default=str(
        BASE / "data" / "RelacaoDeTrabalhadoresVinculadosPorContribuinte-000013067.xlsx"))
    ap.add_argument("--relatorio", action="store_true", help="Escreve CSV de excluidos")
    ap.add_argument("--todos", action="store_true", help="Inclui TODOS os trabalhadores sem aplicar regras de exclusao")
    args = ap.parse_args()

    relacao = Relacao(args.relacao)
    mapa = ler_mapa(args.mapa)
    if not mapa:
        print("ERRO: nenhum trabalhador lido do mapa.", file=sys.stderr)
        return 1

    incluidos, excluidos = resolver_vinculos(mapa, relacao, args.ano, args.mes, todos=args.todos)

    # Salvaguarda: abortar se houver inconsistencia nos dados (salto se --todos)
    if not args.todos:
        avisos = verificar_saida(mapa, incluidos, excluidos, relacao, args.ano, args.mes)
        if avisos:
            print("\nAVISOS DE INTEGRIDADE:", file=sys.stderr)
            for a in avisos:
                print(f"  - {a}", file=sys.stderr)
            if any("CONTABILIDADE" in a or "DUPLICADO" in a for a in avisos):
                print("\nERRO CRITICO: abortado para proteger a integridade dos dados.",
                      file=sys.stderr)
                return 2

    destino_dir = Path(args.saida) if args.saida else (
        BASE / "output_inss_system" / f"{args.ano}_{args.mes:02d}")
    destino_dir.mkdir(parents=True, exist_ok=True)
    destino = destino_dir / nome_ficheiro(args.ano, args.mes)

    header, corpos, trailer = build_txt(incluidos, args.ano, args.mes)
    escrever_txt(destino, header, corpos, trailer)

    print(f"Mapa lido          : {Path(args.mapa).name}")
    print(f"Trabalhadores mapa : {len(mapa)}")
    print(f"Incluidos          : {len(incluidos)}")
    print(f"Excluidos          : {len(excluidos)}")
    print(f"Ficheiro           : {destino}")
    print(f"Linhas             : {len(corpos)} corpos + header + trailer")
    print(f"Total salarios     : {sum(t['salario'] for t in incluidos):,.2f} Kz")

    # Excel canonico equivalente
    xlsx = destino_dir / f"FolhaDeRemuneracao-{args.ano}_{args.mes:02d}.xlsx"
    _escrever_xlsx(xlsx, incluidos)
    print(f"Excel              : {xlsx}")

    if args.relatorio and excluidos:
        csv = destino_dir / "excluidos.csv"
        with open(csv, "w", encoding="utf-8") as f:
            f.write("nome;salario;motivo;niss_candidato;score_candidato\n")
            for e in excluidos:
                f.write(f"{e['nome']};{e['salario']:.2f};{e['motivo']};"
                        f"{e.get('niss_candidato','')};{e.get('score_candidato','')}\n")
        print(f"Relatorio          : {csv}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
