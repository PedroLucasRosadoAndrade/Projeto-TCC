const express = require('express');
const { q, transacao, qc } = require('../db');
const { autenticar, exigir, gestor } = require('../auth');
const { erro, wrap, texto, inteiro, dataISO, periodoVigente, lerConfiguracoes } = require('../util');
const { STATUS_ORIENTACAO_ATIVA, hojeISO } = require('../regras');

const router = express.Router();
router.use(autenticar);

// ---------------------------------------------------------------- Cursos
router.get('/cursos', wrap(async (req, res) => {
  res.json(await q('SELECT id, nome, descricao, ativo FROM cursos ORDER BY nome'));
}));

router.post('/cursos', exigir('ADMIN'), wrap(async (req, res) => {
  const nome = texto(req.body.nome, 'O nome do curso', { min: 3, max: 120 });
  const descricao = texto(req.body.descricao || '-', 'A descrição', { max: 500 });
  const r = await q('INSERT INTO cursos (nome, descricao) VALUES (?, ?)', [nome, descricao]);
  res.status(201).json({ id: r.insertId });
}));

router.put('/cursos/:id', exigir('ADMIN'), wrap(async (req, res) => {
  const nome = texto(req.body.nome, 'O nome do curso', { min: 3, max: 120 });
  const descricao = texto(req.body.descricao || '-', 'A descrição', { max: 500 });
  const ativo = req.body.ativo === false || req.body.ativo === 0 ? 0 : 1;
  await q('UPDATE cursos SET nome = ?, descricao = ?, ativo = ? WHERE id = ?', [nome, descricao, ativo, inteiro(req.params.id, 'Curso')]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Períodos letivos
router.get('/periodos', wrap(async (req, res) => {
  res.json(await q('SELECT id, nome, data_inicio, data_fim, vigente FROM periodos_letivos ORDER BY data_inicio DESC'));
}));

async function salvarPeriodo(req, id) {
  const nome = texto(req.body.nome, 'O nome do período', { min: 3, max: 20 });
  const inicio = dataISO(req.body.data_inicio, 'Data de início');
  const fim = dataISO(req.body.data_fim, 'Data de término');
  if (fim <= inicio) throw erro(400, 'A data de término deve ser posterior ao início.');
  const vigente = req.body.vigente ? 1 : 0;
  await transacao(async (conn) => {
    if (vigente) await qc(conn, 'UPDATE periodos_letivos SET vigente = 0');
    if (id) {
      await qc(conn, 'UPDATE periodos_letivos SET nome=?, data_inicio=?, data_fim=?, vigente=? WHERE id=?', [nome, inicio, fim, vigente, id]);
    } else {
      await qc(conn, 'INSERT INTO periodos_letivos (nome, data_inicio, data_fim, vigente) VALUES (?,?,?,?)', [nome, inicio, fim, vigente]);
    }
  });
}

router.post('/periodos', gestor, wrap(async (req, res) => {
  await salvarPeriodo(req, null);
  res.status(201).json({ ok: true });
}));

router.put('/periodos/:id', gestor, wrap(async (req, res) => {
  await salvarPeriodo(req, inteiro(req.params.id, 'Período'));
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Configurações
router.get('/configuracoes', gestor, wrap(async (req, res) => {
  res.json(await lerConfiguracoes());
}));

router.put('/configuracoes', exigir('ADMIN'), wrap(async (req, res) => {
  const limite = Number(req.body.limiteOrientandos);
  const aprov = Number(req.body.mediaAprovacao);
  const ress = Number(req.body.mediaRessalvas);
  if (!Number.isInteger(limite) || limite < 1 || limite > 50) throw erro(400, 'O limite de orientandos deve ficar entre 1 e 50.');
  if (!(aprov > 0 && aprov <= 10) || !(ress >= 0 && ress < aprov)) {
    throw erro(400, 'Médias inválidas: a média de ressalvas deve ser menor que a de aprovação (máx. 10).');
  }
  await transacao(async (conn) => {
    await qc(conn, "UPDATE configuracoes SET valor = ? WHERE chave = 'limite_orientandos_padrao'", [String(limite)]);
    await qc(conn, "UPDATE configuracoes SET valor = ? WHERE chave = 'media_aprovacao'", [aprov.toFixed(2)]);
    await qc(conn, "UPDATE configuracoes SET valor = ? WHERE chave = 'media_ressalvas'", [ress.toFixed(2)]);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Docentes (lista para escolha de orientador / banca)
router.get('/docentes', wrap(async (req, res) => {
  const apenasOrientadores = req.query.para === 'orientacao';
  const rows = await q(
    `SELECT d.id, u.nome, d.area, d.titulacao, d.limite_orientandos, d.externo, d.instituicao,
            (SELECT COUNT(*) FROM tccs t WHERE t.orientador_id = d.id AND t.status IN (?)) AS orientandos
       FROM docentes d JOIN usuarios u ON u.id = d.usuario_id
      WHERE u.ativo = 1 ${apenasOrientadores ? 'AND d.externo = 0' : ''}
      ORDER BY u.nome`, [STATUS_ORIENTACAO_ATIVA]);
  res.json(rows.map((d) => ({ ...d, vagas: Math.max(0, d.limite_orientandos - d.orientandos) })));
}));

// ---------------------------------------------------------------- Prazos / cronograma (RF-013)
const ETAPAS = ['PROPOSTA', 'VERSAO_PARCIAL', 'VERSAO_FINAL', 'DEFESA'];

router.get('/prazos', wrap(async (req, res) => {
  let periodoId = Number(req.query.periodo_id) || null;
  if (!periodoId) {
    const p = await periodoVigente();
    periodoId = p ? p.id : 0;
  }
  const params = [periodoId];
  let filtroCurso = '';
  const cursoId = req.usuario.papeis.includes('ALUNO') && !req.usuario.ehGestor ? req.usuario.cursoId : Number(req.query.curso_id) || null;
  if (cursoId) {
    filtroCurso = 'AND (pr.curso_id = ? OR pr.curso_id IS NULL)';
    params.push(cursoId);
  }
  res.json(await q(
    `SELECT pr.id, pr.periodo_id, pr.curso_id, c.nome AS curso_nome, pr.etapa, pr.titulo, pr.data_limite
       FROM prazos pr LEFT JOIN cursos c ON c.id = pr.curso_id
      WHERE pr.periodo_id = ? ${filtroCurso}
      ORDER BY pr.data_limite, pr.id`, params));
}));

function lerPrazo(req) {
  const etapa = String(req.body.etapa || '');
  if (!ETAPAS.includes(etapa)) throw erro(400, 'Etapa inválida.');
  return {
    periodoId: inteiro(req.body.periodo_id, 'Período'),
    cursoId: req.body.curso_id ? inteiro(req.body.curso_id, 'Curso') : null,
    etapa,
    titulo: texto(req.body.titulo, 'O título do prazo', { min: 3, max: 150 }),
    dataLimite: dataISO(req.body.data_limite, 'Data limite'),
  };
}

router.post('/prazos', gestor, wrap(async (req, res) => {
  const p = lerPrazo(req);
  const r = await q('INSERT INTO prazos (periodo_id, curso_id, etapa, titulo, data_limite) VALUES (?,?,?,?,?)',
    [p.periodoId, p.cursoId, p.etapa, p.titulo, p.dataLimite]);
  res.status(201).json({ id: r.insertId });
}));

router.put('/prazos/:id', gestor, wrap(async (req, res) => {
  const p = lerPrazo(req);
  await q('UPDATE prazos SET periodo_id=?, curso_id=?, etapa=?, titulo=?, data_limite=? WHERE id=?',
    [p.periodoId, p.cursoId, p.etapa, p.titulo, p.dataLimite, inteiro(req.params.id, 'Prazo')]);
  res.json({ ok: true });
}));

router.delete('/prazos/:id', gestor, wrap(async (req, res) => {
  await q('DELETE FROM prazos WHERE id = ?', [inteiro(req.params.id, 'Prazo')]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Calendário unificado (prazos + bancas + reuniões do usuário)
router.get('/calendario', wrap(async (req, res) => {
  const u = req.usuario;
  const hoje = hojeISO();
  const periodo = await periodoVigente();
  const eventos = [];

  if (periodo) {
    const cursoId = u.papeis.includes('ALUNO') && !u.ehGestor ? u.cursoId : null;
    const prazos = await q(
      `SELECT titulo, data_limite AS data FROM prazos
        WHERE periodo_id = ? ${cursoId ? 'AND (curso_id = ? OR curso_id IS NULL)' : ''}`,
      cursoId ? [periodo.id, cursoId] : [periodo.id]);
    prazos.forEach((p) => eventos.push({ tipo: 'PRAZO', titulo: p.titulo, data: p.data, hora: null }));
  }

  const condicoes = [];
  const params = [];
  if (u.ehGestor) condicoes.push('1=1');
  if (u.alunoId) { condicoes.push('t.aluno_id = ?'); params.push(u.alunoId); }
  if (u.docenteId) {
    condicoes.push(`(t.orientador_id = ? OR t.coorientador_id = ? OR EXISTS
      (SELECT 1 FROM banca_membros bm WHERE bm.banca_id = b.id AND bm.docente_id = ?))`);
    params.push(u.docenteId, u.docenteId, u.docenteId);
  }
  if (condicoes.length) {
    const bancas = await q(
      `SELECT b.data, b.hora, b.local_defesa, ua.nome AS aluno_nome
         FROM bancas b JOIN tccs t ON t.id = b.tcc_id
         JOIN alunos a ON a.id = t.aluno_id JOIN usuarios ua ON ua.id = a.usuario_id
        WHERE b.status = 'AGENDADA' AND (${condicoes.join(' OR ')})`, params);
    bancas.forEach((b) => eventos.push({
      tipo: 'BANCA', titulo: `Defesa — ${b.aluno_nome}`, data: b.data, hora: String(b.hora).slice(0, 5), detalhe: b.local_defesa,
    }));
  }

  eventos.sort((a, b) => a.data.localeCompare(b.data));
  res.json({ hoje, periodo, eventos });
}));

module.exports = router;
