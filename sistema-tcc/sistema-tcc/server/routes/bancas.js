const express = require('express');
const { q, qc, transacao } = require('../db');
const { autenticar, exigir, gestor } = require('../auth');
const {
  erro, wrap, texto, inteiro, dataISO, registrarStatus, notificar, buscarPrazo, lerConfiguracoes,
} = require('../util');
const { carregarTcc, papelNoTcc, listarMembros, listarAvaliacoes, filtrarAvaliacoes } = require('../consultas');
const R = require('../regras');

const router = express.Router();
router.use(autenticar);

async function acessoBanca(u, id) {
  const banca = (await q('SELECT * FROM bancas WHERE id = ?', [id]))[0];
  if (!banca) throw erro(404, 'Banca não encontrada.');
  const tcc = await carregarTcc(banca.tcc_id);
  const papel = await papelNoTcc(u, tcc);
  if (!papel.pode) throw erro(403, 'Você não tem acesso a esta banca.');
  return { banca, tcc, papel };
}

// ================================================================ Listagem
router.get('/', wrap(async (req, res) => {
  const u = req.usuario;
  const cond = [];
  const params = [];
  if (!u.ehGestor) {
    const meus = [];
    if (u.alunoId) { meus.push('t.aluno_id = ?'); params.push(u.alunoId); }
    if (u.docenteId) {
      meus.push(`(t.orientador_id = ? OR t.coorientador_id = ? OR EXISTS (
        SELECT 1 FROM banca_membros bm WHERE bm.banca_id = b.id AND bm.docente_id = ?))`);
      params.push(u.docenteId, u.docenteId, u.docenteId);
    }
    cond.push(meus.length ? `(${meus.join(' OR ')})` : '1 = 0');
  }
  if (['AGENDADA', 'REALIZADA', 'CANCELADA'].includes(req.query.status)) {
    cond.push('b.status = ?');
    params.push(req.query.status);
  }

  const bancas = await q(
    `SELECT b.id, b.tcc_id, b.data, b.hora, b.local_defesa, b.modalidade, b.status, b.media, b.resultado,
            t.titulo, t.tipo, ua.nome AS aluno_nome, c.nome AS curso_nome, uo.nome AS orientador_nome
       FROM bancas b JOIN tccs t ON t.id = b.tcc_id
       JOIN alunos a ON a.id = t.aluno_id JOIN usuarios ua ON ua.id = a.usuario_id
       JOIN cursos c ON c.id = t.curso_id
       LEFT JOIN docentes dor ON dor.id = t.orientador_id LEFT JOIN usuarios uo ON uo.id = dor.usuario_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY b.data DESC, b.hora DESC LIMIT 300`, params);

  const membros = bancas.length
    ? await q(
      `SELECT bm.banca_id, bm.tipo, u.nome FROM banca_membros bm
         JOIN docentes d ON d.id = bm.docente_id JOIN usuarios u ON u.id = d.usuario_id
        WHERE bm.banca_id IN (?) ORDER BY FIELD(bm.tipo, 'PRESIDENTE', 'AVALIADOR', 'SUPLENTE'), u.nome`,
      [bancas.map((b) => b.id)])
    : [];
  res.json(bancas.map((b) => ({ ...b, membros: membros.filter((m) => m.banca_id === b.id) })));
}));

// ================================================================ Detalhe
router.get('/:id', wrap(async (req, res) => {
  const u = req.usuario;
  const { banca, tcc, papel } = await acessoBanca(u, inteiro(req.params.id, 'Banca'));
  const membros = await listarMembros(banca.id);
  const todas = await listarAvaliacoes(banca.id);
  const avaliacoes = filtrarAvaliacoes(todas, banca, u, papel);
  const meu = u.docenteId ? membros.find((m) => m.docente_id === u.docenteId) : null;
  const euAvalio = !!meu && R.membrosQueAvaliam([meu], tcc.orientador_id).length > 0;
  const avaliadores = R.membrosQueAvaliam(membros, tcc.orientador_id);

  res.json({
    banca, membros, avaliacoes,
    tcc: {
      id: tcc.id, titulo: tcc.titulo, tipo: tcc.tipo, status: tcc.status, aluno_nome: tcc.aluno_nome, matricula: tcc.matricula,
      curso_nome: tcc.curso_nome, orientador_id: tcc.orientador_id, orientador_nome: tcc.orientador_nome, coorientador_nome: tcc.coorientador_nome,
    },
    minhaAvaliacao: u.docenteId ? todas.find((a) => a.docente_id === u.docenteId) || null : null,
    euAvalio,
    souPresidente: !!meu && meu.tipo === 'PRESIDENTE',
    pendentes: avaliadores.filter((m) => !todas.some((a) => a.docente_id === m.docente_id)).map((m) => m.nome),
  });
}));

// ================================================================ Criação / edição (RF-010, RN-004, RN-003)
async function validarBanca(body, tcc) {
  const data = dataISO(body.data, 'Data da defesa');
  if (data < R.hojeISO()) throw erro(400, 'A data da defesa não pode estar no passado.');
  const hora = String(body.hora || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw erro(400, 'Horário inválido.');
  const local = texto(body.local_defesa, 'O local (ou link da sala virtual)', { min: 3, max: 200 });
  const modalidade = ['PRESENCIAL', 'REMOTO'].includes(body.modalidade) ? body.modalidade : null;
  if (!modalidade) throw erro(400, 'Informe a modalidade (presencial ou remota).');

  const membros = (Array.isArray(body.membros) ? body.membros : []).map((m) => ({ docente_id: Number(m.docente_id), tipo: m.tipo }));
  const erros = R.validarComposicaoBanca(membros, { orientadorId: tcc.orientador_id });
  if (erros.length) throw erro(400, erros.join(' '));

  const validos = await q(
    'SELECT d.id FROM docentes d JOIN usuarios u ON u.id = d.usuario_id WHERE d.id IN (?) AND u.ativo = 1', [membros.map((m) => m.docente_id)]);
  if (validos.length !== membros.length) throw erro(400, 'Há docente inexistente ou inativo na banca.');

  const prazo = await buscarPrazo(tcc.periodo_id, tcc.curso_id, 'DEFESA');
  if (prazo && data > String(prazo.data_limite).slice(0, 10)) {
    throw erro(400, `A data excede o prazo das defesas (${R.dataBR(prazo.data_limite)}). Ajuste o cronograma ou escolha outra data.`);
  }
  return { data, hora, local, modalidade, membros };
}

async function notificarBanca(tcc, banca, membros, titulo, texto_) {
  const usuarios = (await listarMembros(banca.id)).map((m) => m.usuario_id);
  await notificar([...usuarios, tcc.aluno_usuario_id, tcc.orientador_usuario_id, tcc.coorientador_usuario_id], titulo, texto_, `#/banca/${banca.id}`);
}

router.post('/', gestor, wrap(async (req, res) => {
  const tcc = await carregarTcc(inteiro(req.body.tcc_id, 'TCC'));
  if (!tcc) throw erro(404, 'TCC não encontrado.');
  if (tcc.status !== 'AGUARDANDO_BANCA') throw erro(409, 'O TCC precisa estar liberado pelo orientador (Aguardando banca).');
  const aberta = await q("SELECT id FROM bancas WHERE tcc_id = ? AND status = 'AGENDADA'", [tcc.id]);
  if (aberta.length) throw erro(409, 'Este TCC já possui uma banca agendada.');

  const d = await validarBanca(req.body, tcc);
  const id = await transacao(async (conn) => {
    const r = await qc(conn, 'INSERT INTO bancas (tcc_id, data, hora, local_defesa, modalidade) VALUES (?,?,?,?,?)',
      [tcc.id, d.data, d.hora, d.local, d.modalidade]);
    await qc(conn, 'INSERT INTO banca_membros (banca_id, docente_id, tipo) VALUES ?', [d.membros.map((m) => [r.insertId, m.docente_id, m.tipo])]);
    await registrarStatus(conn, tcc.id, tcc.status, tcc.status, req.usuario.id, `Banca agendada para ${R.dataBR(d.data)} às ${d.hora}`);
    return r.insertId;
  });
  await notificarBanca(tcc, { id }, d.membros, 'Banca de TCC agendada',
    `Defesa do TCC "${tcc.titulo}" (${tcc.aluno_nome}) em ${R.dataBR(d.data)} às ${d.hora} — ${d.local}.`);
  res.status(201).json({ id });
}));

router.put('/:id', gestor, wrap(async (req, res) => {
  const { banca, tcc } = await acessoBanca(req.usuario, inteiro(req.params.id, 'Banca'));
  if (banca.status !== 'AGENDADA') throw erro(409, 'Somente bancas agendadas podem ser alteradas.');
  const d = await validarBanca(req.body, tcc);
  await transacao(async (conn) => {
    await qc(conn, 'UPDATE bancas SET data=?, hora=?, local_defesa=?, modalidade=? WHERE id=?', [d.data, d.hora, d.local, d.modalidade, banca.id]);
    await qc(conn, 'DELETE FROM banca_membros WHERE banca_id = ?', [banca.id]);
    await qc(conn, 'INSERT INTO banca_membros (banca_id, docente_id, tipo) VALUES ?', [d.membros.map((m) => [banca.id, m.docente_id, m.tipo])]);
    // notas de quem saiu da banca (ou virou suplente / orientador) deixam de valer
    await qc(conn, 'DELETE FROM avaliacoes WHERE banca_id = ? AND docente_id NOT IN (?)',
      [banca.id, R.membrosQueAvaliam(d.membros, tcc.orientador_id).map((m) => m.docente_id).concat([0])]);
    await registrarStatus(conn, tcc.id, tcc.status, tcc.status, req.usuario.id, `Banca reagendada para ${R.dataBR(d.data)} às ${d.hora}`);
  });
  await notificarBanca(tcc, banca, d.membros, 'Banca de TCC atualizada',
    `A defesa do TCC "${tcc.titulo}" ficou para ${R.dataBR(d.data)} às ${d.hora} — ${d.local}.`);
  res.json({ ok: true });
}));

router.post('/:id/cancelar', gestor, wrap(async (req, res) => {
  const { banca, tcc } = await acessoBanca(req.usuario, inteiro(req.params.id, 'Banca'));
  if (banca.status !== 'AGENDADA') throw erro(409, 'Somente bancas agendadas podem ser canceladas.');
  await transacao(async (conn) => {
    await qc(conn, "UPDATE bancas SET status = 'CANCELADA' WHERE id = ?", [banca.id]);
    await registrarStatus(conn, tcc.id, tcc.status, tcc.status, req.usuario.id, 'Banca cancelada');
  });
  await notificarBanca(tcc, banca, [], 'Banca de TCC cancelada', `A defesa do TCC "${tcc.titulo}" foi cancelada pela coordenação.`);
  res.json({ ok: true });
}));

// ================================================================ Avaliação por critérios (RF-011)
router.post('/:id/avaliacao', exigir('PROFESSOR'), wrap(async (req, res) => {
  const u = req.usuario;
  const { banca, tcc } = await acessoBanca(u, inteiro(req.params.id, 'Banca'));
  const membros = await listarMembros(banca.id);
  const meu = membros.find((m) => m.docente_id === u.docenteId);
  if (!meu || meu.tipo === 'SUPLENTE') throw erro(403, 'Você não é avaliador titular desta banca.');
  if (u.docenteId === tcc.orientador_id) throw erro(403, 'O orientador não lança nota na banca do próprio orientando.');
  if (banca.status !== 'AGENDADA') throw erro(409, 'Esta banca não está aberta para avaliação.');
  if (R.hojeISO() < banca.data) throw erro(409, `As notas só podem ser lançadas a partir da data da defesa (${R.dataBR(banca.data)}).`);

  const notas = {};
  R.CRITERIOS.forEach((c) => { notas[c] = R.lerNota(req.body[`nota_${c}`]); });
  if (Object.values(notas).some((n) => n === null)) throw erro(400, 'Informe notas de 0 a 10 para todos os critérios.');
  const parecer = texto(req.body.parecer, 'O parecer', { min: 10, max: 3000 });
  const media = R.mediaCriterios(notas);

  await q(
    `INSERT INTO avaliacoes (banca_id, docente_id, nota_conteudo, nota_metodologia, nota_apresentacao, nota_arguicao, media, parecer)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE nota_conteudo = VALUES(nota_conteudo), nota_metodologia = VALUES(nota_metodologia),
       nota_apresentacao = VALUES(nota_apresentacao), nota_arguicao = VALUES(nota_arguicao),
       media = VALUES(media), parecer = VALUES(parecer), data_registro = NOW()`,
    [banca.id, u.docenteId, notas.conteudo, notas.metodologia, notas.apresentacao, notas.arguicao, media, parecer]);
  res.json({ ok: true, media });
}));

// ================================================================ Encerramento: nota final e resultado (RF-012, RN-005)
router.post('/:id/encerrar', wrap(async (req, res) => {
  const u = req.usuario;
  const { banca, tcc } = await acessoBanca(u, inteiro(req.params.id, 'Banca'));
  const membros = await listarMembros(banca.id);
  const meu = u.docenteId ? membros.find((m) => m.docente_id === u.docenteId) : null;
  if (!u.ehGestor && !(meu && meu.tipo === 'PRESIDENTE')) throw erro(403, 'Somente a coordenação ou o presidente da banca podem encerrá-la.');
  if (banca.status !== 'AGENDADA') throw erro(409, 'Esta banca não está aberta.');
  if (R.hojeISO() < banca.data) throw erro(409, 'A banca só pode ser encerrada a partir da data da defesa.');

  const avaliadores = R.membrosQueAvaliam(membros, tcc.orientador_id);
  if (avaliadores.length < R.BANCA_MIN_AVALIADORES) throw erro(409, 'A banca não tem avaliadores suficientes para lançar a nota final.');
  const avaliacoes = await listarAvaliacoes(banca.id);
  const faltam = avaliadores.filter((m) => !avaliacoes.some((a) => a.docente_id === m.docente_id));
  if (faltam.length) throw erro(409, `Ainda faltam as notas de: ${faltam.map((m) => m.nome).join(', ')}.`);

  const media = R.mediaFinal(avaliadores.map((m) => avaliacoes.find((a) => a.docente_id === m.docente_id).media));
  const cfg = await lerConfiguracoes();
  const resultado = R.resultadoPorMedia(media, { aprovacao: cfg.mediaAprovacao, ressalvas: cfg.mediaRessalvas });
  const novoStatus = R.statusPorResultado(resultado);
  const rotulo = { APROVADO: 'Aprovado', RESSALVAS: 'Aprovado com ressalvas', REPROVADO: 'Reprovado' }[resultado];

  await transacao(async (conn) => {
    await qc(conn,
      "UPDATE bancas SET status = 'REALIZADA', media = ?, resultado = ?, encerrada_em = NOW(), encerrada_por = ? WHERE id = ?",
      [media, resultado, u.id, banca.id]);
    await qc(conn, 'UPDATE tccs SET status = ? WHERE id = ?', [novoStatus, tcc.id]);
    await registrarStatus(conn, tcc.id, tcc.status, novoStatus, u.id,
      `Banca encerrada. Média final ${media.toFixed(2).replace('.', ',')} — ${rotulo}`);
  });
  await notificarBanca(tcc, banca, membros, `Resultado da banca: ${rotulo}`,
    `TCC "${tcc.titulo}" (${tcc.aluno_nome}): média final ${media.toFixed(2).replace('.', ',')} — ${rotulo}.`);
  res.json({ ok: true, media, resultado });
}));

// ================================================================ Ata de defesa (RF-012)
router.get('/:id/ata', wrap(async (req, res) => {
  const { banca, tcc } = await acessoBanca(req.usuario, inteiro(req.params.id, 'Banca'));
  if (banca.status !== 'REALIZADA') throw erro(409, 'A ata só fica disponível depois que a banca é encerrada.');
  const cfg = await lerConfiguracoes();
  res.json({
    instituicao: 'Afya Centro Universitário de Ji-Paraná',
    cfg,
    banca,
    tcc: {
      id: tcc.id, titulo: tcc.titulo, tipo: tcc.tipo, aluno_nome: tcc.aluno_nome, matricula: tcc.matricula,
      curso_nome: tcc.curso_nome, periodo_nome: tcc.periodo_nome,
      orientador_id: tcc.orientador_id, orientador_nome: tcc.orientador_nome, coorientador_nome: tcc.coorientador_nome,
    },
    membros: await listarMembros(banca.id),
    avaliacoes: await listarAvaliacoes(banca.id),
  });
}));

module.exports = router;
