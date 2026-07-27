# BTS Ticket Monitor — Alto Tráfego V4

Versão preparada para publicação com domínio próprio e muitos acessos.

## O que mudou

- Uma única rodada do servidor consulta a Ticketmaster; visitantes nunca executam Playwright.
- Os shows são verificados em paralelo com `Promise.allSettled`.
- `/api/status` apenas entrega o último resultado salvo em memória.
- Polling público configurável, padrão de 15 segundos.
- Cache público curto de 5 segundos.
- Limite de chamadas por IP contra abuso.
- Últimos status persistidos em `data/state.json`.
- Histórico de verificações e mudanças.
- Estatísticas de ciclos, falhas, mudanças e alertas.
- Painel com visão operacional em tempo real.
- Verificação manual bloqueada quando outra já está rodando.
- Upload de imagens otimizado: o painel salva arquivos e guarda apenas URLs.
- Contador reinicia e sincroniza automaticamente.
- CORS preparado para domínio próprio via `FRONTEND_ORIGIN`.
- Rotas administrativas permanecem sem cache.

## Estrutura

- `server.js`: API, painel, cache, limites, persistência e arquivos.
- `monitor.js`: Playwright e detecção.
- `config/monitor.json`: parâmetros técnicos.
- `data/config.json`: conteúdo editável.
- `data/state.json`: estado, histórico e estatísticas.
- `data/uploads/`: imagens enviadas pelo painel.
- `public/`: site e painel.

## Render

Configure:

- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `NODE_ENV=production`
- `FRONTEND_ORIGIN=https://SEU-DOMINIO.com.br`

Para manter `state.json` e uploads após novos deploys ou reinícios, use um Persistent Disk no Render apontando para a pasta indicada por `DATA_DIR`.

Exemplo:

- Mount path: `/var/data`
- `DATA_DIR=/var/data`

Na primeira inicialização, copie ou crie `config.json` e `state.json` nesse diretório. O servidor cria a pasta de uploads automaticamente.

## Domínio

Quando tudo estiver hospedado no mesmo Render, mantenha em `public/index.html`:

```js
window.MONITOR_CONFIG={apiBaseUrl:""};
```

Caso separe o frontend no futuro, coloque o endereço do backend em `apiBaseUrl`.
