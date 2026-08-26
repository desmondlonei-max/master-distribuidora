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

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

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

app.get('/produtos', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id, nome, categoria_id, marca, preco, preco_atacado, preco_custo, volume, teor_alcoolico, estoque, imagem, descricao, status, destaque, sabores, eh_gelo_especial, preco_especial FROM produtos');
        await connection.end();
        res.json(rows);
    } catch (erro) {
        console.error('Erro ao buscar produtos:', erro);
        res.status(500).json({ erro: 'Erro interno ao buscar produtos.' });
    }
});

app.get('/produtos-destaque', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT * FROM produtos WHERE destaque = 1 LIMIT 2');
        await connection.end();
        res.json(rows);
    } catch (erro) {
        console.error('Erro ao buscar produtos em destaque:', erro);
        res.status(500).json({ erro: 'Erro interno ao buscar destaques.' });
    }
});

app.post('/produtos', autenticarAdmin, async (req, res) => {
    const { nome, categoria_id, marca, preco, preco_atacado, preco_custo, volume, teor_alcoolico, estoque, imagem, descricao, status, destaque, sabores, eh_gelo_especial, preco_especial } = req.body;
    const isDestaque = destaque ? 1 : 0;
    const isGeloEspecial = eh_gelo_especial ? 1 : 0;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = `
            INSERT INTO produtos (nome, categoria_id, marca, preco, preco_atacado, preco_custo, volume, teor_alcoolico, estoque, imagem, descricao, status, destaque, sabores, eh_gelo_especial, preco_especial) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            preco_especial || 0
        ]);
        await connection.end();
        res.status(201).json({ sucesso: true, mensagem: 'Produto cadastrado com sucesso!' });
    } catch (erro) {
        console.error('Erro ao cadastrar produto:', erro);
        res.status(500).json({ erro: 'Erro ao cadastrar produto.' });
    }
});

app.put('/produtos/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const { nome, categoria_id, marca, preco, preco_atacado, preco_custo, volume, teor_alcoolico, estoque, imagem, descricao, status, destaque, sabores, eh_gelo_especial, preco_especial } = req.body;
    const isDestaque = destaque ? 1 : 0;
    const isGeloEspecial = eh_gelo_especial ? 1 : 0;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = `
            UPDATE produtos 
            SET nome = ?, categoria_id = ?, marca = ?, preco = ?, preco_atacado = ?, preco_custo = ?, volume = ?, teor_alcoolico = ?, estoque = ?, imagem = ?, descricao = ?, status = ?, destaque = ?, sabores = ?, eh_gelo_especial = ?, preco_especial = ?
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
            preco_especial || 0,
            id
        ]);
        await connection.end();
        res.json({ sucesso: true, mensagem: 'Produto atualizado com sucesso!' });
    } catch (erro) {
        console.error('Erro ao atualizar produto:', erro);
        res.status(500).json({ erro: 'Erro ao atualizar produto.' });
    }
});

app.delete('/produtos/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM produtos WHERE id = ?', [id]);
        await connection.end();
        res.json({ sucesso: true, mensagem: 'Produto excluído com sucesso!' });
    } catch (erro) {
        console.error('Erro ao excluir produto:', erro);
        res.status(500).json({ erro: 'Erro ao excluir produto.' });
    }
});

// ==========================================
// ROTAS DE PEDIDOS E RELATÓRIO
// ==========================================

app.get('/pedidos', autenticarAdmin, async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [pedidos] = await connection.execute(`SELECT id, nome_cliente, telefone, endereco, valor_total, status FROM pedidos ORDER BY id DESC`);

        const pedidosComItens = [];
        for (let ped of pedidos) {
            const [itens] = await connection.execute(`
                SELECT ip.quantidade, COALESCE(ip.preco, ip.preco_unitario) AS preco, p.nome, p.sabores 
                FROM itens_pedido ip 
                INNER JOIN produtos p ON ip.produto_id = p.id 
                WHERE ip.pedido_id = ?
            `, [ped.id]);

            pedidosComItens.push({ ...ped, itens });
        }

        await connection.end();
        res.json(pedidosComItens);
    } catch (erro) {
        console.error('Erro ao buscar pedidos:', erro);
        res.status(500).json({ erro: 'Erro interno ao buscar pedidos.' });
    }
});

app.post('/pedidos', async (req, res) => {
    const { nome_cliente, telefone, endereco, itens } = req.body;
    if (!itens || itens.length === 0) return res.status(400).json({ erro: 'O carrinho está vazio.' });

    const connection = await mysql.createConnection(dbConfig);
    try {
        await connection.beginTransaction();

        let subtotalVarejo = 0;
        const produtosDoPedido = [];

        for (let item of itens) {
            const [rows] = await connection.execute(
                'SELECT id, estoque, nome, preco, preco_atacado, eh_gelo_especial, preco_especial FROM produtos WHERE id = ?', 
                [item.id]
            );
            if (rows.length === 0) throw new Error(`Produto ID ${item.id} não encontrado.`);
            
            const produtoDb = rows[0];
            
            if (produtoDb.estoque < item.quantidade) {
                throw new Error(`Estoque insuficiente para "${produtoDb.nome}". Disponível: ${produtoDb.estoque}`);
            }

            // Define o preço base do item (dando prioridade ao preço especial caso seja gelo especial)
            let precoBaseItem = Number(produtoDb.preco);
            if (produtoDb.eh_gelo_especial && produtoDb.preco_especial && Number(produtoDb.preco_especial) > 0) {
                precoBaseItem = Number(produtoDb.preco_especial);
            }

            subtotalVarejo += precoBaseItem * item.quantidade;

            produtosDoPedido.push({
                id: produtoDb.id,
                quantidade: item.quantidade,
                preco_base: precoBaseItem,
                preco_atacado: produtoDb.preco_atacado ? Number(produtoDb.preco_atacado) : 0,
                eh_gelo: produtoDb.eh_gelo_especial
            });
        }

        const atingiuAtacado = subtotalVarejo > 250;
        let novoValorTotalCalculado = 0;
        const itensValidados = [];

        for (let prod of produtosDoPedido) {
            let precoFinalItem = prod.preco_base;

            // Se atingiu atacado e o produto tem preço de atacado válido E NÃO É gelo especial (gelo especial geralmente não acumula atacado, ajuste se necessário)
            if (atingiuAtacado && prod.preco_atacado > 0 && !prod.eh_gelo) {
                precoFinalItem = prod.preco_atacado;
            }

            itensValidados.push({
                id: prod.id,
                quantidade: prod.quantidade,
                preco: precoFinalItem
            });

            novoValorTotalCalculado += precoFinalItem * prod.quantidade;
        }

        const [resultadoPedido] = await connection.execute(
            'INSERT INTO pedidos (nome_cliente, telefone, endereco, valor_total, status) VALUES (?, ?, ?, ?, ?)',
            [nome_cliente, telefone, endereco, novoValorTotalCalculado, 'pendente']
        );
        const pedidoId = resultadoPedido.insertId;

        for (let item of itensValidados) {
            await connection.execute(
                'INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco, preco_unitario) VALUES (?, ?, ?, ?, ?)',
                [pedidoId, item.id, item.quantidade, item.preco, item.preco]
            );
        }

        await connection.commit();
        await connection.end();
        res.status(201).json({ sucesso: true, mensagem: 'Pedido realizado com sucesso!', chave_pix: 'masterdistribuidoracm@gmail.com' });
    } catch (erro) {
        await connection.rollback();
        await connection.end();
        res.status(400).json({ erro: erro.message || 'Erro ao processar o pedido.' });
    }
});

app.put('/pedidos/:id/status', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; 

    const connection = await mysql.createConnection(dbConfig);
    try {
        await connection.beginTransaction();

        const [pedidoRows] = await connection.execute('SELECT status FROM pedidos WHERE id = ?', [id]);
        if (pedidoRows.length === 0) throw new Error('Pedido não encontrado.');
        const statusAnterior = pedidoRows[0].status;

        await connection.execute('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);

        if (status === 'pago' && statusAnterior !== 'pago') {
            const [itens] = await connection.execute('SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = ?', [id]);
            for (let item of itens) {
                await connection.execute('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [item.quantidade, item.produto_id]);
            }
        } else if (status === 'cancelado' && statusAnterior === 'pago') {
            const [itens] = await connection.execute('SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = ?', [id]);
            for (let item of itens) {
                await connection.execute('UPDATE produtos SET estoque = estoque + ? WHERE id = ?', [item.quantidade, item.produto_id]);
            }
        }

        await connection.commit();
        await connection.end();
        res.json({ sucesso: true, mensagem: 'Status atualizado com sucesso!' });
    } catch (erro) {
        await connection.rollback();
        await connection.end();
        console.error('Erro ao atualizar status:', erro);
        res.status(500).json({ erro: erro.message || 'Erro ao atualizar o status.' });
    }
});

app.delete('/pedidos/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM pedidos WHERE id = ?', [id]);
        await connection.end();
        res.json({ sucesso: true, mensagem: 'Pedido excluído com sucesso!' });
    } catch (erro) {
        console.error('Erro ao excluir pedido:', erro);
        res.status(500).json({ erro: 'Erro ao excluir pedido.' });
    }
});

app.get('/relatorio-semanal', autenticarAdmin, async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = `
            SELECT p.id AS pedido_id, ip.quantidade, ip.preco AS preco_venda, pr.preco_custo
            FROM pedidos p
            JOIN itens_pedido ip ON p.id = ip.pedido_id
            JOIN produtos pr ON ip.produto_id = pr.id
            WHERE p.status != 'cancelado' AND YEARWEEK(p.data_criacao, 0) = YEARWEEK(CURDATE(), 0)
        `;
        const [rows] = await connection.execute(query);
        await connection.end();

        let faturamentoTotal = 0;
        let custoTotal = 0;
        const pedidosSemana = new Set();

        rows.forEach(row => {
            pedidosSemana.add(row.pedido_id);
            faturamentoTotal += Number(row.preco_venda) * row.quantidade;
            custoTotal += Number(row.preco_custo || 0) * row.quantidade;
        });

        res.json({ total_pedidos: pedidosSemana.size, faturamento: faturamentoTotal, lucro: faturamentoTotal - custoTotal });
    } catch (erro) {
        console.error('Erro ao gerar relatório:', erro);
        res.status(500).json({ erro: 'Erro ao gerar relatório.' });
    }
});

const PORTA = Number(process.env.PORT || 3000);
app.listen(PORTA, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORTA} 🚀`);
});
