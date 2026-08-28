const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
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
// CONFIGURAÇÃO ADMIN
// ============================================================

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SECRET = process.env.ADMIN_SECRET;


// ============================================================
// AUTENTICAÇÃO
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

    if (
        partes.length !== 2 ||
        !ADMIN_SECRET
    ) {
        return res.status(401).json({
            erro: 'Não autorizado.'
        });
    }

    const [payload, assinatura] = partes;

    const assinaturaEsperada = crypto
        .createHmac('sha256', ADMIN_SECRET)
        .update(payload)
        .digest('base64url');

    try {

        const assinaturaBuffer =
            Buffer.from(assinatura);

        const esperadaBuffer =
            Buffer.from(assinaturaEsperada);

        if (
            assinaturaBuffer.length !==
            esperadaBuffer.length ||
            !crypto.timingSafeEqual(
                assinaturaBuffer,
                esperadaBuffer
            )
        ) {
            return res.status(401).json({
                erro: 'Token inválido.'
            });
        }

    } catch {

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
// LOGIN ADMIN
// ============================================================

app.post('/admin/login', (req, res) => {

    const { senha } = req.body || {};

    if (
        !ADMIN_PASSWORD ||
        senha !== ADMIN_PASSWORD
    ) {
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

// LISTAR PRODUTOS
app.get('/produtos', async (req, res) => {

    let connection;

    try {

        connection =
            await mysql.createConnection(dbConfig);

        const [rows] =
            await connection.execute(`
                SELECT
                    id,
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
                    preco_especial,
                    criado_em
                FROM produtos
                ORDER BY id DESC
            `);

        res.json(rows);

    } catch (erro) {

        console.error(
            'Erro ao buscar produtos:',
            erro
        );

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

        connection =
            await mysql.createConnection(dbConfig);

        const [rows] =
            await connection.execute(`
                SELECT
                    id,
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
                FROM produtos
                WHERE destaque = 1
                ORDER BY id DESC
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
// CADASTRAR PRODUTO
// ============================================================

app.post(
    '/produtos',
    autenticarAdmin,
    async (req, res) => {

        const {
            nome,
            categoria_id,
            marca,
            preco,
            preco_promocional,
            preco_atacado,
            preco_custo,
            volume,
            teor_alcoolico,
            estoque,
            imagem,
            descricao,
            status,
            destaque,
            eh_gelo_especial,
            preco_especial
        } = req.body;


        if (!nome) {
            return res.status(400).json({
                erro: 'Nome do produto é obrigatório.'
            });
        }


        let connection;

        try {

            connection =
                await mysql.createConnection(dbConfig);

            const query = `
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
            `;

            await connection.execute(
                query,
                [
                    categoria_id || 1,
                    nome,
                    descricao || null,
                    marca || null,
                    volume || null,
                    Number(teor_alcoolico) || 0,
                    Number(preco) || 0,
                    preco_promocional !== undefined &&
                    preco_promocional !== null &&
                    preco_promocional !== ''
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
                ]
            );


            res.status(201).json({
                sucesso: true,
                mensagem:
                    'Produto cadastrado com sucesso!'
            });

        } catch (erro) {

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
    }
);


// ============================================================
// EDITAR PRODUTO
// ============================================================

app.put(
    '/produtos/:id',
    autenticarAdmin,
    async (req, res) => {

        const { id } = req.params;

        const {
            nome,
            categoria_id,
            marca,
            preco,
            preco_promocional,
            preco_atacado,
            preco_custo,
            volume,
            teor_alcoolico,
            estoque,
            imagem,
            descricao,
            status,
            destaque,
            eh_gelo_especial,
            preco_especial
        } = req.body;


        let connection;

        try {

            connection =
                await mysql.createConnection(dbConfig);

            const query = `
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
            `;


            await connection.execute(
                query,
                [
                    categoria_id || 1,
                    nome,
                    descricao || null,
                    marca || null,
                    volume || null,
                    Number(teor_alcoolico) || 0,
                    Number(preco) || 0,
                    preco_promocional !== undefined &&
                    preco_promocional !== null &&
                    preco_promocional !== ''
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
                ]
            );


            res.json({
                sucesso: true,
                mensagem:
                    'Produto atualizado com sucesso!'
            });

        } catch (erro) {

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
    }
);


// ============================================================
// EXCLUIR PRODUTO
// ============================================================

app.delete(
    '/produtos/:id',
    autenticarAdmin,
    async (req, res) => {

        const { id } = req.params;

        let connection;

        try {

            connection =
                await mysql.createConnection(dbConfig);

            await connection.execute(
                'DELETE FROM produtos WHERE id = ?',
                [id]
            );

            res.json({
                sucesso: true,
                mensagem:
                    'Produto excluído com sucesso!'
            });

        } catch (erro) {

            console.error(
                'Erro ao excluir produto:',
                erro
            );

            res.status(500).json({
                erro:
                    'Erro ao excluir produto.'
            });

        } finally {

            if (connection) {
                await connection.end();
            }
        }
    }
);


// ============================================================
// CATÁLOGOS DE SABORES
// ============================================================

// LISTAR CATÁLOGOS
app.get('/catalogos-sabores', async (req, res) => {

    let connection;

    try {

        connection =
            await mysql.createConnection(dbConfig);

        const [catalogos] =
            await connection.execute(`
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

        res.json(catalogos);

    } catch (erro) {

        console.error(
            'Erro ao buscar catálogos:',
            erro
        );

        res.status(500).json({
            erro: 'Erro ao buscar catálogos.'
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

// LISTAR SABORES
app.get('/sabores', async (req, res) => {

    let connection;

    try {

        connection =
            await mysql.createConnection(dbConfig);

        const [sabores] =
            await connection.execute(`
                SELECT
                    s.id,
                    s.catalogo_id,
                    c.nome AS catalogo_nome,
                    c.marca AS catalogo_marca,
                    s.nome,
                    s.preco,
                    s.preco_custo,
                    s.preco_atacado,
                    s.estoque,
                    s.status,
                    s.imagem,
                    s.descricao,
                    s.criado_em
                FROM sabores s
                INNER JOIN catalogos_sabores c
                    ON s.catalogo_id = c.id
                ORDER BY s.id DESC
            `);

        res.json(sabores);

    } catch (erro) {

        console.error(
            'Erro ao buscar sabores:',
            erro
        );

        res.status(500).json({
            erro: 'Erro ao buscar sabores.'
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
});


// ============================================================
// PEDIDOS
// ============================================================

app.get(
    '/pedidos',
    autenticarAdmin,
    async (req, res) => {

        let connection;

        try {

            connection =
                await mysql.createConnection(dbConfig);

            const [pedidos] =
                await connection.execute(`
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


            const pedidosComItens = [];


            for (const pedido of pedidos) {

                const [itens] =
                    await connection.execute(`
                        SELECT
                            ip.id,
                            ip.quantidade,
                            ip.preco,

                            ip.produto_id,
                            ip.sabor_id,

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


                const itensFormatados =
                    itens.map(item => {

                        let nome = item.produto_nome;

                        if (item.sabor_nome) {

                            if (item.catalogo_nome) {
                                nome =
                                    `${item.catalogo_nome} - ${item.sabor_nome}`;
                            } else {
                                nome =
                                    item.sabor_nome;
                            }
                        }

                        return {
                            ...item,
                            nome
                        };
                    });


                pedidosComItens.push({
                    ...pedido,
                    itens: itensFormatados
                });
            }


            res.json(pedidosComItens);

        } catch (erro) {

            console.error(
                'Erro ao buscar pedidos:',
                erro
            );

            res.status(500).json({
                erro:
                    'Erro interno ao buscar pedidos.'
            });

        } finally {

            if (connection) {
                await connection.end();
            }
        }
    }
);


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
            erro:
                'Nome, telefone e endereço são obrigatórios.'
        });
    }


    if (
        !Array.isArray(itens) ||
        itens.length === 0
    ) {
        return res.status(400).json({
            erro: 'O carrinho está vazio.'
        });
    }


    let connection;


    try {

        connection =
            await mysql.createConnection(dbConfig);

        await connection.beginTransaction();


        let subtotalVarejo = 0;

        const itensValidados = [];


        // ====================================================
        // VALIDAR TODOS OS ITENS
        // ====================================================

        for (const item of itens) {

            const quantidade =
                Number(item.quantidade);

            if (
                !quantidade ||
                quantidade <= 0
            ) {
                throw new Error(
                    'Quantidade de produto inválida.'
                );
            }


            // -----------------------------------------------
            // PRODUTO NORMAL
            // -----------------------------------------------

            if (item.produto_id) {

                const [rows] =
                    await connection.execute(`
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


                const produto =
                    rows[0];


                if (
                    produto.estoque <
                    quantidade
                ) {
                    throw new Error(
                        `Estoque insuficiente para "${produto.nome}". Disponível: ${produto.estoque}`
                    );
                }


                let preco =
                    Number(produto.preco);


                // -------------------------------------------
                // GELO ESPECIAL
                // -------------------------------------------

                if (
                    Number(produto.eh_gelo_especial) === 1
                ) {

                    if (
                        produto.preco_especial &&
                        Number(produto.preco_especial) > 0
                    ) {

                        preco =
                            Number(
                                produto.preco_especial
                            );

                    } else {

                        const pacotesDeSeis =
                            Math.floor(
                                quantidade / 6
                            );

                        const resto =
                            quantidade % 6;


                        const valorTotal =
                            (pacotesDeSeis * 20) +
                            (resto * 4);


                        preco =
                            valorTotal /
                            quantidade;
                    }
                }


                subtotalVarejo +=
                    preco * quantidade;


                itensValidados.push({

                    produto_id:
                        produto.id,

                    sabor_id:
                        null,

                    quantidade,

                    preco,

                    preco_atacado:
                        Number(
                            produto.preco_atacado || 0
                        ),

                    eh_gelo:
                        Number(
                            produto.eh_gelo_especial
                        ) === 1
                });

            }


            // -----------------------------------------------
            // SABOR
            // -----------------------------------------------

            else if (item.sabor_id) {

                const [rows] =
                    await connection.execute(`
                        SELECT
                            s.id,
                            s.nome,
                            s.preco,
                            s.preco_atacado,
                            s.estoque,
                            c.nome AS catalogo_nome
                        FROM sabores s
                        INNER JOIN catalogos_sabores c
                            ON s.catalogo_id = c.id
                        WHERE s.id = ?
                        FOR UPDATE
                    `, [item.sabor_id]);


                if (rows.length === 0) {
                    throw new Error(
                        `Sabor ID ${item.sabor_id} não encontrado.`
                    );
                }


                const sabor =
                    rows[0];


                if (
                    sabor.estoque <
                    quantidade
                ) {
                    throw new Error(
                        `Estoque insuficiente para "${sabor.catalogo_nome} - ${sabor.nome}". Disponível: ${sabor.estoque}`
                    );
                }


                const preco =
                    Number(sabor.preco);


                subtotalVarejo +=
                    preco * quantidade;


                itensValidados.push({

                    produto_id:
                        null,

                    sabor_id:
                        sabor.id,

                    quantidade,

                    preco,

                    preco_atacado:
                        Number(
                            sabor.preco_atacado || 0
                        ),

                    eh_gelo:
                        false
                });

            }

            else {

                throw new Error(
                    'Item do pedido não possui produto_id nem sabor_id.'
                );
            }
        }


        // ====================================================
        // REGRA DE ATACADO
        // ====================================================

        const atingiuAtacado =
            subtotalVarejo > 250;


        let valorTotal =
            0;


        for (const item of itensValidados) {

            let precoFinal =
                item.preco;


            if (
                atingiuAtacado &&
                item.preco_atacado > 0 &&
                !item.eh_gelo
            ) {

                precoFinal =
                    item.preco_atacado;
            }


            item.precoFinal =
                precoFinal;


            valorTotal +=
                precoFinal *
                item.quantidade;
        }


        // ====================================================
        // CRIAR PEDIDO
        // ====================================================

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


        // ====================================================
        // INSERIR ITENS
        // ====================================================

        for (const item of itensValidados) {

            await connection.execute(`
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

                item.precoFinal
            ]);
        }


        await connection.commit();


        res.status(201).json({

            sucesso: true,

            mensagem:
                'Pedido realizado com sucesso!',

            pedido_id:
                pedidoId,

            valor_total:
                valorTotal,

            chave_pix:
                'masterdistribuidoracm@gmail.com'
        });


    } catch (erro) {

        if (connection) {

            try {
                await connection.rollback();
            } catch {}
        }


        console.error(
            'Erro ao processar pedido:',
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
// ALTERAR STATUS DO PEDIDO
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


        if (
            !statusPermitidos.includes(status)
        ) {
            return res.status(400).json({
                erro:
                    'Status inválido.'
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
                    FOR UPDATE
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


            // =================================================
            // PAGAMENTO
            // =================================================

            if (
                status === 'pago' &&
                statusAnterior !== 'pago'
            ) {

                const [itens] =
                    await connection.execute(`
                        SELECT
                            produto_id,
                            sabor_id,
                            quantidade
                        FROM itens_pedido
                        WHERE pedido_id = ?
                    `, [id]);


                for (const item of itens) {

                    // PRODUTO
                    if (item.produto_id) {

                        const [resultado] =
                            await connection.execute(`
                                UPDATE produtos
                                SET estoque =
                                    estoque - ?
                                WHERE id = ?
                                AND estoque >= ?
                            `, [
                                item.quantidade,
                                item.produto_id,
                                item.quantidade
                            ]);


                        if (
                            resultado.affectedRows === 0
                        ) {
                            throw new Error(
                                'Estoque insuficiente para um dos produtos do pedido.'
                            );
                        }

                    }


                    // SABOR
                    else if (item.sabor_id) {

                        const [resultado] =
                            await connection.execute(`
                                UPDATE sabores
                                SET estoque =
                                    estoque - ?
                                WHERE id = ?
                                AND estoque >= ?
                            `, [
                                item.quantidade,
                                item.sabor_id,
                                item.quantidade
                            ]);


                        if (
                            resultado.affectedRows === 0
                        ) {
                            throw new Error(
                                'Estoque insuficiente para um dos sabores do pedido.'
                            );
                        }
                    }
                }
            }


            // =================================================
            // CANCELAMENTO DE PEDIDO PAGO
            // DEVOLVE ESTOQUE
            // =================================================

            else if (
                status === 'cancelado' &&
                statusAnterior === 'pago'
            ) {

                const [itens] =
                    await connection.execute(`
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
                            SET estoque =
                                estoque + ?
                            WHERE id = ?
                        `, [
                            item.quantidade,
                            item.produto_id
                        ]);

                    }


                    else if (item.sabor_id) {

                        await connection.execute(`
                            UPDATE sabores
                            SET estoque =
                                estoque + ?
                            WHERE id = ?
                        `, [
                            item.quantidade,
                            item.sabor_id
                        ]);
                    }
                }
            }


            // =================================================
            // ATUALIZAR STATUS
            // =================================================

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


            await connection.commit();


            res.json({
                sucesso: true,
                mensagem:
                    'Status atualizado com sucesso!'
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
                'DELETE FROM pedidos WHERE id = ?',
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
                await connection.execute(`
                    SELECT
                        p.id AS pedido_id,
                        ip.quantidade,
                        ip.preco AS preco_venda,

                        CASE

                            WHEN ip.produto_id IS NOT NULL
                                THEN COALESCE(
                                    pr.preco_custo,
                                    0
                                )

                            WHEN ip.sabor_id IS NOT NULL
                                THEN COALESCE(
                                    s.preco_custo,
                                    0
                                )

                            ELSE 0

                        END AS preco_custo

                    FROM pedidos p

                    INNER JOIN itens_pedido ip
                        ON p.id = ip.pedido_id

                    LEFT JOIN produtos pr
                        ON ip.produto_id = pr.id

                    LEFT JOIN sabores s
                        ON ip.sabor_id = s.id

                    WHERE p.status != 'cancelado'

                    AND YEARWEEK(
                        p.data_criacao,
                        0
                    ) = YEARWEEK(
                        CURDATE(),
                        0
                    )
                `);


            let faturamentoTotal =
                0;

            let custoTotal =
                0;


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
// TESTE DO BANCO
// ============================================================

app.get('/teste-banco', async (req, res) => {

    let connection;

    try {

        connection =
            await mysql.createConnection(dbConfig);


        const [rows] =
            await connection.execute(
                'SELECT 1 AS conectado'
            );


        res.json({
            sucesso: true,
            mensagem:
                'Conexão com MySQL funcionando!',
            resultado:
                rows
        });


    } catch (erro) {

        console.error(
            'Erro de conexão:',
            erro
        );


        res.status(500).json({
            sucesso: false,
            erro:
                'Não foi possível conectar ao MySQL.'
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
