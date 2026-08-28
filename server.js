require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURAÇÕES
// ============================================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos do site
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// BANCO DE DADOS
// ============================================================

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'adega_db',

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,

    ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined
});

// ============================================================
// TESTE DO BANCO
// ============================================================

async function testarBanco() {
    try {
        const conexao = await pool.getConnection();

        await conexao.query('SELECT 1');

        conexao.release();

        console.log('✅ MySQL conectado com sucesso!');
    } catch (erro) {
        console.error('❌ Erro ao conectar no MySQL:');
        console.error(erro.message);
    }
}

testarBanco();

// ============================================================
// AUTENTICAÇÃO ADMIN
// ============================================================

const ADMIN_SECRET =
    process.env.ADMIN_SECRET ||
    crypto.randomBytes(32).toString('hex');

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || '';

const tokensAdmin = new Set();

function autenticarAdmin(req, res, next) {
    const header = req.headers.authorization || '';

    if (!header.startsWith('Bearer ')) {
        return res.status(401).json({
            erro: 'Não autorizado.'
        });
    }

    const token = header.substring(7);

    if (!tokensAdmin.has(token)) {
        return res.status(401).json({
            erro: 'Sessão administrativa inválida ou expirada.'
        });
    }

    next();
}

// ============================================================
// LOGIN ADMIN
// ============================================================

app.post('/admin/login', (req, res) => {
    const { senha } = req.body;

    if (!ADMIN_PASSWORD) {
        return res.status(500).json({
            erro: 'ADMIN_PASSWORD não configurada no servidor.'
        });
    }

    if (senha !== ADMIN_PASSWORD) {
        return res.status(401).json({
            erro: 'Senha incorreta!'
        });
    }

    const token = crypto
        .createHmac('sha256', ADMIN_SECRET)
        .update(Date.now().toString() + Math.random().toString())
        .digest('hex');

    tokensAdmin.add(token);

    return res.json({
        sucesso: true,
        token
    });
});

// ============================================================
// PRODUTOS
// ============================================================

// ------------------------------------------------------------
// GET /produtos
// ------------------------------------------------------------

app.get('/produtos', async (req, res) => {
    try {
        const [produtos] = await pool.query(`
            SELECT
                p.id,
                p.categoria_id,
                p.nome,
                p.descricao,
                p.marca,
                p.volume,
                p.teor_alcoolico,
                p.preco,
                p.preco_promocional,
                p.preco_custo,
                p.preco_atacado,
                p.estoque,
                p.status,
                p.imagem,
                p.destaque,
                p.eh_gelo_especial,
                p.preco_especial,
                p.criado_em
            FROM produtos p
            ORDER BY p.id DESC
        `);

        // ----------------------------------------------------
        // Novo sistema de sabores
        //
        // O produto pode possuir um catálogo de sabores.
        // Como a tabela produtos não possui catalogo_id,
        // relacionamos pelo nome do produto.
        //
        // Exemplo:
        // Produto: Jack Daniel's
        // Catálogo: Jack Daniel's
        //
        // Sabores:
        // Apple
        // Honey
        // Fire
        // ----------------------------------------------------

        for (const produto of produtos) {
            const [catalogos] = await pool.query(`
                SELECT id, nome, marca, descricao, imagem
                FROM catalogos_sabores
                WHERE nome = ?
                LIMIT 1
            `, [produto.nome]);

            if (catalogos.length > 0) {
                const catalogo = catalogos[0];

                const [sabores] = await pool.query(`
                    SELECT
                        id,
                        catalogo_id,
                        nome,
                        preco,
                        preco_custo,
                        preco_atacado,
                        estoque,
                        status,
                        imagem,
                        descricao
                    FROM sabores
                    WHERE catalogo_id = ?
                    ORDER BY id ASC
                `, [catalogo.id]);

                produto.catalogo_id = catalogo.id;
                produto.sabores = sabores;
            } else {
                produto.catalogo_id = null;
                produto.sabores = [];
            }
        }

        res.json(produtos);

    } catch (erro) {
        console.error('Erro ao buscar produtos:', erro);

        res.status(500).json({
            erro: 'Erro ao buscar produtos.'
        });
    }
});

// ------------------------------------------------------------
// GET /produtos/destaques
// ------------------------------------------------------------

app.get('/produtos/destaques', async (req, res) => {
    try {
        const [produtos] = await pool.query(`
            SELECT *
            FROM produtos
            WHERE destaque = 1
            ORDER BY id DESC
        `);

        res.json(produtos);

    } catch (erro) {
        console.error('Erro ao buscar destaques:', erro);

        res.status(500).json({
            erro: 'Erro ao buscar produtos em destaque.'
        });
    }
});

// ------------------------------------------------------------
// GET /produtos/:id
// ------------------------------------------------------------

app.get('/produtos/:id', async (req, res) => {
    try {
        const [produtos] = await pool.query(`
            SELECT *
            FROM produtos
            WHERE id = ?
            LIMIT 1
        `, [req.params.id]);

        if (produtos.length === 0) {
            return res.status(404).json({
                erro: 'Produto não encontrado.'
            });
        }

        const produto = produtos[0];

        const [catalogos] = await pool.query(`
            SELECT *
            FROM catalogos_sabores
            WHERE nome = ?
            LIMIT 1
        `, [produto.nome]);

        if (catalogos.length > 0) {
            const catalogo = catalogos[0];

            const [sabores] = await pool.query(`
                SELECT *
                FROM sabores
                WHERE catalogo_id = ?
                ORDER BY id ASC
            `, [catalogo.id]);

            produto.catalogo_id = catalogo.id;
            produto.sabores = sabores;
        } else {
            produto.catalogo_id = null;
            produto.sabores = [];
        }

        res.json(produto);

    } catch (erro) {
        console.error('Erro ao buscar produto:', erro);

        res.status(500).json({
            erro: 'Erro ao buscar produto.'
        });
    }
});

// ============================================================
// CRIAR PRODUTO
// ============================================================

app.post('/produtos', autenticarAdmin, async (req, res) => {
    const conexao = await pool.getConnection();

    try {
        await conexao.beginTransaction();

        const {
            nome,
            descricao,
            marca,
            volume,
            teor_alcoolico,
            preco,
            preco_promocional,
            preco_custo,
            preco_atacado,
            estoque,
            status,
            imagem,
            destaque,
            eh_gelo_especial,
            preco_especial,
            categoria_id,
            sabores
        } = req.body;

        if (!nome) {
            await conexao.rollback();

            return res.status(400).json({
                erro: 'Nome do produto é obrigatório.'
            });
        }

        if (!categoria_id) {
            await conexao.rollback();

            return res.status(400).json({
                erro: 'Categoria é obrigatória.'
            });
        }

        // ----------------------------------------------------
        // Produto
        // ----------------------------------------------------

        const [resultado] = await conexao.query(`
            INSERT INTO produtos (
                categoria_id,
                nome,
                descricao,
                marca,
                volume,
                teor_alcoolico,
                preco,
                preco_promocional,
                preco_custo,
                preco_atacado,
                estoque,
                status,
                imagem,
                destaque,
                eh_gelo_especial,
                preco_especial
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            categoria_id,
            nome,
            descricao || null,
            marca || null,
            volume || null,
            teor_alcoolico || 0,
            preco || 0,
            preco_promocional || null,
            preco_custo || 0,
            preco_atacado || 0,
            estoque || 0,
            status || 'disponivel',
            imagem || null,
            destaque ? 1 : 0,
            eh_gelo_especial ? 1 : 0,
            preco_especial || 0
        ]);

        // ----------------------------------------------------
        // SABORES
        // ----------------------------------------------------

        await salvarSabores(
            conexao,
            nome,
            marca,
            sabores
        );

        await conexao.commit();

        res.status(201).json({
            sucesso: true,
            id: resultado.insertId,
            mensagem: 'Produto salvo com sucesso!'
        });

    } catch (erro) {
        await conexao.rollback();

        console.error('Erro ao criar produto:', erro);

        res.status(500).json({
            erro: 'Erro ao criar produto.',
            detalhe: erro.message
        });

    } finally {
        conexao.release();
    }
});

// ============================================================
// EDITAR PRODUTO
// ============================================================

app.put('/produtos/:id', autenticarAdmin, async (req, res) => {
    const conexao = await pool.getConnection();

    try {
        await conexao.beginTransaction();

        const id = req.params.id;

        const {
            nome,
            descricao,
            marca,
            volume,
            teor_alcoolico,
            preco,
            preco_promocional,
            preco_custo,
            preco_atacado,
            estoque,
            status,
            imagem,
            destaque,
            eh_gelo_especial,
            preco_especial,
            categoria_id,
            sabores
        } = req.body;

        if (!nome) {
            await conexao.rollback();

            return res.status(400).json({
                erro: 'Nome do produto é obrigatório.'
            });
        }

        // ----------------------------------------------------
        // Verifica produto
        // ----------------------------------------------------

        const [produtoExistente] = await conexao.query(`
            SELECT *
            FROM produtos
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (produtoExistente.length === 0) {
            await conexao.rollback();

            return res.status(404).json({
                erro: 'Produto não encontrado.'
            });
        }

        const nomeAntigo = produtoExistente[0].nome;

        // ----------------------------------------------------
        // Atualiza produto
        // ----------------------------------------------------

        await conexao.query(`
            UPDATE produtos
            SET
                categoria_id = ?,
                nome = ?,
                descricao = ?,
                marca = ?,
                volume = ?,
                teor_alcoolico = ?,
                preco = ?,
                preco_promocional = ?,
                preco_custo = ?,
                preco_atacado = ?,
                estoque = ?,
                status = ?,
                imagem = ?,
                destaque = ?,
                eh_gelo_especial = ?,
                preco_especial = ?
            WHERE id = ?
        `, [
            categoria_id || produtoExistente[0].categoria_id,
            nome,
            descricao || null,
            marca || null,
            volume || null,
            teor_alcoolico || 0,
            preco || 0,
            preco_promocional || null,
            preco_custo || 0,
            preco_atacado || 0,
            estoque || 0,
            status || 'disponivel',
            imagem || null,
            destaque ? 1 : 0,
            eh_gelo_especial ? 1 : 0,
            preco_especial || 0,
            id
        ]);

        // ----------------------------------------------------
        // Se o nome mudou, renomeia o catálogo correspondente
        // ----------------------------------------------------

        if (nomeAntigo !== nome) {
            await conexao.query(`
                UPDATE catalogos_sabores
                SET nome = ?
                WHERE nome = ?
            `, [nome, nomeAntigo]);
        }

        // ----------------------------------------------------
        // Atualiza sabores
        // ----------------------------------------------------

        await salvarSabores(
            conexao,
            nome,
            marca,
            sabores
        );

        await conexao.commit();

        res.json({
            sucesso: true,
            mensagem: 'Produto atualizado com sucesso!'
        });

    } catch (erro) {
        await conexao.rollback();

        console.error('Erro ao atualizar produto:', erro);

        res.status(500).json({
            erro: 'Erro ao atualizar produto.',
            detalhe: erro.message
        });

    } finally {
        conexao.release();
    }
});

// ============================================================
// EXCLUIR PRODUTO
// ============================================================

app.delete('/produtos/:id', autenticarAdmin, async (req, res) => {
    const conexao = await pool.getConnection();

    try {
        await conexao.beginTransaction();

        const id = req.params.id;

        const [produtos] = await conexao.query(`
            SELECT nome
            FROM produtos
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (produtos.length === 0) {
            await conexao.rollback();

            return res.status(404).json({
                erro: 'Produto não encontrado.'
            });
        }

        const nomeProduto = produtos[0].nome;

        // ----------------------------------------------------
        // Primeiro remove catálogo/sabores
        // ----------------------------------------------------

        const [catalogos] = await conexao.query(`
            SELECT id
            FROM catalogos_sabores
            WHERE nome = ?
        `, [nomeProduto]);

        for (const catalogo of catalogos) {
            await conexao.query(`
                DELETE FROM sabores
                WHERE catalogo_id = ?
            `, [catalogo.id]);

            await conexao.query(`
                DELETE FROM catalogos_sabores
                WHERE id = ?
            `, [catalogo.id]);
        }

        // ----------------------------------------------------
        // Depois remove produto
        // ----------------------------------------------------

        await conexao.query(`
            DELETE FROM produtos
            WHERE id = ?
        `, [id]);

        await conexao.commit();

        res.json({
            sucesso: true,
            mensagem: 'Produto excluído com sucesso!'
        });

    } catch (erro) {
        await conexao.rollback();

        console.error('Erro ao excluir produto:', erro);

        res.status(500).json({
            erro: 'Erro ao excluir produto.',
            detalhe: erro.message
        });

    } finally {
        conexao.release();
    }
});

// ============================================================
// FUNÇÃO DO NOVO SISTEMA DE SABORES
// ============================================================

async function salvarSabores(
    conexao,
    nomeProduto,
    marca,
    saboresRecebidos
) {
    // --------------------------------------------------------
    // Se não existem sabores:
    // remove catálogo existente e encerra.
    // --------------------------------------------------------

    if (
        !saboresRecebidos ||
        (
            typeof saboresRecebidos === 'string' &&
            saboresRecebidos.trim() === ''
        )
    ) {
        const [catalogos] = await conexao.query(`
            SELECT id
            FROM catalogos_sabores
            WHERE nome = ?
        `, [nomeProduto]);

        for (const catalogo of catalogos) {
            await conexao.query(`
                DELETE FROM sabores
                WHERE catalogo_id = ?
            `, [catalogo.id]);

            await conexao.query(`
                DELETE FROM catalogos_sabores
                WHERE id = ?
            `, [catalogo.id]);
        }

        return;
    }

    // --------------------------------------------------------
    // Aceita:
    //
    // "Melancia, Maçã Verde, Uva"
    //
    // ou:
    //
    // ["Melancia", "Maçã Verde", "Uva"]
    // --------------------------------------------------------

    let listaSabores = [];

    if (Array.isArray(saboresRecebidos)) {
        listaSabores = saboresRecebidos;
    } else if (typeof saboresRecebidos === 'string') {
        listaSabores = saboresRecebidos
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }

    // Remove duplicados
    listaSabores = [...new Set(listaSabores)];

    // --------------------------------------------------------
    // Procura catálogo
    // --------------------------------------------------------

    const [catalogos] = await conexao.query(`
        SELECT id
        FROM catalogos_sabores
        WHERE nome = ?
        LIMIT 1
    `, [nomeProduto]);

    let catalogoId;

    if (catalogos.length > 0) {
        catalogoId = catalogos[0].id;

        await conexao.query(`
            UPDATE catalogos_sabores
            SET marca = ?
            WHERE id = ?
        `, [
            marca || null,
            catalogoId
        ]);

        // Limpa sabores antigos
        await conexao.query(`
            DELETE FROM sabores
            WHERE catalogo_id = ?
        `, [catalogoId]);

    } else {
        const [resultado] = await conexao.query(`
            INSERT INTO catalogos_sabores (
                nome,
                marca
            )
            VALUES (?, ?)
        `, [
            nomeProduto,
            marca || null
        ]);

        catalogoId = resultado.insertId;
    }

    // --------------------------------------------------------
    // Cria os novos sabores
    // --------------------------------------------------------

    for (const nomeSabor of listaSabores) {
        await conexao.query(`
            INSERT INTO sabores (
                catalogo_id,
                nome,
                preco,
                preco_custo,
                preco_atacado,
                estoque,
                status,
                imagem,
                descricao
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            catalogoId,
            nomeSabor,
            0,
            0,
            0,
            0,
            'disponivel',
            null,
            null
        ]);
    }
}

// ============================================================
// CATÁLOGOS DE SABORES
// ============================================================

// ------------------------------------------------------------
// GET /catalogos-sabores
// ------------------------------------------------------------

app.get('/catalogos-sabores', async (req, res) => {
    try {
        const [catalogos] = await pool.query(`
            SELECT *
            FROM catalogos_sabores
            ORDER BY nome ASC
        `);

        for (const catalogo of catalogos) {
            const [sabores] = await pool.query(`
                SELECT *
                FROM sabores
                WHERE catalogo_id = ?
                ORDER BY nome ASC
            `, [catalogo.id]);

            catalogo.sabores = sabores;
        }

        res.json(catalogos);

    } catch (erro) {
        console.error('Erro ao buscar catálogos:', erro);

        res.status(500).json({
            erro: 'Erro ao buscar catálogos de sabores.'
        });
    }
});

// ------------------------------------------------------------
// GET /catalogos-sabores/:id
// ------------------------------------------------------------

app.get('/catalogos-sabores/:id', async (req, res) => {
    try {
        const [catalogos] = await pool.query(`
            SELECT *
            FROM catalogos_sabores
            WHERE id = ?
            LIMIT 1
        `, [req.params.id]);

        if (catalogos.length === 0) {
            return res.status(404).json({
                erro: 'Catálogo não encontrado.'
            });
        }

        const catalogo = catalogos[0];

        const [sabores] = await pool.query(`
            SELECT *
            FROM sabores
            WHERE catalogo_id = ?
            ORDER BY nome ASC
        `, [catalogo.id]);

        catalogo.sabores = sabores;

        res.json(catalogo);

    } catch (erro) {
        console.error('Erro ao buscar catálogo:', erro);

        res.status(500).json({
            erro: 'Erro ao buscar catálogo.'
        });
    }
});

// ============================================================
// PEDIDOS
// ============================================================

// ------------------------------------------------------------
// CRIAR PEDIDO
// ------------------------------------------------------------

app.post('/pedidos', async (req, res) => {
    const conexao = await pool.getConnection();

    try {
        await conexao.beginTransaction();

        const {
            nome_cliente,
            telefone,
            endereco,
            itens
        } = req.body;

        if (
            !nome_cliente ||
            !telefone ||
            !endereco ||
            !Array.isArray(itens) ||
            itens.length === 0
        ) {
            await conexao.rollback();

            return res.status(400).json({
                erro: 'Dados do pedido incompletos.'
            });
        }

        let valorTotal = 0;

        const itensProcessados = [];

        // ----------------------------------------------------
        // Processa produtos e sabores
        // ----------------------------------------------------

        for (const item of itens) {
            const quantidade = Number(item.quantidade);

            if (!quantidade || quantidade <= 0) {
                throw new Error('Quantidade inválida.');
            }

            // Produto normal
            if (item.produto_id) {
                const [produtos] = await conexao.query(`
                    SELECT *
                    FROM produtos
                    WHERE id = ?
                    LIMIT 1
                `, [item.produto_id]);

                if (produtos.length === 0) {
                    throw new Error('Produto não encontrado.');
                }

                const produto = produtos[0];

                if (produto.estoque < quantidade) {
                    throw new Error(
                        `Estoque insuficiente para ${produto.nome}.`
                    );
                }

                const preco = Number(
                    produto.preco_promocional ||
                    produto.preco
                );

                valorTotal += preco * quantidade;

                itensProcessados.push({
                    produto_id: produto.id,
                    sabor_id: null,
                    quantidade,
                    preco
                });
            }

            // Sabor
            else if (item.sabor_id) {
                const [sabores] = await conexao.query(`
                    SELECT *
                    FROM sabores
                    WHERE id = ?
                    LIMIT 1
                `, [item.sabor_id]);

                if (sabores.length === 0) {
                    throw new Error('Sabor não encontrado.');
                }

                const sabor = sabores[0];

                if (sabor.estoque < quantidade) {
                    throw new Error(
                        `Estoque insuficiente para ${sabor.nome}.`
                    );
                }

                const preco = Number(sabor.preco);

                valorTotal += preco * quantidade;

                itensProcessados.push({
                    produto_id: null,
                    sabor_id: sabor.id,
                    quantidade,
                    preco
                });
            }

            else {
                throw new Error(
                    'Item do pedido não possui produto_id nem sabor_id.'
                );
            }
        }

        // ----------------------------------------------------
        // Pedido
        // ----------------------------------------------------

        const [pedido] = await conexao.query(`
            INSERT INTO pedidos (
                nome_cliente,
                telefone,
                endereco,
                valor_total,
                status
            )
            VALUES (?, ?, ?, ?, ?)
        `, [
            nome_cliente,
            telefone,
            endereco,
            valorTotal,
            'pendente'
        ]);

        const pedidoId = pedido.insertId;

        // ----------------------------------------------------
        // Itens
        // ----------------------------------------------------

        for (const item of itensProcessados) {

            await conexao.query(`
                INSERT INTO itens_pedido (
                    pedido_id,
                    produto_id,
                    sabor_id,
                    quantidade,
                    preco
                )
                VALUES (?, ?, ?, ?, ?)
            `, [
                pedidoId,
                item.produto_id,
                item.sabor_id,
                item.quantidade,
                item.preco
            ]);

            // Atualiza estoque
            if (item.produto_id) {
                await conexao.query(`
                    UPDATE produtos
                    SET estoque = estoque - ?
                    WHERE id = ?
                `, [
                    item.quantidade,
                    item.produto_id
                ]);
            }

            if (item.sabor_id) {
                await conexao.query(`
                    UPDATE sabores
                    SET estoque = estoque - ?
                    WHERE id = ?
                `, [
                    item.quantidade,
                    item.sabor_id
                ]);
            }
        }

        await conexao.commit();

        res.status(201).json({
            sucesso: true,
            pedido_id: pedidoId,
            valor_total: valorTotal,
            mensagem: 'Pedido realizado com sucesso!'
        });

    } catch (erro) {
        await conexao.rollback();

        console.error('Erro ao criar pedido:', erro);

        res.status(400).json({
            erro: erro.message
        });

    } finally {
        conexao.release();
    }
});

// ============================================================
// LISTAR PEDIDOS - ADMIN
// ============================================================

app.get('/pedidos', autenticarAdmin, async (req, res) => {
    try {
        const [pedidos] = await pool.query(`
            SELECT *
            FROM pedidos
            ORDER BY data_criacao DESC
        `);

        for (const pedido of pedidos) {

            const [itens] = await pool.query(`
                SELECT
                    ip.id,
                    ip.quantidade,
                    ip.preco,

                    p.nome AS produto_nome,

                    s.nome AS sabor_nome,

                    cs.nome AS catalogo_nome

                FROM itens_pedido ip

                LEFT JOIN produtos p
                    ON ip.produto_id = p.id

                LEFT JOIN sabores s
                    ON ip.sabor_id = s.id

                LEFT JOIN catalogos_sabores cs
                    ON s.catalogo_id = cs.id

                WHERE ip.pedido_id = ?

                ORDER BY ip.id ASC
            `, [pedido.id]);

            pedido.itens = itens.map(item => {

                let nome = item.produto_nome;

                if (item.sabor_nome) {
                    nome = `${item.catalogo_nome} - ${item.sabor_nome}`;
                }

                return {
                    id: item.id,
                    nome,
                    quantidade: item.quantidade,
                    preco: item.preco
                };
            });
        }

        res.json(pedidos);

    } catch (erro) {
        console.error('Erro ao buscar pedidos:', erro);

        res.status(500).json({
            erro: 'Erro ao buscar pedidos.'
        });
    }
});

// ============================================================
// ALTERAR STATUS DO PEDIDO
// ============================================================

app.put('/pedidos/:id/status', autenticarAdmin, async (req, res) => {
    try {
        const { status } = req.body;

        const statusValidos = [
            'pendente',
            'pago',
            'enviado',
            'entregue',
            'cancelado'
        ];

        if (!statusValidos.includes(status)) {
            return res.status(400).json({
                erro: 'Status inválido.'
            });
        }

        const [resultado] = await pool.query(`
            UPDATE pedidos
            SET status = ?
            WHERE id = ?
        `, [
            status,
            req.params.id
        ]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: 'Pedido não encontrado.'
            });
        }

        res.json({
            sucesso: true,
            mensagem: 'Status atualizado.'
        });

    } catch (erro) {
        console.error('Erro ao atualizar status:', erro);

        res.status(500).json({
            erro: 'Erro ao atualizar status.'
        });
    }
});

// ============================================================
// EXCLUIR PEDIDO
// ============================================================

app.delete('/pedidos/:id', autenticarAdmin, async (req, res) => {
    const conexao = await pool.getConnection();

    try {
        await conexao.beginTransaction();

        const pedidoId = req.params.id;

        const [itens] = await conexao.query(`
            SELECT
                produto_id,
                sabor_id,
                quantidade
            FROM itens_pedido
            WHERE pedido_id = ?
        `, [pedidoId]);

        // ----------------------------------------------------
        // Devolve estoque antes de excluir
        // ----------------------------------------------------

        for (const item of itens) {

            if (item.produto_id) {
                await conexao.query(`
                    UPDATE produtos
                    SET estoque = estoque + ?
                    WHERE id = ?
                `, [
                    item.quantidade,
                    item.produto_id
                ]);
            }

            if (item.sabor_id) {
                await conexao.query(`
                    UPDATE sabores
                    SET estoque = estoque + ?
                    WHERE id = ?
                `, [
                    item.quantidade,
                    item.sabor_id
                ]);
            }
        }

        await conexao.query(`
            DELETE FROM itens_pedido
            WHERE pedido_id = ?
        `, [pedidoId]);

        const [resultado] = await conexao.query(`
            DELETE FROM pedidos
            WHERE id = ?
        `, [pedidoId]);

        if (resultado.affectedRows === 0) {
            await conexao.rollback();

            return res.status(404).json({
                erro: 'Pedido não encontrado.'
            });
        }

        await conexao.commit();

        res.json({
            sucesso: true,
            mensagem: 'Pedido excluído com sucesso.'
        });

    } catch (erro) {
        await conexao.rollback();

        console.error('Erro ao excluir pedido:', erro);

        res.status(500).json({
            erro: 'Erro ao excluir pedido.'
        });

    } finally {
        conexao.release();
    }
});

// ============================================================
// RELATÓRIO SEMANAL
// ============================================================

app.get('/relatorio-semanal', autenticarAdmin, async (req, res) => {
    try {

        const [resultado] = await pool.query(`
            SELECT
                COUNT(*) AS total_pedidos,
                COALESCE(SUM(valor_total), 0) AS faturamento
            FROM pedidos
            WHERE
                data_criacao >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                AND status <> 'cancelado'
        `);

        const totalPedidos =
            Number(resultado[0].total_pedidos) || 0;

        const faturamento =
            Number(resultado[0].faturamento) || 0;

        // ----------------------------------------------------
        // Calcula custo dos produtos vendidos
        // ----------------------------------------------------

        const [custos] = await pool.query(`
            SELECT
                COALESCE(
                    SUM(
                        ip.quantidade *
                        COALESCE(
                            p.preco_custo,
                            s.preco_custo,
                            0
                        )
                    ),
                    0
                ) AS custo
            FROM itens_pedido ip

            INNER JOIN pedidos pe
                ON ip.pedido_id = pe.id

            LEFT JOIN produtos p
                ON ip.produto_id = p.id

            LEFT JOIN sabores s
                ON ip.sabor_id = s.id

            WHERE
                pe.data_criacao >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                AND pe.status <> 'cancelado'
        `);

        const custo =
            Number(custos[0].custo) || 0;

        const lucro = faturamento - custo;

        res.json({
            total_pedidos: totalPedidos,
            faturamento,
            lucro
        });

    } catch (erro) {
        console.error('Erro no relatório:', erro);

        res.status(500).json({
            erro: 'Erro ao gerar relatório semanal.'
        });
    }
});

// ============================================================
// ROTA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'public', 'index.html')
    );
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
    res.status(404).json({
        erro: 'Rota não encontrada.'
    });
});

// ============================================================
// ERRO GLOBAL
// ============================================================

app.use((erro, req, res, next) => {
    console.error('Erro global:', erro);

    res.status(500).json({
        erro: 'Erro interno do servidor.'
    });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(PORT, () => {
    console.log('======================================');
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log('======================================');
});
