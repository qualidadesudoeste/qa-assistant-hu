# 🚀 Guia de Deploy no Vercel

Este guia cobre o deploy do **QA Assistant** no Vercel em poucos minutos.

---

## 📋 Pré-requisitos

- Conta no [Vercel](https://vercel.com) (gratuita é suficiente)
- Conta no [GitHub](https://github.com) (recomendado) OU [Vercel CLI](https://vercel.com/docs/cli)
- Uma API key do provedor de IA:
  - **Anthropic Claude:** obtenha em https://console.anthropic.com/settings/keys
  - **OpenAI:** obtenha em https://platform.openai.com/api-keys

---

## 🎯 Método 1 — Deploy via GitHub (recomendado)

### Passo 1: Criar repositório no GitHub

```bash
cd C:\projetos\gerador-testes-hu
git init
git add .
git commit -m "feat: QA Assistant v2.0 com integração IA"
```

1. Crie um novo repositório em https://github.com/new (ex: `qa-assistant-hu`).
2. Conecte e envie:

```bash
git remote add origin https://github.com/qualidadesudoeste/qa-assistant-hu.git
git branch -M main
git push -u origin main
```

### Passo 2: Importar no Vercel

1. Acesse https://vercel.com/new
2. Clique em **Import Git Repository**
3. Selecione o repositório `qa-assistant-hu`
4. Clique em **Import**

### Passo 3: Configurar o projeto

Na tela de configuração:
- **Framework Preset:** `Other` (é um projeto estático + serverless)
- **Build Command:** deixe vazio
- **Output Directory:** deixe vazio
- **Install Command:** deixe vazio

### Passo 4: (Opcional) Variáveis de ambiente

Se quiser que o app funcione SEM precisar que o usuário cole a chave na UI, configure:

1. Em **Environment Variables**, adicione:
   - `ANTHROPIC_API_KEY` = `sk-ant-sua-chave-aqui`
   - OU `OPENAI_API_KEY` = `sk-sua-chave-aqui`

2. Defina em quais ambientes (`Production`, `Preview`, `Development`)

### Passo 5: Deploy

Clique em **Deploy**. Em 1-2 minutos seu app estará no ar em:
```
https://qa-assistant-hu.vercel.app
```

---

## 🎯 Método 2 — Deploy via Vercel CLI

### Passo 1: Instalar CLI

```bash
npm install -g vercel
```

### Passo 2: Login

```bash
vercel login
```

### Passo 3: Deploy

Na pasta do projeto:

```bash
cd C:\projetos\gerador-testes-hu
vercel
```

Responda as perguntas:
- **Set up and deploy?** `Y`
- **Which scope?** (selecione sua conta)
- **Link to existing project?** `N`
- **Project name?** `qa-assistant-hu`
- **In which directory is your code located?** `./`

### Passo 4: Deploy de produção

```bash
vercel --prod
```

### Passo 5: (Opcional) Configurar env vars

```bash
vercel env add ANTHROPIC_API_KEY
# cole a chave quando solicitado
# selecione Production / Preview / Development
```

Re-deploy:
```bash
vercel --prod
```

---

## 🧪 Testando localmente antes do deploy

A serverless function `/api/ai-analyze` **NÃO funciona** abrindo o `index.html` direto no navegador (CORS + sem runtime Node). Para testar localmente:

```bash
npm install -g vercel
vercel dev
```

Isso roda o app em `http://localhost:3000` com as funções serverless ativas.

Alternativamente, você pode usar o app **sem IA** abrindo direto o `index.html` — apenas a análise baseada em regras funcionará.

---

## 🔐 Segurança da API Key

Você tem **duas opções**:

### Opção A: Chave fornecida pelo usuário (default)
- Cada usuário cola sua própria chave na UI
- A chave é armazenada no `localStorage` do navegador do usuário
- A chave é enviada ao endpoint `/api/ai-analyze` a cada requisição
- **Ideal para:** app público compartilhado, onde cada pessoa usa sua própria chave

### Opção B: Chave no servidor (env var)
- Você configura `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` nas env vars do Vercel
- Usuários não precisam ter chave própria — usam a sua
- **Atenção:** você paga pelo uso de TODOS os visitantes
- **Ideal para:** app interno da empresa, demo pessoal, ambiente controlado

Você pode combinar as duas: se o usuário informa chave, ela é usada; senão, cai no fallback do servidor.

---

## 🌐 Domínio customizado (opcional)

1. No dashboard do Vercel, entre no projeto
2. Vá em **Settings → Domains**
3. Adicione seu domínio (ex: `qa.seudominio.com`)
4. Configure os registros DNS conforme instrução exibida

---

## 🔧 Troubleshooting

### "API key não fornecida" no app publicado
- Verifique se configurou a env var no Vercel **E** fez um novo deploy após configurá-la
- OU forneça a chave pelo próprio app (ícone ⚙️)

### CORS error
- Geralmente só ocorre em ambiente local. No Vercel com a config `vercel.json` incluída, não deve acontecer

### Timeout (504)
- A função serverless tem timeout de 30s (configurado em `vercel.json`)
- Modelos mais lentos (Opus) podem estourar — prefira Sonnet ou Haiku

### "Function runtime error"
- Verifique os logs em Vercel → seu projeto → Functions → ai-analyze
- Geralmente é chave inválida ou formato errado

---

## 📊 Limites do plano gratuito Vercel (Hobby)

- **Bandwidth:** 100 GB/mês
- **Serverless invocations:** 100k/mês
- **Function duration:** 10s (Hobby) — temos 30s setado, mas só funciona no plano Pro
  - Se ficar no Hobby, ajuste `maxDuration` em `vercel.json` para `10`

---

## ✅ Checklist final

- [ ] Código no GitHub
- [ ] Projeto importado no Vercel
- [ ] Deploy concluído sem erro
- [ ] URL de produção acessível
- [ ] (Opcional) Env vars configuradas
- [ ] (Opcional) Domínio customizado
- [ ] Testou a análise com IA na UI

**Pronto!** Seu QA Assistant está no ar 🎉
