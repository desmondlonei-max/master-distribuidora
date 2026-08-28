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
// CONFIGURAÇÃO DO BANCO
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


// ============================================================
// ADMIN
// ============================================================

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SECRET = process.env.ADMIN_SECRET;


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
    const payload = partes[0];
    const assinatura = partes[1];

    if (!payload || !assinatura || !ADMIN_SECRET) {
        return res.status(401).json({
            erro: 'Não autorizado.'
        });
    }

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
// PRODUTOS
// ============================================================

app.get('/produtos', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(`
            SELECT
                p.id,
                p.nome,
                p.categoria_id,
                p.marca,
                p.preco,
                p.preco_promocional,
                p.preco_custo,
                p.preco_atacado,
                p.volume,
                p.teor_alcoolico,
                p.estoque,
                p.status,
                p.imagem,
                p.destaque,
                p.eh_gelo_especial,
                p.preco_especial,
                p.descricao,
                p.criado_em,

                COALESCE(
                    GROUP_CONCAT(
                        DISTINCT s.nome
                        ORDER BY s.id
                        SEPARATOR ', '
                    ),
                    ''
                ) AS sabores

            FROM produtos p

            LEFT JOIN catalogos_sabores cs
                ON cs.nome = p.nome

            LEFT JOIN sabores s
                ON s.catalogo_id = cs.id

            GROUP BY p.id

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
                p.nome,
                p.categoria_id,
                p.marca,
                p.preco,
                p.preco_promocional,
                p.preco_custo,
                p.preco_atacado,
                p.volume,
                p.teor_alcoolico,
                p.estoque,
                p.status,
                p.imagem,
                p.destaque,
                p.eh_gelo_especial,
                p.preco_especial,
                p.descricao,

                COALESCE(
                    GROUP_CONCAT(
                        DISTINCT s.nome
                        ORDER BY s.id
                        SEPARATOR ', '
                    ),
                    ''
                ) AS sabores

            FROM produtos p

            LEFT JOIN catalogos_sabores cs
                ON cs.nome = p.nome

            LEFT JOIN sabores s
                ON s.catalogo_id = cs.id

            WHERE p.destaque = 1

            GROUP BY p.id

            ORDER BY p.id DESC

            LIMIT 2
        `);

        res.json(rows);

    } catch (erro) {
        console.error(
            'Erro ao buscar produtos em destaque:',
            erro
        );

        res.status(500).json({
            erro: 'Erro interno ao buscar destaques.'
        });

    } finally {
        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// FUNÇÃO AUXILIAR PARA SALVAR SABORES
// ============================================================

async function salvarSabores(connection, nomeProduto, saboresTexto) {

    // Procura catálogo relacionado ao produto
    const [catalogos] = await connection.execute(
        `
        SELECT id
        FROM catalogos_sabores
        WHERE nome = ?
        LIMIT 1
        `,
        [nomeProduto]
    );

    let catalogoId;

    if (catalogos.length > 0) {

        catalogoId = catalogos[0].id;

        // Remove sabores antigos
        await connection.execute(
            `
            DELETE FROM sabores
            WHERE catalogo_id = ?
            `,
            [catalogoId]
        );

    } else {

        // Cria novo catálogo
        const [resultado] = await connection.execute(
            `
            INSERT INTO catalogos_sabores
            (
                nome,
                marca
            )
            VALUES (?, ?)
            `,
            [nomeProduto, nomeProduto]
        );

        catalogoId = resultado.insertId;
    }


    // Se não existem sabores, não precisa inserir nada
    if (!saboresTexto) {
        return;
    }


    const listaSabores = saboresTexto
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);


    for (const sabor of listaSabores) {

        await connection.execute(
            `
            INSERT INTO sabores
            (
                catalogo_id,
                nome,
                preco,
                preco_custo,
                preco_atacado,
                estoque,
                status
            )
            VALUES (?, ?, 0, 0, 0, 0, 'disponivel')
            `,
            [
                catalogoId,
                sabor
            ]
        );
    }
}


// ============================================================
// CADASTRAR PRODUTO
// ============================================================

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
        eh_gelo_especial
    } = req.body;


    const isDestaque = destaque ? 1 : 0;
    const isGeloEspecial = eh_gelo_especial ? 1 : 0;


    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        await connection.beginTransaction();


        const [resultado] = await connection.execute(
            `
            INSERT INTO produtos
            (
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
                eh_gelo_especial
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                nome,
                categoria_id || 1,
                marca || null,
                preco || 0,
                preco_atacado || 0,
                preco_custo || 0,
                volume || null,
                teor_alcoolico || 0,
                estoque || 0,
                imagem || '',
                descricao || null,
                status || 'disponivel',
                isDestaque,
                isGeloEspecial
            ]
        );


        // Salva os sabores no novo sistema
        if (sabores) {
            await salvarSabores(
                connection,
                nome,
                sabores
            );
        }


        await connection.commit();


        res.status(201).json({
            sucesso: true,
            mensagem: 'Produto cadastrado com sucesso!',
            id: resultado.insertId
        });


    } catch (erro) {

        if (connection) {
            await connection.rollback();
        }

        console.error(
            'Erro ao cadastrar produto:',
            erro
        );

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
        eh_gelo_especial
    } = req.body;


    const isDestaque = destaque ? 1 : 0;
    const isGeloEspecial = eh_gelo_especial ? 1 : 0;


    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        await connection.beginTransaction();


        // Descobre nome antigo
        const [produtoAntigo] = await connection.execute(
            `
            SELECT nome
            FROM produtos
            WHERE id = ?
            `,
            [id]
        );


        if (produtoAntigo.length === 0) {

            await connection.rollback();

            return res.status(404).json({
                erro: 'Produto não encontrado.'
            });
        }


        const nomeAntigo = produtoAntigo[0].nome;


        await connection.execute(
            `
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
                eh_gelo_especial = ?
            WHERE id = ?
            `,
            [
                nome,
                categoria_id || 1,
                marca || null,
                preco || 0,
                preco_atacado || 0,
                preco_custo || 0,
                volume || null,
                teor_alcoolico || 0,
                estoque || 0,
                imagem || '',
                descricao || null,
                status || 'disponivel',
                isDestaque,
                isGeloEspecial,
                id
            ]
        );


        // Se o nome mudou, procura o catálogo antigo
        if (nomeAntigo !== nome) {

            await connection.execute(
                `
                UPDATE catalogos_sabores
                SET nome = ?
                WHERE nome = ?
                `,
                [
                    nome,
                    nomeAntigo
                ]
            );
        }


        // Atualiza sabores
        if (sabores) {

            await salvarSabores(
                connection,
                nome,
                sabores
            );

        } else {

            const [catalogos] = await connection.execute(
                `
                SELECT id
                FROM catalogos_sabores
                WHERE nome = ?
                LIMIT 1
                `,
                [nome]
            );

            if (catalogos.length > 0) {

                await connection.execute(
                    `
                    DELETE FROM sabores
                    WHERE catalogo_id = ?
                    `,
                    [catalogos[0].id]
                );
            }
        }


        await connection.commit();


        res.json({
            sucesso: true,
            mensagem: 'Produto atualizado com sucesso!'
        });


    } catch (erro) {

        if (connection) {
            await connection.rollback();
        }

        console.error(
            'Erro ao atualizar produto:',
            erro
        );

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

        await connection.beginTransaction();


        const [produto] = await connection.execute(
            `
            SELECT nome
            FROM produtos
            WHERE id = ?
            `,
            [id]
        );


        if (produto.length === 0) {

            await connection.rollback();

            return res.status(404).json({
                erro: 'Produto não encontrado.'
            });
        }


        const nomeProduto = produto[0].nome;


        // Remove catálogo e sabores relacionados
        const [catalogos] = await connection.execute(
            `
            SELECT id
            FROM catalogos_sabores
            WHERE nome = ?
            `,
            [nomeProduto]
        );


        for (const catalogo of catalogos) {

            await connection.execute(
                `
                DELETE FROM sabores
                WHERE catalogo_id = ?
                `,
                [catalogo.id]
            );

            await connection.execute(
                `
                DELETE FROM catalogos_sabores
                WHERE id = ?
                `,
                [catalogo.id]
            );
        }


        await connection.execute(
            `
            DELETE FROM produtos
            WHERE id = ?
            `,
            [id]
        );


        await connection.commit();


        res.json({
            sucesso: true,
            mensagem: 'Produto excluído com sucesso!'
        });


    } catch (erro) {

        if (connection) {
            await connection.rollback();
        }

        console.error(
            'Erro ao excluir produto:',
            erro
        );

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
// PEDIDOS - ADMIN
// ============================================================

app.get('/pedidos', autenticarAdmin, async (req, res) => {

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);


        const [pedidos] = await connection.execute(
            `
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
            `
        );


        const pedidosComItens = [];


        for (const ped of pedidos) {

            const [itens] = await connection.execute(
                `
                SELECT
                    ip.id,
                    ip.produto_id,
                    ip.sabor_id,
                    ip.quantidade,
                    ip.preco,

                    COALESCE(
                        p.nome,
                        CONCAT(
                            cs.nome,
                            ' - ',
                            s.nome
                        )
                    ) AS nome

                FROM itens_pedido ip

                LEFT JOIN produtos p
                    ON ip.produto_id = p.id

                LEFT JOIN sabores s
                    ON ip.sabor_id = s.id

                LEFT JOIN catalogos_sabores cs
                    ON s.catalogo_id = cs.id

                WHERE ip.pedido_id = ?
                `,
                [ped.id]
            );


            pedidosComItens.push({
                ...ped,
                itens
            });
        }


        res.json(pedidosComItens);


    } catch (erro) {

        console.error(
            'Erro ao buscar pedidos:',
            erro
        );

        res.status(500).json({
            erro: 'Erro interno ao buscar pedidos.'
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


    if (!itens || itens.length === 0) {

        return res.status(400).json({
            erro: 'O carrinho está vazio.'
        });
    }


    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        await connection.beginTransaction();


        let subtotalVarejo = 0;

        const produtosDoPedido = [];


        // ====================================================
        // VALIDAR PRODUTOS
        // ====================================================

        for (const item of itens) {

            const [rows] = await connection.execute(
                `
                SELECT
                    id,
                    estoque,
                    nome,
                    preco,
                    preco_atacado,
                    eh_gelo_especial
                FROM produtos
                WHERE id = ?
                `,
                [item.id]
            );


            if (rows.length === 0) {

                throw new Error(
                    `Produto ID ${item.id} não encontrado.`
                );
            }


            const produtoDb = rows[0];


            if (
                Number(produtoDb.estoque) <
                Number(item.quantidade)
            ) {

                throw new Error(
                    `Estoque insuficiente para "${produtoDb.nome}". Disponível: ${produtoDb.estoque}`
                );
            }


            const precoBaseItem =
                Number(produtoDb.preco);


            subtotalVarejo +=
                precoBaseItem *
                Number(item.quantidade);


            produtosDoPedido.push({

                id: produtoDb.id,

                quantidade:
                    Number(item.quantidade),

                preco_base:
                    precoBaseItem,

                preco_atacado:
                    produtoDb.preco_atacado
                        ? Number(produtoDb.preco_atacado)
                        : 0,

                eh_gelo:
                    Number(produtoDb.eh_gelo_especial) === 1
            });
        }


        // ====================================================
        // REGRA DE ATACADO
        // ====================================================

        const atingiuAtacado =
            subtotalVarejo > 250;


        let novoValorTotalCalculado = 0;

        const itensValidados = [];


        for (const prod of produtosDoPedido) {

            let precoFinalItem =
                prod.preco_base;


            if (
                atingiuAtacado &&
                prod.preco_atacado > 0 &&
                !prod.eh_gelo
            ) {

                precoFinalItem =
                    prod.preco_atacado;
            }


            itensValidados.push({

                id: prod.id,

                quantidade:
                    prod.quantidade,

                preco:
                    precoFinalItem
            });


            novoValorTotalCalculado +=
                precoFinalItem *
                prod.quantidade;
        }


        // ====================================================
        // CRIAR PEDIDO
        // ====================================================

        const [resultadoPedido] =
            await connection.execute(
                `
                INSERT INTO pedidos
                (
                    nome_cliente,
                    telefone,
                    endereco,
                    valor_total,
                    status
                )
                VALUES (?, ?, ?, ?, ?)
                `,
                [
                    nome_cliente,
                    telefone,
                    endereco,
                    novoValorTotalCalculado,
                    'pendente'
                ]
            );


        const pedidoId =
            resultadoPedido.insertId;


        // ====================================================
        // ITENS DO PEDIDO
        // ====================================================

        for (const item of itensValidados) {

            await connection.execute(
                `
                INSERT INTO itens_pedido
                (
                    pedido_id,
                    produto_id,
                    sabor_id,
                    quantidade,
                    preco
                )
                VALUES (?, ?, NULL, ?, ?)
                `,
                [
                    pedidoId,
                    item.id,
                    item.quantidade,
                    item.preco
                ]
            );
        }


        await connection.commit();


        res.status(201).json({

            sucesso: true,

            mensagem:
                'Pedido realizado com sucesso!',

            chave_pix:
                'masterdistribuidoracm@gmail.com',

            pedido_id:
                pedidoId,

            valor_total:
                novoValorTotalCalculado
        });


    } catch (erro) {

        if (connection) {
            await connection.rollback();
        }

        console.error(
            'Erro ao criar pedido:',
            erro
        );

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
// ATUALIZAR STATUS DO PEDIDO
// ============================================================

app.put(
    '/pedidos/:id/status',
    autenticarAdmin,
    async (req, res) => {

        const { id } = req.params;
        const { status } = req.body;


        const statusPermitidos = [
            'pendente',
            'pago',
            'enviado',
            'entregue',
            'cancelado'
        ];


        if (!statusPermitidos.includes(status)) {

            return res.status(400).json({
                erro: 'Status inválido.'
            });
        }


        let connection;

        try {

            connection =
                await mysql.createConnection(dbConfig);

            await connection.beginTransaction();


            const [pedidoRows] =
                await connection.execute(
                    `
                    SELECT status
                    FROM pedidos
                    WHERE id = ?
                    `,
                    [id]
                );


            if (pedidoRows.length === 0) {

                throw new Error(
                    'Pedido não encontrado.'
                );
            }


            const statusAnterior =
                pedidoRows[0].status;


            await connection.execute(
                `
                UPDATE pedidos
                SET status = ?
                WHERE id = ?
                `,
                [
                    status,
                    id
                ]
            );


            // =================================================
            // PAGO -> DIMINUI ESTOQUE
            // =================================================

            if (
                status === 'pago' &&
                statusAnterior !== 'pago'
            ) {

                const [itens] =
                    await connection.execute(
                        `
                        SELECT
                            produto_id,
                            sabor_id,
                            quantidade
                        FROM itens_pedido
                        WHERE pedido_id = ?
                        `,
                        [id]
                    );


                for (const item of itens) {

                    if (item.produto_id) {

                        await connection.execute(
                            `
                            UPDATE produtos
                            SET estoque =
                                estoque - ?
                            WHERE id = ?
                            `,
                            [
                                item.quantidade,
                                item.produto_id
                            ]
                        );

                    } else if (item.sabor_id) {

                        await connection.execute(
                            `
                            UPDATE sabores
                            SET estoque =
                                estoque - ?
                            WHERE id = ?
                            `,
                            [
                                item.quantidade,
                                item.sabor_id
                            ]
                        );
                    }
                }
            }


            // =================================================
            // CANCELADO DEPOIS DE PAGO -> DEVOLVE ESTOQUE
            // =================================================

            else if (
                status === 'cancelado' &&
                statusAnterior === 'pago'
            ) {

                const [itens] =
                    await connection.execute(
                        `
                        SELECT
                            produto_id,
                            sabor_id,
                            quantidade
                        FROM itens_pedido
                        WHERE pedido_id = ?
                        `,
                        [id]
                    );


                for (const item of itens) {

                    if (item.produto_id) {

                        await connection.execute(
                            `
                            UPDATE produtos
                            SET estoque =
                                estoque + ?
                            WHERE id = ?
                            `,
                            [
                                item.quantidade,
                                item.produto_id
                            ]
                        );

                    } else if (item.sabor_id) {

                        await connection.execute(
                            `
                            UPDATE sabores
                            SET estoque =
                                estoque + ?
                            WHERE id = ?
                            `,
                            [
                                item.quantidade,
                                item.sabor_id
                            ]
                        );
                    }
                }
            }


            await connection.commit();


            res.json({
                sucesso: true,
                mensagem:
                    'Status atualizado com sucesso!'
            });


        } catch (erro) {

            if (connection) {
                await connection.rollback();
            }

            console.error(
                'Erro ao atualizar status:',
                erro
            );

            res.status(500).json({
                erro:
                    erro.message ||
                    'Erro ao atualizar o status.'
            });

        } finally {

            if (connection) {
                await connection.end();
            }
        }
    }
);


// ============================================================
// EXCLUIR PEDIDO
// ============================================================

app.delete(
    '/pedidos/:id',
    autenticarAdmin,
    async (req, res) => {

        const { id } = req.params;

        let connection;

        try {

            connection =
                await mysql.createConnection(dbConfig);


            await connection.execute(
                `
                DELETE FROM pedidos
                WHERE id = ?
                `,
                [id]
            );


            res.json({
                sucesso: true,
                mensagem:
                    'Pedido excluído com sucesso!'
            });


        } catch (erro) {

            console.error(
                'Erro ao excluir pedido:',
                erro
            );

            res.status(500).json({
                erro:
                    'Erro ao excluir pedido.'
            });

        } finally {

            if (connection) {
                await connection.end();
            }
        }
    }
);


// ============================================================
// RELATÓRIO SEMANAL
// ============================================================

app.get(
    '/relatorio-semanal',
    autenticarAdmin,
    async (req, res) => {

        let connection;

        try {

            connection =
                await mysql.createConnection(dbConfig);


            const [rows] =
                await connection.execute(
                    `
                    SELECT
                        p.id AS pedido_id,
                        ip.quantidade,
                        ip.preco AS preco_venda,
                        pr.preco_custo

                    FROM pedidos p

                    JOIN itens_pedido ip
                        ON p.id = ip.pedido_id

                    JOIN produtos pr
                        ON ip.produto_id = pr.id

                    WHERE
                        p.status != 'cancelado'

                        AND YEARWEEK(
                            p.data_criacao,
                            0
                        ) =
                        YEARWEEK(
                            CURDATE(),
                            0
                        )
                    `
                );


            let faturamentoTotal = 0;
            let custoTotal = 0;

            const pedidosSemana =
                new Set();


            rows.forEach(row => {

                pedidosSemana.add(
                    row.pedido_id
                );


                faturamentoTotal +=
                    Number(row.preco_venda) *
                    Number(row.quantidade);


                custoTotal +=
                    Number(row.preco_custo || 0) *
                    Number(row.quantidade);
            });


            res.json({

                total_pedidos:
                    pedidosSemana.size,

                faturamento:
                    faturamentoTotal,

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
                erro:
                    'Erro ao gerar relatório.'
            });

        } finally {

            if (connection) {
                await connection.end();
            }
        }
    }
);


// ============================================================
// ROTA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            'public',
            'index.html'
        )
    );
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
            `Servidor rodando na porta ${PORTA} 🚀`
        );
    }
);
