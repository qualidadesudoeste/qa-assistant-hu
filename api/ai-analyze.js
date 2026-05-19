// Serverless Function (Vercel) - Proxy para análise com IA
// Suporta Anthropic Claude, OpenAI GPT e Google Gemini

const SYSTEM_PROMPT = `Você é um especialista em Heurísticas de Testes de Software, com domínio profundo de testes manuais em sistemas críticos.

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

// --- RETRY COM BACKOFF EXPONENCIAL ---
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = 4;

async function fetchWithRetry(url, options, providerName) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;

      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_RETRIES - 1) {
        const body = await response.text();
        const err = new Error(`${providerName} error ${response.status}: ${body}`);
        err.status = response.status;
        throw err;
      }
      lastError = new Error(`${providerName} ${response.status}`);
      lastError.status = response.status;
    } catch (err) {
      if (err.status && !RETRYABLE_STATUS.has(err.status)) throw err;
      lastError = err;
      if (attempt === MAX_RETRIES - 1) throw err;
    }
    const delay = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
    await new Promise(r => setTimeout(r, delay));
  }
  throw lastError;
}

// --- FUNÇÕES DE CHAMADA (PROVEDORES) ---

async function callAnthropic({ apiKey, model, userPrompt }) {
  const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
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
  }, "Anthropic");
  const data = await response.json();
  return { texto: data.content?.[0]?.text || "", usage: data.usage };
}

async function callOpenAI({ apiKey, model, userPrompt }) {
  const response = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
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
  }, "OpenAI");
  const data = await response.json();
  return { texto: data.choices?.[0]?.message?.content || "", usage: data.usage };
}

// --- NOVO PROVEDOR: GEMINI ---
async function callGeminiOnce(apiKey, modelName, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const generationConfig = {
    temperature: 0.4,
    responseMimeType: "application/json",
    maxOutputTokens: 16384
  };

  // Modelos 2.5 têm "thinking" ativado por padrão e consomem maxOutputTokens.
  // Desabilita para que todo o orçamento seja usado na resposta JSON.
  if (modelName.startsWith("gemini-2.5")) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const response = await fetchWithRetry(url, {
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
      generationConfig
    })
  }, "Gemini");

  const data = await response.json();
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const finishReason = data.candidates?.[0]?.finishReason;
  const blockReason = data.promptFeedback?.blockReason;

  if (!texto) {
    throw new Error(
      `Gemini retornou resposta vazia (finishReason: ${finishReason || "n/a"}${blockReason ? ", blockReason: " + blockReason : ""}). ` +
      `Tente reduzir o tamanho da HU ou trocar o modelo.`
    );
  }

  if (finishReason === "MAX_TOKENS") {
    throw new Error(
      `Gemini truncou a resposta (atingiu maxOutputTokens). ` +
      `Use um modelo com mais capacidade (ex: gemini-2.5-pro) ou reduza a quantidade de casos existentes enviados.`
    );
  }

  return {
    texto,
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount,
      completion_tokens: data.usageMetadata?.candidatesTokenCount
    },
    modelUsed: modelName
  };
}

async function callGemini({ apiKey, model, userPrompt }) {
  if (!apiKey.startsWith("AIza")) {
    const err = new Error(
      "API key do Gemini inválida: deve começar com \"AIza\". " +
      "Gere uma key em https://aistudio.google.com/apikey (não use access token OAuth)."
    );
    err.status = 400;
    throw err;
  }

  const requestedModel = model || "gemini-2.5-flash";

  // Cadeia de fallback: modelo escolhido → 2.5-flash → 2.0-flash.
  // Em caso de 503 (sobrecarga) ou 429 (quota), tenta o próximo automaticamente.
  // Evita modelos 1.5 que estão sendo deprecados para keys novas.
  const fallbackChain = [requestedModel];
  for (const alt of ["gemini-2.5-flash", "gemini-2.0-flash"]) {
    if (!fallbackChain.includes(alt)) fallbackChain.push(alt);
  }

  let lastError;
  for (let i = 0; i < fallbackChain.length; i++) {
    const modelName = fallbackChain[i];
    try {
      return await callGeminiOnce(apiKey, modelName, userPrompt);
    } catch (err) {
      lastError = err;
      const isOverloaded = err.status === 503 || err.status === 429;
      const isLast = i === fallbackChain.length - 1;
      if (!isOverloaded || isLast) {
        if (isOverloaded && isLast) {
          throw new Error(
            `Todos os modelos Gemini estão sobrecarregados no momento (${fallbackChain.join(", ")}). ` +
            `Tente novamente em alguns minutos ou troque para Anthropic/OpenAI nas Configurações.`
          );
        }
        throw err;
      }
      console.warn(`[gemini] ${modelName} indisponível (${err.status}), tentando ${fallbackChain[i + 1]}...`);
    }
  }
  throw lastError;
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
  const preview = trimmed.length > 200
    ? trimmed.slice(0, 100) + " […] " + trimmed.slice(-100)
    : trimmed;
  throw new Error(`Resposta da IA não é JSON válido. Início/fim do texto: ${preview}`);
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
    // Ordem de prioridade quando múltiplas keys estão configuradas no servidor.
    // OpenAI/Anthropic vêm antes do Gemini porque, quando o operador escolhe pagar
    // por uma dessas, é sinal de que prefere o serviço pago como padrão.
    let defaultProvider = null;
    if (hasOpenAI) defaultProvider = "openai";
    else if (hasAnthropic) defaultProvider = "anthropic";
    else if (hasGemini) defaultProvider = "gemini";
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

    const chosenProvider = provider || "gemini";
    
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
      model: result.modelUsed || model,
      usage: result.usage,
      analise: extractJSON(result.texto)
    });

  } catch (err) {
    console.error("[ai-analyze] erro:", err);
    const status = (err.status && err.status >= 400 && err.status < 600) ? err.status : 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
}