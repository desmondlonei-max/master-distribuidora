-- Cria o banco de dados (se não existir) e seleciona
-- Execute este arquivo dentro do banco MySQL fornecido pela hospedagem.
-- O banco deve se chamar adega_db (ou ajuste DB_NAME no .env).

-- Remove tabelas antigas se precisar resetar (cuidado: apaga os dados existentes)
-- DROP TABLE IF EXISTS itens_pedido;
-- DROP TABLE IF EXISTS pedidos;
-- DROP TABLE IF EXISTS produtos;
-- DROP TABLE IF EXISTS categorias;

-- 1. Tabela de Categorias
CREATE TABLE IF NOT EXISTS categorias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL UNIQUE,
    slug VARCHAR(50) NOT NULL UNIQUE
);

-- 2. Tabela de Produtos
CREATE TABLE IF NOT EXISTS produtos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    categoria_id INT NOT NULL,
    nome VARCHAR(150) NOT NULL,
    descricao TEXT,
    marca VARCHAR(50),
    volume VARCHAR(20),
    teor_alcoolico DECIMAL(4,2),
    preco DECIMAL(10,2) NOT NULL,
    preco_promocional DECIMAL(10,2) NULL,
    estoque INT NOT NULL DEFAULT 0,
    status ENUM('disponivel', 'poucas_unidades', 'esgotado') DEFAULT 'disponivel',
    imagem VARCHAR(255),
    destaque BOOLEAN DEFAULT FALSE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

-- 3. Tabela de Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome_cliente VARCHAR(255) NOT NULL,
    telefone VARCHAR(50) NOT NULL,
    endereco TEXT NOT NULL,
    valor_total DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pendente',
    data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabela de Itens do Pedido (com exclusão em cascata)
CREATE TABLE IF NOT EXISTS itens_pedido (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pedido_id INT NOT NULL,
    produto_id INT NOT NULL,
    quantidade INT NOT NULL,
    preco DECIMAL(10,2) NOT NULL,
    preco_unitario DECIMAL(10,2) NULL,
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
);

-- ==========================================
-- DADOS INICIAIS (Opcional)
-- ==========================================
INSERT IGNORE INTO categorias (id, nome, slug) VALUES (1, 'Vinhos', 'vinhos');

INSERT IGNORE INTO produtos (id, categoria_id, nome, descricao, marca, volume, teor_alcoolico, preco, estoque, status, destaque) 
VALUES (1, 1, 'Vinho Tinto Seco Cabernet Sauvignon', 'Vinho fino tinto seco, harmoniza perfeitamente com carnes vermelhas e massas.', 'Concha y Toro', '750ml', 13.50, 49.90, 15, 'disponivel', TRUE);
ALTER TABLE produtos ADD COLUMN preco_custo DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE produtos ADD COLUMN preco_atacado DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE produtos ADD COLUMN sabores VARCHAR(255);
ALTER TABLE produtos ADD COLUMN eh_gelo_especial TINYINT(1) DEFAULT 0;