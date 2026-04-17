// Serverless Function (Vercel) - Proxy para análise com IA
// Suporta Anthropic Claude e OpenAI GPT
// A chave pode vir do body da requisição (fornecida pelo usuário na UI)
// OU da variável de ambiente ANTHROPIC_API_KEY / OPENAI_API_KEY configurada no Vercel.

const SYSTEM_PROMPT = `Você é um QA Sênior especialista em testes manuais de software, com décadas de experiência em sistemas críticos.

Sua tarefa é analisar uma História de Usuário (HU) e, considerando casos de teste já gerados por um motor de regras baseado em palavras-chave, produzir uma análise aprofundada que CAPTURE o que o motor de regras não consegue ver.

Foque em:
1. Ambiguidades, gaps e informações faltantes na HU.
2. Casos de teste ADICIONAIS específicos do domínio/contexto da HU.
3. Riscos sutis (negócio, segurança, UX, performance, integrações).
4. Combinações improváveis que nenhum roteiro prevê.
5. Questões de usabilidade específicas do fluxo.

IMPORTANTE: Retorne APENAS JSON válido, sem markdown, sem comentários, sem texto fora do JSON.

Estrutura obrigatória:
{
  "analiseHU": {
    "qualidade": "alta|media|baixa",
    "pontosFortes": ["..."],
    "ambiguidades": ["..."],
    "gapsIdentificados": ["perguntas que o PO deveria responder antes do desenvolvimento"]
  },
  "casosAdicionais": [
    {
      "id": "IA-001",
      "titulo": "título descritivo curto",
      "tipo": "Funcional|Negativo|Borda|Segurança|Acessibilidade|Performance|Integração|UX|Domínio",
      "prioridade": "alta|media|baixa",
      "preCondicoes": ["..."],
      "passos": ["..."],
      "resultadoEsperado": "...",
      "dadosTeste": "...",
      "justificativa": "por que este caso é importante e o que o motor de regras não capturou"
    }
  ],
  "riscosDominio": [
    {
      "nivel": "alto|medio|baixo",
      "descricao": "risco específico deste domínio/fluxo"
    }
  ],
  "recomendacoes": ["recomendações táticas para o QA antes/durante a execução"]
}

Gere entre 5 e 10 casos adicionais de alta qualidade. Priorize casos que realmente agreguem valor e não dupliquem o que o motor de regras já cobre.`;

function buildUserPrompt({ hu, tela, tipoSistema, criticidade, casosExistentes }) {
  return `## Contexto do Sistema
- **Tela/Funcionalidade:** ${tela || "(não informada)"}
- **Tipo de Sistema:** ${tipoSistema}
- **Criticidade:** ${criticidade}

## História de Usuário
${hu}

## Casos já gerados pelo motor de regras (${casosExistentes?.length || 0} casos)
${(casosExistentes || []).map(c => `- [${c.id}] ${c.titulo} (${c.tipo}, ${c.prioridade})`).join("\n") || "Nenhum"}

## Sua análise
Agora produza a análise aprofundada em JSON conforme estrutura obrigatória.`;
}

async function callAnthropic({ apiKey, model, userPrompt }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: [
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const texto = data.content?.[0]?.text || "";
  return { texto, usage: data.usage };
}

async function callOpenAI({ apiKey, model, userPrompt }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.4
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const texto = data.choices?.[0]?.message?.content || "";
  return { texto, usage: data.usage };
}

function extractJSON(texto) {
  const trimmed = texto.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const match = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1]); } catch (_) {}
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.substring(firstBrace, lastBrace + 1);
    try { return JSON.parse(candidate); } catch (_) {}
  }

  throw new Error("Resposta da IA não é JSON válido: " + trimmed.substring(0, 200));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { hu, tela, tipoSistema, criticidade, casosExistentes, apiKey, provider, model, testOnly } = body || {};

    const chosenProvider = provider || "anthropic";
    const chosenKey =
      apiKey ||
      (chosenProvider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);

    if (!chosenKey) {
      return res.status(400).json({
        error: "API key não fornecida. Informe a chave na UI ou configure a variável de ambiente no Vercel."
      });
    }

    if (testOnly) {
      const testPrompt = "Responda apenas com o JSON: {\"ok\": true}";
      try {
        const result = chosenProvider === "openai"
          ? await callOpenAI({ apiKey: chosenKey, model, userPrompt: testPrompt })
          : await callAnthropic({ apiKey: chosenKey, model, userPrompt: testPrompt });
        return res.status(200).json({ ok: true, provider: chosenProvider, model });
      } catch (err) {
        return res.status(400).json({ ok: false, error: err.message });
      }
    }

    if (!hu || hu.trim().length < 20) {
      return res.status(400).json({ error: "HU muito curta (mínimo 20 caracteres)." });
    }

    const userPrompt = buildUserPrompt({ hu, tela, tipoSistema, criticidade, casosExistentes });

    const { texto, usage } = chosenProvider === "openai"
      ? await callOpenAI({ apiKey: chosenKey, model, userPrompt })
      : await callAnthropic({ apiKey: chosenKey, model, userPrompt });

    const analise = extractJSON(texto);

    return res.status(200).json({
      ok: true,
      provider: chosenProvider,
      model,
      usage,
      analise
    });
  } catch (err) {
    console.error("[ai-analyze] erro:", err);
    return res.status(500).json({ ok: false, error: err.message || "Erro interno" });
  }
}
