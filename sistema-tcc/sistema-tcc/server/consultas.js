/**
 * Consultas compartilhadas entre as rotas de TCC e de bancas.
 * Observação: "do" é palavra reservada no MySQL, por isso os apelidos dor/dco.
 */
const { q, qc } = require('./db');
const { erro } = require('./util');

const SQL_TCC = `
  SELECT t.*, ua.nome AS aluno_nome, ua.email AS aluno_email, a.matricula, a.usuario_id AS aluno_usuario_id,
         c.nome AS curso_nome, p.nome AS periodo_nome,
         uo.nome AS orientador_nome, dor.usuario_id AS orientador_usuario_id,
         uc.nome AS coorientador_nome, dco.usuario_id AS coorientador_usuario_id
    FROM tccs t
    JOIN alunos a ON a.id = t.aluno_id
    JOIN usuarios ua ON ua.id = a.usuario_id
    JOIN cursos c ON c.id = t.curso_id
    JOIN periodos_letivos p ON p.id = t.periodo_id
    LEFT JOIN docentes dor ON dor.id = t.orientador_id
    LEFT JOIN usuarios uo ON uo.id = dor.usuario_id
    LEFT JOIN docentes dco ON dco.id = t.coorientador_id
    LEFT JOIN usuarios uc ON uc.id = dco.usuario_id`;

async function carregarTcc(id, conn = null) {
  const rows = conn ? await qc(conn, `${SQL_TCC} WHERE t.id = ?`, [id]) : await q(`${SQL_TCC} WHERE t.id = ?`, [id]);
  return rows[0] || null;
}

/** Qual é a relação do usuário logado com este TCC. */
async function papelNoTcc(u, tcc) {
  const aluno = !!u.alunoId && tcc.aluno_id === u.alunoId;
  const orientador = !!u.docenteId && tcc.orientador_id === u.docenteId;
  const coorientador = !!u.docenteId && tcc.coorientador_id === u.docenteId;
  let banca = false;
  if (u.docenteId) {
    const r = await q(
      `SELECT 1 FROM bancas b JOIN banca_membros bm ON bm.banca_id = b.id
        WHERE b.tcc_id = ? AND bm.docente_id = ? AND b.status <> 'CANCELADA' LIMIT 1`, [tcc.id, u.docenteId]);
    banca = r.length > 0;
  }
  const gestor = u.ehGestor;
  return { aluno, orientador, coorientador, banca, gestor, pode: aluno || orientador || coorientador || banca || gestor };
}

/** Carrega o TCC e confere se o usuário pode vê-lo (404 se não existe, 403 se sem acesso). */
async function acessoTcc(u, id) {
  const tcc = await carregarTcc(id);
  if (!tcc) throw erro(404, 'TCC não encontrado.');
  const papel = await papelNoTcc(u, tcc);
  if (!papel.pode) throw erro(403, 'Você não tem acesso a este TCC.');
  return { tcc, papel };
}

async function listarMembros(bancaId) {
  return q(
    `SELECT bm.docente_id, bm.tipo, u.nome, d.titulacao, d.externo, d.instituicao, u.id AS usuario_id
       FROM banca_membros bm
       JOIN docentes d ON d.id = bm.docente_id JOIN usuarios u ON u.id = d.usuario_id
      WHERE bm.banca_id = ?
      ORDER BY FIELD(bm.tipo, 'PRESIDENTE', 'AVALIADOR', 'SUPLENTE'), u.nome`, [bancaId]);
}

async function listarAvaliacoes(bancaId) {
  return q(
    `SELECT av.id, av.docente_id, u.nome, av.nota_conteudo, av.nota_metodologia, av.nota_apresentacao,
            av.nota_arguicao, av.media, av.parecer, av.data_registro
       FROM avaliacoes av JOIN docentes d ON d.id = av.docente_id JOIN usuarios u ON u.id = d.usuario_id
      WHERE av.banca_id = ? ORDER BY u.nome`, [bancaId]);
}

/**
 * Notas: gestão vê tudo; cada membro vê só a própria até a banca ser encerrada;
 * depois do encerramento, quem tem acesso ao TCC vê todas.
 */
function filtrarAvaliacoes(avaliacoes, banca, usuario, papel) {
  if (banca.status === 'REALIZADA' || papel.gestor) return avaliacoes;
  if (usuario.docenteId) return avaliacoes.filter((a) => a.docente_id === usuario.docenteId);
  return [];
}

module.exports = { carregarTcc, papelNoTcc, acessoTcc, listarMembros, listarAvaliacoes, filtrarAvaliacoes };
