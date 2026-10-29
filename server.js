/* Testa as rotas REAIS de COMBOS (cadastro em /api/combos e venda via POST /api/vendas com unidade 'combo',
 * cancelar, excluir, restaurar) com um MySQL SIMULADO em memória — não precisa de banco. Uso: npm run test:combos
 * (O fluxo contra um MySQL de verdade continua em scripts/testes-integracao.js.) */
const assert = require('assert');
const crypto = require('crypto');
process.env.JWT_SECRET = crypto.randomBytes(24).toString('hex');
const jwt = require('jsonwebtoken');
const { app, pool } = require('../server');

/* ---------- banco simulado (só as consultas usadas por estas rotas) ---------- */
let S; // estado
const novoEstado = () => ({
  produtos: {
    1: { id: 1, nome: 'Vodka', quantidade: 3, ml_avulso: 0, volume_ml: 1000, preco_custo: 80, ativo: 1 },
    2: { id: 2, nome: 'Gelo', quantidade: 50, ml_avulso: 0, volume_ml: null, preco_custo: 1, ativo: 1 },
    3: { id: 3, nome: 'Energético', quantidade: 24, ml_avulso: 0, volume_ml: 269, preco_custo: 6, ativo: 1 },
    4: { id: 4, nome: 'Whisky', quantidade: 2, ml_avulso: 0, volume_ml: 1000, preco_custo: 120, ativo: 1 }
  },
  vendas: {}, itens: [], ings: [], movs: [], pags: [], auditoria: [], receitas: [], combos: [], comboItens: [], seq: { venda: 0, item: 0, ing: 0, rec: 0, combo: 0, cit: 0 }
});
const clone = o => JSON.parse(JSON.stringify(o));
let snapshot = null;
async function query(sql, p = []) {
  const q = sql.replace(/\s+/g, ' ').trim();
  const R = x => [x];
  if (/FROM usuarios WHERE id=\? AND ativo=1/.test(q)) return R([{ id: 1, nome: 'Admin', perfil: 'admin' }]);
  if (/^SELECT id FROM vendas WHERE token_unico=\?/.test(q)) return R(Object.values(S.vendas).filter(v => v.token_unico === p[0]).map(v => ({ id: v.id })));
  if (/^SELECT id, nome, quantidade, ml_avulso, volume_ml, preco_custo, ativo FROM produtos WHERE id=\? FOR UPDATE/.test(q)) return R(S.produtos[p[0]] ? [{ ...S.produtos[p[0]] }] : []);
  if (/^INSERT INTO vendas /.test(q)) { const id = ++S.seq.venda; S.vendas[id] = { id, token_unico: p[0], total: p[6], subtotal: p[4], desconto: p[5], cancelada: 0, excluida_em: null, data_venda: p[2], cliente_id: p[1] }; return R({ insertId: id }); }
  if (/^INSERT INTO itens_venda_ingredientes/.test(q)) { S.ings.push({ id: ++S.seq.ing, item_id: p[0], produto_id: p[1], quantidade: p[2], ml_unitario: p[3], ml_baixado: p[4], custo: p[5] }); return R({ insertId: 1 }); }
  if (/^INSERT INTO itens_venda /.test(q)) { const id = ++S.seq.item; S.itens.push({ id, venda_id: p[0], produto_id: p[1], descricao: p[2], quantidade: p[3], unidade: p[4], ml_unitario: p[5], ml_baixado: p[6], preco_unitario: p[7], custo_unitario: p[8], desconto: p[9], subtotal: p[10] }); return R({ insertId: id }); }
  if (/^UPDATE produtos SET quantidade=\?, ml_avulso=\? WHERE id=\?/.test(q)) { S.produtos[p[2]].quantidade = p[0]; S.produtos[p[2]].ml_avulso = p[1]; return R({ affectedRows: 1 }); }
  if (/^UPDATE produtos SET quantidade=\? WHERE id=\?/.test(q)) { S.produtos[p[1]].quantidade = p[0]; return R({ affectedRows: 1 }); }
  if (/^INSERT INTO movimentacoes_estoque/.test(q)) { S.movs.push({ produto_id: p[0], tipo: p[1], quantidade: p[2], unidade: p[3], saldo_apos: p[4], saldo_ml_apos: p[5], motivo: p[6], venda_id: p[7] }); return R({ insertId: 1 }); }
  if (/^INSERT INTO pagamentos/.test(q)) { S.pags.push({ venda_id: p[1], valor: p[3] }); return R({ insertId: 1 }); }
  if (/^INSERT INTO auditoria/.test(q)) { S.auditoria.push({ acao: p[2], entidade_id: p[4] }); return R({ insertId: 1 }); }
  if (/^SELECT id, total, cancelada, excluida_em FROM vendas WHERE id=\? FOR UPDATE/.test(q)) return R(S.vendas[p[0]] ? [S.vendas[p[0]]] : []);
  if (/^SELECT \* FROM vendas WHERE id=\? FOR UPDATE/.test(q)) return R(S.vendas[p[0]] ? [S.vendas[p[0]]] : []);
  if (/^SELECT COUNT\(\*\) AS n FROM pagamentos WHERE venda_id=\?/.test(q)) return R([{ n: S.pags.filter(x => x.venda_id === p[0]).length }]);
  if (/^SELECT id, valor, data_pagamento, forma_pagamento FROM pagamentos WHERE venda_id=\?/.test(q)) return R(S.pags.filter(x => x.venda_id === p[0]));
  if (/^SELECT COUNT\(\*\) AS nItens FROM itens_venda WHERE venda_id=\?/.test(q)) return R([{ nItens: S.itens.filter(i => i.venda_id === p[0]).length }]);
  if (/^SELECT produto_id, quantidade, unidade, ml_unitario FROM itens_venda WHERE venda_id=\? AND produto_id IS NOT NULL/.test(q)) return R(S.itens.filter(i => i.venda_id === p[0] && i.produto_id !== null).map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade, unidade: i.unidade, ml_unitario: i.ml_unitario })));
  if (/FROM itens_venda_ingredientes g JOIN itens_venda i/.test(q)) return R(S.ings.filter(g => S.itens.find(i => i.id === g.item_id).venda_id === p[0]).map(g => ({ produto_id: g.produto_id, quantidade: g.quantidade * S.itens.find(i => i.id === g.item_id).quantidade, unidade: g.ml_unitario === null ? 'unidade' : 'copo', ml_unitario: g.ml_unitario })));
  if (/^UPDATE vendas SET cancelada=1/.test(q)) { S.vendas[p[0]].cancelada = 1; return R({ affectedRows: 1 }); }
  if (/^UPDATE vendas SET excluida_em=NOW\(\)/.test(q)) { if (S.vendas[p[2]].excluida_em) return R({ affectedRows: 0 }); S.vendas[p[2]].excluida_em = 'agora'; return R({ affectedRows: 1 }); }
  if (/^UPDATE vendas SET excluida_em=NULL/.test(q)) { S.vendas[p[0]].excluida_em = null; return R({ affectedRows: 1 }); }
  if (/^SELECT id FROM produtos WHERE id IN \(\?\) AND ativo=1/.test(q)) return R(p[0].filter(id => S.produtos[id] && S.produtos[id].ativo).map(id => ({ id })));
  if (/^INSERT INTO copao_receitas/.test(q)) { let r = S.receitas.find(x => x.nome === p[0]); if (r) { r.preco = p[1]; r.ingredientes = p[2]; } else S.receitas.push({ id: ++S.seq.rec, nome: p[0], preco: p[1], ingredientes: p[2] }); return R({ affectedRows: 1 }); }
  if (/^SELECT id FROM copao_receitas WHERE nome=\?/.test(q)) return R(S.receitas.filter(x => x.nome === p[0]).map(x => ({ id: x.id })));
  if (/^SELECT id, nome, preco, ingredientes FROM copao_receitas/.test(q)) return R(S.receitas);
  if (/^DELETE FROM copao_receitas WHERE id=\?/.test(q)) { const n = S.receitas.length; S.receitas = S.receitas.filter(x => x.id !== p[0] && String(x.id) !== String(p[0])); return R({ affectedRows: n - S.receitas.length }); }
  /* ---- combos ---- */
  if (/^SELECT id(, nome)? FROM combos WHERE id=\?( FOR UPDATE)?$/.test(q)) return R(S.combos.filter(c => String(c.id) === String(p[0])).map(c => ({ id: c.id, nome: c.nome })));
  if (/^SELECT produto_id, quantidade, ml_unitario FROM combo_itens WHERE combo_id=\? ORDER BY id/.test(q)) return R(S.comboItens.filter(x => x.combo_id === p[0]).map(x => ({ produto_id: x.produto_id, quantidade: x.quantidade, ml_unitario: x.ml_unitario })));
  if (/^SELECT id, nome, preco FROM combos c ORDER BY nome/.test(q)) return R([...S.combos].sort((a, b) => a.nome.localeCompare(b.nome)).map(c => ({ id: c.id, nome: c.nome, preco: c.preco })));
  if (/FROM combo_itens ci JOIN produtos p ON p.id = ci.produto_id WHERE ci.combo_id IN/.test(q)) return R(S.comboItens.filter(x => p[0].includes(x.combo_id)).map(x => {
    const pr = S.produtos[x.produto_id];
    return { combo_id: x.combo_id, produto_id: x.produto_id, quantidade: x.quantidade, ml_unitario: x.ml_unitario, produto_nome: pr.nome, ativo: pr.ativo, preco_custo: pr.preco_custo, volume_ml: pr.volume_ml, estoque_un: pr.quantidade, estoque_ml: pr.volume_ml ? pr.quantidade * pr.volume_ml + pr.ml_avulso : null };
  }));
  if (/^SELECT id, nome, volume_ml FROM produtos WHERE id IN \(\?\) AND ativo=1/.test(q)) return R(p[0].filter(id => S.produtos[id] && S.produtos[id].ativo).map(id => ({ id, nome: S.produtos[id].nome, volume_ml: S.produtos[id].volume_ml })));
  if (/^INSERT INTO combos \(nome, preco\)/.test(q)) { if (S.combos.some(c => c.nome === p[0])) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }); const id = ++S.seq.combo; S.combos.push({ id, nome: p[0], preco: p[1] }); return R({ insertId: id }); }
  if (/^UPDATE combos SET nome=\?, preco=\? WHERE id=\?/.test(q)) { if (S.combos.some(c => c.nome === p[0] && c.id !== p[2])) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }); const c = S.combos.find(x => x.id === p[2]); c.nome = p[0]; c.preco = p[1]; return R({ affectedRows: 1 }); }
  if (/^DELETE FROM combo_itens WHERE combo_id=\?/.test(q)) { S.comboItens = S.comboItens.filter(x => x.combo_id !== p[0]); return R({ affectedRows: 1 }); }
  if (/^INSERT INTO combo_itens/.test(q)) { S.comboItens.push({ id: ++S.seq.cit, combo_id: p[0], produto_id: p[1], quantidade: p[2], ml_unitario: p[3] }); return R({ insertId: S.seq.cit }); }
  if (/^DELETE FROM combos WHERE id=\?/.test(q)) { S.combos = S.combos.filter(c => c.id !== p[0]); S.comboItens = S.comboItens.filter(x => x.combo_id !== p[0]); return R({ affectedRows: 1 }); }
  if (/^SELECT DISTINCT c\.nome FROM combo_itens ci JOIN combos c/.test(q)) return R([...new Set(S.comboItens.filter(x => String(x.produto_id) === String(p[0])).map(x => S.combos.find(c => c.id === x.combo_id).nome))].map(nome => ({ nome })));
  if (/^UPDATE produtos SET ativo=0 WHERE id=\? AND ativo=1/.test(q)) { const pr = S.produtos[p[0]]; if (!pr || !pr.ativo) return R({ affectedRows: 0 }); pr.ativo = 0; return R({ affectedRows: 1 }); }
  throw new Error('Consulta não prevista no banco simulado: ' + q.slice(0, 120));
}
const conexao = { query, async beginTransaction() { snapshot = clone(S); }, async commit() { snapshot = null; }, async rollback() { if (snapshot) { S = snapshot; snapshot = null; } }, release() {} };
pool.getConnection = async () => conexao;
pool.query = query;
// o rollback troca o objeto de estado; as funções acima sempre leem a variável S atual

/* ---------- ferramentas de teste ---------- */
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const tk = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
const api = async (m, u, corpo) => {
  const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, b: await r.json().catch(() => ({})) };
};
const hoje = require('../lib/util').hojeBR(); // mesma data (Brasília) que o servidor usa
const venda = (itens, extra = {}) => ({ token_unico: crypto.randomUUID(), data_venda: hoje, forma_pagamento: 'Pix', desconto: 0, valor_pago: 0, itens, ...extra });
const copao = (ingredientes, extra = {}) => ({ unidade: 'copao', descricao: 'Copão', quantidade: 1, preco_unitario: 25, ingredientes, ...extra });

const combo = (combo_id, extra = {}) => ({ unidade: 'combo', combo_id, descricao: 'Combo', quantidade: 1, preco_unitario: 90, ...extra });
const novoCombo = (extra = {}) => api('POST', '/api/combos', { nome: 'Combo Vodka + 5 gelos', preco: 90, itens: [{ produto_id: 1, quantidade: 1 }, { produto_id: 2, quantidade: 5 }], ...extra });
const totalMl = id => S.produtos[id].quantidade * S.produtos[id].volume_ml + S.produtos[id].ml_avulso;
let ok = 0, falhas = 0;
const t = async (nome, fn) => { S = novoEstado(); snapshot = null; try { await fn(); ok++; console.log('  ✓', nome); } catch (e) { falhas++; console.log('  ✗', nome, '\n     ', e.message); } };

(async () => {
  console.log('Combos (rotas reais, banco simulado)');
  await t('criar combo (1 vodka + 5 gelos) e listar com custo, lucro e quantidade vendável', async () => {
    const r = await novoCombo(); assert.strictEqual(r.status, 201, JSON.stringify(r.b));
    const l = await api('GET', '/api/combos'); assert.strictEqual(l.status, 200);
    assert.strictEqual(l.b.length, 1); const c = l.b[0];
    assert.strictEqual(c.nome, 'Combo Vodka + 5 gelos'); assert.strictEqual(c.preco, 90);
    assert.strictEqual(c.custo, 85); assert.strictEqual(c.lucro, 5);
    assert.strictEqual(c.maximo, 3, 'limitado pelas 3 garrafas de vodka (gelo daria 10)');
    assert.deepStrictEqual(c.itens.map(i => [i.produto_id, i.quantidade, i.ml_unitario]), [[1, 1, null], [2, 5, null]]);
    assert.ok(S.auditoria.some(a => a.acao === 'COMBO_CRIADO'));
  });
  await t('vender 2 combos baixa 2 vodkas e 10 gelos do estoque e grava custo, ingredientes e movimentações', async () => {
    const id = (await novoCombo()).b.id;
    const r = await api('POST', '/api/vendas', venda([combo(id, { quantidade: 2 })], { valor_pago: 180 }));
    assert.strictEqual(r.status, 201, JSON.stringify(r.b));
    assert.strictEqual(S.produtos[1].quantidade, 3 - 2); assert.strictEqual(S.produtos[2].quantidade, 50 - 10);
    const it = S.itens[0];
    assert.strictEqual(it.unidade, 'combo'); assert.strictEqual(it.produto_id, null); assert.strictEqual(it.quantidade, 2);
    assert.strictEqual(it.preco_unitario, 90); assert.strictEqual(it.subtotal, 180); assert.strictEqual(it.custo_unitario, 85);
    assert.strictEqual(it.descricao, 'Combo Vodka + 5 gelos (Vodka + 5× Gelo)');
    assert.deepStrictEqual(S.ings.map(g => [g.produto_id, g.quantidade, g.ml_unitario, g.custo]), [[1, 1, null, 80], [2, 5, null, 5]]);
    assert.deepStrictEqual(S.movs.filter(m => m.produto_id === 2).map(m => [m.tipo, m.quantidade, m.saldo_apos, m.venda_id]), [['saida', 10, 40, r.b.id]]);
    assert.strictEqual(S.pags.length, 1);
  });
  await t('o navegador não manda no que baixa: ingredientes enviados na venda são ignorados', async () => {
    const id = (await novoCombo()).b.id;
    const r = await api('POST', '/api/vendas', venda([combo(id, { ingredientes: [{ produto_id: 4, quantidade: 2 }] })]));
    assert.strictEqual(r.status, 201, JSON.stringify(r.b));
    assert.strictEqual(S.produtos[4].quantidade, 2, 'whisky intacto'); assert.strictEqual(S.produtos[1].quantidade, 2); assert.strictEqual(S.produtos[2].quantidade, 45);
  });
  await t('combo com dose em ml (100 ml de vodka + 2 gelos + 1 energético)', async () => {
    const id = (await novoCombo({ nome: 'Dose', itens: [{ produto_id: 1, quantidade: 1, ml_unitario: 100 }, { produto_id: 2, quantidade: 2 }, { produto_id: 3, quantidade: 1 }] })).b.id;
    const r = await api('POST', '/api/vendas', venda([combo(id, { quantidade: 3, preco_unitario: 20 })]));
    assert.strictEqual(r.status, 201, JSON.stringify(r.b));
    assert.strictEqual(totalMl(1), 3000 - 300); assert.strictEqual(S.produtos[1].ml_avulso, 700); assert.strictEqual(S.produtos[2].quantidade, 44); assert.strictEqual(S.produtos[3].quantidade, 21);
    assert.strictEqual(S.itens[0].custo_unitario, 8 + 2 + 6); assert.strictEqual(S.itens[0].descricao, 'Dose (Vodka 100 ml + 2× Gelo + Energético)');
  });
  await t('estoque insuficiente recusa a venda inteira e não deixa nada pela metade', async () => {
    const id = (await novoCombo()).b.id; const antes = clone(S.produtos);
    const r = await api('POST', '/api/vendas', venda([combo(id, { quantidade: 4 })]));
    assert.strictEqual(r.status, 400); assert.ok(/Estoque insuficiente/.test(r.b.erro), r.b.erro);
    assert.deepStrictEqual(S.produtos, antes); assert.strictEqual(Object.keys(S.vendas).length, 0); assert.strictEqual(S.itens.length, 0); assert.strictEqual(S.ings.length, 0);
  });
  await t('combo e item avulso do mesmo produto somam a demanda no estoque', async () => {
    const id = (await novoCombo()).b.id;
    const r = await api('POST', '/api/vendas', venda([combo(id, { quantidade: 2 }), { produto_id: 1, descricao: 'Vodka', unidade: 'garrafa', quantidade: 2, preco_unitario: 100 }]));
    assert.strictEqual(r.status, 400, 'precisa de 4 vodkas e só há 3');
    const r2 = await api('POST', '/api/vendas', venda([combo(id, { quantidade: 2 }), { produto_id: 1, descricao: 'Vodka', unidade: 'garrafa', quantidade: 1, preco_unitario: 100 }]));
    assert.strictEqual(r2.status, 201, JSON.stringify(r2.b)); assert.strictEqual(S.produtos[1].quantidade, 0);
  });
  await t('cancelar devolve exatamente o mesmo estoque e não devolve duas vezes', async () => {
    const id = (await novoCombo()).b.id;
    const r = await api('POST', '/api/vendas', venda([combo(id, { quantidade: 3 })]));
    assert.strictEqual(S.produtos[1].quantidade, 0); assert.strictEqual(S.produtos[2].quantidade, 35);
    assert.strictEqual((await api('POST', `/api/vendas/${r.b.id}/cancelar`)).status, 200);
    assert.strictEqual(S.produtos[1].quantidade, 3); assert.strictEqual(S.produtos[2].quantidade, 50);
    assert.strictEqual((await api('POST', `/api/vendas/${r.b.id}/cancelar`)).status, 409); assert.strictEqual(S.produtos[1].quantidade, 3);
  });
  await t('excluir devolve o estoque; restaurar baixa de novo', async () => {
    const id = (await novoCombo()).b.id;
    const r = await api('POST', '/api/vendas', venda([combo(id, { quantidade: 2 })], { valor_pago: 20 }));
    const apos = clone(S.produtos);
    const ex = await api('POST', `/api/vendas/${r.b.id}/excluir`, { estado_esperado: { total_pago: 20, qtd_pagamentos: 1 }, confirmar_pagamentos: true });
    assert.strictEqual(ex.status, 200, JSON.stringify(ex.b)); assert.strictEqual(S.produtos[1].quantidade, 3); assert.strictEqual(S.produtos[2].quantidade, 50);
    assert.strictEqual((await api('POST', `/api/vendas/${r.b.id}/restaurar`)).status, 200); assert.deepStrictEqual(S.produtos, apos);
  });
  await t('editar o combo vale para as próximas vendas; a venda antiga devolve o que realmente baixou', async () => {
    const id = (await novoCombo()).b.id;
    const v1 = await api('POST', '/api/vendas', venda([combo(id)]));
    assert.strictEqual(S.produtos[2].quantidade, 45);
    const e = await api('PUT', `/api/combos/${id}`, { nome: 'Combo Vodka + 10 gelos', preco: 100, itens: [{ produto_id: 1, quantidade: 1 }, { produto_id: 2, quantidade: 10 }] });
    assert.strictEqual(e.status, 200, JSON.stringify(e.b));
    await api('POST', '/api/vendas', venda([combo(id, { preco_unitario: 100 })]));
    assert.strictEqual(S.produtos[2].quantidade, 35); assert.strictEqual(S.itens[1].descricao, 'Combo Vodka + 10 gelos (Vodka + 10× Gelo)');
    assert.strictEqual((await api('POST', `/api/vendas/${v1.b.id}/cancelar`)).status, 200);
    assert.strictEqual(S.produtos[2].quantidade, 40, 'devolveu os 5 gelos da venda antiga, não 10');
  });
  await t('excluir o combo não afeta vendas já feitas (cancelar ainda devolve o estoque)', async () => {
    const id = (await novoCombo()).b.id;
    const v = await api('POST', '/api/vendas', venda([combo(id)]));
    assert.strictEqual((await api('DELETE', `/api/combos/${id}`)).status, 200);
    assert.strictEqual((await api('GET', '/api/combos')).b.length, 0);
    assert.strictEqual((await api('POST', `/api/vendas/${v.b.id}/cancelar`)).status, 200);
    assert.strictEqual(S.produtos[1].quantidade, 3); assert.strictEqual(S.produtos[2].quantidade, 50);
    assert.strictEqual((await api('DELETE', `/api/combos/${id}`)).status, 404);
    const r = await api('POST', '/api/vendas', venda([combo(id)])); assert.strictEqual(r.status, 400); assert.ok(/Combo não encontrado/.test(r.b.erro));
  });
  await t('validações do cadastro: nome, preço, itens, repetidos, ml sem volume, produto inativo/inexistente, nome duplicado', async () => {
    assert.strictEqual((await novoCombo({ nome: '' })).status, 400);
    assert.strictEqual((await novoCombo({ preco: '' })).status, 400);
    assert.strictEqual((await novoCombo({ preco: -5 })).status, 400);
    assert.strictEqual((await novoCombo({ itens: [] })).status, 400);
    assert.strictEqual((await novoCombo({ itens: [{ produto_id: 2, quantidade: 0 }] })).status, 400);
    assert.strictEqual((await novoCombo({ itens: [{ produto_id: 2, quantidade: 1 }, { produto_id: 2, quantidade: 2 }] })).status, 400);
    assert.strictEqual((await novoCombo({ itens: [{ produto_id: 2, quantidade: 1, ml_unitario: 50 }] })).status, 400);
    assert.strictEqual((await novoCombo({ itens: [{ produto_id: 99, quantidade: 1 }] })).status, 400);
    S.produtos[4].ativo = 0; assert.strictEqual((await novoCombo({ itens: [{ produto_id: 4, quantidade: 1 }] })).status, 400); S.produtos[4].ativo = 1;
    assert.strictEqual(S.combos.length, 0);
    assert.strictEqual((await novoCombo()).status, 201); assert.strictEqual((await novoCombo()).status, 409);
    assert.strictEqual((await api('PUT', '/api/combos/999', { nome: 'x', preco: 1, itens: [{ produto_id: 2, quantidade: 1 }] })).status, 404);
  });
  await t('venda com combo inexistente, sem combo_id ou com produto inativo é recusada sem baixar nada', async () => {
    const id = (await novoCombo()).b.id; const antes = clone(S.produtos);
    assert.strictEqual((await api('POST', '/api/vendas', venda([combo(9999)]))).status, 400);
    assert.strictEqual((await api('POST', '/api/vendas', venda([combo(undefined)]))).status, 400);
    S.produtos[2].ativo = 0;
    const r = await api('POST', '/api/vendas', venda([combo(id)])); assert.strictEqual(r.status, 400); assert.ok(/Combo Vodka \+ 5 gelos/.test(r.b.erro) && /Gelo/.test(r.b.erro), r.b.erro);
    S.produtos[2].ativo = 1;
    assert.deepStrictEqual(S.produtos, antes); assert.strictEqual(Object.keys(S.vendas).length, 0);
  });
  await t('listagem avisa quando falta estoque ou o produto está inativo', async () => {
    await novoCombo(); S.produtos[1].quantidade = 0;
    assert.strictEqual((await api('GET', '/api/combos')).b[0].maximo, 0);
    S.produtos[1].quantidade = 3; S.produtos[2].ativo = 0;
    const c = (await api('GET', '/api/combos')).b[0]; assert.strictEqual(c.maximo, 0); assert.ok(/inativo/.test(c.problema));
  });
  await t('não deixa excluir produto que faz parte de combo; depois de excluir o combo, deixa', async () => {
    const id = (await novoCombo()).b.id;
    const r = await api('DELETE', '/api/produtos/2'); assert.strictEqual(r.status, 409); assert.ok(/Combo Vodka \+ 5 gelos/.test(r.b.erro)); assert.strictEqual(S.produtos[2].ativo, 1);
    await api('DELETE', `/api/combos/${id}`);
    assert.strictEqual((await api('DELETE', '/api/produtos/2')).status, 200); assert.strictEqual(S.produtos[2].ativo, 0);
  });
  await t('venda sem combo continua igual (garrafa e item manual)', async () => {
    const r = await api('POST', '/api/vendas', venda([{ produto_id: 1, descricao: 'Vodka', unidade: 'garrafa', quantidade: 1, preco_unitario: 100 }, { descricao: 'Taxa', quantidade: 1, preco_unitario: 5 }]));
    assert.strictEqual(r.status, 201, JSON.stringify(r.b)); assert.strictEqual(S.produtos[1].quantidade, 2); assert.strictEqual(S.itens.length, 2);
  });

  console.log(`\n${ok} aprovados, ${falhas} falha(s)`);
  srv.close(); process.exit(falhas ? 1 : 0);
})();
