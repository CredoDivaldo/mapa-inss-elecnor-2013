import sys, csv
sys.path.insert(0,'.')
import extrair_v3 as v3
import pdfplumber
FILES = {'05':'05-INSS MAIO 2018.pdf','06':'06-INSS JUNHO  2018.pdf','07':'07-INSS JULHO 2018.pdf','08':'08-INSS  AGOSTO 2018.pdf','09':'09-INSS SETEMBRO 2018.pdf','10':'10-INSS OUTUBRO 2018.pdf','11':'11-INSS  NOVEMBRO 2018.pdf','12':'12-INSS DEZEMBRO 2018.pdf'}
for m,f in FILES.items():
    v3.TOTAIS.clear()
    pdf=pdfplumber.open('originais/'+f)
    todas=[]
    for i,page in enumerate(pdf.pages):
        rows,cols=v3.extrair_pagina(page)
        for r in rows: r['pagina']=i+1; todas.append(r)
    with open(f'extraidos_v2/2018_{m}_v3.csv','w',newline='',encoding='utf-8') as fh:
        w=csv.writer(fh); w.writerow(['pagina','nome']+v3.COLS+['y','h'])
        for r in todas: w.writerow([r['pagina'],r['nome']]+[r.get(c,'') for c in v3.COLS]+[r.get('y',''),r.get('h','')])
    s={c: sum(v3.to_num(r[c]) or 0 for r in todas) for c in v3.COLS}
    cands=[r for r in v3.TOTAIS if (v3.to_num(r['liq']) or 0)>1e6 and v3.to_num(r['sal']) and abs((v3.to_num(r['sal']) or 0)+(v3.to_num(r['rem']) or 0)-(v3.to_num(r['liq']) or 0))<=0.01*(v3.to_num(r['liq']) or 1)]
    t=max(cands, key=lambda r: v3.to_num(r['liq'])) if cands else None
    if t:
        tl=v3.to_num(t['liq']); tt=v3.to_num(t['ss_trab']) or tl*0.03; te=v3.to_num(t['ss_emp'])
        ts=v3.to_num(t['sal']); tr=v3.to_num(t['rem'])
        print(f"MES {m} pag{t['pagina'] if 'pagina' in t else '?'} linhas={len(todas)} | liq {s['liq']:.2f} vs TOTAL {tl:.2f} ({(s['liq']-tl)/tl*100:+.2f}%) | sal {s['sal']:.2f} vs {ts:.2f} ({(s['sal']-ts)/ts*100:+.2f}%) | ss_trab {s['ss_trab']:.2f} vs {tt:.2f} ({(s['ss_trab']-tt)/tt*100:+.2f}%) | ss_emp {s['ss_emp']:.2f} vs {(te or 0):.2f}", flush=True)
    else:
        print(f"MES {m} linhas={len(todas)} SEM TOTAL DETECTADO", flush=True)
