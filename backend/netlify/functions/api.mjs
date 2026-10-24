// Handler serverless do Netlify (formato v1: evento Lambda). Importa o app
// Express de server.js, que NÃO abre porta quando apenas importado (guarda de
// execução direta em server.js). serverless-http converte o evento Lambda em
// req/res do Express. O redirect /* -> /.netlify/functions/api do netlify.toml
// preserva o path original do request, então /health e /api/... chegam ao app
// com a rota completa.
import serverless from 'serverless-http';
import app from '../../server.js';

const serverlessHandler = serverless(app);

export const handler = async (event, context) => serverlessHandler(event, context);
