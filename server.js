const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const dbConfig = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'adega_db',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};

const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_SECRET = process.env.ADMIN_SECRET;

// Diagnóstico: confirma se as variáveis foram carregadas, sem expor os valores.
// Se aparecer "false" aqui nos logs do serviço, a variável não está configurada
// no ambiente onde o servidor está rodando (não é sobre o .env local).
console.log('[config] ADMIN_PASSWORD definido:', Boolean(ADMIN_PASSWORD));
console.log('[config] ADMIN_SECRET definido:', Boolean(ADMIN_SECRET));

// Regra do GELO DE CUBO (normal): 1 ou 2 unidades = R$ 7,00 cada | 3 unidades ou mais = R$ 5,00 cada.
// A quantidade considerada é o total do produto no carrinho (somando todos os sabores/variações dele).
const GELO_CUBO_PRECO = 7.00;
const GELO_CUBO_PRECO_PROMO = 5.00;
const GELO_CUBO_QTD_PROMO = 3;

function precoGeloCubo(quantidade) {
    return Number(quantidade) >= GELO_CUBO_QTD_PROMO ? GELO_CUBO_PRECO_PROMO : GELO_CUBO_PRECO;
}

function criarTokenAdmin() {
    const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
    const assinatura = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
    return `${payload}.${assinatura}`;
}

function autenticarAdmin(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const [payload, assinatura] = token.split('.');

    if (!payload || !assinatura || !ADMIN_SECRET) {
        return res.status(401).json({ erro: 'Não autorizado.' });
    }

    const assinaturaEsperada = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');

    if (assinatura.length !== assinaturaEsperada.length || !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(assinaturaEsperada))) {
        return res.status(401).json({ erro: 'Token inválido.' });
    }

    try {
        const dados = JSON.parse(Buffer.from(payload, 'base64url').toString());

        if (dados.role !== 'admin' || dados.exp < Date.now()) {
            return res.status(401).json({ erro: 'Sessão expirada.' });
        }
    } catch {
        return res.status(401).json({ erro: 'Token inválido.' });
    }

    next();
}

app.post('/admin/login', (req, res) => {
    const { senha } = req.body || {};

    if (!ADMIN_PASSWORD || senha !== ADMIN_PASSWORD) {
        return res.status(401).json({ erro: 'Senha incorreta!' });
    }

    res.json({ token: criarTokenAdmin() });
});

// ==========================================
// ROTAS DE PRODUTOS
// ==========================================

// Busca todas as variações (sabores) de uma vez e agrupa por produto_id.
// Evita N+1 queries ao montar a lista de produtos.
async function buscarVariacoesAgrupadas(connection) {
    const [variacoes] = await connection.execute(
        'SELECT id, produto_id, sabor, preco, preco_promocional, preco_atacado, preco_custo, estoque, imagem, status FROM produto_variacoes'
    );

    const porProduto = {};
    for (const v of variacoes) {
        if (!porProduto[v.produto_id]) porProduto[v.produto_id] = [];
        porProduto[v.produto_id].push(v);
    }

    return porProduto;
}

// ==========================================
// ROTAS DE CATEGORIAS
// ==========================================

app.get('/categorias', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            'SELECT id, nome, slug FROM categorias ORDER BY nome'
        );
        res.json(rows);
    } catch (erro) {
        console.error('Erro ao buscar categorias:', erro);
        res.status(500).json({ erro: 'Erro interno ao buscar categorias.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/categorias', autenticarAdmin, async (req, res) => {
    const { nome } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({ erro: 'Informe o nome da categoria.' });
    }

    const slug = nome
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        const [resultado] = await connection.execute(
            'INSERT INTO categorias (nome, slug) VALUES (?, ?)',
            [nome.trim(), slug]
        );

        res.status(201).json({ sucesso: true, id: resultado.insertId, nome: nome.trim(), slug });
    } catch (erro) {
        console.error('Erro ao criar categoria:', erro);

        if (erro.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ erro: 'Já existe uma categoria com esse nome.' });
        }

        res.status(500).json({ erro: 'Erro interno ao criar categoria.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/produtos', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(
            'SELECT id, nome, categoria_id, marca, preco, preco_atacado, preco_custo, volume, teor_alcoolico, estoque, imagem, descricao, status, destaque, sabores, eh_gelo_especial, eh_gelo_cubo, possui_variacoes, ordem FROM produtos ORDER BY ordem ASC, id ASC'
        );

        const variacoesPorProduto = await buscarVariacoesAgrupadas(connection);

        const produtos = rows.map(p => ({
            ...p,
            variacoes: p.possui_variacoes ? (variacoesPorProduto[p.id] || []) : []
        }));

        res.json(produtos);
    } catch (erro) {
        console.error('Erro ao buscar produtos:', erro);
        res.status(500).json({ erro: 'Erro interno ao buscar produtos.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/produtos-destaque', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(
            'SELECT id, nome, categoria_id, marca, preco, preco_atacado, preco_custo, volume, teor_alcoolico, estoque, imagem, descricao, status, destaque, sabores, eh_gelo_especial, eh_gelo_cubo, possui_variacoes, ordem FROM produtos WHERE destaque = 1 ORDER BY ordem ASC, id ASC LIMIT 2'
        );

        const variacoesPorProduto = await buscarVariacoesAgrupadas(connection);

        const produtos = rows.map(p => ({
            ...p,
            variacoes: p.possui_variacoes ? (variacoesPorProduto[p.id] || []) : []
        }));

        res.json(produtos);
    } catch (erro) {
        console.error('Erro ao buscar produtos em destaque:', erro);
        res.status(500).json({ erro: 'Erro interno ao buscar destaques.' });
    } finally {
        if (connection) await connection.end();
    }
});

// ==========================================
// ROTAS DE VARIAÇÕES (SABORES)
// ==========================================

// Cadastro agrupado: cria o produto base + todas as variações (sabores) numa transação
app.post('/produtos/agrupado', autenticarAdmin, async (req, res) => {
    const {
        nome,
        categoria_id,
        marca,
        descricao,
        volume,
        teor_alcoolico,
        destaque,
        eh_gelo_especial,
        eh_gelo_cubo,
        variacoes
    } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({ erro: 'Informe o nome do produto base.' });
    }

    if (!Array.isArray(variacoes) || variacoes.length === 0) {
        return res.status(400).json({ erro: 'Informe ao menos uma variação (sabor).' });
    }

    for (const v of variacoes) {
        if (!v.sabor || !v.sabor.trim() || v.preco === undefined || v.preco === null || v.preco === '') {
            return res.status(400).json({ erro: 'Cada variação precisa de sabor e preço.' });
        }
    }

    const isDestaque = destaque ? 1 : 0;
    const isGeloEspecial = eh_gelo_especial ? 1 : 0;
    const isGeloCubo = (eh_gelo_cubo && !isGeloEspecial) ? 1 : 0; // um produto é gelo especial OU gelo de cubo

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [[{ proxima }]] = await connection.execute(
            'SELECT COALESCE(MAX(ordem), 0) + 1 AS proxima FROM produtos'
        );

        const [resultadoProduto] = await connection.execute(
            `INSERT INTO produtos
                (nome, categoria_id, marca, descricao, volume, teor_alcoolico,
                 preco, estoque, status, destaque, eh_gelo_especial, eh_gelo_cubo, possui_variacoes, ordem)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'disponivel', ?, ?, ?, 1, ?)`,
            [
                nome,
                categoria_id || 1,
                marca || null,
                descricao || null,
                volume || null,
                teor_alcoolico || null,
                isDestaque,
                isGeloEspecial,
                isGeloCubo,
                proxima
            ]
        );

        const produtoId = resultadoProduto.insertId;

        for (const v of variacoes) {
            await connection.execute(
                `INSERT INTO produto_variacoes
                    (produto_id, sabor, preco, preco_promocional, preco_atacado, preco_custo, estoque, imagem, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    produtoId,
                    v.sabor,
                    v.preco,
                    v.preco_promocional || null,
                    v.preco_atacado || 0,
                    v.preco_custo || 0,
                    v.estoque || 0,
                    v.imagem || null,
                    v.status || 'disponivel'
                ]
            );
        }

        await connection.commit();

        res.status(201).json({
            sucesso: true,
            produto_id: produtoId,
            mensagem: 'Produto com variações cadastrado com sucesso!'
        });
    } catch (erro) {
        if (connection) {
            try { await connection.rollback(); } catch {}
        }
        console.error('Erro ao cadastrar produto agrupado:', erro);
        res.status(500).json({ erro: 'Erro ao cadastrar produto com variações.' });
    } finally {
        if (connection) await connection.end();
    }
});

// Adiciona uma nova variação (sabor) a um produto base já existente
app.post('/produtos/:id/variacoes', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const { sabor, preco, preco_promocional, preco_atacado, preco_custo, estoque, imagem, status } = req.body;

    if (!sabor || !sabor.trim() || preco === undefined || preco === null || preco === '') {
        return res.status(400).json({ erro: 'Informe sabor e preço da variação.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [produtoRows] = await connection.execute(
            'SELECT id FROM produtos WHERE id = ?',
            [id]
        );

        if (produtoRows.length === 0) {
            throw new Error('Produto base não encontrado.');
        }

        await connection.execute(
            `INSERT INTO produto_variacoes
                (produto_id, sabor, preco, preco_promocional, preco_atacado, preco_custo, estoque, imagem, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                sabor,
                preco,
                preco_promocional || null,
                preco_atacado || 0,
                preco_custo || 0,
                estoque || 0,
                imagem || null,
                status || 'disponivel'
            ]
        );

        // Garante que o produto base fique marcado como "com variações"
        await connection.execute(
            'UPDATE produtos SET possui_variacoes = 1 WHERE id = ?',
            [id]
        );

        await connection.commit();

        res.status(201).json({ sucesso: true, mensagem: 'Variação adicionada com sucesso!' });
    } catch (erro) {
        if (connection) {
            try { await connection.rollback(); } catch {}
        }
        console.error('Erro ao adicionar variação:', erro);
        res.status(500).json({ erro: erro.message || 'Erro ao adicionar variação.' });
    } finally {
        if (connection) await connection.end();
    }
});

// Edita uma variação específica (estoque, preço, imagem, status), como se fosse um produto individual
app.put('/produto-variacoes/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const { sabor, preco, preco_promocional, preco_atacado, preco_custo, estoque, imagem, status } = req.body;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        await connection.execute(
            `UPDATE produto_variacoes
             SET sabor = ?, preco = ?, preco_promocional = ?, preco_atacado = ?,
                 preco_custo = ?, estoque = ?, imagem = ?, status = ?
             WHERE id = ?`,
            [
                sabor,
                preco,
                preco_promocional || null,
                preco_atacado || 0,
                preco_custo || 0,
                estoque,
                imagem || null,
                status || 'disponivel',
                id
            ]
        );

        res.json({ sucesso: true, mensagem: 'Variação atualizada com sucesso!' });
    } catch (erro) {
        console.error('Erro ao atualizar variação:', erro);
        res.status(500).json({ erro: 'Erro ao atualizar variação.' });
    } finally {
        if (connection) await connection.end();
    }
});

// Remove uma variação específica
app.delete('/produto-variacoes/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM produto_variacoes WHERE id = ?', [id]);

        res.json({ sucesso: true, mensagem: 'Variação excluída com sucesso!' });
    } catch (erro) {
        console.error('Erro ao excluir variação:', erro);
        res.status(500).json({ erro: 'Erro ao excluir variação.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/produtos', autenticarAdmin, async (req, res) => {
    const {
        nome,
        categoria_id,
        marca,
        preco,
        preco_atacado,
        preco_custo,
        volume,
        teor_alcoolico,
        estoque,
        imagem,
        descricao,
        status,
        destaque,
        sabores,
        eh_gelo_especial,
        eh_gelo_cubo
    } = req.body;

    const isDestaque = destaque ? 1 : 0;
    const isGeloEspecial = eh_gelo_especial ? 1 : 0;
    const isGeloCubo = (eh_gelo_cubo && !isGeloEspecial) ? 1 : 0; // um produto é gelo especial OU gelo de cubo

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [[{ proxima }]] = await connection.execute(
            'SELECT COALESCE(MAX(ordem), 0) + 1 AS proxima FROM produtos'
        );

        const query = `
            INSERT INTO produtos (
                nome,
                categoria_id,
                marca,
                preco,
                preco_atacado,
                preco_custo,
                volume,
                teor_alcoolico,
                estoque,
                imagem,
                descricao,
                status,
                destaque,
                sabores,
                eh_gelo_especial,
                eh_gelo_cubo,
                ordem
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await connection.execute(query, [
            nome,
            categoria_id || 1,
            marca,
            preco,
            preco_atacado || 0,
            preco_custo || 0,
            volume,
            teor_alcoolico,
            estoque,
            imagem,
            descricao,
            status || 'disponivel',
            isDestaque,
            sabores || null,
            isGeloEspecial,
            isGeloCubo,
            proxima
        ]);

        res.status(201).json({
            sucesso: true,
            mensagem: 'Produto cadastrado com sucesso!'
        });
    } catch (erro) {
        console.error('Erro ao cadastrar produto:', erro);
        res.status(500).json({
            erro: 'Erro ao cadastrar produto.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

// Salva a ordem de exibição dos produtos (a ordem do array = ordem no site)
app.put('/produtos-ordem', autenticarAdmin, async (req, res) => {
    const ids = req.body && req.body.ids;

    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => !Number.isInteger(Number(id)))) {
        return res.status(400).json({ erro: 'Lista de produtos inválida.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        for (let i = 0; i < ids.length; i++) {
            await connection.execute('UPDATE produtos SET ordem = ? WHERE id = ?', [i + 1, Number(ids[i])]);
        }

        await connection.commit();
        res.json({ sucesso: true });
    } catch (erro) {
        if (connection) {
            try { await connection.rollback(); } catch {}
        }
        console.error('Erro ao salvar ordem dos produtos:', erro);
        res.status(500).json({ erro: 'Erro ao salvar a ordem dos produtos.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.put('/produtos/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;

    const {
        nome,
        categoria_id,
        marca,
        preco,
        preco_atacado,
        preco_custo,
        volume,
        teor_alcoolico,
        estoque,
        imagem,
        descricao,
        status,
        destaque,
        sabores,
        eh_gelo_especial,
        eh_gelo_cubo
    } = req.body;

    const isDestaque = destaque ? 1 : 0;
    const isGeloEspecial = eh_gelo_especial ? 1 : 0;
    const isGeloCubo = (eh_gelo_cubo && !isGeloEspecial) ? 1 : 0; // um produto é gelo especial OU gelo de cubo

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const query = `
            UPDATE produtos
            SET
                nome = ?,
                categoria_id = ?,
                marca = ?,
                preco = ?,
                preco_atacado = ?,
                preco_custo = ?,
                volume = ?,
                teor_alcoolico = ?,
                estoque = ?,
                imagem = ?,
                descricao = ?,
                status = ?,
                destaque = ?,
                sabores = ?,
                eh_gelo_especial = ?,
                eh_gelo_cubo = ?
            WHERE id = ?
        `;

        await connection.execute(query, [
            nome,
            categoria_id || 1,
            marca,
            preco,
            preco_atacado || 0,
            preco_custo || 0,
            volume,
            teor_alcoolico,
            estoque,
            imagem,
            descricao,
            status || 'disponivel',
            isDestaque,
            sabores || null,
            isGeloEspecial,
            isGeloCubo,
            id
        ]);

        res.json({
            sucesso: true,
            mensagem: 'Produto atualizado com sucesso!'
        });
    } catch (erro) {
        console.error('Erro ao atualizar produto:', erro);
        res.status(500).json({
            erro: 'Erro ao atualizar produto.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

app.delete('/produtos/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        await connection.execute(
            'DELETE FROM produtos WHERE id = ?',
            [id]
        );

        res.json({
            sucesso: true,
            mensagem: 'Produto excluído com sucesso!'
        });
    } catch (erro) {
        console.error('Erro ao excluir produto:', erro);
        res.status(500).json({
            erro: 'Erro ao excluir produto.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

// ==========================================
// ROTAS DE PEDIDOS E RELATÓRIO
// ==========================================

app.get('/pedidos', autenticarAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [pedidos] = await connection.execute(
            'SELECT id, nome_cliente, telefone, endereco, valor_total, taxa_entrega, tipo_entrega, forma_pagamento, troco_para, status, data_criacao FROM pedidos ORDER BY id DESC'
        );

        const pedidosComItens = [];

        for (let ped of pedidos) {
            const [itens] = await connection.execute(`
                SELECT
                    ip.quantidade,
                    ip.preco AS preco,
                    p.nome,
                    p.sabores,
                    v.sabor AS sabor_variacao
                FROM itens_pedido ip
                INNER JOIN produtos p ON ip.produto_id = p.id
                LEFT JOIN produto_variacoes v ON ip.variacao_id = v.id
                WHERE ip.pedido_id = ?
            `, [ped.id]);

            pedidosComItens.push({
                ...ped,
                itens
            });
        }

        res.json(pedidosComItens);
    } catch (erro) {
        console.error('Erro ao buscar pedidos:', erro);
        res.status(500).json({
            erro: 'Erro interno ao buscar pedidos.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/pedidos', async (req, res) => {
    const {
        nome_cliente,
        telefone,
        endereco,
        tipo_entrega,
        forma_pagamento,
        troco_para,
        itens
    } = req.body;

    if (!itens || itens.length === 0) {
        return res.status(400).json({
            erro: 'O carrinho está vazio.'
        });
    }

    // Normaliza valores vindos do front-end, nunca confiando neles para o preço final.
    const tipoEntregaFinal = tipo_entrega === 'retirada' ? 'retirada' : 'entrega';
    const formaPagamentoFinal = forma_pagamento === 'dinheiro' ? 'dinheiro' : 'pix';
    const trocoParaFinal =
        (formaPagamentoFinal === 'dinheiro' && troco_para) ? Number(troco_para) : null;

    if (tipoEntregaFinal === 'entrega' && (!endereco || !endereco.trim())) {
        return res.status(400).json({
            erro: 'Informe o endereço de entrega ou escolha "Retirar na loja".'
        });
    }

    // Taxa fixa de entrega: soma R$5,00 quando o pedido é para entrega (não se aplica à retirada).
    // Calculada aqui (servidor), nunca confiando no valor que o front-end mandar.
    const taxaEntrega = tipoEntregaFinal === 'entrega' ? 5.00 : 0.00;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const produtosDoPedido = [];
        const itensComDados = [];

        // 1ª passada: busca os dados de cada item (produto ou variação) e valida estoque.
        for (let item of itens) {
            // Se o item veio com variacao_id, os dados de estoque/preço vêm da variação (sabor),
            // não do produto base — cada sabor tem seu próprio estoque e preço.
            let produtoDb;
            let variacaoId = null;

            if (item.variacao_id) {
                const [variacaoRows] = await connection.execute(
                    `SELECT v.id AS variacao_id, v.estoque, v.preco, v.preco_atacado,
                            p.id, p.nome, p.eh_gelo_especial, p.eh_gelo_cubo
                     FROM produto_variacoes v
                     INNER JOIN produtos p ON v.produto_id = p.id
                     WHERE v.id = ? AND v.produto_id = ?`,
                    [item.variacao_id, item.id]
                );

                if (variacaoRows.length === 0) {
                    throw new Error(`Variação ID ${item.variacao_id} não encontrada.`);
                }

                const variacaoDb = variacaoRows[0];
                variacaoId = variacaoDb.variacao_id;
                produtoDb = variacaoDb;
            } else {
                const [rows] = await connection.execute(
                    'SELECT id, estoque, nome, preco, preco_atacado, eh_gelo_especial, eh_gelo_cubo FROM produtos WHERE id = ?',
                    [item.id]
                );

                if (rows.length === 0) {
                    throw new Error(`Produto ID ${item.id} não encontrado.`);
                }

                produtoDb = rows[0];
            }

            if (produtoDb.estoque < item.quantidade) {
                throw new Error(
                    `Estoque insuficiente para "${produtoDb.nome}". Disponível: ${produtoDb.estoque}`
                );
            }

            itensComDados.push({ item, produtoDb, variacaoId });
        }

        // Soma as quantidades de gelo especial por PRODUTO BASE (não por sabor), já que
        // a faixa de preço (1un / 6un / >10un) considera o total comprado do produto,
        // somando todos os sabores dele.
        const qtdGeloPorProduto = {};

        for (const { item, produtoDb } of itensComDados) {
            if (produtoDb.eh_gelo_especial || produtoDb.eh_gelo_cubo) {
                qtdGeloPorProduto[produtoDb.id] =
                    (qtdGeloPorProduto[produtoDb.id] || 0) + Number(item.quantidade);
            }
        }

        // 2ª passada: calcula o preço de cada item já considerando a quantidade agregada do gelo.
        for (const { item, produtoDb, variacaoId } of itensComDados) {

            let precoBaseItem = Number(produtoDb.preco);

            // Regra do gelo especial: 1-4un R$4/un / 5-9un R$3,33/un / 10-39un R$2,50/un / 40un+ R$2,00/un
            if (produtoDb.eh_gelo_especial) {
                const qtd = qtdGeloPorProduto[produtoDb.id];

                if (qtd >= 40) {
                    precoBaseItem = 2.00;
                } else if (qtd >= 10) {
                    precoBaseItem = 2.50;
                } else if (qtd >= 5) {
                    precoBaseItem = 3.33;
                } else {
                    precoBaseItem = 4.00;
                }
            }

            // Regra do gelo de cubo (normal): 1-2un R$7,00/un | 3un+ R$5,00/un
            if (!produtoDb.eh_gelo_especial && produtoDb.eh_gelo_cubo) {
                precoBaseItem = precoGeloCubo(qtdGeloPorProduto[produtoDb.id]);
            }

            produtosDoPedido.push({
                id: produtoDb.id,
                variacao_id: variacaoId,
                quantidade: item.quantidade,
                preco_base: precoBaseItem,
                preco_atacado: produtoDb.preco_atacado
                    ? Number(produtoDb.preco_atacado)
                    : 0,
                eh_gelo: produtoDb.eh_gelo_especial || produtoDb.eh_gelo_cubo // gelo nunca entra no atacado por valor
            });
        }

        let novoValorTotalCalculado = 0;
        const itensValidados = [];

        // Atacado por valor do carrinho: quando o subtotal (a preço normal, sem
        // taxa de entrega) chega a R$ 300,00, TODOS os itens que têm preço de
        // atacado passam a valer esse preço. Não vale para gelo (que já tem sua
        // própria tabela de faixas). Calculado aqui, nunca confiando no front-end.
        const VALOR_MINIMO_ATACADO = 300;

        const subtotalSemAtacado = produtosDoPedido.reduce(
            (soma, prod) => soma + prod.preco_base * Number(prod.quantidade),
            0
        );

        const carrinhoAtingiuAtacado =
            subtotalSemAtacado >= VALOR_MINIMO_ATACADO;

        for (let prod of produtosDoPedido) {
            let precoFinalItem = prod.preco_base;

            const aplicaAtacado =
                !prod.eh_gelo &&
                carrinhoAtingiuAtacado &&
                prod.preco_atacado > 0;

            if (aplicaAtacado) {
                precoFinalItem = prod.preco_atacado;
            }

            itensValidados.push({
                id: prod.id,
                variacao_id: prod.variacao_id,
                quantidade: prod.quantidade,
                preco: precoFinalItem
            });

            novoValorTotalCalculado +=
                precoFinalItem * prod.quantidade;
        }

        novoValorTotalCalculado += taxaEntrega;

        const enderecoFinal =
            tipoEntregaFinal === 'retirada' ? 'Retirada na loja' : endereco;

        const [resultadoPedido] = await connection.execute(
            'INSERT INTO pedidos (nome_cliente, telefone, endereco, valor_total, taxa_entrega, tipo_entrega, forma_pagamento, troco_para, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                nome_cliente,
                telefone,
                enderecoFinal,
                novoValorTotalCalculado,
                taxaEntrega,
                tipoEntregaFinal,
                formaPagamentoFinal,
                trocoParaFinal,
                'pendente'
            ]
        );

        const pedidoId = resultadoPedido.insertId;

        for (let item of itensValidados) {
            await connection.execute(
                'INSERT INTO itens_pedido (pedido_id, produto_id, variacao_id, quantidade, preco) VALUES (?, ?, ?, ?, ?)',
                [
                    pedidoId,
                    item.id,
                    item.variacao_id,
                    item.quantidade,
                    item.preco
                ]
            );
        }

        await connection.commit();

        res.status(201).json({
            sucesso: true,
            mensagem: 'Pedido realizado com sucesso!',
            chave_pix: 'masterdistribuidoracm@gmail.com'
        });
    } catch (erro) {
        if (connection) {
            try {
                await connection.rollback();
            } catch {}
        }

        console.error('Erro ao processar pedido:', erro);

        res.status(400).json({
            erro: erro.message || 'Erro ao processar o pedido.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.put('/pedidos/:id/status', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [pedidoRows] = await connection.execute(
            'SELECT status FROM pedidos WHERE id = ?',
            [id]
        );

        if (pedidoRows.length === 0) {
            throw new Error('Pedido não encontrado.');
        }

        const statusAnterior = pedidoRows[0].status;

        await connection.execute(
            'UPDATE pedidos SET status = ? WHERE id = ?',
            [status, id]
        );

        if (status === 'pago' && statusAnterior !== 'pago') {
            const [itens] = await connection.execute(
                'SELECT produto_id, variacao_id, quantidade FROM itens_pedido WHERE pedido_id = ?',
                [id]
            );

            for (let item of itens) {
                if (item.variacao_id) {
                    await connection.execute(
                        'UPDATE produto_variacoes SET estoque = estoque - ? WHERE id = ?',
                        [item.quantidade, item.variacao_id]
                    );
                } else {
                    await connection.execute(
                        'UPDATE produtos SET estoque = estoque - ? WHERE id = ?',
                        [item.quantidade, item.produto_id]
                    );
                }
            }
        } else if (
            status === 'cancelado' &&
            statusAnterior === 'pago'
        ) {
            const [itens] = await connection.execute(
                'SELECT produto_id, variacao_id, quantidade FROM itens_pedido WHERE pedido_id = ?',
                [id]
            );

            for (let item of itens) {
                if (item.variacao_id) {
                    await connection.execute(
                        'UPDATE produto_variacoes SET estoque = estoque + ? WHERE id = ?',
                        [item.quantidade, item.variacao_id]
                    );
                } else {
                    await connection.execute(
                        'UPDATE produtos SET estoque = estoque + ? WHERE id = ?',
                        [item.quantidade, item.produto_id]
                    );
                }
            }
        }

        await connection.commit();

        res.json({
            sucesso: true,
            mensagem: 'Status atualizado com sucesso!'
        });
    } catch (erro) {
        if (connection) {
            try {
                await connection.rollback();
            } catch {}
        }

        console.error('Erro ao atualizar status:', erro);

        res.status(500).json({
            erro: erro.message || 'Erro ao atualizar o status.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.delete('/pedidos/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        await connection.execute(
            'DELETE FROM pedidos WHERE id = ?',
            [id]
        );

        res.json({
            sucesso: true,
            mensagem: 'Pedido excluído com sucesso!'
        });
    } catch (erro) {
        console.error('Erro ao excluir pedido:', erro);

        res.status(500).json({
            erro: 'Erro ao excluir pedido.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/relatorio-semanal', autenticarAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const query = `
            SELECT
                p.id AS pedido_id,
                ip.quantidade,
                ip.preco AS preco_venda,
                COALESCE(v.preco_custo, pr.preco_custo) AS preco_custo
            FROM pedidos p
            JOIN itens_pedido ip ON p.id = ip.pedido_id
            JOIN produtos pr ON ip.produto_id = pr.id
            LEFT JOIN produto_variacoes v ON ip.variacao_id = v.id
            WHERE p.status != 'cancelado'
            AND YEARWEEK(p.data_criacao, 0) = YEARWEEK(CURDATE(), 0)
        `;

        const [rows] = await connection.execute(query);

        let faturamentoTotal = 0;
        let custoTotal = 0;
        const pedidosSemana = new Set();

        rows.forEach(row => {
            pedidosSemana.add(row.pedido_id);

            faturamentoTotal +=
                Number(row.preco_venda) *
                row.quantidade;

            custoTotal +=
                Number(row.preco_custo || 0) *
                row.quantidade;
        });

        res.json({
            total_pedidos: pedidosSemana.size,
            faturamento: faturamentoTotal,
            lucro: faturamentoTotal - custoTotal
        });
    } catch (erro) {
        console.error('Erro ao gerar relatório:', erro);

        res.status(500).json({
            erro: 'Erro ao gerar relatório.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

// Estatísticas do painel administrativo (período livre + comparação com o período anterior)
app.get('/estatisticas', autenticarAdmin, async (req, res) => {
    const LIMITE_ESTOQUE_BAIXO = 5;
    const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    const dataValida = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(Date.parse(v + 'T12:00:00Z'));
    const somaDias = (v, n) => { const d = new Date(v + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

    const agora = new Date();
    const hojeLocal = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
    const de = req.query.de || hojeLocal.slice(0, 8) + '01';
    const ate = req.query.ate || hojeLocal;

    if (!dataValida(de) || !dataValida(ate)) return res.status(400).json({ erro: 'Datas inválidas.' });
    if (de > ate) return res.status(400).json({ erro: 'A data inicial deve ser anterior à data final.' });

    const dias = Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(de + 'T12:00:00Z')) / 86400000) + 1;
    if (dias > 366) return res.status(400).json({ erro: 'Escolha um período de no máximo 366 dias.' });

    const antAte = somaDias(de, -1);
    const antDe = somaDias(antAte, -(dias - 1));
    const PERIODO = 'p.data_criacao >= ? AND p.data_criacao < DATE_ADD(?, INTERVAL 1 DAY)';

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [linhas] = await connection.execute(`
            SELECT p.id AS pedido_id, p.status, p.forma_pagamento, p.tipo_entrega, p.taxa_entrega,
                   DATE_FORMAT(p.data_criacao, '%Y-%m-%d') AS dia, HOUR(p.data_criacao) AS hora, WEEKDAY(p.data_criacao) AS dow,
                   pr.id AS produto_id, pr.nome AS produto, c.nome AS categoria, v.sabor AS sabor,
                   ip.quantidade, ip.preco, COALESCE(v.preco_custo, pr.preco_custo, 0) AS custo
            FROM pedidos p
            JOIN itens_pedido ip ON ip.pedido_id = p.id
            JOIN produtos pr ON pr.id = ip.produto_id
            LEFT JOIN categorias c ON c.id = pr.categoria_id
            LEFT JOIN produto_variacoes v ON v.id = ip.variacao_id
            WHERE p.status <> 'cancelado' AND ${PERIODO}
        `, [de, ate]);

        const [[anterior]] = await connection.execute(`
            SELECT COUNT(DISTINCT p.id) AS pedidos,
                   COALESCE(SUM(ip.preco * ip.quantidade), 0) AS faturamento,
                   COALESCE(SUM(COALESCE(v.preco_custo, pr.preco_custo, 0) * ip.quantidade), 0) AS custo
            FROM pedidos p
            JOIN itens_pedido ip ON ip.pedido_id = p.id
            JOIN produtos pr ON pr.id = ip.produto_id
            LEFT JOIN produto_variacoes v ON v.id = ip.variacao_id
            WHERE p.status <> 'cancelado' AND ${PERIODO}
        `, [antDe, antAte]);

        const [porStatusRows] = await connection.execute(
            `SELECT p.status, COUNT(*) AS pedidos FROM pedidos p WHERE ${PERIODO} GROUP BY p.status`, [de, ate]
        );

        // ----- agregações -----
        const pedidos = new Map(), produtos = new Map(), categorias = new Map();

        for (const l of linhas) {
            const q = Number(l.quantidade) || 0;
            const fat = Number(l.preco) * q;
            const custo = Number(l.custo || 0) * q;

            let p = pedidos.get(l.pedido_id);
            if (!p) {
                p = {
                    dia: l.dia, status: l.status, forma: l.forma_pagamento || 'nao_informado', entrega: l.tipo_entrega || 'entrega',
                    taxa: Number(l.taxa_entrega || 0), hora: Number(l.hora), dow: Number(l.dow), faturamento: 0, custo: 0, itens: 0
                };
                pedidos.set(l.pedido_id, p);
            }
            p.faturamento += fat; p.custo += custo; p.itens += q;

            const kp = `${l.produto_id}|${l.sabor || ''}`;
            const pr = produtos.get(kp) || { produto: l.produto, sabor: l.sabor || null, quantidade: 0, faturamento: 0, lucro: 0 };
            pr.quantidade += q; pr.faturamento += fat; pr.lucro += fat - custo; produtos.set(kp, pr);

            const nc = l.categoria || 'Sem categoria';
            const ca = categorias.get(nc) || { categoria: nc, quantidade: 0, faturamento: 0, lucro: 0 };
            ca.quantidade += q; ca.faturamento += fat; ca.lucro += fat - custo; categorias.set(nc, ca);
        }

        const agrupar = (chaveFn, extra = () => ({})) => {
            const m = new Map();
            for (const p of pedidos.values()) {
                const k = chaveFn(p);
                const a = m.get(k) || { chave: k, pedidos: 0, faturamento: 0, lucro: 0, ...extra() };
                a.pedidos += 1; a.faturamento += p.faturamento; a.lucro += p.faturamento - p.custo;
                m.set(k, a);
            }
            return m;
        };
        const arred = a => ({ ...a, faturamento: r2(a.faturamento), lucro: r2(a.lucro) });

        const porDia = Array.from(agrupar(p => p.dia).values()).sort((a, b) => a.chave.localeCompare(b.chave)).map(a => ({ dia: a.chave, pedidos: a.pedidos, faturamento: r2(a.faturamento), lucro: r2(a.lucro) }));
        const porForma = Array.from(agrupar(p => p.forma).values()).sort((a, b) => b.faturamento - a.faturamento).map(arred);
        const porEntrega = Array.from(agrupar(p => p.entrega).values()).sort((a, b) => b.faturamento - a.faturamento).map(arred);

        const porDiaSemana = Array.from({ length: 7 }, (_, i) => ({ dow: i, pedidos: 0, faturamento: 0 }));
        const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, pedidos: 0 }));
        let faturamento = 0, custo = 0, itens = 0, taxas = 0, aReceber = 0, recebido = 0;

        for (const p of pedidos.values()) {
            faturamento += p.faturamento; custo += p.custo; itens += p.itens; taxas += p.taxa;
            if (p.status === 'pendente') aReceber += p.faturamento; else recebido += p.faturamento;
            if (porDiaSemana[p.dow]) { porDiaSemana[p.dow].pedidos++; porDiaSemana[p.dow].faturamento += p.faturamento; }
            if (porHora[p.hora]) porHora[p.hora].pedidos++;
        }

        const totalPedidos = pedidos.size;
        const lucro = faturamento - custo;
        const statusContagem = Object.fromEntries(porStatusRows.map(r => [r.status, Number(r.pedidos)]));

        const topProdutos = Array.from(produtos.values())
            .sort((a, b) => b.faturamento - a.faturamento || b.quantidade - a.quantidade)
            .slice(0, 15)
            .map(p => ({ ...p, faturamento: r2(p.faturamento), lucro: r2(p.lucro) }));
        const porCategoria = Array.from(categorias.values()).sort((a, b) => b.faturamento - a.faturamento).map(arred);

        // ----- estoque (situação atual, não depende do período) -----
        const [simples] = await connection.execute(
            `SELECT id, nome, estoque, preco, preco_custo FROM produtos WHERE COALESCE(possui_variacoes, 0) = 0`
        );
        const [sabores] = await connection.execute(
            `SELECT v.id, pr.nome, v.sabor, v.estoque, v.preco, v.preco_custo
             FROM produto_variacoes v JOIN produtos pr ON pr.id = v.produto_id WHERE pr.possui_variacoes = 1`
        );

        const todosEstoque = [
            ...simples.map(p => ({ nome: p.nome, sabor: null, estoque: Number(p.estoque) || 0, preco: Number(p.preco) || 0, custo: Number(p.preco_custo) || 0 })),
            ...sabores.map(v => ({ nome: v.nome, sabor: v.sabor, estoque: Number(v.estoque) || 0, preco: Number(v.preco) || 0, custo: Number(v.preco_custo) || 0 }))
        ];
        const estoqueResumo = {
            itens_cadastrados: todosEstoque.length,
            unidades: todosEstoque.reduce((s, i) => s + Math.max(0, i.estoque), 0),
            valor_custo: r2(todosEstoque.reduce((s, i) => s + Math.max(0, i.estoque) * i.custo, 0)),
            valor_venda: r2(todosEstoque.reduce((s, i) => s + Math.max(0, i.estoque) * i.preco, 0)),
            esgotados: todosEstoque.filter(i => i.estoque <= 0).length,
            baixos: todosEstoque.filter(i => i.estoque > 0 && i.estoque <= LIMITE_ESTOQUE_BAIXO).length
        };
        const estoqueBaixo = todosEstoque
            .filter(i => i.estoque <= LIMITE_ESTOQUE_BAIXO)
            .sort((a, b) => a.estoque - b.estoque || a.nome.localeCompare(b.nome))
            .slice(0, 50)
            .map(i => ({ nome: i.nome, sabor: i.sabor, estoque: i.estoque, nivel: i.estoque <= 0 ? 'esgotado' : 'baixo' }));

        res.json({
            periodo: { de, ate, dias, anterior_de: antDe, anterior_ate: antAte },
            kpis: {
                pedidos: totalPedidos,
                faturamento: r2(faturamento),
                custo: r2(custo),
                lucro: r2(lucro),
                margem: faturamento > 0 ? r2((lucro / faturamento) * 100) : 0,
                ticket_medio: totalPedidos ? r2(faturamento / totalPedidos) : 0,
                itens_vendidos: itens,
                taxas_entrega: r2(taxas),
                recebido: r2(recebido),
                a_receber: r2(aReceber),
                cancelados: statusContagem.cancelado || 0
            },
            anterior: {
                pedidos: Number(anterior.pedidos) || 0,
                faturamento: r2(anterior.faturamento),
                lucro: r2(Number(anterior.faturamento) - Number(anterior.custo)),
                ticket_medio: Number(anterior.pedidos) ? r2(Number(anterior.faturamento) / Number(anterior.pedidos)) : 0
            },
            por_dia: porDia,
            por_forma_pagamento: porForma,
            por_tipo_entrega: porEntrega,
            por_status: statusContagem,
            por_dia_semana: porDiaSemana.map(d => ({ ...d, faturamento: r2(d.faturamento) })),
            por_hora: porHora,
            por_categoria: porCategoria,
            top_produtos: topProdutos,
            estoque: { limite: LIMITE_ESTOQUE_BAIXO, resumo: estoqueResumo, baixo: estoqueBaixo }
        });
    } catch (erro) {
        console.error('Erro ao gerar estatísticas:', erro);
        res.status(500).json({ erro: 'Erro ao gerar estatísticas.' });
    } finally {
        if (connection) await connection.end();
    }
});

// Cria a coluna 'ordem' automaticamente (uma única vez) mantendo a ordem atual (por id)
async function garantirColunaOrdem() {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [[{ existe }]] = await connection.execute(
            `SELECT COUNT(*) AS existe FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produtos' AND COLUMN_NAME = 'ordem'`
        );

        if (!existe) {
            await connection.execute('ALTER TABLE produtos ADD COLUMN ordem INT NOT NULL DEFAULT 0');
            await connection.execute('UPDATE produtos SET ordem = id');
            console.log('[migração] Coluna produtos.ordem criada.');
        }
    } catch (erro) {
        console.error('[migração] Não foi possível garantir a coluna produtos.ordem:', erro.message);
    } finally {
        if (connection) await connection.end();
    }
}

// Cria a coluna 'eh_gelo_cubo' automaticamente (uma única vez). Sem ela as listagens de produtos não funcionam,
// então, se não for possível criá-la, o servidor avisa claramente e não inicia.
async function garantirColunaGeloCubo() {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [[{ existe }]] = await connection.execute(
            `SELECT COUNT(*) AS existe FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produtos' AND COLUMN_NAME = 'eh_gelo_cubo'`
        );

        if (!existe) {
            await connection.execute('ALTER TABLE produtos ADD COLUMN eh_gelo_cubo TINYINT(1) NOT NULL DEFAULT 0');
            console.log('[migração] Coluna produtos.eh_gelo_cubo criada.');
        }
    } catch (erro) {
        console.error('[migração] Não foi possível criar a coluna produtos.eh_gelo_cubo:', erro.message);
        console.error('Crie manualmente no MySQL: ALTER TABLE produtos ADD COLUMN eh_gelo_cubo TINYINT(1) NOT NULL DEFAULT 0;');
        process.exit(1);
    } finally {
        if (connection) await connection.end();
    }
}

const PORTA = Number(process.env.PORT || 3000);

garantirColunaOrdem().then(garantirColunaGeloCubo).finally(() => {
    app.listen(PORTA, '0.0.0.0', () => {
        console.log(`Servidor rodando na porta ${PORTA} 🚀`);
    });
});
