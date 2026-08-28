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


// ============================================================
// BANCO DE DADOS
// ============================================================

const dbConfig = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'adega_db',
    ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined
};

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SECRET = process.env.ADMIN_SECRET;


// ============================================================
// AUTENTICAÇÃO ADMIN
// ============================================================

function criarTokenAdmin() {
    const payload = Buffer.from(
        JSON.stringify({
            role: 'admin',
            exp: Date.now() + 12 * 60 * 60 * 1000
        })
    ).toString('base64url');

    const assinatura = crypto
        .createHmac('sha256', ADMIN_SECRET)
        .update(payload)
        .digest('base64url');

    return `${payload}.${assinatura}`;
}


function autenticarAdmin(req, res, next) {
    const header = req.headers.authorization || '';

    const token = header.startsWith('Bearer ')
        ? header.slice(7)
        : '';

    const partes = token.split('.');

    if (partes.length !== 2 || !ADMIN_SECRET) {
        return res.status(401).json({
            erro: 'Não autorizado.'
        });
    }

    const [payload, assinatura] = partes;

    const assinaturaEsperada = crypto
        .createHmac('sha256', ADMIN_SECRET)
        .update(payload)
        .digest('base64url');

    if (
        assinatura.length !== assinaturaEsperada.length ||
        !crypto.timingSafeEqual(
            Buffer.from(assinatura),
            Buffer.from(assinaturaEsperada)
        )
    ) {
        return res.status(401).json({
            erro: 'Token inválido.'
        });
    }

    try {
        const dados = JSON.parse(
            Buffer.from(payload, 'base64url').toString()
        );

        if (
            dados.role !== 'admin' ||
            dados.exp < Date.now()
        ) {
            return res.status(401).json({
                erro: 'Sessão expirada.'
            });
        }

    } catch {
        return res.status(401).json({
            erro: 'Token inválido.'
        });
    }

    next();
}


// ============================================================
// LOGIN
// ============================================================

app.post('/admin/login', (req, res) => {

    const { senha } = req.body || {};

    if (!ADMIN_PASSWORD || senha !== ADMIN_PASSWORD) {
        return res.status(401).json({
            erro: 'Senha incorreta!'
        });
    }

    res.json({
        token: criarTokenAdmin()
    });
});


// ============================================================
// CATEGORIAS
// ============================================================

app.get('/categorias', async (req, res) => {

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(`
            SELECT
                id,
                nome,
                slug
            FROM categorias
            ORDER BY nome ASC
        `);

        res.json(rows);

    } catch (erro) {

        console.error('Erro ao buscar categorias:', erro);

        res.status(500).json({
            erro: 'Erro ao buscar categorias.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// PRODUTOS
// ============================================================

app.get('/produtos', async (req, res) => {

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(`
            SELECT
                p.id,
                p.categoria_id,
                c.nome AS categoria,
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
            LEFT JOIN categorias c
                ON p.categoria_id = c.id
            ORDER BY p.id DESC
        `);

        res.json(rows);

    } catch (erro) {

        console.error('Erro ao buscar produtos:', erro);

        res.status(500).json({
            erro: 'Erro interno ao buscar produtos.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// PRODUTOS EM DESTAQUE
// ============================================================

app.get('/produtos-destaque', async (req, res) => {

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(`
            SELECT
                p.id,
                p.categoria_id,
                c.nome AS categoria,
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
                p.preco_especial
            FROM produtos p
            LEFT JOIN categorias c
                ON p.categoria_id = c.id
            WHERE p.destaque = 1
            ORDER BY p.id DESC
            LIMIT 2
        `);

        res.json(rows);

    } catch (erro) {

        console.error('Erro ao buscar destaques:', erro);

        res.status(500).json({
            erro: 'Erro ao buscar destaques.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// CADASTRAR PRODUTO
// ============================================================

app.post('/produtos', autenticarAdmin, async (req, res) => {

    const {
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
    } = req.body;

    if (!nome || preco === undefined) {
        return res.status(400).json({
            erro: 'Nome e preço são obrigatórios.'
        });
    }

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [resultado] = await connection.execute(`
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
            categoria_id || 1,
            nome,
            descricao || null,
            marca || null,
            volume || null,
            Number(teor_alcoolico) || 0,
            Number(preco) || 0,
            preco_promocional !== undefined && preco_promocional !== null && preco_promocional !== ''
                ? Number(preco_promocional)
                : null,
            Number(preco_custo) || 0,
            Number(preco_atacado) || 0,
            Number(estoque) || 0,
            status || 'disponivel',
            imagem || null,
            destaque ? 1 : 0,
            eh_gelo_especial ? 1 : 0,
            Number(preco_especial) || 0
        ]);

        res.status(201).json({
            sucesso: true,
            id: resultado.insertId,
            mensagem: 'Produto cadastrado com sucesso!'
        });

    } catch (erro) {

        console.error('Erro ao cadastrar produto:', erro);

        res.status(500).json({
            erro: 'Erro ao cadastrar produto.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// EDITAR PRODUTO
// ============================================================

app.put('/produtos/:id', autenticarAdmin, async (req, res) => {

    const { id } = req.params;

    const {
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
    } = req.body;

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [resultado] = await connection.execute(`
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
            categoria_id || 1,
            nome,
            descricao || null,
            marca || null,
            volume || null,
            Number(teor_alcoolico) || 0,
            Number(preco) || 0,
            preco_promocional !== undefined && preco_promocional !== null && preco_promocional !== ''
                ? Number(preco_promocional)
                : null,
            Number(preco_custo) || 0,
            Number(preco_atacado) || 0,
            Number(estoque) || 0,
            status || 'disponivel',
            imagem || null,
            destaque ? 1 : 0,
            eh_gelo_especial ? 1 : 0,
            Number(preco_especial) || 0,
            id
        ]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: 'Produto não encontrado.'
            });
        }

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

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// EXCLUIR PRODUTO
// ============================================================

app.delete('/produtos/:id', autenticarAdmin, async (req, res) => {

    const { id } = req.params;

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [resultado] = await connection.execute(
            'DELETE FROM produtos WHERE id = ?',
            [id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: 'Produto não encontrado.'
            });
        }

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

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// CATÁLOGOS DE SABORES
// ============================================================

app.get('/catalogos-sabores', async (req, res) => {

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [catalogos] = await connection.execute(`
            SELECT
                id,
                nome,
                marca,
                descricao,
                imagem,
                criado_em
            FROM catalogos_sabores
            ORDER BY id DESC
        `);

        for (const catalogo of catalogos) {

            const [sabores] = await connection.execute(`
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
                    descricao,
                    criado_em
                FROM sabores
                WHERE catalogo_id = ?
                ORDER BY id ASC
            `, [catalogo.id]);

            catalogo.sabores = sabores;
        }

        res.json(catalogos);

    } catch (erro) {

        console.error('Erro ao buscar catálogos:', erro);

        res.status(500).json({
            erro: 'Erro ao buscar catálogos de sabores.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// CADASTRAR CATÁLOGO DE SABORES
// ============================================================

app.post('/catalogos-sabores', autenticarAdmin, async (req, res) => {

    const {
        nome,
        marca,
        descricao,
        imagem
    } = req.body;

    if (!nome) {
        return res.status(400).json({
            erro: 'O nome do catálogo é obrigatório.'
        });
    }

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [resultado] = await connection.execute(`
            INSERT INTO catalogos_sabores (
                nome,
                marca,
                descricao,
                imagem
            )
            VALUES (?, ?, ?, ?)
        `, [
            nome,
            marca || null,
            descricao || null,
            imagem || null
        ]);

        res.status(201).json({
            sucesso: true,
            id: resultado.insertId,
            mensagem: 'Catálogo criado com sucesso!'
        });

    } catch (erro) {

        console.error('Erro ao criar catálogo:', erro);

        res.status(500).json({
            erro: 'Erro ao criar catálogo.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// EDITAR CATÁLOGO
// ============================================================

app.put('/catalogos-sabores/:id', autenticarAdmin, async (req, res) => {

    const { id } = req.params;

    const {
        nome,
        marca,
        descricao,
        imagem
    } = req.body;

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [resultado] = await connection.execute(`
            UPDATE catalogos_sabores
            SET
                nome = ?,
                marca = ?,
                descricao = ?,
                imagem = ?
            WHERE id = ?
        `, [
            nome,
            marca || null,
            descricao || null,
            imagem || null,
            id
        ]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: 'Catálogo não encontrado.'
            });
        }

        res.json({
            sucesso: true,
            mensagem: 'Catálogo atualizado com sucesso!'
        });

    } catch (erro) {

        console.error('Erro ao atualizar catálogo:', erro);

        res.status(500).json({
            erro: 'Erro ao atualizar catálogo.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// EXCLUIR CATÁLOGO
// ============================================================

app.delete('/catalogos-sabores/:id', autenticarAdmin, async (req, res) => {

    const { id } = req.params;

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        await connection.execute(
            'DELETE FROM catalogos_sabores WHERE id = ?',
            [id]
        );

        res.json({
            sucesso: true,
            mensagem: 'Catálogo excluído com sucesso!'
        });

    } catch (erro) {

        console.error('Erro ao excluir catálogo:', erro);

        res.status(500).json({
            erro: 'Erro ao excluir catálogo.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// SABORES
// ============================================================

app.post('/sabores', autenticarAdmin, async (req, res) => {

    const {
        catalogo_id,
        nome,
        preco,
        preco_custo,
        preco_atacado,
        estoque,
        status,
        imagem,
        descricao
    } = req.body;

    if (!catalogo_id || !nome) {
        return res.status(400).json({
            erro: 'Catálogo e nome do sabor são obrigatórios.'
        });
    }

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [resultado] = await connection.execute(`
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
            catalogo_id,
            nome,
            Number(preco) || 0,
            Number(preco_custo) || 0,
            Number(preco_atacado) || 0,
            Number(estoque) || 0,
            status || 'disponivel',
            imagem || null,
            descricao || null
        ]);

        res.status(201).json({
            sucesso: true,
            id: resultado.insertId,
            mensagem: 'Sabor cadastrado com sucesso!'
        });

    } catch (erro) {

        console.error('Erro ao cadastrar sabor:', erro);

        res.status(500).json({
            erro: 'Erro ao cadastrar sabor.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// EDITAR SABOR
// ============================================================

app.put('/sabores/:id', autenticarAdmin, async (req, res) => {

    const { id } = req.params;

    const {
        catalogo_id,
        nome,
        preco,
        preco_custo,
        preco_atacado,
        estoque,
        status,
        imagem,
        descricao
    } = req.body;

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [resultado] = await connection.execute(`
            UPDATE sabores
            SET
                catalogo_id = ?,
                nome = ?,
                preco = ?,
                preco_custo = ?,
                preco_atacado = ?,
                estoque = ?,
                status = ?,
                imagem = ?,
                descricao = ?
            WHERE id = ?
        `, [
            catalogo_id,
            nome,
            Number(preco) || 0,
            Number(preco_custo) || 0,
            Number(preco_atacado) || 0,
            Number(estoque) || 0,
            status || 'disponivel',
            imagem || null,
            descricao || null,
            id
        ]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: 'Sabor não encontrado.'
            });
        }

        res.json({
            sucesso: true,
            mensagem: 'Sabor atualizado com sucesso!'
        });

    } catch (erro) {

        console.error('Erro ao atualizar sabor:', erro);

        res.status(500).json({
            erro: 'Erro ao atualizar sabor.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// EXCLUIR SABOR
// ============================================================

app.delete('/sabores/:id', autenticarAdmin, async (req, res) => {

    const { id } = req.params;

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [resultado] = await connection.execute(
            'DELETE FROM sabores WHERE id = ?',
            [id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: 'Sabor não encontrado.'
            });
        }

        res.json({
            sucesso: true,
            mensagem: 'Sabor excluído com sucesso!'
        });

    } catch (erro) {

        console.error('Erro ao excluir sabor:', erro);

        res.status(500).json({
            erro: 'Erro ao excluir sabor.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// PEDIDOS - LISTAR
// ============================================================

app.get('/pedidos', autenticarAdmin, async (req, res) => {

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [pedidos] = await connection.execute(`
            SELECT
                id,
                nome_cliente,
                telefone,
                endereco,
                valor_total,
                status,
                data_criacao
            FROM pedidos
            ORDER BY id DESC
        `);

        for (const pedido of pedidos) {

            const [itens] = await connection.execute(`
                SELECT
                    ip.id,
                    ip.produto_id,
                    ip.sabor_id,
                    ip.quantidade,
                    ip.preco,

                    p.nome AS produto_nome,

                    s.nome AS sabor_nome,
                    c.nome AS catalogo_nome

                FROM itens_pedido ip

                LEFT JOIN produtos p
                    ON ip.produto_id = p.id

                LEFT JOIN sabores s
                    ON ip.sabor_id = s.id

                LEFT JOIN catalogos_sabores c
                    ON s.catalogo_id = c.id

                WHERE ip.pedido_id = ?

                ORDER BY ip.id ASC
            `, [pedido.id]);

            pedido.itens = itens;
        }

        res.json(pedidos);

    } catch (erro) {

        console.error('Erro ao buscar pedidos:', erro);

        res.status(500).json({
            erro: 'Erro ao buscar pedidos.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// CRIAR PEDIDO
// ============================================================

app.post('/pedidos', async (req, res) => {

    const {
        nome_cliente,
        telefone,
        endereco,
        itens
    } = req.body;

    if (
        !nome_cliente ||
        !telefone ||
        !endereco
    ) {
        return res.status(400).json({
            erro: 'Nome, telefone e endereço são obrigatórios.'
        });
    }

    if (!Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({
            erro: 'O carrinho está vazio.'
        });
    }

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        await connection.beginTransaction();

        let subtotalVarejo = 0;

        const produtosPedido = [];

        // ======================================================
        // VALIDAR ITENS
        // ======================================================

        for (const item of itens) {

            const quantidade = Number(item.quantidade);

            if (!quantidade || quantidade <= 0) {
                throw new Error(
                    'Quantidade de produto inválida.'
                );
            }


            // ==================================================
            // PRODUTO NORMAL
            // ==================================================

            if (item.produto_id) {

                const [rows] = await connection.execute(`
                    SELECT
                        id,
                        nome,
                        preco,
                        preco_atacado,
                        estoque,
                        eh_gelo_especial,
                        preco_especial
                    FROM produtos
                    WHERE id = ?
                    FOR UPDATE
                `, [item.produto_id]);

                if (rows.length === 0) {
                    throw new Error(
                        `Produto ID ${item.produto_id} não encontrado.`
                    );
                }

                const produto = rows[0];

                if (produto.estoque < quantidade) {
                    throw new Error(
                        `Estoque insuficiente para "${produto.nome}". Disponível: ${produto.estoque}`
                    );
                }

                let precoBase = Number(produto.preco);

                // ==================================================
                // GELO ESPECIAL
                // ==================================================

                if (produto.eh_gelo_especial) {

                    if (quantidade > 10) {

                        precoBase = 2.50;

                    } else {

                        const pacotesDeSeis =
                            Math.floor(quantidade / 6);

                        const resto =
                            quantidade % 6;

                        const valorTotal =
                            (pacotesDeSeis * 20) +
                            (resto * 4);

                        precoBase =
                            valorTotal / quantidade;
                    }
                }

                subtotalVarejo +=
                    precoBase * quantidade;

                produtosPedido.push({
                    tipo: 'produto',

                    id: produto.id,

                    quantidade,

                    preco_base: precoBase,

                    preco_atacado:
                        Number(produto.preco_atacado || 0),

                    eh_gelo:
                        Boolean(produto.eh_gelo_especial)
                });

            }


            // ==================================================
            // SABOR
            // ==================================================

            else if (item.sabor_id) {

                const [rows] = await connection.execute(`
                    SELECT
                        s.id,
                        s.nome,
                        s.preco,
                        s.preco_atacado,
                        s.estoque
                    FROM sabores s
                    WHERE s.id = ?
                    FOR UPDATE
                `, [item.sabor_id]);

                if (rows.length === 0) {
                    throw new Error(
                        `Sabor ID ${item.sabor_id} não encontrado.`
                    );
                }

                const sabor = rows[0];

                if (sabor.estoque < quantidade) {
                    throw new Error(
                        `Estoque insuficiente para "${sabor.nome}". Disponível: ${sabor.estoque}`
                    );
                }

                const precoBase =
                    Number(sabor.preco);

                subtotalVarejo +=
                    precoBase * quantidade;

                produtosPedido.push({
                    tipo: 'sabor',

                    id: sabor.id,

                    quantidade,

                    preco_base: precoBase,

                    preco_atacado:
                        Number(sabor.preco_atacado || 0),

                    eh_gelo: false
                });

            }

            else {

                throw new Error(
                    'Item do pedido não possui produto_id nem sabor_id.'
                );
            }
        }


        // ======================================================
        // ATACADO
        // ======================================================

        const atingiuAtacado =
            subtotalVarejo > 250;


        const itensValidados = [];

        let valorTotal = 0;


        for (const item of produtosPedido) {

            let precoFinal =
                item.preco_base;

            if (
                atingiuAtacado &&
                item.preco_atacado > 0 &&
                !item.eh_gelo
            ) {
                precoFinal =
                    item.preco_atacado;
            }

            itensValidados.push({
                tipo: item.tipo,
                id: item.id,
                quantidade: item.quantidade,
                preco: precoFinal
            });

            valorTotal +=
                precoFinal * item.quantidade;
        }


        // ======================================================
        // CRIAR PEDIDO
        // ======================================================

        const [resultadoPedido] =
            await connection.execute(`
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

        const pedidoId =
            resultadoPedido.insertId;


        // ======================================================
        // INSERIR ITENS
        // ======================================================

        for (const item of itensValidados) {

            if (item.tipo === 'produto') {

                await connection.execute(`
                    INSERT INTO itens_pedido (
                        pedido_id,
                        produto_id,
                        sabor_id,
                        quantidade,
                        preco
                    )
                    VALUES (?, ?, NULL, ?, ?)
                `, [
                    pedidoId,
                    item.id,
                    item.quantidade,
                    item.preco
                ]);

            } else {

                await connection.execute(`
                    INSERT INTO itens_pedido (
                        pedido_id,
                        produto_id,
                        sabor_id,
                        quantidade,
                        preco
                    )
                    VALUES (?, NULL, ?, ?, ?)
                `, [
                    pedidoId,
                    item.id,
                    item.quantidade,
                    item.preco
                ]);
            }
        }


        await connection.commit();

        res.status(201).json({
            sucesso: true,
            mensagem: 'Pedido realizado com sucesso!',
            pedido_id: pedidoId,
            valor_total: valorTotal,
            atacado: atingiuAtacado,
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
            erro:
                erro.message ||
                'Erro ao processar o pedido.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// ALTERAR STATUS DO PEDIDO
// ============================================================

app.put('/pedidos/:id/status', autenticarAdmin, async (req, res) => {

    const { id } = req.params;
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

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        await connection.beginTransaction();

        const [pedidoRows] = await connection.execute(`
            SELECT status
            FROM pedidos
            WHERE id = ?
            FOR UPDATE
        `, [id]);

        if (pedidoRows.length === 0) {
            throw new Error(
                'Pedido não encontrado.'
            );
        }

        const statusAnterior =
            pedidoRows[0].status;


        // ======================================================
        // PAGAMENTO
        // ======================================================

        if (
            status === 'pago' &&
            statusAnterior !== 'pago'
        ) {

            const [itens] = await connection.execute(`
                SELECT
                    produto_id,
                    sabor_id,
                    quantidade
                FROM itens_pedido
                WHERE pedido_id = ?
            `, [id]);


            for (const item of itens) {

                if (item.produto_id) {

                    const [resultado] =
                        await connection.execute(`
                            UPDATE produtos
                            SET estoque = estoque - ?
                            WHERE id = ?
                            AND estoque >= ?
                        `, [
                            item.quantidade,
                            item.produto_id,
                            item.quantidade
                        ]);

                    if (resultado.affectedRows === 0) {
                        throw new Error(
                            'Estoque insuficiente para um dos produtos do pedido.'
                        );
                    }

                } else if (item.sabor_id) {

                    const [resultado] =
                        await connection.execute(`
                            UPDATE sabores
                            SET estoque = estoque - ?
                            WHERE id = ?
                            AND estoque >= ?
                        `, [
                            item.quantidade,
                            item.sabor_id,
                            item.quantidade
                        ]);

                    if (resultado.affectedRows === 0) {
                        throw new Error(
                            'Estoque insuficiente para um dos sabores do pedido.'
                        );
                    }
                }
            }
        }


        // ======================================================
        // CANCELAR PEDIDO PAGO
        // ======================================================

        else if (
            status === 'cancelado' &&
            statusAnterior === 'pago'
        ) {

            const [itens] = await connection.execute(`
                SELECT
                    produto_id,
                    sabor_id,
                    quantidade
                FROM itens_pedido
                WHERE pedido_id = ?
            `, [id]);


            for (const item of itens) {

                if (item.produto_id) {

                    await connection.execute(`
                        UPDATE produtos
                        SET estoque = estoque + ?
                        WHERE id = ?
                    `, [
                        item.quantidade,
                        item.produto_id
                    ]);

                } else if (item.sabor_id) {

                    await connection.execute(`
                        UPDATE sabores
                        SET estoque = estoque + ?
                        WHERE id = ?
                    `, [
                        item.quantidade,
                        item.sabor_id
                    ]);
                }
            }
        }


        await connection.execute(`
            UPDATE pedidos
            SET status = ?
            WHERE id = ?
        `, [
            status,
            id
        ]);


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

        console.error(
            'Erro ao atualizar status:',
            erro
        );

        res.status(500).json({
            erro:
                erro.message ||
                'Erro ao atualizar status.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// EXCLUIR PEDIDO
// ============================================================

app.delete('/pedidos/:id', autenticarAdmin, async (req, res) => {

    const { id } = req.params;

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [resultado] = await connection.execute(
            'DELETE FROM pedidos WHERE id = ?',
            [id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: 'Pedido não encontrado.'
            });
        }

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

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// RELATÓRIO SEMANAL
// ============================================================

app.get('/relatorio-semanal', autenticarAdmin, async (req, res) => {

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(`
            SELECT
                p.id AS pedido_id,
                ip.quantidade,
                ip.preco AS preco_venda,

                CASE
                    WHEN ip.produto_id IS NOT NULL
                        THEN pr.preco_custo
                    WHEN ip.sabor_id IS NOT NULL
                        THEN sa.preco_custo
                    ELSE 0
                END AS preco_custo

            FROM pedidos p

            JOIN itens_pedido ip
                ON p.id = ip.pedido_id

            LEFT JOIN produtos pr
                ON ip.produto_id = pr.id

            LEFT JOIN sabores sa
                ON ip.sabor_id = sa.id

            WHERE p.status != 'cancelado'

            AND YEARWEEK(
                p.data_criacao,
                0
            ) = YEARWEEK(
                CURDATE(),
                0
            )
        `);


        let faturamentoTotal = 0;
        let custoTotal = 0;

        const pedidosSemana =
            new Set();


        for (const row of rows) {

            pedidosSemana.add(
                row.pedido_id
            );

            faturamentoTotal +=
                Number(row.preco_venda) *
                Number(row.quantidade);

            custoTotal +=
                Number(row.preco_custo || 0) *
                Number(row.quantidade);
        }


        res.json({
            total_pedidos:
                pedidosSemana.size,

            faturamento:
                faturamentoTotal,

            custo:
                custoTotal,

            lucro:
                faturamentoTotal -
                custoTotal
        });

    } catch (erro) {

        console.error(
            'Erro ao gerar relatório:',
            erro
        );

        res.status(500).json({
            erro: 'Erro ao gerar relatório.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// TESTE DO BANCO
// ============================================================

app.get('/status', async (req, res) => {

    let connection;

    try {

        connection =
            await mysql.createConnection(dbConfig);

        await connection.execute(
            'SELECT 1'
        );

        res.json({
            online: true,
            banco: 'adega_db',
            mensagem: 'Servidor e banco funcionando corretamente.'
        });

    } catch (erro) {

        console.error(
            'Erro na conexão com banco:',
            erro
        );

        res.status(500).json({
            online: false,
            erro: 'Não foi possível conectar ao banco.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// SERVIDOR
// ============================================================

const PORTA =
    Number(process.env.PORT || 3000);

app.listen(
    PORTA,
    '0.0.0.0',
    () => {
        console.log(
            `Servidor rodando na porta ${PORTA}`
        );
    }
);
