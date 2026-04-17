// Serverless Function (Vercel) - Proxy para análise com IA
// Suporta Anthropic Claude, OpenAI GPT e Google Gemini

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

// --- FUNÇÕES DE CHAMADA (PROVEDORES) ---

async function callAnthropic({ apiKey, model, userPrompt }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: model || "claude-3-5-sonnet-20240620",
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM_PROMPT }],
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  if (!response.ok) throw new Error(`Anthropic error: ${await response.text()}`);
  const data = await response.json();
  return { texto: data.content?.[0]?.text || "", usage: data.usage };
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
  if (!response.ok) throw new Error(`OpenAI error: ${await response.text()}`);
  const data = await response.json();
  return { texto: data.choices?.[0]?.message?.content || "", usage: data.usage };
}

// --- NOVO PROVEDOR: GEMINI ---
async function callGemini({ apiKey, model, userPrompt }) {
  const modelName = model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  return {
    texto,
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount,
      completion_tokens: data.usageMetadata?.candidatesTokenCount
    }
  };
}

// --- UTILITÁRIOS ---

function extractJSON(texto) {
  const trimmed = texto.trim();
  try { return JSON.parse(trimmed); } catch (_) {}
  const match = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (match) try { return JSON.parse(match[1]); } catch (_) {}
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.substring(firstBrace, lastBrace + 1);
    try { return JSON.parse(candidate); } catch (_) {}
  }
  throw new Error("Resposta da IA não é JSON válido.");
}

// --- HANDLER PRINCIPAL ---

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Configuração de GET para informar provedores disponíveis
  if (req.method === "GET") {
    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasGemini = !!process.env.GEMINI_API_KEY;
    let defaultProvider = null;
    if (hasGemini) defaultProvider = "gemini";
    else if (hasAnthropic) defaultProvider = "anthropic";
    else if (hasOpenAI) defaultProvider = "openai";
    return res.status(200).json({
      serverConfigured: hasAnthropic || hasOpenAI || hasGemini,
      providers: {
        anthropic: hasAnthropic,
        openai: hasOpenAI,
        gemini: hasGemini
      },
      defaultProvider
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { hu, tela, tipoSistema, criticidade, casosExistentes, apiKey, provider, model, testOnly } = body || {};

    const chosenProvider = provider || "anthropic";
    
    // Mapeamento de chaves de ambiente
    const envKeys = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      gemini: process.env.GEMINI_API_KEY
    };

    const chosenKey = apiKey || envKeys[chosenProvider];

    if (!chosenKey) {
      return res.status(400).json({ error: `API key para ${chosenProvider} não configurada.` });
    }

    // Modo de teste de conexão
    if (testOnly) {
      const testPrompt = "Responda apenas JSON: {\"ok\": true}";
      const callMap = { anthropic: callAnthropic, openai: callOpenAI, gemini: callGemini };
      await callMap[chosenProvider]({ apiKey: chosenKey, model, userPrompt: testPrompt });
      return res.status(200).json({ ok: true, provider: chosenProvider });
    }

    if (!hu || hu.trim().length < 20) return res.status(400).json({ error: "HU muito curta." });

    const userPrompt = buildUserPrompt({ hu, tela, tipoSistema, criticidade, casosExistentes });

    // Execução da chamada baseada no provedor
    let result;
    if (chosenProvider === "openai") {
      result = await callOpenAI({ apiKey: chosenKey, model, userPrompt });
    } else if (chosenProvider === "gemini") {
      result = await callGemini({ apiKey: chosenKey, model, userPrompt });
    } else {
      result = await callAnthropic({ apiKey: chosenKey, model, userPrompt });
    }

    return res.status(200).json({
      ok: true,
      provider: chosenProvider,
      model,
      usage: result.usage,
      analise: extractJSON(result.texto)
    });

  } catch (err) {
    console.error("[ai-analyze] erro:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}