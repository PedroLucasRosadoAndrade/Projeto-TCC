const express = require('express');
const { q } = require('../db');
const { autenticar } = require('../auth');
const { wrap, inteiro, periodoVigente } = require('../util');
const R = require('../regras');

const notificacoes = express.Router();
notificacoes.use(autenticar);

notificacoes.get('/', wrap(async (req, res) => {
  const lista = await q(
    'SELECT id, titulo, mensagem, link, lida, criado_em FROM notificacoes WHERE usuario_id = ? ORDER BY id DESC LIMIT 100',
    [req.usuario.id]);
  res.json({ lista, naoLidas: lista.filter((n) => !n.lida).length });
}));

notificacoes.get('/contagem', wrap(async (req, res) => {
  const [{ total }] = await q('SELECT COUNT(*) AS total FROM notificacoes WHERE usuario_id = ? AND lida = 0', [req.usuario.id]);
  res.json({ naoLidas: total });
}));

notificacoes.post('/lidas', wrap(async (req, res) => {
  await q('UPDATE notificacoes SET lida = 1 WHERE usuario_id = ?', [req.usuario.id]);
  res.json({ ok: true });
}));

notificacoes.post('/:id/lida', wrap(async (req, res) => {
  await q('UPDATE notificacoes SET lida = 1 WHERE id = ? AND usuario_id = ?', [inteiro(req.params.id, 'Notificação'), req.usuario.id]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Painel de controle (resumo por perfil)
const dashboard = express.Router();
dashboard.use(autenticar);

dashboard.get('/', wrap(async (req, res) => {
  const u = req.usuario;
  const hoje = R.hojeISO();
  const periodo = await periodoVigente();
  const resposta = { periodo, prazos: [], naoLidas: 0 };

  if (periodo) {
    const cursoId = u.papeis.includes('ALUNO') && !u.ehGestor ? u.cursoId : null;
    resposta.prazos = await q(
      `SELECT titulo, etapa, data_limite FROM prazos
        WHERE periodo_id = ? AND data_limite >= ? ${cursoId ? 'AND (curso_id = ? OR curso_id IS NULL)' : ''}
        ORDER BY data_limite LIMIT 4`,
      cursoId ? [periodo.id, hoje, cursoId] : [periodo.id, hoje]);
  }
  const [{ total }] = await q('SELECT COUNT(*) AS total FROM notificacoes WHERE usuario_id = ? AND lida = 0', [u.id]);
  resposta.naoLidas = total;

  if (u.alunoId) {
    resposta.aluno = (await q(
      `SELECT t.id, t.titulo, t.tipo, t.status, t.justificativa, p.nome AS periodo_nome, uo.nome AS orientador_nome,
              (SELECT COUNT(*) FROM versoes v WHERE v.tcc_id = t.id) AS versoes
         FROM tccs t JOIN periodos_letivos p ON p.id = t.periodo_id
         LEFT JOIN docentes dor ON dor.id = t.orientador_id LEFT JOIN usuarios uo ON uo.id = dor.usuario_id
        WHERE t.aluno_id = ? ORDER BY t.id DESC LIMIT 1`, [u.alunoId]))[0] || null;
  }

  if (u.docenteId) {
    const pendentes = await q(
      `SELECT t.id, t.titulo, ua.nome AS aluno_nome FROM tccs t
         JOIN alunos a ON a.id = t.aluno_id JOIN usuarios ua ON ua.id = a.usuario_id
        WHERE t.orientador_id = ? AND t.status = 'PROPOSTA' ORDER BY t.id`, [u.docenteId]);
    const paraRevisar = await q(
      `SELECT t.id, t.titulo, ua.nome AS aluno_nome FROM tccs t
         JOIN alunos a ON a.id = t.aluno_id JOIN usuarios ua ON ua.id = a.usuario_id
        WHERE t.orientador_id = ? AND t.status = 'EM_REVISAO' ORDER BY t.atualizado_em`, [u.docenteId]);
    const [{ ativos }] = await q('SELECT COUNT(*) AS ativos FROM tccs WHERE orientador_id = ? AND status IN (?)', [u.docenteId, R.STATUS_ORIENTACAO_ATIVA]);
    const proximasBancas = await q(
      `SELECT b.id, b.data, b.hora, b.local_defesa, ua.nome AS aluno_nome FROM bancas b
         JOIN tccs t ON t.id = b.tcc_id JOIN alunos a ON a.id = t.aluno_id JOIN usuarios ua ON ua.id = a.usuario_id
         JOIN banca_membros bm ON bm.banca_id = b.id
        WHERE bm.docente_id = ? AND b.status = 'AGENDADA' AND b.data >= ? ORDER BY b.data, b.hora LIMIT 5`, [u.docenteId, hoje]);
    const avaliacoesPendentes = await q(
      `SELECT b.id, b.data, ua.nome AS aluno_nome FROM bancas b
         JOIN tccs t ON t.id = b.tcc_id JOIN alunos a ON a.id = t.aluno_id JOIN usuarios ua ON ua.id = a.usuario_id
         JOIN banca_membros bm ON bm.banca_id = b.id
        WHERE bm.docente_id = ? AND bm.tipo <> 'SUPLENTE' AND t.orientador_id <> ?
          AND b.status = 'AGENDADA' AND b.data <= ?
          AND NOT EXISTS (SELECT 1 FROM avaliacoes av WHERE av.banca_id = b.id AND av.docente_id = bm.docente_id)
        ORDER BY b.data`, [u.docenteId, u.docenteId, hoje]);
    resposta.docente = { pendentes, paraRevisar, ativos, limite: u.docente.limite_orientandos, proximasBancas, avaliacoesPendentes };
  }

  if (u.ehGestor) {
    const porStatus = await q('SELECT status, COUNT(*) AS total FROM tccs GROUP BY status');
    const contagem = Object.fromEntries(porStatus.map((s) => [s.status, s.total]));
    const proximasBancas = await q(
      `SELECT b.id, b.data, b.hora, b.local_defesa, ua.nome AS aluno_nome FROM bancas b
         JOIN tccs t ON t.id = b.tcc_id JOIN alunos a ON a.id = t.aluno_id JOIN usuarios ua ON ua.id = a.usuario_id
        WHERE b.status = 'AGENDADA' AND b.data >= ? ORDER BY b.data, b.hora LIMIT 5`, [hoje]);
    resposta.gestao = {
      porStatus: contagem,
      total: porStatus.reduce((acc, s) => acc + s.total, 0),
      aguardandoHomologacao: contagem.AGUARDANDO_HOMOLOGACAO || 0,
      aguardandoBanca: contagem.AGUARDANDO_BANCA || 0,
      proximasBancas,
    };
  }
  res.json(resposta);
}));

module.exports = { notificacoes, dashboard };
