# Adega Virtual / Master Distribuidora

## Rodar localmente
1. Instale Node.js 18+.
2. Crie `.env` a partir de `.env.example`.
3. Importe `masterdistribuidora.sql` em um MySQL.
4. Execute `npm install`.
5. Execute `npm start`.
6. Acesse `http://localhost:3000/` e `http://localhost:3000/admin.html`.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Adicione no Render as variáveis do `.env`.
- O banco MySQL deve ser um serviço externo compatível com MySQL.

Nunca publique `.env` ou `node_modules` no GitHub.
