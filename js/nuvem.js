/* Persistência partilhada (Supabase) com perfis de utilizador.
 * Sem login com palavra-passe: a app entra em modo anónimo (sessão silenciosa) e o
 * perfil escolhido no ecrã inicial (Credo, Djamila, Mauricio) identifica quem grava.
 * Sem Supabase (offline / CDN bloqueado) a app continua a funcionar só com rascunho local. */
(function () {
  const URL = "https://cbbnrjsszgkmqvijfdxq.supabase.co";
  const KEY = "sb_publishable_MaZudV1Iedk4S6_qpRIHrg_tAJy2EoZ";
  const CHAVE_PERFIL = "inss-perfil";
  const PERFIS = ["Credo", "Djamila", "Mauricio"];
  let sb = null;
  let perfil = null;
  let timer = 0;
  let pendente = null;

  const cliente = () => {
    if (!sb && window.supabase) sb = window.supabase.createClient(URL, KEY);
    return sb;
  };

  const init = async () => {
    perfil = localStorage.getItem(CHAVE_PERFIL) || null;
    const c = cliente();
    if (!c) return perfil;
    const { data } = await c.auth.getSession();
    if (!data || !data.session) {
      const r = await c.auth.signInAnonymously();
      if (r.error) console.warn("nuvem: sessão anónima:", r.error.message);
    }
    return perfil;
  };

  const definirPerfil = (nome) => {
    if (!PERFIS.includes(nome)) throw new Error("Perfil desconhecido: " + nome);
    perfil = nome;
    localStorage.setItem(CHAVE_PERFIL, nome);
    return perfil;
  };

  const utilizador = () => (perfil ? { nome: perfil } : null);

  const carregarRascunho = async (mesId) => {
    const c = cliente();
    if (!c || !perfil) return null;
    const { data, error } = await c.from("rascunhos").select("dados, atualizado_em, atualizado_por").eq("mes_id", mesId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { ...data.dados, atualizado_em: data.atualizado_em, atualizado_por: data.atualizado_por } : null;
  };

  const gravar = (mesId, dados, resumo) => {
    if (!cliente() || !perfil) return;
    pendente = { mesId, dados, resumo };
    clearTimeout(timer);
    timer = setTimeout(executarGravacao, 1500);
  };

  const executarGravacao = async () => {
    const p = pendente; pendente = null;
    if (!p || !perfil) return;
    const c = cliente();
    const agora = new Date().toISOString();
    const [ano, mes] = p.mesId.split("-").map(Number);
    const estado = p.resumo.pendentes === 0 && p.resumo.alteracoes === 0 ? "pronto" : "em_edicao";
    const m = await c.from("meses").upsert({
      id: p.mesId, ano, mes, estado,
      pendentes: p.resumo.pendentes, alteracoes: p.resumo.alteracoes,
      em_edicao_por: perfil, em_edicao_desde: agora,
      atualizado_em: agora, atualizado_por: perfil,
    });
    if (m.error) { console.warn("nuvem meses:", m.error.message); return; }
    const r = await c.from("rascunhos").upsert({ mes_id: p.mesId, dados: p.dados, atualizado_em: agora, atualizado_por: perfil });
    if (r.error) console.warn("nuvem rascunho:", r.error.message);
    await c.from("historico").insert({ mes_id: p.mesId, utilizador: perfil, acao: "gravou rascunho", detalhe: `${p.resumo.pendentes} por resolver · ${p.resumo.alteracoes} alterações` });
  };

  const listarMeses = async () => {
    const c = cliente();
    if (!c || !perfil) return [];
    const { data, error } = await c.from("meses").select("*").order("id");
    if (error) throw new Error(error.message);
    return data || [];
  };

  window.NUVEM = { init, definirPerfil, utilizador, perfis: () => PERFIS.slice(), carregarRascunho, gravar, listarMeses };
})();
