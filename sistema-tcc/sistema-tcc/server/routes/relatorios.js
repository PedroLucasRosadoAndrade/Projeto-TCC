const express = require('express');
const { q } = require('../db');
const { autenticar, gestor } = require('../auth');
const { wrap } = require('../util');
const R = require('../regras');

const router = express.Router();
router.use(autenticar, gestor);

/** Filtros comuns de período e curso (sobre a tabela tccs, apelido t). */
function filtros(req) {
  const cond = [];
  const params = [];
  if (req.query.periodo_id) { cond.push('t.periodo_id = ?'); params.push(Number(req.query.periodo_id)); }
  if (req.query.curso_id) { cond.push('t.curso_id = ?'); params.push(Number(req.query.curso_id)); }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params, cond };
}

// RF-014: status dos TCCs e indicadores de andamento
router.get('/andamento', wrap(async (req, res) => {
  const f = filtros(req);
  const porStatus = await q(`SELECT t.status, COUNT(*) AS total FROM tccs t ${f.where} GROUP BY t.status`, f.params);
  const tccs = await q(
    `SELECT t.id, ua.nome AS aluno_nome, a.matricula, c.nome AS curso_nome, p.nome AS periodo_nome, t.tipo,
            t.titulo, t.status, uo.nome AS orientador_nome, t.atualizado_em
       FROM tccs t
       JOIN alunos a ON a.id = t.aluno_id JOIN usuarios ua ON ua.id = a.usuario_id
       JOIN cursos c ON c.id = t.curso_id JOIN periodos_letivos p ON p.id = t.periodo_id
       LEFT JOIN docentes dor ON dor.id = t.orientador_id LEFT JOIN usuarios uo ON uo.id = dor.usuario_id
      ${f.where} ORDER BY c.nome, ua.nome`, f.params);
  res.json({ porStatus, tccs });
}));

// Indicadores de conclusão: resultado das bancas realizadas por curso e período
router.get('/aprovacao', wrap(async (req, res) => {
  const f = filtros(req);
  const cond = ["b.status = 'REALIZADA'", ...f.cond];
  const linhas = await q(
    `SELECT c.nome AS curso_nome, p.nome AS periodo_nome, COUNT(*) AS total,
            SUM(b.resultado = 'APROVADO') AS aprovados,
            SUM(b.resultado = 'RESSALVAS') AS ressalvas,
            SUM(b.resultado = 'REPROVADO') AS reprovados,
            AVG(b.media) AS media_geral
       FROM bancas b JOIN tccs t ON t.id = b.tcc_id
       JOIN cursos c ON c.id = t.curso_id JOIN periodos_letivos p ON p.id = t.periodo_id
      WHERE ${cond.join(' AND ')}
      GROUP BY c.id, c.nome, p.id, p.nome
      ORDER BY p.nome DESC, c.nome`, f.params);
  res.json(linhas.map((l) => {
    const total = Number(l.total);
    const aprovados = Number(l.aprovados);
    const ressalvas = Number(l.ressalvas);
    return {
      curso_nome: l.curso_nome, periodo_nome: l.periodo_nome, total, aprovados, ressalvas,
      reprovados: Number(l.reprovados),
      media_geral: R.arredondar(Number(l.media_geral || 0)),
      taxa_aprovacao: total ? R.arredondar(((aprovados + ressalvas) / total) * 100) : 0,
    };
  }));
}));

// Carga de orientação por professor
router.get('/carga', wrap(async (req, res) => {
  const rows = await q(
    `SELECT d.id, u.nome, d.area, d.limite_orientandos AS limite, d.externo,
            (SELECT COUNT(*) FROM tccs t WHERE t.orientador_id = d.id AND t.status IN (?)) AS orientandos_ativos,
            (SELECT COUNT(*) FROM tccs t WHERE t.orientador_id = d.id AND t.status IN (?)) AS concluidos,
            (SELECT COUNT(*) FROM banca_membros bm JOIN bancas b ON b.id = bm.banca_id
              WHERE bm.docente_id = d.id AND b.status <> 'CANCELADA') AS participacoes_banca
       FROM docentes d JOIN usuarios u ON u.id = d.usuario_id
      WHERE u.ativo = 1 ORDER BY u.nome`, [R.STATUS_ORIENTACAO_ATIVA, R.STATUS_APROVADOS]);
  res.json(rows);
}));

module.exports = router;
