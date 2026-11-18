const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { pool } = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Cabeçalhos de segurança. Os scripts só rodam se vierem do próprio servidor (sem JS inline).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; object-src 'self'; frame-ancestors 'none'; base-uri 'self'");
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/tccs', require('./routes/tccs'));
app.use('/api/bancas', require('./routes/bancas'));
app.use('/api/relatorios', require('./routes/relatorios'));
const painel = require('./routes/painel');
app.use('/api/notificacoes', painel.notificacoes);
app.use('/api/dashboard', painel.dashboard);
app.use('/api', require('./routes/cadastros'));

app.use('/api', (req, res) => res.status(404).json({ erro: 'Recurso não encontrado.' }));

app.get('/', (req, res) => res.redirect(req.cookies.token ? '/app.html' : '/login.html'));
app.use(express.static(config.publicDir, { index: false, extensions: ['html'] }));

// ---------------------------------------------------------------- Tratamento de erros
const CHAVES_DUPLICADAS = {
  uq_usuarios_email: 'Já existe um usuário com este e-mail.',
  uq_alunos_matricula: 'Já existe um aluno com esta matrícula.',
  uq_docentes_matricula: 'Já existe um docente com esta matrícula funcional.',
  uq_cursos_nome: 'Já existe um curso com este nome.',
  uq_periodos_nome: 'Já existe um período com este nome.',
  uq_versoes_tcc_numero: 'Outra versão foi enviada ao mesmo tempo. Tente novamente.',
  uq_membro_banca: 'Um docente não pode ocupar duas posições na mesma banca.',
};

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ erro: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Requisição inválida.' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ erro: `O arquivo excede o limite de ${config.maxUploadMb} MB.` });
  if (err.code && err.code.startsWith('LIMIT_')) return res.status(400).json({ erro: 'Envio de arquivo inválido.' });
  if (err.code === 'ER_DUP_ENTRY') {
    const chave = Object.keys(CHAVES_DUPLICADAS).find((k) => String(err.message).includes(k));
    return res.status(409).json({ erro: chave ? CHAVES_DUPLICADAS[chave] : 'Registro duplicado.' });
  }
  if (['ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST'].includes(err.code)) {
    console.error('[BANCO DE DADOS]', err.code, err.message);
    return res.status(503).json({ erro: 'Não foi possível conectar ao banco de dados. Verifique o MySQL e o arquivo .env.' });
  }
  if (err.code === 'ER_NO_SUCH_TABLE') {
    console.error('[BANCO DE DADOS]', err.message);
    return res.status(503).json({ erro: 'O banco de dados ainda não foi criado. Execute o script database/tcc_afya.sql no MySQL Workbench.' });
  }
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

app.listen(config.porta, async () => {
  console.log(`\n  TCC+ | Afya Ji-Paraná rodando em ${config.appUrl}\n`);
  try {
    await pool.query('SELECT 1');
    console.log('  Banco de dados MySQL: conectado.\n');
  } catch (e) {
    console.error(`  [ATENÇÃO] Não foi possível conectar ao MySQL (${e.code || e.message}).`);
    console.error('  Confira DB_HOST, DB_USER, DB_PASSWORD e DB_NAME no arquivo .env e se o script database/tcc_afya.sql foi executado.\n');
  }
});
