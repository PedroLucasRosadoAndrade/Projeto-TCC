const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config');
const { q, transacao, qc } = require('../db');
const { autenticar, emitirCookie, limparCookie } = require('../auth');
const { erro, wrap } = require('../util');
const { validarSenha, emailValido } = require('../regras');
const { enviarEmail } = require('../mailer');

const router = express.Router();

// Hash fictício para gastar o mesmo tempo quando o e-mail não existe (evita descobrir e-mails cadastrados).
const HASH_FALSO = bcrypt.hashSync('senha-inexistente-123', 10);

// Limitador simples de tentativas de login (5 falhas / 15 min por IP + e-mail)
const tentativas = new Map();
const JANELA_MS = 15 * 60 * 1000;
const MAX_FALHAS = 5;

function chaveTentativa(req, email) {
  return `${req.ip}|${email}`;
}
function bloqueado(chave) {
  const t = tentativas.get(chave);
  if (!t) return false;
  if (Date.now() - t.inicio > JANELA_MS) {
    tentativas.delete(chave);
    return false;
  }
  return t.falhas >= MAX_FALHAS;
}
function registrarFalha(chave) {
  const t = tentativas.get(chave);
  if (!t || Date.now() - t.inicio > JANELA_MS) tentativas.set(chave, { falhas: 1, inicio: Date.now() });
  else t.falhas += 1;
}

router.post('/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  if (!emailValido(email) || !senha) throw erro(400, 'Informe e-mail e senha.');

  const chave = chaveTentativa(req, email);
  if (bloqueado(chave)) throw erro(429, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.');

  const rows = await q('SELECT id, senha_hash, ativo FROM usuarios WHERE email = ?', [email]);
  const u = rows[0];
  const ok = await bcrypt.compare(senha, u ? u.senha_hash : HASH_FALSO);
  if (!u || !ok) {
    registrarFalha(chave);
    throw erro(401, 'E-mail ou senha incorretos.');
  }
  if (!u.ativo) throw erro(403, 'Seu acesso está inativo. Fale com a coordenação.');

  tentativas.delete(chave);
  await q('UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = ?', [u.id]);
  emitirCookie(res, u.id);
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => {
  limparCookie(res);
  res.json({ ok: true });
});

router.get('/me', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

// RF-002 — recuperação de senha por link com token (validade de 30 minutos)
router.post('/esqueci', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!emailValido(email)) throw erro(400, 'Informe um e-mail válido.');

  const rows = await q('SELECT id, nome FROM usuarios WHERE email = ? AND ativo = 1', [email]);
  if (rows.length) {
    const u = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await transacao(async (conn) => {
      await qc(conn, 'UPDATE tokens_recuperacao SET usado = 1 WHERE usuario_id = ? AND usado = 0', [u.id]);
      await qc(conn,
        'INSERT INTO tokens_recuperacao (usuario_id, token_hash, expira_em) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))',
        [u.id, hash]);
    });
    const link = `${config.appUrl}/login.html#/redefinir?token=${token}`;
    // sem await: o tempo de resposta não revela se o e-mail existe
    enviarEmail(email, '[TCC+] Recuperação de senha',
      `Olá, ${u.nome}.\n\nRecebemos um pedido para criar uma nova senha.\nAcesse o link abaixo (válido por 30 minutos):\n${link}\n\nSe não foi você, ignore esta mensagem.`);
  }
  // Resposta sempre igual, exista ou não o e-mail
  res.json({ ok: true });
}));

router.post('/redefinir', wrap(async (req, res) => {
  const token = String(req.body.token || '');
  const senha = String(req.body.senha || '');
  const msg = validarSenha(senha);
  if (msg) throw erro(400, msg);
  if (!/^[a-f0-9]{64}$/.test(token)) throw erro(400, 'Link inválido ou expirado. Solicite um novo.');

  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const rows = await q(
    'SELECT id, usuario_id FROM tokens_recuperacao WHERE token_hash = ? AND usado = 0 AND expira_em > NOW()', [hash]);
  if (!rows.length) throw erro(400, 'Link inválido ou expirado. Solicite um novo.');

  const senhaHash = await bcrypt.hash(senha, 10);
  await transacao(async (conn) => {
    await qc(conn, 'UPDATE usuarios SET senha_hash = ? WHERE id = ?', [senhaHash, rows[0].usuario_id]);
    await qc(conn, 'UPDATE tokens_recuperacao SET usado = 1 WHERE usuario_id = ?', [rows[0].usuario_id]);
  });
  res.json({ ok: true });
}));

router.post('/alterar-senha', autenticar, wrap(async (req, res) => {
  const atual = String(req.body.atual || '');
  const nova = String(req.body.nova || '');
  const msg = validarSenha(nova);
  if (msg) throw erro(400, msg);
  const rows = await q('SELECT senha_hash FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (!(await bcrypt.compare(atual, rows[0].senha_hash))) throw erro(400, 'A senha atual está incorreta.');
  await q('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [await bcrypt.hash(nova, 10), req.usuario.id]);
  res.json({ ok: true });
}));

module.exports = router;
