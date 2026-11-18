const jwt = require('jsonwebtoken');
const config = require('./config');
const { q } = require('./db');
const { erro, wrap } = require('./util');

const COOKIE = 'token';
const DURACAO_HORAS = 8;

function emitirCookie(res, usuarioId) {
  const token = jwt.sign({ id: usuarioId }, config.jwtSecret, { expiresIn: `${DURACAO_HORAS}h` });
  res.cookie(COOKIE, token, {
    httpOnly: true,                 // inacessível ao JavaScript da página (protege contra XSS)
    sameSite: 'strict',             // não é enviado em requisições de outros sites (protege contra CSRF)
    secure: config.cookieSeguro,
    maxAge: DURACAO_HORAS * 3600 * 1000,
  });
}

function limparCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: config.cookieSeguro });
}

/** Carrega o usuário logado (sempre do banco, para respeitar inativações e mudança de papéis). */
async function carregarUsuario(id) {
  const rows = await q('SELECT id, nome, email, telefone, ativo FROM usuarios WHERE id = ?', [id]);
  const u = rows[0];
  if (!u || !u.ativo) return null;

  const papeis = (await q(
    `SELECT p.nome FROM usuario_papeis up JOIN papeis p ON p.id = up.papel_id
      WHERE up.usuario_id = ? ORDER BY p.id`, [id])).map((r) => r.nome);

  const aluno = papeis.includes('ALUNO')
    ? (await q(`SELECT a.id, a.matricula, a.curso_id, a.status, c.nome AS curso_nome
                  FROM alunos a JOIN cursos c ON c.id = a.curso_id WHERE a.usuario_id = ?`, [id]))[0]
    : null;
  const docente = papeis.includes('PROFESSOR')
    ? (await q('SELECT id, matricula_funcional, area, titulacao, limite_orientandos, externo FROM docentes WHERE usuario_id = ?', [id]))[0]
    : null;

  return {
    id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, papeis,
    alunoId: aluno ? aluno.id : null,
    cursoId: aluno ? aluno.curso_id : null,
    aluno: aluno || null,
    docenteId: docente ? docente.id : null,
    docente: docente || null,
    ehAdmin: papeis.includes('ADMIN'),
    ehGestor: papeis.includes('ADMIN') || papeis.includes('COORDENADOR'), // coordenação ou administração
  };
}

/** Middleware: exige sessão válida. */
const autenticar = wrap(async (req, res, next) => {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) throw erro(401, 'Sessão expirada. Entre novamente.');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    limparCookie(res);
    throw erro(401, 'Sessão expirada. Entre novamente.');
  }
  const usuario = await carregarUsuario(payload.id);
  if (!usuario) {
    limparCookie(res);
    throw erro(401, 'Sessão inválida. Entre novamente.');
  }
  req.usuario = usuario;
  next();
});

/** Middleware (RBAC): exige ao menos um dos papéis informados. */
const exigir = (...papeis) => (req, res, next) => {
  if (papeis.some((p) => req.usuario.papeis.includes(p))) return next();
  next(erro(403, 'Você não tem permissão para esta ação.'));
};

const gestor = exigir('ADMIN', 'COORDENADOR');

module.exports = { autenticar, exigir, gestor, emitirCookie, limparCookie, carregarUsuario };
