# BTS Ticket Monitor — V5.1

Correção do Chromium/Playwright no Render gratuito.

## Alteração principal

O Render agora executa durante o build:

```bash
npm install && npx playwright install --with-deps chromium
```

Isso baixa o Chromium e instala as dependências necessárias antes de iniciar o bot.

## Depois de atualizar o GitHub

1. Entre no Render.
2. Abra **Deploys**.
3. Clique em **Manual Deploy**.
4. Escolha **Clear build cache & deploy**.
5. Aguarde o serviço ficar **Live**.
6. Abra `/api/health`.

O esperado é:

```json
{
  "ok": true,
  "monitorRunning": true,
  "realtimeConfigured": true
}
```

O plano continua `free`, sem Persistent Disk.
