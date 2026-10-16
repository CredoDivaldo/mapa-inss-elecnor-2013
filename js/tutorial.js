/* Tutorial guiado: destaca cada elemento com uma explicação simples, passo a passo.
 * Abre sozinho na primeira visita (depois de escolher o perfil). Pode ser aberto pelo botão "Tutorial". */
(function () {
  const CHAVE_VISTO = "inss-tutorial-visto";
  const PASSOS = [
    { sel: "#perfil-chip", titulo: "1 · O seu perfil", texto: "Este é o seu perfil. O seu nome fica registado em cada alteração. Para trocar de pessoa, clique aqui." },
    { sel: "#yearSelector", titulo: "2 · Escolha o mês", texto: "Escolha o ano e o mês que vai trabalhar. Os meses mostram se já foram iniciados e por quem." },
    { sel: "#pos", titulo: "3 · Onde está", texto: "Este número mostra a linha em que está, e quantas linhas tem o mês." },
    { sel: "#btn-next", titulo: "4 · Próxima linha", texto: "Esta seta passa para a linha seguinte. A seta anterior volta atrás. Pode usar também as setas do teclado." },
    { sel: "#well", titulo: "5 · A página do mapa", texto: "Aqui aparece a página original do mapa. A faixa clara é a linha que está a rever. O mapa acompanha a linha automaticamente." },
    { sel: "#f-nome", titulo: "6 · Nome", texto: "Confirme o nome. Deve coincidir com o nome da relação de NISS. Se houver dúvida, o sistema sugere opções." },
    { sel: "#f-niss", titulo: "7 · NISS", texto: "Escreva o NISS com 8 números. Se a pessoa ainda não tiver NISS, deixe em branco: ela vai para a lista 'por resolver'." },
    { sel: "#f-sal", titulo: "8 · Valores", texto: "Confirme o salário, a remuneração e a Segurança Social com o mapa. Se algum estiver errado, corrija aqui." },
    { sel: "#btn-pend", titulo: "9 · Por resolver", texto: "Esta é a lista de quem ainda não tem NISS. Descarregue-a, preencha a coluna 'niss' no computador e guarde." },
    { sel: "label:has(#nissimp-file)", titulo: "10 · Importar NISS", texto: "Depois de preencher a lista, importe o mesmo ficheiro aqui. Os NISS entram logo no sistema." },
    { sel: "#btn-excl", titulo: "11 · Excluídos do mês", texto: "São pessoas cujo vínculo não cobre este mês. Descarregue a lista para o contabilista confirmar as datas." },
    { sel: "#btn-ja", titulo: "12 · Já inscritos", texto: "Marque a pessoa atual quando já estiver inscrita. Ela sai da lista de pendentes." },
    { sel: "#btn-ferramentas", titulo: "13 · Ferramentas", texto: "Aqui estão a base de NISS, guardar o rascunho em ficheiro e o estado da equipa. Abra quando precisar." },
    { sel: "#btn-txt", titulo: "14 · Exportar o TXT", texto: "Quando não houver nada por resolver, exporte o TXT final. Só fica disponível com todos os trabalhadores resolvidos." },
  ];

  let indice = 0, ativo = false;
  let spot = null, tip = null;

  const criar = () => {
    if (spot) return;
    spot = document.createElement("div");
    spot.className = "tour-spot";
    tip = document.createElement("div");
    tip.className = "tour-tip";
    tip.setAttribute("role", "dialog");
    tip.innerHTML = `
      <div class="tour-passo"></div>
      <h3 class="tour-titulo"></h3>
      <p class="tour-texto"></p>
      <div class="tour-acoes">
        <button type="button" class="tour-sair">Fechar</button>
        <span class="tour-espaco"></span>
        <button type="button" class="tour-ant">Anterior</button>
        <button type="button" class="tour-seg primary">Seguinte</button>
      </div>`;
    document.body.appendChild(spot);
    document.body.appendChild(tip);
    tip.querySelector(".tour-sair").addEventListener("click", parar);
    tip.querySelector(".tour-ant").addEventListener("click", () => ir(indice - 1));
    tip.querySelector(".tour-seg").addEventListener("click", () => (indice >= PASSOS.length - 1 ? parar(true) : ir(indice + 1)));
    window.addEventListener("resize", mostrar);
    window.addEventListener("scroll", mostrar, true);
    document.addEventListener("keydown", (e) => {
      if (!ativo) return;
      if (e.key === "Escape") parar();
      if (e.key === "ArrowRight") ir(indice + 1);
      if (e.key === "ArrowLeft") ir(indice - 1);
    });
  };

  const ir = (n) => {
    if (n < 0) n = 0;
    if (n >= PASSOS.length) return parar(true);
    indice = n;
    mostrar();
  };

  const mostrar = () => {
    if (!ativo) return;
    const passo = PASSOS[indice];
    const alvo = document.querySelector(passo.sel);
    if (!alvo || alvo.offsetParent === null && getComputedStyle(alvo).position !== "fixed") {
      // elemento não visível: salta para o seguinte
      if (indice < PASSOS.length - 1) { indice++; return mostrar(); }
      return parar(true);
    }
    alvo.scrollIntoView({ block: "center", inline: "nearest" });
    const r = alvo.getBoundingClientRect();
    const m = 6;
    Object.assign(spot.style, { left: r.left - m + "px", top: r.top - m + "px", width: r.width + 2 * m + "px", height: r.height + 2 * m + "px" });
    tip.querySelector(".tour-passo").textContent = `Passo ${indice + 1} de ${PASSOS.length}`;
    tip.querySelector(".tour-titulo").textContent = passo.titulo;
    tip.querySelector(".tour-texto").textContent = passo.texto;
    tip.querySelector(".tour-ant").disabled = indice === 0;
    tip.querySelector(".tour-seg").textContent = indice === PASSOS.length - 1 ? "Concluir" : "Seguinte";
    // posiciona a caixa abaixo ou acima do alvo, sempre dentro do ecrã
    const largura = Math.min(360, window.innerWidth - 24);
    tip.style.width = largura + "px";
    const altura = tip.offsetHeight || 180;
    let top = r.bottom + 14;
    if (top + altura > window.innerHeight - 12) top = Math.max(12, r.top - altura - 14);
    let left = Math.min(Math.max(12, r.left), window.innerWidth - largura - 12);
    Object.assign(tip.style, { top: top + "px", left: left + "px" });
    tip.querySelector(".tour-seg").focus({ preventScroll: true });
  };

  const comecar = () => {
    criar();
    ativo = true;
    indice = 0;
    spot.style.display = tip.style.display = "";
    mostrar();
  };

  const parar = (concluido) => {
    ativo = false;
    if (spot) spot.style.display = "none";
    if (tip) tip.style.display = "none";
    try { localStorage.setItem(CHAVE_VISTO, "1"); } catch (e) { /* sem armazenamento */ }
    void concluido;
  };

  const primeiraVisita = () => { try { return !localStorage.getItem(CHAVE_VISTO); } catch (e) { return false; } };

  window.TOUR = {
    start: comecar,
    stop: parar,
    primeiraVisita,
    passos: PASSOS.length,
  };
})();
