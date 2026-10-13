# INSS Angola - Elecnor

Processamento e conversão de mapas de remuneração INSS para envio ao portal do contribuinte.

## 📁 Estrutura

```
app-inss/
├── data/
│   └── relacao/        # Relação de trabalhadores (Excel)
├── mapas/
│   └── 2018/           # PDFs originais por ano
│       └── originais/
├── outputs/
│   └── 2018/           # TXT gerados para portal
├── scripts/
│   └── ocr/            # Scripts de extração
└── webapp/             # App web de revisão
```

## 📊 Estado 2018

| Mês | Trabalhadores | TXT |
|-----|---------------|-----|
| Janeiro | 286 | ✅ |
| Fevereiro | 203 | ✅ |
| Março | 196 | ✅ |
| Maio | 171 | ✅ |
| Junho | 164 | ✅ |
| Julho | 125 | ✅ |
| Agosto | 132 | ✅ |
| Setembro | 14 | ✅ |

**Total: 1391 trabalhadores processados**

## ⚠️ Meses não processados

Os meses **Abril, Outubro, Novembro, Dezembro** de 2018 não foram extraídos porque:
- Os PDFs são imagens escaneadas sem texto legível
- O Tesseract OCR não conseguiu extrair dados válidos
- Seria necessário OCR manual ou ficheiros originais XLSX

## 🔧 Scripts

- `extract_2018_full.py` - OCR completo para PDFs 2018
- `pipeline_year.py` - Pipeline genérico de extração

## 🌐 Web App

Acesse em: https://credodivaldo.github.io/mapa-inss-elecnor-2013/

Faz seleção por ano (2013, 2018) e visualização de trabalhadores por mês.
