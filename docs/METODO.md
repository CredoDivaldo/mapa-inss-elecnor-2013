# Processo INSS Elecnor — Método Documentado

Este documento descreve o **método que funciona** para converter os mapas INSS
escaneados da Elecnor em ficheiros TXT importáveis pelo portal da Segurança
Social. Foi calibrado por tentativa e erro ao longo de várias sessões e **deve
ser seguido para qualquer ano novo**.

> **Regra de ouro:** não escrever scripts novos por ano. Usar
> `scripts/ocr/extract_mapa.py` — é o mesmo método do pipeline de 2013 que
> está em produção na web app.

## Estrutura do projecto

```
app-inss/
├── data/relacao/                    Relação de Trabalhadores (Excel)
├── mapas/
│   └── {ANO}/
│       ├── originais/               PDFs escaneados (NÃO EDITAR)
│       └── processados/            CSVs das experiências antigas
├── scripts/ocr/extract_mapa.py     PIPELINE PRINCIPAL (qualquer ano)
├── webapp/                          App em produção (GitHub Pages)
│   ├── data/{ANO}/{MM}_semifinal.csv
│   └── data/config.js
├── outputs/{ANO}/                   TXTs gerados
└── legacy/                          Tentativas antigas (2014, 2020 partial)
```

## Formato do TXT (especificação do portal)

| Campo                    | Valor                                        |
|--------------------------|----------------------------------------------|
| Comprimento da linha     | 181 caracteres                               |
| Terminador de linha      | CRLF (`\r\n`)                                |
| Header                   | `00` + DD + MM + AAAA + `N` + NISS(9)        |
| Registo de trabalhador   | `100` + NISS segurado(8) + 20 espaços + nome(71) + bloco monetário(38) |
| Trailer                  | `9900000000`                                 |
| Ordem dos registos       | **Alfabética por nome completo (A→Z)** — obrigatório |
| Nome do ficheiro         | `<NISS><AAAA><MM><TIPO>.TXT` (ex: `130672018100.TXT`) |

O bloco monetário é **PROVISIONAL** até ser calibrado contra um TXT aceite
real. Ver skill `inss-angola-txt-generator` para o protocolo de calibração.

## Método de extracção (passo a passo)

### 0. Pré-requisitos

```bash
# Tesseract com português (tem de ser FICHEIRO REAL, não symlink)
ls -la /usr/local/share/tessdata/por.traineddata
# Se estiver partido:
curl -L https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/por.traineddata \
  > /usr/local/share/tessdata/por.traineddata

# Bibliotecas Python
pip install pymupdf opencv-python-headless openpyxl numpy pillow
```

### 1. Colocar os PDFs no sítio certo

```
mapas/2019/originais/01-INSS JANEIRO 19.pdf
mapas/2019/originais/02-INSS FEVEREIRO 19.pdf
...
```

O `find_pdf()` procura pelo padrão `NN` + nome do mês em português + ano.
Aceita variações como "MAR€O" (Março), espaços extra, parêntesis.

### 2. Extrair

```bash
# Um mês
python3 scripts/ocr/extract_mapa.py --ano 2018 --mes 10

# Vários meses
python3 scripts/ocr/extract_mapa.py --ano 2018 --mes 9 10 11 12

# Forçar reprocessamento (ignora CSV existente)
python3 scripts/ocr/extract_mapa.py --ano 2018 --mes 10 --force
```

**Output:** `webapp/data/{ANO}/{MM}_semifinal.csv`

Colunas: `num, nome, niss, sal, rem, tot, page, y, h`

### 3. Validar

```bash
# Contar trabalhadores e NISS casados
python3 scripts/validate_csv.py --ano 2018 --mes 10

# Ver a imagem da página de um trabalhador
# (abrir webapp/index.html e seleccionar o mês)
```

### 4. Gerar TXT

```bash
python3 scripts/gerar_txt.py --ano 2018 --mes 10
```

Validar com o validador do skill antes de entregar.

### 5. Trabalhadores excluídos (sem NISS na relação)

```bash
python3 scripts/excluded_workers.py --ano 2018 --mes 10
```

Gera `outputs/{ANO}/excluded_{ANO}_{MM}.csv` para a contabilidade cadastrar
no portal.

## Como o pipeline funciona (internos)

1. **Rasterização** — PyMuPDF a `DPI_ZOOM=3.0` (≈718 dpi).
2. **Rotação** — `upright()` conta as linhas da tabela em OpenCV (morfologia
   horizontal) e desempata 0 vs 180 pela legibilidade do cabeçalho. Isto
   resolve os mapas **landscape** (Outubro 2018 em diante).
3. **Lock de rotação** — a primeira página de tabela valida a rotação; as
   restantes páginas do mesmo PDF **herdam** essa rotação. Sem isto, páginas
   de continuação sem cabeçalho ficam de cabeça para baixo.
4. **Filtro de anexos** — `is_anexo()` salta recibos de entrega, guias de
   depósito e páginas de RESUMO que não são mapa de pessoal.
5. **Bandeamento** — `row_bands()` encontra as faixas horizontais entre linhas
   da tabela.
6. **OCR por linha** — cada faixa é recortada e passada ao Tesseract com
   **psm=7** (linha única). **Nunca psm=3/6 na página inteira** — devolve
   lixo em mapas densos.
7. **Money** — `MONEY_RE` aceita valores **com ou sem sufixo "kz"**. Mapas
   landscape não trazem o sufixo.
8. **Nomes** — `limpar_nome()` separia o nome da categoria ocupacional
   (MONTADOR, AJUDANTE, etc.) usando a lista `STOP`/`CAT_PREFIX`.
9. **NISS** — `casar_niss()` faz fuzzy matching contra a Relação de
   Trabalhadores (matching por tokens partilhados, não string exacta).

## Erros conhecidos — NÃO REPETIR

| Sintoma                              | Causa                                | Solução                              |
|--------------------------------------|--------------------------------------|--------------------------------------|
| 0 trabalhadores                     | Regex a exigir "kz" (mapas landscape não têm) | `MONEY_RE` actual aceita sem sufixo |
| Lixo / pipes aleatórios              | psm 3 ou 6 na página inteira         | psm **7** por linha recortada        |
| Texto de cabeça para baixo           | Desempate 0 vs 180 falha             | `_legibility_score()` + lock de rotação |
| `Error in fopenReadStream` (Leptonica) | Imagem em `/tmp`                     | O `WORK` fica na home do user        |
| Tesseract não reconhece "por"        | `por.traineddata` é symlink partido  | Transferir o ficheiro real           |
| Salário gigante (ex: 12131128,99)    | Espaço solto aceite como separador de milhares funde com Nº INSS | Só `.` é separador de milhares |
| Nome com prefixo "—3IADRIANO"        | `\b\d+\b` não limpa dígitos colados a letras | `re.sub(r"^[^A-ZÁ-Ú]+", "", token)` |
| Páginas do meio ignoradas            | Rotação inconsistentemente detectada | Lock de rotação na 1ª página de tabela |

## Anos processados

| Ano  | Estado                              | Mapas em `mapas/` |
|------|-------------------------------------|-------------------|
| 2013 | ✅ Em produção na web app           | `mapas/2013/`     |
| 2015 | ⬜ Pendente (12 PDFs em `mapas/2015/originais/`) | sim |
| 2016 | ⬜ Pendente                         | `mapas/2016/`     |
| 2017 | ⬜ Pendente                         | `mapas/2017/`     |
| 2018 | 🔄 Em curso (ver `webapp/data/2018/`) | `mapas/2018/`     |
| 2019 | ⬜ Pendente                         | `mapas/2019/`     |
| 2020 | ⬜ Pendente (parcial em `legacy/`)  | `mapas/2020/`     |

## Web app

- **URL produção:** https://credodivaldo.github.io/mapa-inss-elecnor-2013/
- **Repo:** `app-inss` (este directório)
- **Deploy:** commit + push para `main` (GitHub Pages publica automaticamente)

Para adicionar um ano à web app:

1. Correr o pipeline (passo 2 acima) para os 12 meses.
2. Editar `webapp/data/config.js` — adicionar entradas a `anos["2018"]`.
3. Commit e push.

## Deploy checklist

- [ ] CSVs semifinais gerados para todos os meses
- [ ] `config.js` actualizado com os meses novos
- [ ] Web app testada localmente (`open webapp/index.html`)
- [ ] Commit + push para `main`
- [ ] Verificar o site em produção
