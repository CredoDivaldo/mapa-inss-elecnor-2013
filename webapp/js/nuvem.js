/* Persistência partilhada (Supabase). Só funciona com sessão iniciada.
 * Sem sessão, a app continua a funcionar só com rascunho local (localStorage). */
(function () {
  const URL = "https://cbbnrjsszgkmqvijfdxq.supabase.co";
  const KEY = "sb_publishable_MaZudV1Iedk4S6_qpRIHrg_tAJy2EoZ";
  let sb = null;
  let utilizador = null;     // { email, nome }
  let timer = 0;
  let pendente = null;      // última gravação à espera do atraso

  const nomeDe = (u) => (u && u.email ? u.email.split("@")[0] : "desconhecido");

  const cliente = () => {
    if (!sb && window.supabase) sb = window.supabase.createClient(URL, KEY);
    return sb;
  };

  const init = async () => {
    const c = cliente();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    if (data && data.session) {
      utilizador = { email: data.session.user.email, nome: nomeDe(data.session.user) };
    }
    return utilizador;
  };

  const entrar = async (email, password) => {
    const c = cliente();
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "Email ou palavra-passe incorrectos" : error.message);
    utilizador = { email: data.user.email, nome: nomeDe(data.user) };
    return utilizador;
  };

  const sair = async () => {
    const c = cliente();
    if (c) await c.auth.signOut();
    utilizador = null;
  };

  const carregarRascunho = async (mesId) => {
    const c = cliente();
    if (!c || !utilizador) return null;
    const { data, error } = await c.from("rascunhos").select("dados, atualizado_em, atualizado_por").eq("mes_id", mesId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { ...data.dados, atualizado_em: data.atualizado_em, atualizado_por: data.atualizado_por } : null;
  };

  // grava (com atraso): rascunho completo + resumo do mês
  const gravar = (mesId, dados, resumo) => {
    if (!cliente() || !utilizador) return;
    pendente = { mesId, dados, resumo };
    clearTimeout(timer);
    timer = setTimeout(executarGravacao, 1500);
  };

  const executarGravacao = async () => {
    const p = pendente; pendente = null;
    if (!p || !utilizador) return;
    const c = cliente();
    const agora = new Date().toISOString();
    const [ano, mes] = p.mesId.split("-").map(Number);
    const estado = p.resumo.pendentes === 0 && p.resumo.alteracoes === 0 ? "pronto" : "em_edicao";
    const m = await c.from("meses").upsert({
      id: p.mesId, ano, mes, estado,
      pendentes: p.resumo.pendentes, alteracoes: p.resumo.alteracoes,
      em_edicao_por: utilizador.nome, em_edicao_desde: agora,
      atualizado_em: agora, atualizado_por: utilizador.nome,
    });
    if (m.error) { console.warn("nuvem meses:", m.error.message); return; }
    const r = await c.from("rascunhos").upsert({
      mes_id: p.mesId, dados: p.dados, atualizado_em: agora, atualizado_por: utilizador.nome,
    });
    if (r.error) console.warn("nuvem rascunho:", r.error.message);
    await c.from("historico").insert({ mes_id: p.mesId, utilizador: utilizador.nome, acao: "gravou rascunho", detalhe: `${p.resumo.pendentes} por resolver · ${p.resumo.alteracoes} alterações` });
  };

  const listarMeses = async () => {
    const c = cliente();
    if (!c || !utilizador) return [];
    const { data, error } = await c.from("meses").select("*").order("id");
    if (error) throw new Error(error.message);
    return data || [];
  };

  window.NUVEM = { init, entrar, sair, carregarRascunho, gravar, listarMeses, utilizador: () => utilizador };
})();
