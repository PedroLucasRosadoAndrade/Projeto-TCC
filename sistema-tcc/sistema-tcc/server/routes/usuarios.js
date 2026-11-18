const express = require('express');
const bcrypt = require('bcryptjs');
const { q, transacao, qc } = require('../db');
const { autenticar, gestor } = require('../auth');
const { erro, wrap, texto, inteiro } = require('../util');
const { validarSenha, emailValido } = require('../regras');

const router = express.Router();
router.use(autenticar, gestor); // RF-04: gestão de usuários pela coordenação

const PAPEIS = ['ADMIN', 'COORDENADOR', 'PROFESSOR', 'ALUNO'];
const PAPEIS_RESTRITOS = ['ADMIN', 'COORDENADOR']; // só o administrador concede

router.get('/', wrap(async (req, res) => {
  const filtros = [];
  const params = [];
  if (req.query.q) {
    filtros.push('(u.nome LIKE ? OR u.email LIKE ? OR a.matricula LIKE ? OR d.matricula_funcional LIKE ?)');
    const like = `%${String(req.query.q).trim()}%`;
    params.push(like, like, like, like);
  }
  if (PAPEIS.includes(req.query.papel)) {
    filtros.push(`EXISTS (SELECT 1 FROM usuario_papeis x JOIN papeis y ON y.id = x.papel_id
                           WHERE x.usuario_id = u.id AND y.nome = ?)`);
    params.push(req.query.papel);
  }
  const usuarios = await q(
    `SELECT u.id, u.nome, u.email, u.telefone, u.ativo, u.criado_em, u.ultimo_acesso,
            a.matricula, a.curso_id, a.status AS aluno_status, c.nome AS curso_nome,
            d.matricula_funcional, d.area, d.titulacao, d.limite_orientandos, d.externo, d.instituicao
       FROM usuarios u
       LEFT JOIN alunos a ON a.usuario_id = u.id
       LEFT JOIN cursos c ON c.id = a.curso_id
       LEFT JOIN docentes d ON d.usuario_id = u.id
      ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
      ORDER BY u.nome LIMIT 500`, params);

  const papeis = usuarios.length
    ? await q(`SELECT up.usuario_id, p.nome FROM usuario_papeis up JOIN papeis p ON p.id = up.papel_id
                WHERE up.usuario_id IN (?) ORDER BY p.id`, [usuarios.map((u) => u.id)])
    : [];
  res.json(usuarios.map((u) => ({
    ...u,
    papeis: papeis.filter((p) => p.usuario_id === u.id).map((p) => p.nome),
  })));
}));

/** Valida o corpo (criação e edição) e devolve os dados limpos. */
function lerCorpo(req, { criacao }) {
  const b = req.body;
  const nome = texto(b.nome, 'O nome', { min: 3, max: 150 });
  const email = String(b.email || '').trim().toLowerCase();
  if (!emailValido(email)) throw erro(400, 'Informe um e-mail válido.');
  const telefone = b.telefone ? texto(b.telefone, 'O telefone', { max: 25 }) : null;

  const papeis = [...new Set(Array.isArray(b.papeis) ? b.papeis : [])];
  if (!papeis.length || papeis.some((p) => !PAPEIS.includes(p))) throw erro(400, 'Selecione ao menos um perfil válido.');
  if (!req.usuario.ehAdmin && papeis.some((p) => PAPEIS_RESTRITOS.includes(p))) {
    throw erro(403, 'Apenas o administrador pode conceder os perfis Administrador e Coordenador.');
  }

  let senha = null;
  if (criacao || b.senha) {
    const msg = validarSenha(b.senha);
    if (msg) throw erro(400, msg);
    senha = b.senha;
  }

  let aluno = null;
  if (papeis.includes('ALUNO')) {
    const a = b.aluno || {};
    aluno = {
      matricula: texto(a.matricula, 'A matrícula', { min: 3, max: 30 }),
      cursoId: inteiro(a.curso_id, 'Curso'),
      status: ['ATIVO', 'TRANCADO', 'CONCLUIDO', 'INATIVO'].includes(a.status) ? a.status : 'ATIVO',
    };
  }
  let docente = null;
  if (papeis.includes('PROFESSOR')) {
    const d = b.docente || {};
    const limite = Number(d.limite_orientandos || 8);
    if (!Number.isInteger(limite) || limite < 1 || limite > 50) throw erro(400, 'Limite de orientandos inválido (1 a 50).');
    docente = {
      matricula: texto(d.matricula_funcional, 'A matrícula funcional', { min: 3, max: 30 }),
      area: d.area ? texto(d.area, 'A área', { max: 120 }) : null,
      titulacao: d.titulacao ? texto(d.titulacao, 'A titulação', { max: 60 }) : null,
      limite,
      externo: d.externo ? 1 : 0,
      instituicao: d.externo && d.instituicao ? texto(d.instituicao, 'A instituição', { max: 150 }) : null,
    };
  }
  return { nome, email, telefone, papeis, senha, aluno, docente };
}

async function gravarVinculos(conn, usuarioId, dados) {
  await qc(conn, 'DELETE FROM usuario_papeis WHERE usuario_id = ?', [usuarioId]);
  const ids = await qc(conn, 'SELECT id, nome FROM papeis WHERE nome IN (?)', [dados.papeis]);
  await qc(conn, 'INSERT INTO usuario_papeis (usuario_id, papel_id) VALUES ?', [ids.map((p) => [usuarioId, p.id])]);

  // Sem "upsert" por chave única: uma matrícula repetida deve gerar erro, nunca sobrescrever outra pessoa.
  if (dados.aluno) {
    const a = dados.aluno;
    const existe = await qc(conn, 'SELECT id FROM alunos WHERE usuario_id = ?', [usuarioId]);
    if (existe.length) {
      await qc(conn, 'UPDATE alunos SET matricula = ?, curso_id = ?, status = ? WHERE usuario_id = ?',
        [a.matricula, a.cursoId, a.status, usuarioId]);
    } else {
      await qc(conn, 'INSERT INTO alunos (usuario_id, matricula, curso_id, status) VALUES (?,?,?,?)',
        [usuarioId, a.matricula, a.cursoId, a.status]);
    }
  }
  if (dados.docente) {
    const d = dados.docente;
    const existe = await qc(conn, 'SELECT id FROM docentes WHERE usuario_id = ?', [usuarioId]);
    if (existe.length) {
      await qc(conn,
        `UPDATE docentes SET matricula_funcional = ?, area = ?, titulacao = ?, limite_orientandos = ?,
                externo = ?, instituicao = ? WHERE usuario_id = ?`,
        [d.matricula, d.area, d.titulacao, d.limite, d.externo, d.instituicao, usuarioId]);
    } else {
      await qc(conn,
        `INSERT INTO docentes (usuario_id, matricula_funcional, area, titulacao, limite_orientandos, externo, instituicao)
         VALUES (?,?,?,?,?,?,?)`,
        [usuarioId, d.matricula, d.area, d.titulacao, d.limite, d.externo, d.instituicao]);
    }
  }
}

router.post('/', wrap(async (req, res) => {
  const dados = lerCorpo(req, { criacao: true });
  const hash = await bcrypt.hash(dados.senha, 10);
  const id = await transacao(async (conn) => {
    const r = await qc(conn, 'INSERT INTO usuarios (nome, email, senha_hash, telefone) VALUES (?,?,?,?)',
      [dados.nome, dados.email, hash, dados.telefone]);
    await gravarVinculos(conn, r.insertId, dados);
    return r.insertId;
  });
  res.status(201).json({ id });
}));

router.put('/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, 'Usuário');
  const atual = await q(
    `SELECT u.id, GROUP_CONCAT(p.nome) AS papeis FROM usuarios u
       LEFT JOIN usuario_papeis up ON up.usuario_id = u.id LEFT JOIN papeis p ON p.id = up.papel_id
      WHERE u.id = ? GROUP BY u.id`, [id]);
  if (!atual.length) throw erro(404, 'Usuário não encontrado.');
  // coordenador não edita contas de administradores/coordenadores
  const papeisAtuais = (atual[0].papeis || '').split(',');
  if (!req.usuario.ehAdmin && papeisAtuais.some((p) => PAPEIS_RESTRITOS.includes(p))) {
    throw erro(403, 'Apenas o administrador pode editar este usuário.');
  }

  const dados = lerCorpo(req, { criacao: false });
  if (id === req.usuario.id && req.usuario.ehAdmin && !dados.papeis.includes('ADMIN')) {
    throw erro(400, 'Você não pode remover seu próprio perfil de administrador.');
  }
  await transacao(async (conn) => {
    await qc(conn, 'UPDATE usuarios SET nome = ?, email = ?, telefone = ? WHERE id = ?', [dados.nome, dados.email, dados.telefone, id]);
    if (dados.senha) await qc(conn, 'UPDATE usuarios SET senha_hash = ? WHERE id = ?', [await bcrypt.hash(dados.senha, 10), id]);
    await gravarVinculos(conn, id, dados);
  });
  res.json({ ok: true });
}));

router.patch('/:id/ativo', wrap(async (req, res) => {
  const id = inteiro(req.params.id, 'Usuário');
  if (id === req.usuario.id) throw erro(400, 'Você não pode inativar o próprio acesso.');
  const alvo = await q(
    `SELECT GROUP_CONCAT(p.nome) AS papeis FROM usuarios u
       LEFT JOIN usuario_papeis up ON up.usuario_id = u.id LEFT JOIN papeis p ON p.id = up.papel_id
      WHERE u.id = ? GROUP BY u.id`, [id]);
  if (!alvo.length) throw erro(404, 'Usuário não encontrado.');
  if (!req.usuario.ehAdmin && (alvo[0].papeis || '').split(',').some((p) => PAPEIS_RESTRITOS.includes(p))) {
    throw erro(403, 'Apenas o administrador pode alterar este usuário.');
  }
  await q('UPDATE usuarios SET ativo = ? WHERE id = ?', [req.body.ativo ? 1 : 0, id]);
  res.json({ ok: true });
}));



// Excluir usuário permanentemente
router.delete('/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, 'Usuário');

  // Impede excluir a própria conta
  if (id === req.usuario.id) {
    throw erro(400, 'Você não pode excluir sua própria conta.');
  }

  // Verifica se o usuário existe e identifica seus perfis
  const alvo = await q(
    `SELECT u.id, u.nome, GROUP_CONCAT(p.nome) AS papeis
       FROM usuarios u
       LEFT JOIN usuario_papeis up ON up.usuario_id = u.id
       LEFT JOIN papeis p ON p.id = up.papel_id
      WHERE u.id = ?
      GROUP BY u.id`,
    [id]
  );

  if (!alvo.length) {
    throw erro(404, 'Usuário não encontrado.');
  }

  const papeis = (alvo[0].papeis || '').split(',');

  // Coordenadores não podem excluir administradores ou coordenadores
  if (!req.usuario.ehAdmin &&
    papeis.some(p => PAPEIS_RESTRITOS.includes(p))) {
    throw erro(403, 'Apenas o administrador pode excluir este usuário.');
  }

  // Impede excluir o último administrador
  if (papeis.includes('ADMIN')) {
    const admins = await q(
      `SELECT COUNT(*) AS total
         FROM usuario_papeis up
         JOIN papeis p ON p.id = up.papel_id
        WHERE p.nome = 'ADMIN'`
    );

    if (Number(admins[0].total) <= 1) {
      throw erro(400, 'Não é possível excluir o último administrador do sistema.');
    }
  }

  // Verifica se o usuário é aluno
  const alunos = await q(
    'SELECT id FROM alunos WHERE usuario_id = ?',
    [id]
  );

  if (alunos.length) {
    const tccs = await q(
      'SELECT id FROM tccs WHERE aluno_id = ? LIMIT 1',
      [alunos[0].id]
    );

    if (tccs.length) {
      throw erro(
        409,
        'Este aluno possui TCC cadastrado. Inative o usuário em vez de excluí-lo.'
      );
    }
  }

  // Verifica se o usuário é professor
  const docentes = await q(
    'SELECT id FROM docentes WHERE usuario_id = ?',
    [id]
  );

  if (docentes.length) {
    const docenteId = docentes[0].id;

    // Verifica participação em TCCs
    const tccs = await q(
      `SELECT id FROM tccs
        WHERE orientador_id = ? OR coorientador_id = ?
        LIMIT 1`,
      [docenteId, docenteId]
    );

    // Verifica participação em bancas
    const bancas = await q(
      'SELECT id FROM banca_membros WHERE docente_id = ? LIMIT 1',
      [docenteId]
    );

    // Verifica avaliações registradas
    const avaliacoes = await q(
      'SELECT id FROM avaliacoes WHERE docente_id = ? LIMIT 1',
      [docenteId]
    );

    if (tccs.length || bancas.length || avaliacoes.length) {
      throw erro(
        409,
        'Este professor possui vínculos acadêmicos. Inative o usuário em vez de excluí-lo.'
      );
    }
  }

  // Exclui o usuário e seus vínculos em uma transação
  await transacao(async (conn) => {
    await qc(
      conn,
      'DELETE FROM usuarios WHERE id = ?',
      [id]
    );
  });

  res.json({
    ok: true,
    mensagem: 'Usuário excluído com sucesso.'
  });
}));


module.exports = router;
