// Handler serverless da Vercel (@vercel/node). Importa o app Express de
// server.js, que NÃO abre porta quando apenas importado (guarda de execução
// direta em server.js) — aqui o app é somente exportado como handler HTTP.
// Compatibilidade de rotas: vercel.json faz rewrite de tudo para /api/index.js.
import app from '../server.js';

export default app;
