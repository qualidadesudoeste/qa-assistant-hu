// Cliente Supabase + operações de plano/execução.
// Todas as funções ficam em window.SupaAPI.

(function () {
  const cfg = window.APP_CONFIG || {};
  const ok = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase;
  const client = ok
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  function huHash(hu) {
    // Hash estável leve (djb2) — não precisa ser criptográfico.
    let h = 5381;
    const s = (hu || "").trim();
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return "h" + (h >>> 0).toString(16);
  }

  async function upsertPlano({ projeto, sprint, tela, hu, tipoSistema, criticidade, resultado }) {
    if (!client) throw new Error("Supabase não configurado (config.js).");
    const hash = huHash(hu);
    const { data, error } = await client
      .from("test_plans")
      .upsert(
        {
          projeto,
          sprint,
          tela,
          hu,
          hu_hash: hash,
          tipo_sistema: tipoSistema,
          criticidade,
          resultado_json: resultado
        },
        { onConflict: "projeto,sprint,hu_hash" }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function listarPlanos({ projeto, sprint } = {}) {
    if (!client) return [];
    let q = client
      .from("test_plans")
      .select("id, projeto, sprint, tela, tipo_sistema, criticidade, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (projeto) q = q.eq("projeto", projeto);
    if (sprint) q = q.eq("sprint", sprint);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function carregarPlano(planId) {
    if (!client) throw new Error("Supabase não configurado.");
    const { data: plano, error } = await client
      .from("test_plans")
      .select("*")
      .eq("id", planId)
      .single();
    if (error) throw error;

    const { data: execs, error: e2 } = await client
      .from("test_case_executions")
      .select("*")
      .eq("plan_id", planId);
    if (e2) throw e2;

    return { plano, execucoes: execs || [] };
  }

  async function salvarExecucao({ planId, caseId, status, titulo, tipo, origem }) {
    if (!client) return null;
    const { data, error } = await client
      .from("test_case_executions")
      .upsert(
        { plan_id: planId, case_id: caseId, status, titulo, tipo, origem },
        { onConflict: "plan_id,case_id" }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function registrarFalha({ planId, caseId, observacao }) {
    if (!client) return null;
    // Incrementa fail_count e adiciona registro no histórico.
    const { data: atual } = await client
      .from("test_case_executions")
      .select("fail_count")
      .eq("plan_id", planId)
      .eq("case_id", caseId)
      .maybeSingle();

    const novoCount = (atual?.fail_count || 0) + 1;

    const { error: e1 } = await client
      .from("test_case_executions")
      .update({ status: "falhou", fail_count: novoCount })
      .eq("plan_id", planId)
      .eq("case_id", caseId);
    if (e1) throw e1;

    const { error: e2 } = await client
      .from("test_case_fail_history")
      .insert({ plan_id: planId, case_id: caseId, observacao: observacao || null });
    if (e2) throw e2;

    return { fail_count: novoCount };
  }

  async function historicoFalhas({ planId, caseId }) {
    if (!client) return [];
    const { data, error } = await client
      .from("test_case_fail_history")
      .select("observacao, created_at")
      .eq("plan_id", planId)
      .eq("case_id", caseId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  window.SupaAPI = {
    isReady: () => !!client,
    huHash,
    upsertPlano,
    listarPlanos,
    carregarPlano,
    salvarExecucao,
    registrarFalha,
    historicoFalhas
  };
})();
