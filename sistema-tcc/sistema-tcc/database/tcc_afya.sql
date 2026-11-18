-- =====================================================================
--  Sistema de Gestão de TCC  |  Afya Centro Universitário de Ji-Paraná
--  Banco de dados: MySQL 8.0+  (testado para o MySQL Workbench)
--
--  COMO EXECUTAR NO MYSQL WORKBENCH
--    1. Abra uma conexão (ex.: "Local instance MySQL80").
--    2. Menu  File > Open SQL Script...  e escolha este arquivo.
--    3. Clique no raio (Execute) ou use  Ctrl + Shift + Enter.
--
--  O script é idempotente: pode ser executado mais de uma vez sem apagar
--  dados existentes (usa CREATE ... IF NOT EXISTS e INSERT IGNORE).
--
--  Usuários de demonstração (senha de todos: Afya@2026)
--    admin@afya.teste          -> Administrador
--    coordenacao@afya.teste    -> Coordenador de curso
--    professor1@afya.teste     -> Professor / Orientador   (professor2, 3 e 4 também)
--    aluno1@afya.teste         -> Aluno                    (aluno2 e aluno3 também)
-- =====================================================================

CREATE DATABASE IF NOT EXISTS tcc_afya
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tcc_afya;

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
--  ESTRUTURA
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cursos (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome       VARCHAR(120) NOT NULL,
  descricao  TEXT NULL,
  ativo      TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cursos_nome (nome)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS periodos_letivos (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome         VARCHAR(20) NOT NULL,              -- ex.: 2026/2
  data_inicio  DATE NOT NULL,
  data_fim     DATE NOT NULL,
  vigente      TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_periodos_nome (nome)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS papeis (
  id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome  VARCHAR(30) NOT NULL,                     -- ADMIN, COORDENADOR, PROFESSOR, ALUNO
  PRIMARY KEY (id),
  UNIQUE KEY uq_papeis_nome (nome)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS usuarios (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome           VARCHAR(150) NOT NULL,
  email          VARCHAR(150) NOT NULL,
  senha_hash     VARCHAR(100) NOT NULL,           -- bcrypt (nunca texto puro)
  telefone       VARCHAR(25) NULL,
  ativo          TINYINT NOT NULL DEFAULT 1,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_acesso  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB;

select * from usuarios;

-- Um usuário pode ter mais de um papel (ex.: professor e coordenador)
CREATE TABLE IF NOT EXISTS usuario_papeis (
  usuario_id  INT UNSIGNED NOT NULL,
  papel_id    INT UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, papel_id),
  CONSTRAINT fk_up_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT fk_up_papel   FOREIGN KEY (papel_id)   REFERENCES papeis (id)   ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alunos (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id  INT UNSIGNED NOT NULL,
  matricula   VARCHAR(30) NOT NULL,
  curso_id    INT UNSIGNED NOT NULL,
  status      ENUM('ATIVO','TRANCADO','CONCLUIDO','INATIVO') NOT NULL DEFAULT 'ATIVO',
  PRIMARY KEY (id),
  UNIQUE KEY uq_alunos_usuario (usuario_id),
  UNIQUE KEY uq_alunos_matricula (matricula),
  CONSTRAINT fk_alunos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT fk_alunos_curso   FOREIGN KEY (curso_id)   REFERENCES cursos (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS docentes (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id           INT UNSIGNED NOT NULL,
  matricula_funcional  VARCHAR(30) NOT NULL,
  area                 VARCHAR(120) NULL,
  titulacao            VARCHAR(60) NULL,
  limite_orientandos   TINYINT UNSIGNED NOT NULL DEFAULT 8,   -- RN-002
  externo              TINYINT NOT NULL DEFAULT 0,         -- avaliador convidado
  instituicao          VARCHAR(150) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_docentes_usuario (usuario_id),
  UNIQUE KEY uq_docentes_matricula (matricula_funcional),
  CONSTRAINT fk_docentes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS configuracoes (
  chave      VARCHAR(60) NOT NULL,
  valor      VARCHAR(100) NOT NULL,
  descricao  VARCHAR(200) NULL,
  PRIMARY KEY (chave)
) ENGINE=InnoDB;

-- Cronograma de etapas (RF-013). curso_id NULL = vale para todos os cursos.
CREATE TABLE IF NOT EXISTS prazos (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  periodo_id   INT UNSIGNED NOT NULL,
  curso_id     INT UNSIGNED NULL,
  etapa        ENUM('PROPOSTA','VERSAO_PARCIAL','VERSAO_FINAL','DEFESA') NOT NULL,
  titulo       VARCHAR(150) NOT NULL,
  data_limite  DATE NOT NULL,
  criado_em    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prazos_periodo (periodo_id, etapa),
  CONSTRAINT fk_prazos_periodo FOREIGN KEY (periodo_id) REFERENCES periodos_letivos (id) ON DELETE CASCADE,
  CONSTRAINT fk_prazos_curso   FOREIGN KEY (curso_id)   REFERENCES cursos (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tccs (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  aluno_id           INT UNSIGNED NOT NULL,
  curso_id           INT UNSIGNED NOT NULL,
  periodo_id         INT UNSIGNED NOT NULL,
  tipo               ENUM('TCC1','TCC2') NOT NULL DEFAULT 'TCC1',
  titulo             VARCHAR(255) NOT NULL,
  resumo             TEXT NOT NULL,
  area               VARCHAR(120) NOT NULL,
  palavras_chave     VARCHAR(255) NOT NULL,
  status             ENUM('PROPOSTA','AGUARDANDO_HOMOLOGACAO','RECUSADO','EM_DESENVOLVIMENTO',
                          'EM_REVISAO','AGUARDANDO_BANCA','APROVADO','APROVADO_RESSALVAS',
                          'REPROVADO','ARQUIVADO') NOT NULL DEFAULT 'PROPOSTA',
  orientador_id      INT UNSIGNED NULL,           -- docentes.id
  coorientador_id    INT UNSIGNED NULL,           -- docentes.id
  justificativa      TEXT NULL,                   -- última recusa / reprovação de tema
  criado_em          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  arquivado_em       DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_tccs_status (status),
  KEY idx_tccs_aluno (aluno_id),
  KEY idx_tccs_orientador (orientador_id),
  KEY idx_tccs_periodo (periodo_id, curso_id),
  CONSTRAINT fk_tccs_aluno        FOREIGN KEY (aluno_id)        REFERENCES alunos (id),
  CONSTRAINT fk_tccs_curso        FOREIGN KEY (curso_id)        REFERENCES cursos (id),
  CONSTRAINT fk_tccs_periodo      FOREIGN KEY (periodo_id)      REFERENCES periodos_letivos (id),
  CONSTRAINT fk_tccs_orientador   FOREIGN KEY (orientador_id)   REFERENCES docentes (id),
  CONSTRAINT fk_tccs_coorientador FOREIGN KEY (coorientador_id) REFERENCES docentes (id)
) ENGINE=InnoDB;

-- Auditoria de mudanças de status (RN07)
CREATE TABLE IF NOT EXISTS historico_status (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tcc_id           INT UNSIGNED NOT NULL,
  status_anterior  VARCHAR(30) NULL,
  status_novo      VARCHAR(30) NOT NULL,
  usuario_id       INT UNSIGNED NULL,
  justificativa    TEXT NULL,
  criado_em        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hist_tcc (tcc_id),
  CONSTRAINT fk_hist_tcc     FOREIGN KEY (tcc_id)     REFERENCES tccs (id) ON DELETE CASCADE,
  CONSTRAINT fk_hist_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS versoes (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tcc_id         INT UNSIGNED NOT NULL,
  numero         INT UNSIGNED NOT NULL,
  tipo           ENUM('PRE_PROJETO','PARCIAL','FINAL') NOT NULL,
  arquivo_nome   VARCHAR(255) NOT NULL,           -- nome original do PDF
  arquivo_path   VARCHAR(255) NOT NULL,           -- nome gravado em /uploads
  tamanho        INT UNSIGNED NOT NULL DEFAULT 0,
  descricao      TEXT NULL,
  status         ENUM('ENVIADA','APROVADA','AJUSTES') NOT NULL DEFAULT 'ENVIADA',
  feedback       TEXT NULL,
  avaliada_por   INT UNSIGNED NULL,
  data_envio     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data_feedback  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_versoes_tcc_numero (tcc_id, numero),
  CONSTRAINT fk_versoes_tcc FOREIGN KEY (tcc_id) REFERENCES tccs (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reunioes (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tcc_id         INT UNSIGNED NOT NULL,
  data           DATE NOT NULL,
  pauta          TEXT NOT NULL,
  deliberacoes   TEXT NOT NULL,
  registrado_por INT UNSIGNED NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reunioes_tcc (tcc_id),
  CONSTRAINT fk_reunioes_tcc     FOREIGN KEY (tcc_id)         REFERENCES tccs (id) ON DELETE CASCADE,
  CONSTRAINT fk_reunioes_usuario FOREIGN KEY (registrado_por) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bancas (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tcc_id         INT UNSIGNED NOT NULL,
  data           DATE NOT NULL,
  hora           TIME NOT NULL,
  local_defesa   VARCHAR(200) NOT NULL,           -- sala ou link da reunião remota
  modalidade     ENUM('PRESENCIAL','REMOTO') NOT NULL DEFAULT 'PRESENCIAL',
  status         ENUM('AGENDADA','REALIZADA','CANCELADA') NOT NULL DEFAULT 'AGENDADA',
  media          DECIMAL(4,2) NULL,
  resultado      ENUM('APROVADO','RESSALVAS','REPROVADO') NULL,
  encerrada_em   DATETIME NULL,
  encerrada_por  INT UNSIGNED NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bancas_tcc (tcc_id),
  KEY idx_bancas_data (data),
  CONSTRAINT fk_bancas_tcc FOREIGN KEY (tcc_id) REFERENCES tccs (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS banca_membros (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  banca_id    INT UNSIGNED NOT NULL,
  docente_id  INT UNSIGNED NOT NULL,
  tipo        ENUM('PRESIDENTE','AVALIADOR','SUPLENTE') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_membro_banca (banca_id, docente_id),
  CONSTRAINT fk_bm_banca   FOREIGN KEY (banca_id)   REFERENCES bancas (id) ON DELETE CASCADE,
  CONSTRAINT fk_bm_docente FOREIGN KEY (docente_id) REFERENCES docentes (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS avaliacoes (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  banca_id           INT UNSIGNED NOT NULL,
  docente_id         INT UNSIGNED NOT NULL,
  nota_conteudo      DECIMAL(4,2) NOT NULL,
  nota_metodologia   DECIMAL(4,2) NOT NULL,
  nota_apresentacao  DECIMAL(4,2) NOT NULL,
  nota_arguicao      DECIMAL(4,2) NOT NULL,
  media              DECIMAL(4,2) NOT NULL,
  parecer            TEXT NOT NULL,
  data_registro      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_avaliacao (banca_id, docente_id),
  CONSTRAINT fk_av_banca   FOREIGN KEY (banca_id)   REFERENCES bancas (id) ON DELETE CASCADE,
  CONSTRAINT fk_av_docente FOREIGN KEY (docente_id) REFERENCES docentes (id),
  CONSTRAINT ck_av_notas CHECK (
    nota_conteudo     BETWEEN 0 AND 10 AND nota_metodologia BETWEEN 0 AND 10 AND
    nota_apresentacao BETWEEN 0 AND 10 AND nota_arguicao    BETWEEN 0 AND 10)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notificacoes (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id  INT UNSIGNED NOT NULL,
  titulo      VARCHAR(150) NOT NULL,
  mensagem    VARCHAR(500) NOT NULL,
  link        VARCHAR(120) NULL,
  lida        TINYINT NOT NULL DEFAULT 0,
  criado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_usuario (usuario_id, lida),
  CONSTRAINT fk_notif_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Guarda apenas o hash (SHA-256) do token enviado por e-mail (RF-002)
CREATE TABLE IF NOT EXISTS tokens_recuperacao (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id  INT UNSIGNED NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expira_em   DATETIME NOT NULL,
  usado       TINYINT NOT NULL DEFAULT 0,
  criado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_token_hash (token_hash),
  CONSTRAINT fk_tok_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  DADOS INICIAIS
-- ---------------------------------------------------------------------

INSERT IGNORE INTO papeis (id, nome) VALUES
  (1, 'ADMIN'), (2, 'COORDENADOR'), (3, 'PROFESSOR'), (4, 'ALUNO');

INSERT IGNORE INTO cursos (id, nome, descricao) VALUES
  (1, 'Ciência da Computação', 'Bacharelado em Ciência da Computação'),
  (2, 'Medicina',              'Graduação em Medicina'),
  (3, 'Enfermagem',            'Bacharelado em Enfermagem'),
  (4, 'Direito',               'Bacharelado em Direito'),
  (5, 'Psicologia',            'Graduação em Psicologia');

INSERT IGNORE INTO periodos_letivos (id, nome, data_inicio, data_fim, vigente) VALUES
  (1,
   CONCAT(YEAR(CURDATE()), '/', IF(MONTH(CURDATE()) <= 6, 1, 2)),
   DATE_SUB(CURDATE(), INTERVAL 60 DAY),
   DATE_ADD(CURDATE(), INTERVAL 120 DAY),
   1);

INSERT IGNORE INTO configuracoes (chave, valor, descricao) VALUES
  ('limite_orientandos_padrao', '8',    'Limite padrão de orientandos simultâneos por docente (RN-002)'),
  ('media_aprovacao',           '7.00', 'Média mínima para aprovação (RN-005)'),
  ('media_ressalvas',           '5.00', 'Média mínima para aprovação com ressalvas (RN-005)');

-- Senha de todos os usuários de demonstração: Afya@2026  (hash bcrypt)
INSERT IGNORE INTO usuarios (id, nome, email, senha_hash, telefone) VALUES
  (1, 'Administrador do Sistema',   'admin@afya.teste',        '$2b$10$jTHb8MUu1I2PWseHjmyS2eYgrUmf4yoDBMHNVaj8xN4BTVqIkB1Ay', '(69) 3000-0001'),
  (2, 'Coordenação de Curso',       'coordenacao@afya.teste',  '$2b$10$jTHb8MUu1I2PWseHjmyS2eYgrUmf4yoDBMHNVaj8xN4BTVqIkB1Ay', '(69) 3000-0002'),
  (3, 'Prof. Carlos Almeida',       'professor1@afya.teste',   '$2b$10$jTHb8MUu1I2PWseHjmyS2eYgrUmf4yoDBMHNVaj8xN4BTVqIkB1Ay', '(69) 99999-0003'),
  (4, 'Profa. Mariana Souza',       'professor2@afya.teste',   '$2b$10$jTHb8MUu1I2PWseHjmyS2eYgrUmf4yoDBMHNVaj8xN4BTVqIkB1Ay', '(69) 99999-0004'),
  (5, 'Prof. Ricardo Lima',         'professor3@afya.teste',   '$2b$10$jTHb8MUu1I2PWseHjmyS2eYgrUmf4yoDBMHNVaj8xN4BTVqIkB1Ay', '(69) 99999-0005'),
  (6, 'Profa. Helena Costa',        'professor4@afya.teste',   '$2b$10$jTHb8MUu1I2PWseHjmyS2eYgrUmf4yoDBMHNVaj8xN4BTVqIkB1Ay', '(69) 99999-0006'),
  (7, 'Ana Beatriz Ferreira',       'aluno1@afya.teste',       '$2b$10$jTHb8MUu1I2PWseHjmyS2eYgrUmf4yoDBMHNVaj8xN4BTVqIkB1Ay', '(69) 98888-0007'),
  (8, 'João Pedro Martins',         'aluno2@afya.teste',       '$2b$10$jTHb8MUu1I2PWseHjmyS2eYgrUmf4yoDBMHNVaj8xN4BTVqIkB1Ay', '(69) 98888-0008'),
  (9, 'Larissa Oliveira',           'aluno3@afya.teste',       '$2b$10$jTHb8MUu1I2PWseHjmyS2eYgrUmf4yoDBMHNVaj8xN4BTVqIkB1Ay', '(69) 98888-0009');

INSERT IGNORE INTO usuario_papeis (usuario_id, papel_id) VALUES
  (1, 1), (2, 2), (3, 3), (4, 3), (5, 3), (6, 3), (7, 4), (8, 4), (9, 4);

INSERT IGNORE INTO docentes (id, usuario_id, matricula_funcional, area, titulacao, limite_orientandos, externo, instituicao) VALUES
  (1, 3, 'DOC001', 'Engenharia de Software',          'Doutor',  8, 0, NULL),
  (2, 4, 'DOC002', 'Banco de Dados e Sistemas',       'Mestre',  8, 0, NULL),
  (3, 5, 'DOC003', 'Redes e Segurança',               'Mestre',  8, 0, NULL),
  (4, 6, 'EXT001', 'Inteligência Artificial',         'Doutora', 8, 1, 'Instituição externa (convidada)');

INSERT IGNORE INTO alunos (id, usuario_id, matricula, curso_id, status) VALUES
  (1, 7, '2026001', 1, 'ATIVO'),
  (2, 8, '2026002', 1, 'ATIVO'),
  (3, 9, '2026003', 3, 'ATIVO');

-- Cronograma do período vigente (datas relativas ao dia da execução do script;
-- a coordenação pode alterá-las na tela "Cronograma").
INSERT IGNORE INTO prazos (id, periodo_id, curso_id, etapa, titulo, data_limite) VALUES
  (1, 1, NULL, 'PROPOSTA',       'Cadastro da proposta de TCC',      DATE_ADD(CURDATE(), INTERVAL 30 DAY)),
  (2, 1, NULL, 'VERSAO_PARCIAL', 'Envio da versão parcial',          DATE_ADD(CURDATE(), INTERVAL 60 DAY)),
  (3, 1, NULL, 'VERSAO_FINAL',   'Envio da versão final',            DATE_ADD(CURDATE(), INTERVAL 90 DAY)),
  (4, 1, NULL, 'DEFESA',         'Realização das defesas (bancas)',  DATE_ADD(CURDATE(), INTERVAL 110 DAY));

-- TCCs de exemplo (aluno1 em desenvolvimento; aluno2 aguardando banca com defesa agendada; aluno3 livre para cadastrar do zero)
INSERT IGNORE INTO tccs (id, aluno_id, curso_id, periodo_id, tipo, titulo, resumo, area, palavras_chave, status, orientador_id) VALUES
  (1, 1, 1, 1, 'TCC1',
   'Sistema Web para Gestão de Trabalhos de Conclusão de Curso na Afya Ji-Paraná',
   'Desenvolvimento de uma plataforma web centralizada para gerenciamento do ciclo de vida dos TCCs, contemplando submissão de propostas, controle de versões em PDF, registro de reuniões de orientação, formação de bancas examinadoras e emissão automática de atas de defesa.',
   'Engenharia de Software',
   'TCC, Gestão Acadêmica, Sistema Web, Engenharia de Software',
   'EM_DESENVOLVIMENTO', 1),
  (2, 2, 1, 1, 'TCC1',
   'Análise de Desempenho de Consultas Relacionais em Sistemas Acadêmicos de Grande Porte',
   'Estudo comparativo de indexação e otimização de consultas SQL em bancos de dados relacionais aplicados a sistemas de gestão universitária.',
   'Banco de Dados e Sistemas',
   'SQL, MySQL, Desempenho, Indexação',
   'AGUARDANDO_BANCA', 2);

INSERT IGNORE INTO historico_status (id, tcc_id, status_anterior, status_novo, usuario_id, justificativa) VALUES
  (1, 1, NULL, 'PROPOSTA', 7, 'Proposta cadastrada pelo aluno'),
  (2, 1, 'PROPOSTA', 'AGUARDANDO_HOMOLOGACAO', 3, 'Orientação aceita por Prof. Carlos Almeida'),
  (3, 1, 'AGUARDANDO_HOMOLOGACAO', 'EM_DESENVOLVIMENTO', 2, 'Tema e orientador homologados'),
  (4, 2, NULL, 'PROPOSTA', 8, 'Proposta cadastrada pelo aluno'),
  (5, 2, 'PROPOSTA', 'AGUARDANDO_HOMOLOGACAO', 4, 'Orientação aceita por Profa. Mariana Souza'),
  (6, 2, 'AGUARDANDO_HOMOLOGACAO', 'EM_DESENVOLVIMENTO', 2, 'Tema e orientador homologados'),
  (7, 2, 'EM_DESENVOLVIMENTO', 'AGUARDANDO_BANCA', 4, 'Aprovação formal do orientador para submissão à banca');

INSERT IGNORE INTO reunioes (id, tcc_id, data, pauta, deliberacoes, registrado_por) VALUES
  (1, 1, DATE_SUB(CURDATE(), INTERVAL 10 DAY),
   'Alinhamento do levantamento de requisitos e modelagem do banco de dados',
   'Foram validados os requisitos funcionais (RF-001 a RF-014), as regras de negócio (RN-001 a RN-006) e o diagrama de classes.',
   3);

INSERT IGNORE INTO bancas (id, tcc_id, data, hora, local_defesa, modalidade, status) VALUES
  (1, 2, CURDATE(), '19:30:00', 'Auditório Bloco A — Afya Ji-Paraná', 'PRESENCIAL', 'AGENDADA');

INSERT IGNORE INTO banca_membros (id, banca_id, docente_id, tipo) VALUES
  (1, 1, 2, 'PRESIDENTE'),
  (2, 1, 1, 'AVALIADOR'),
  (3, 1, 3, 'AVALIADOR');

-- Fim do script
