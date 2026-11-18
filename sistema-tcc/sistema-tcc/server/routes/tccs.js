const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { q, qc, transacao } = require('../db');
const { autenticar, exigir, gestor } = require('../auth');
const { upload, pdfAutentico, nomeOriginal } = require('../upload');
const {
  erro, wrap, texto, inteiro, dataISO, registrarStatus, idsPorPapel, notificar,
  exigirNoPrazo, periodoVigente, removerArquivo,
} = require('../util');
const { carregarTcc, acessoTcc, listarMembros, listarAvaliacoes, filtrarAvaliacoes } = require('../consultas');
const R = require('../regras');

const router = express.Router();
router.use(autenticar);

/** Handler com upload: se algo falhar depois do upload, o arquivo órfão é apagado. */
const comArquivo = (fn) => wrap(async (req, res, next) => {
  try {
    if (req.file && !pdfAutentico(req.file.path)) throw erro(400, 'O arquivo enviado não é um PDF válido.');
    await fn(req, res, next);
  } catch (e) {
    if (req.file) removerArquivo(req.file.path);
    throw e;
  }
});

function lerDadosTcc(b) {
  const orientadorId = inteiro(b.orientador_id, 'Orientador');
  const coorientadorId = b.coorientador_id ? inteiro(b.coorientador_id, 'Coorientador') : null;
  if (coorientadorId && coorientadorId === orientadorId) throw erro(400, 'O coorientador deve ser diferente do orientador.');
  return {
    titulo: texto(b.titulo, 'O título', { min: 5, max: 255 }),
    resumo: texto(b.resumo, 'O resumo', { min: 30, max: 5000 }),
    area: texto(b.area, 'A área', { min: 2, max: 120 }),
    palavrasChave: texto(b.palavras_chave, 'As palavras-chave', { min: 3, max: 255 }),
    orientadorId,
    coorientadorId,
  };
}

/**
 * Confere se o docente pode orientar: ativo, interno e com vaga (RN-002).
 * ignorarTccId: não conta o próprio TCC no limite (troca de orientador/reenvio).
 */
async function validarOrientador(orientadorId, coorientadorId, ignorarTccId = 0) {
  const rows = await q(
    `SELECT d.id, d.limite_orientandos, d.externo, u.nome, u.id AS usuario_id,
            (SELECT COUNT(*) FROM tccs t WHERE t.orientador_id = d.id AND t.status IN (?) AND t.id <> ?) AS ativos
       FROM docentes d JOIN usuarios u ON u.id = d.usuario_id
      WHERE d.id = ? AND u.ativo = 1`, [R.STATUS_ORIENTACAO_ATIVA, ignorarTccId, orientadorId]);
  const o = rows[0];
  if (!o) throw erro(400, 'Orientador inválido ou inativo.');
  if (o.externo) throw erro(400, 'Docentes externos atuam apenas como avaliadores de banca.');
  if (o.ativos >= o.limite_orientandos) {
    throw erro(409, `${o.nome} atingiu o limite de ${o.limite_orientandos} orientandos simultâneos.`);
  }
  if (coorientadorId) {
    const c = await q('SELECT d.id FROM docentes d JOIN usuarios u ON u.id = d.usuario_id WHERE d.id = ? AND u.ativo = 1', [coorientadorId]);
    if (!c.length) throw erro(400, 'Coorientador inválido ou inativo.');
  }
  return o;
}

async function inserirVersao(conn, tccId, tipo, file, descricao) {
  const [{ prox }] = await qc(conn, 'SELECT COALESCE(MAX(numero), 0) + 1 AS prox FROM versoes WHERE tcc_id = ?', [tccId]);
  const r = await qc(conn,
    `INSERT INTO versoes (tcc_id, numero, tipo, arquivo_nome, arquivo_path, tamanho, descricao)
     VALUES (?,?,?,?,?,?,?)`,
    [tccId, prox, tipo, nomeOriginal(file), file.filename, file.size, descricao || null]);
  return { id: r.insertId, numero: prox };
}

async function mudarStatus(conn, tcc, novo, usuarioId, justificativa = null, extras = {}) {
  const campos = ['status = ?'];
  const valores = [novo];
  Object.entries(extras).forEach(([k, v]) => { campos.push(`${k} = ?`); valores.push(v); });
  await qc(conn, `UPDATE tccs SET ${campos.join(', ')} WHERE id = ?`, [...valores, tcc.id]);
  await registrarStatus(conn, tcc.id, tcc.status, novo, usuarioId, justificativa);
}

const idsUsuariosOrientacao = (tcc) => [tcc.orientador_usuario_id, tcc.coorientador_usuario_id].filter(Boolean);
const linkTcc = (tcc) => `#/tcc/${tcc.id}`;

// ================================================================ Listagem (RF-014: consulta por status, curso, período, orientador e aluno)
router.get('/', wrap(async (req, res) => {
  const u = req.usuario;
  const cond = [];
  const params = [];

  if (!u.ehGestor) {
    const meus = [];
    if (u.alunoId) { meus.push('t.aluno_id = ?'); params.push(u.alunoId); }
    if (u.docenteId) {
      meus.push(`(t.orientador_id = ? OR t.coorientador_id = ? OR EXISTS (
        SELECT 1 FROM bancas b JOIN banca_membros bm ON bm.banca_id = b.id
         WHERE b.tcc_id = t.id AND bm.docente_id = ? AND b.status <> 'CANCELADA'))`);
      params.push(u.docenteId, u.docenteId, u.docenteId);
    }
    cond.push(meus.length ? `(${meus.join(' OR ')})` : '1 = 0');
  }
  if (req.query.vinculo === 'orientacao' && u.docenteId && !u.ehGestor) {
    cond.push('(t.orientador_id = ? OR t.coorientador_id = ?)');
    params.push(u.docenteId, u.docenteId);
  }
  if (req.query.status) { cond.push('t.status = ?'); params.push(String(req.query.status)); }
  if (req.query.curso_id) { cond.push('t.curso_id = ?'); params.push(Number(req.query.curso_id)); }
  if (req.query.periodo_id) { cond.push('t.periodo_id = ?'); params.push(Number(req.query.periodo_id)); }
  if (req.query.orientador_id) { cond.push('t.orientador_id = ?'); params.push(Number(req.query.orientador_id)); }
  if (req.query.q) {
    cond.push('(ua.nome LIKE ? OR a.matricula LIKE ? OR t.titulo LIKE ?)');
    const like = `%${String(req.query.q).trim()}%`;
    params.push(like, like, like);
  }

  const rows = await q(
    `SELECT t.id, t.titulo, t.tipo, t.status, t.area, t.criado_em, t.atualizado_em,
            t.aluno_id, t.orientador_id, t.curso_id, t.periodo_id,
            ua.nome AS aluno_nome, a.matricula, c.nome AS curso_nome, p.nome AS periodo_nome, uo.nome AS orientador_nome
       FROM tccs t
       JOIN alunos a ON a.id = t.aluno_id JOIN usuarios ua ON ua.id = a.usuario_id
       JOIN cursos c ON c.id = t.curso_id JOIN periodos_letivos p ON p.id = t.periodo_id
       LEFT JOIN docentes dor ON dor.id = t.orientador_id LEFT JOIN usuarios uo ON uo.id = dor.usuario_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY t.atualizado_em DESC, t.id DESC LIMIT 500`, params);
  res.json(rows);
}));

// ================================================================ Detalhe
router.get('/:id', wrap(async (req, res) => {
  const { tcc, papel } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));

  const versoes = await q(
    `SELECT v.id, v.numero, v.tipo, v.arquivo_nome, v.tamanho, v.descricao, v.status, v.feedback,
            v.data_envio, v.data_feedback, uv.nome AS avaliada_por_nome
       FROM versoes v LEFT JOIN usuarios uv ON uv.id = v.avaliada_por
      WHERE v.tcc_id = ? ORDER BY v.numero DESC`, [tcc.id]);

  const reunioes = (papel.aluno || papel.orientador || papel.coorientador || papel.gestor)
    ? await q(
      `SELECT r.id, r.data, r.pauta, r.deliberacoes, r.registrado_por, ur.nome AS registrado_por_nome
         FROM reunioes r LEFT JOIN usuarios ur ON ur.id = r.registrado_por
        WHERE r.tcc_id = ? ORDER BY r.data DESC, r.id DESC`, [tcc.id])
    : [];

  const historico = await q(
    `SELECT h.status_anterior, h.status_novo, h.justificativa, h.criado_em, uh.nome AS usuario_nome
       FROM historico_status h LEFT JOIN usuarios uh ON uh.id = h.usuario_id
      WHERE h.tcc_id = ? ORDER BY h.id DESC`, [tcc.id]);

  let banca = (await q(
    "SELECT * FROM bancas WHERE tcc_id = ? AND status <> 'CANCELADA' ORDER BY id DESC LIMIT 1", [tcc.id]))[0] || null;
  if (banca) {
    const membros = await listarMembros(banca.id);
    const avaliacoes = filtrarAvaliacoes(await listarAvaliacoes(banca.id), banca, req.usuario, papel);
    banca = { ...banca, membros, avaliacoes };
  }

  res.json({ tcc, papel, versoes, reunioes, historico, banca });
}));

router.get('/:id/versoes/:versaoId/arquivo', wrap(async (req, res) => {
  const { tcc } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  const rows = await q('SELECT arquivo_nome, arquivo_path FROM versoes WHERE id = ? AND tcc_id = ?',
    [inteiro(req.params.versaoId, 'Versão'), tcc.id]);
  if (!rows.length) throw erro(404, 'Versão não encontrada.');
  const caminho = path.join(config.uploadDir, path.basename(rows[0].arquivo_path));
  if (!fs.existsSync(caminho)) throw erro(404, 'Arquivo não encontrado no servidor.');
  const disp = req.query.inline ? 'inline' : 'attachment';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(rows[0].arquivo_nome)}`);
  res.sendFile(caminho);
}));

// ================================================================ Aluno: cadastro da proposta (RF-004, RF-005, RF-006)
router.post('/', exigir('ALUNO'), upload.single('pre_projeto'), comArquivo(async (req, res) => {
  const u = req.usuario;
  if (!u.alunoId) throw erro(403, 'Seu usuário não possui cadastro de aluno.');
  if (u.aluno.status !== 'ATIVO') throw erro(403, 'Somente alunos com matrícula ativa podem cadastrar TCC.');

  const periodo = await periodoVigente();
  if (!periodo) throw erro(409, 'Não há período letivo vigente. Procure a coordenação.');
  await exigirNoPrazo(periodo.id, u.cursoId, 'PROPOSTA');

  const dados = lerDadosTcc(req.body);

  const ativo = await q("SELECT id FROM tccs WHERE aluno_id = ? AND periodo_id = ? AND status <> 'REPROVADO'", [u.alunoId, periodo.id]);
  if (ativo.length) throw erro(409, 'Você já possui um TCC ativo neste período. Cada aluno pode ter apenas um TCC ativo por semestre.');

  const anteriores = await q('SELECT tipo, status FROM tccs WHERE aluno_id = ?', [u.alunoId]);
  const prox = R.proximoTipoTcc(anteriores);
  if (prox.erro) throw erro(409, prox.erro);

  const orientador = await validarOrientador(dados.orientadorId, dados.coorientadorId);

  const id = await transacao(async (conn) => {
    const r = await qc(conn,
      `INSERT INTO tccs (aluno_id, curso_id, periodo_id, tipo, titulo, resumo, area, palavras_chave, status, orientador_id, coorientador_id)
       VALUES (?,?,?,?,?,?,?,?, 'PROPOSTA', ?, ?)`,
      [u.alunoId, u.cursoId, periodo.id, prox.tipo, dados.titulo, dados.resumo, dados.area, dados.palavrasChave,
        dados.orientadorId, dados.coorientadorId]);
    await registrarStatus(conn, r.insertId, null, 'PROPOSTA', u.id, 'Proposta cadastrada pelo aluno');
    if (req.file) await inserirVersao(conn, r.insertId, 'PRE_PROJETO', req.file, 'Pré-projeto anexado à proposta');
    return r.insertId;
  });

  await notificar(orientador.usuario_id, 'Nova solicitação de orientação',
    `${u.nome} solicitou sua orientação no TCC "${dados.titulo}".`, `#/tcc/${id}`);
  res.status(201).json({ id, tipo: prox.tipo });
}));

// Aluno: editar proposta (ou reenviar após recusa)
router.put('/:id', exigir('ALUNO'), upload.single('pre_projeto'), comArquivo(async (req, res) => {
  const { tcc, papel } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  if (!papel.aluno) throw erro(403, 'Somente o autor do TCC pode editá-lo.');
  if (!['PROPOSTA', 'RECUSADO'].includes(tcc.status)) {
    throw erro(409, 'Os dados só podem ser alterados enquanto a proposta ainda não foi aceita e homologada.');
  }
  await exigirNoPrazo(tcc.periodo_id, tcc.curso_id, 'PROPOSTA');

  const dados = lerDadosTcc(req.body);
  const trocouOrientador = dados.orientadorId !== tcc.orientador_id;
  const reenvio = tcc.status === 'RECUSADO';
  let orientador = null;
  if (trocouOrientador || reenvio) orientador = await validarOrientador(dados.orientadorId, dados.coorientadorId, tcc.id);
  else if (dados.coorientadorId) {
    const c = await q('SELECT d.id FROM docentes d JOIN usuarios u ON u.id = d.usuario_id WHERE d.id = ? AND u.ativo = 1', [dados.coorientadorId]);
    if (!c.length) throw erro(400, 'Coorientador inválido ou inativo.');
  }

  await transacao(async (conn) => {
    await qc(conn,
      `UPDATE tccs SET titulo=?, resumo=?, area=?, palavras_chave=?, orientador_id=?, coorientador_id=? WHERE id = ?`,
      [dados.titulo, dados.resumo, dados.area, dados.palavrasChave, dados.orientadorId, dados.coorientadorId, tcc.id]);
    if (reenvio) {
      await mudarStatus(conn, tcc, 'PROPOSTA', req.usuario.id, 'Proposta ajustada e reenviada pelo aluno');
    } else if (trocouOrientador) {
      await registrarStatus(conn, tcc.id, tcc.status, 'PROPOSTA', req.usuario.id, 'Aluno escolheu outro orientador');
    }
    if (req.file) await inserirVersao(conn, tcc.id, 'PRE_PROJETO', req.file, 'Pré-projeto anexado à proposta');
  });

  if (orientador) {
    await notificar(orientador.usuario_id, 'Nova solicitação de orientação',
      `${req.usuario.nome} solicitou sua orientação no TCC "${dados.titulo}".`, linkTcc(tcc));
  }
  res.json({ ok: true });
}));

// ================================================================ Orientador: aceitar ou recusar (RF-007, RN-002)
router.post('/:id/orientacao', exigir('PROFESSOR'), wrap(async (req, res) => {
  const { tcc, papel } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  if (!papel.orientador) throw erro(403, 'Apenas o orientador indicado pode responder a esta solicitação.');
  if (tcc.status !== 'PROPOSTA') throw erro(409, 'Esta solicitação já foi respondida.');

  const acao = String(req.body.acao || '');
  if (acao === 'ACEITAR') {
    const o = await validarOrientador(tcc.orientador_id, null, tcc.id);
    await transacao((conn) => mudarStatus(conn, tcc, 'AGUARDANDO_HOMOLOGACAO', req.usuario.id, `Orientação aceita por ${o.nome}`,
      { justificativa: null }));
    await notificar(tcc.aluno_usuario_id, 'Orientação aceita',
      `${req.usuario.nome} aceitou orientar seu TCC. Agora aguarde a homologação da coordenação.`, linkTcc(tcc));
    await notificar(await idsPorPapel('COORDENADOR'), 'TCC aguardando homologação',
      `O TCC "${tcc.titulo}" (${tcc.aluno_nome}) teve a orientação aceita e aguarda homologação.`, linkTcc(tcc));
  } else if (acao === 'RECUSAR') {
    const justificativa = texto(req.body.justificativa, 'A justificativa da recusa', { min: 10, max: 1000 });
    await transacao((conn) => mudarStatus(conn, tcc, 'RECUSADO', req.usuario.id, justificativa,
      { orientador_id: null, justificativa }));
    await notificar(tcc.aluno_usuario_id, 'Orientação recusada',
      `${req.usuario.nome} recusou a orientação: "${justificativa}". Escolha outro orientador e reenvie a proposta.`, linkTcc(tcc));
  } else {
    throw erro(400, 'Ação inválida.');
  }
  res.json({ ok: true });
}));

// ================================================================ Coordenação: homologar tema e orientador
router.post('/:id/homologar', gestor, wrap(async (req, res) => {
  const { tcc } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  if (tcc.status !== 'AGUARDANDO_HOMOLOGACAO') throw erro(409, 'Este TCC não está aguardando homologação.');

  if (req.body.aprovar) {
    await transacao((conn) => mudarStatus(conn, tcc, 'EM_DESENVOLVIMENTO', req.usuario.id, 'Tema e orientador homologados',
      { justificativa: null }));
    await notificar([tcc.aluno_usuario_id, ...idsUsuariosOrientacao(tcc)], 'TCC homologado',
      `O tema "${tcc.titulo}" foi homologado. O desenvolvimento pode começar.`, linkTcc(tcc));
  } else {
    const justificativa = texto(req.body.justificativa, 'A justificativa', { min: 10, max: 1000 });
    await transacao((conn) => mudarStatus(conn, tcc, 'RECUSADO', req.usuario.id, justificativa, { justificativa }));
    await notificar([tcc.aluno_usuario_id, ...idsUsuariosOrientacao(tcc)], 'Tema não homologado',
      `O tema "${tcc.titulo}" não foi homologado: "${justificativa}". Ajuste a proposta e reenvie.`, linkTcc(tcc));
  }
  res.json({ ok: true });
}));

// RN: a troca de orientador exige justificativa registrada
router.post('/:id/trocar-orientador', gestor, wrap(async (req, res) => {
  const { tcc } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  if (R.STATUS_FINAIS.includes(tcc.status)) throw erro(409, 'Este TCC já foi finalizado.');
  const novoId = inteiro(req.body.orientador_id, 'Orientador');
  const justificativa = texto(req.body.justificativa, 'A justificativa da troca', { min: 10, max: 1000 });
  if (novoId === tcc.orientador_id) throw erro(400, 'O novo orientador deve ser diferente do atual.');
  if (novoId === tcc.coorientador_id) throw erro(400, 'O coorientador atual não pode ser o novo orientador.');
  const novo = await validarOrientador(novoId, null, tcc.id);

  await transacao(async (conn) => {
    await qc(conn, 'UPDATE tccs SET orientador_id = ? WHERE id = ?', [novoId, tcc.id]);
    await registrarStatus(conn, tcc.id, tcc.status, tcc.status, req.usuario.id,
      `Troca de orientador: ${tcc.orientador_nome || '(nenhum)'} → ${novo.nome}. Justificativa: ${justificativa}`);
  });
  await notificar([tcc.aluno_usuario_id, tcc.orientador_usuario_id, novo.usuario_id], 'Troca de orientador',
    `O orientador do TCC "${tcc.titulo}" passou a ser ${novo.nome}.`, linkTcc(tcc));
  res.json({ ok: true });
}));

// RF-008: coorientador por TCC (coordenação ou orientador)
router.post('/:id/coorientador', wrap(async (req, res) => {
  const { tcc, papel } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  if (!papel.gestor && !papel.orientador) throw erro(403, 'Somente a coordenação ou o orientador podem definir o coorientador.');
  if (R.STATUS_FINAIS.includes(tcc.status)) throw erro(409, 'Este TCC já foi finalizado.');
  const docenteId = req.body.docente_id ? inteiro(req.body.docente_id, 'Coorientador') : null;
  if (docenteId) {
    if (docenteId === tcc.orientador_id) throw erro(400, 'O coorientador deve ser diferente do orientador.');
    const d = await q('SELECT d.id, u.id AS usuario_id FROM docentes d JOIN usuarios u ON u.id = d.usuario_id WHERE d.id = ? AND u.ativo = 1', [docenteId]);
    if (!d.length) throw erro(400, 'Docente inválido.');
    await notificar(d[0].usuario_id, 'Convite de coorientação', `Você foi indicado(a) como coorientador(a) do TCC "${tcc.titulo}".`, linkTcc(tcc));
  }
  await q('UPDATE tccs SET coorientador_id = ? WHERE id = ?', [docenteId, tcc.id]);
  res.json({ ok: true });
}));

// ================================================================ Versões (RF-005/006/009, RN-006, RF-013)
router.post('/:id/versoes', exigir('ALUNO'), upload.single('arquivo'), comArquivo(async (req, res) => {
  const { tcc, papel } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  if (!papel.aluno) throw erro(403, 'Somente o autor do TCC pode enviar versões.');
  if (!req.file) throw erro(400, 'Selecione o arquivo PDF.');

  const tipo = String(req.body.tipo || '');
  if (!['PARCIAL', 'FINAL'].includes(tipo)) throw erro(400, 'Tipo de versão inválido.');
  const descricao = texto(req.body.descricao, 'A descrição da versão', { min: 5, max: 1000 });

  const correcaoPosBanca = tcc.status === 'APROVADO_RESSALVAS';
  if (correcaoPosBanca) {
    if (tipo !== 'FINAL') throw erro(409, 'Após a banca com ressalvas, envie a versão final corrigida.');
  } else if (!['EM_DESENVOLVIMENTO', 'EM_REVISAO'].includes(tcc.status)) {
    throw erro(409, 'Neste momento o TCC não aceita novas versões.');
  } else {
    await exigirNoPrazo(tcc.periodo_id, tcc.curso_id, tipo === 'FINAL' ? 'VERSAO_FINAL' : 'VERSAO_PARCIAL');
  }

  if (tipo === 'FINAL' && !correcaoPosBanca) {
    // RN-006: a versão final exige a aprovação do orientador na versão imediatamente anterior
    const ultima = (await q('SELECT numero, status FROM versoes WHERE tcc_id = ? ORDER BY numero DESC LIMIT 1', [tcc.id]))[0];
    if (!ultima || ultima.status !== 'APROVADA') {
      throw erro(409, 'A versão final só pode ser enviada depois que o orientador aprovar a versão imediatamente anterior.');
    }
  }

  const v = await transacao(async (conn) => {
    const nova = await inserirVersao(conn, tcc.id, tipo, req.file, descricao);
    if (tcc.status === 'EM_DESENVOLVIMENTO') {
      await mudarStatus(conn, tcc, 'EM_REVISAO', req.usuario.id, `Versão ${nova.numero} (${tipo === 'FINAL' ? 'final' : 'parcial'}) enviada`);
    }
    return nova;
  });

  if (correcaoPosBanca) {
    await notificar(await idsPorPapel('COORDENADOR'), 'Versão final corrigida enviada',
      `${tcc.aluno_nome} enviou a versão final corrigida do TCC "${tcc.titulo}".`, linkTcc(tcc));
  } else {
    await notificar(idsUsuariosOrientacao(tcc), 'Nova versão para revisão',
      `${tcc.aluno_nome} enviou a versão ${v.numero} do TCC "${tcc.titulo}".`, linkTcc(tcc));
  }
  res.status(201).json({ id: v.id, numero: v.numero });
}));

router.post('/:id/versoes/:versaoId/feedback', exigir('PROFESSOR'), wrap(async (req, res) => {
  const { tcc, papel } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  if (!papel.orientador) throw erro(403, 'Somente o orientador avalia as versões.');
  if (!['EM_REVISAO', 'EM_DESENVOLVIMENTO'].includes(tcc.status)) throw erro(409, 'O TCC não está em fase de revisão.');

  const versaoId = inteiro(req.params.versaoId, 'Versão');
  const versao = (await q('SELECT id, numero, status FROM versoes WHERE id = ? AND tcc_id = ?', [versaoId, tcc.id]))[0];
  if (!versao) throw erro(404, 'Versão não encontrada.');
  if (versao.status !== 'ENVIADA') throw erro(409, 'Esta versão já foi avaliada.');

  const status = String(req.body.status || '');
  if (!['APROVADA', 'AJUSTES'].includes(status)) throw erro(400, 'Resultado inválido.');
  const feedback = status === 'AJUSTES'
    ? texto(req.body.feedback, 'O feedback', { min: 5, max: 3000 })
    : (req.body.feedback ? texto(req.body.feedback, 'O feedback', { max: 3000 }) : null);

  await transacao(async (conn) => {
    await qc(conn, 'UPDATE versoes SET status = ?, feedback = ?, avaliada_por = ?, data_feedback = NOW() WHERE id = ?',
      [status, feedback, req.usuario.id, versaoId]);
    if (tcc.status === 'EM_REVISAO') {
      await mudarStatus(conn, tcc, 'EM_DESENVOLVIMENTO', req.usuario.id,
        `Versão ${versao.numero} ${status === 'APROVADA' ? 'aprovada' : 'devolvida para ajustes'} pelo orientador`);
    }
  });
  await notificar(tcc.aluno_usuario_id,
    status === 'APROVADA' ? 'Versão aprovada pelo orientador' : 'Ajustes solicitados pelo orientador',
    status === 'APROVADA'
      ? `Sua versão ${versao.numero} do TCC foi aprovada.${feedback ? ' Feedback: ' + feedback : ''}`
      : `Sua versão ${versao.numero} precisa de ajustes: ${feedback}`, linkTcc(tcc));
  res.json({ ok: true });
}));

// RN-003 (documento 1): TCC só vai à banca com aprovação formal do orientador
router.post('/:id/liberar-banca', exigir('PROFESSOR'), wrap(async (req, res) => {
  const { tcc, papel } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  if (!papel.orientador) throw erro(403, 'Somente o orientador pode liberar o TCC para a banca.');
  if (!['EM_DESENVOLVIMENTO', 'EM_REVISAO'].includes(tcc.status)) throw erro(409, 'O TCC não está em fase de desenvolvimento.');

  const ultima = (await q('SELECT tipo, status FROM versoes WHERE tcc_id = ? ORDER BY numero DESC LIMIT 1', [tcc.id]))[0];
  if (!ultima || ultima.tipo !== 'FINAL' || ultima.status !== 'APROVADA') {
    throw erro(409, 'Para liberar a banca, a versão mais recente deve ser a versão final já aprovada por você.');
  }
  await transacao((conn) => mudarStatus(conn, tcc, 'AGUARDANDO_BANCA', req.usuario.id, 'Aprovação formal do orientador para submissão à banca'));
  await notificar(await idsPorPapel('COORDENADOR'), 'TCC liberado para banca',
    `O TCC "${tcc.titulo}" (${tcc.aluno_nome}) foi liberado pelo orientador e aguarda formação de banca.`, linkTcc(tcc));
  await notificar(tcc.aluno_usuario_id, 'TCC liberado para a banca',
    'Seu orientador liberou o TCC para a banca. A coordenação irá agendar a defesa.', linkTcc(tcc));
  res.json({ ok: true });
}));

// ================================================================ Reuniões de orientação (RF-008)
router.post('/:id/reunioes', exigir('PROFESSOR'), wrap(async (req, res) => {
  const { tcc, papel } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  if (!papel.orientador && !papel.coorientador) throw erro(403, 'Somente o orientador ou coorientador registra reuniões.');
  if (['PROPOSTA', 'RECUSADO', ...R.STATUS_FINAIS].includes(tcc.status)) throw erro(409, 'Reuniões só podem ser registradas durante a orientação.');
  const data = dataISO(req.body.data, 'Data da reunião');
  const pauta = texto(req.body.pauta, 'A pauta', { min: 3, max: 2000 });
  const deliberacoes = texto(req.body.deliberacoes, 'As deliberações', { min: 3, max: 3000 });
  await q('INSERT INTO reunioes (tcc_id, data, pauta, deliberacoes, registrado_por) VALUES (?,?,?,?,?)',
    [tcc.id, data, pauta, deliberacoes, req.usuario.id]);
  await notificar(tcc.aluno_usuario_id, 'Reunião de orientação registrada',
    `Foi registrada a reunião de ${R.dataBR(data)} do seu TCC.`, linkTcc(tcc));
  res.status(201).json({ ok: true });
}));

router.delete('/:id/reunioes/:reuniaoId', wrap(async (req, res) => {
  const { tcc, papel } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  const reuniaoId = inteiro(req.params.reuniaoId, 'Reunião');
  const r = (await q('SELECT registrado_por FROM reunioes WHERE id = ? AND tcc_id = ?', [reuniaoId, tcc.id]))[0];
  if (!r) throw erro(404, 'Reunião não encontrada.');
  if (r.registrado_por !== req.usuario.id && !papel.gestor) throw erro(403, 'Apenas quem registrou a reunião pode excluí-la.');
  await q('DELETE FROM reunioes WHERE id = ?', [reuniaoId]);
  res.json({ ok: true });
}));

// ================================================================ Arquivamento (RN-006 do documento 1)
router.post('/:id/arquivar', gestor, wrap(async (req, res) => {
  const { tcc } = await acessoTcc(req.usuario, inteiro(req.params.id, 'TCC'));
  if (!['APROVADO', 'APROVADO_RESSALVAS'].includes(tcc.status)) {
    throw erro(409, 'Somente TCCs aprovados em banca podem ser arquivados.');
  }
  if (tcc.status === 'APROVADO_RESSALVAS') {
    const banca = (await q("SELECT encerrada_em FROM bancas WHERE tcc_id = ? AND status = 'REALIZADA' ORDER BY id DESC LIMIT 1", [tcc.id]))[0];
    const corrigida = await q(
      "SELECT id FROM versoes WHERE tcc_id = ? AND tipo = 'FINAL' AND data_envio > ? LIMIT 1", [tcc.id, banca ? banca.encerrada_em : '1970-01-01']);
    if (!corrigida.length) throw erro(409, 'Aguarde o envio da versão final corrigida (correções obrigatórias da banca).');
  }
  await transacao((conn) => mudarStatus(conn, tcc, 'ARQUIVADO', req.usuario.id, 'TCC arquivado pela coordenação', { arquivado_em: new Date() }));
  await notificar(tcc.aluno_usuario_id, 'TCC arquivado', 'Seu TCC foi arquivado. Ciclo concluído!', linkTcc(tcc));
  res.json({ ok: true });
}));

module.exports = router;
