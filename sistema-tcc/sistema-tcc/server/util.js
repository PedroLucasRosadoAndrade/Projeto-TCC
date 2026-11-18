const fs = require('fs');
const { q, qc } = require('./db');
const { enviarEmail } = require('./mailer');
const { prazoVencido, dataBR } = require('./regras');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const erro = (status, mensagem) => new HttpError(status, mensagem);

/** Envolve handlers async para repassar erros ao middleware de erro. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Texto obrigatório com tamanho mínimo/máximo. */
function texto(valor, rotulo, { min = 1, max = 255 } = {}) {
  const v = typeof valor === 'string' ? valor.trim() : '';
  if (v.length < min) throw erro(400, min <= 1 ? `Informe ${rotulo}.` : `${rotulo} deve ter pelo menos ${min} caracteres.`);
  if (v.length > max) throw erro(400, `${rotulo} deve ter no máximo ${max} caracteres.`);
  return v;
}

function inteiro(valor, rotulo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw erro(400, `${rotulo} inválido.`);
  return n;
}

function dataISO(valor, rotulo) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(valor))) {
    throw erro(400, `${rotulo} inválida.`);
  }
  return valor;
}

/** Registra mudança de status com data, hora e responsável (RN-07 / auditoria). */
async function registrarStatus(conn, tccId, anterior, novo, usuarioId, justificativa = null) {
  await qc(conn,
    'INSERT INTO historico_status (tcc_id, status_anterior, status_novo, usuario_id, justificativa) VALUES (?,?,?,?,?)',
    [tccId, anterior, novo, usuarioId, justificativa]);
}

/** Ids de usuários com algum dos papéis informados. */
async function idsPorPapel(...papeis) {
  const rows = await q(
    `SELECT DISTINCT up.usuario_id FROM usuario_papeis up
       JOIN papeis p ON p.id = up.papel_id JOIN usuarios u ON u.id = up.usuario_id
      WHERE p.nome IN (?) AND u.ativo = 1`, [papeis]);
  return rows.map((r) => r.usuario_id);
}

/**
 * Cria notificação interna e envia e-mail (RF16 / "notificações de status e prazos").
 * Falhas aqui são registradas, mas não interrompem o fluxo.
 */
async function notificar(usuarioIds, titulo, mensagem, link = null) {
  try {
    const ids = [...new Set((Array.isArray(usuarioIds) ? usuarioIds : [usuarioIds]).filter(Boolean))];
    if (!ids.length) return;
    await q('INSERT INTO notificacoes (usuario_id, titulo, mensagem, link) VALUES ?',
      [ids.map((id) => [id, titulo.slice(0, 150), mensagem.slice(0, 500), link])]);
    const usuarios = await q('SELECT email FROM usuarios WHERE id IN (?) AND ativo = 1', [ids]);
    usuarios.forEach((u) => enviarEmail(u.email, `[TCC+] ${titulo}`, `${mensagem}\n\n— Sistema de Gestão de TCC | Afya Ji-Paraná`));
  } catch (e) {
    console.error('Falha ao notificar:', e.message);
  }
}

/** Busca o prazo mais específico (do curso, senão geral) da etapa. */
async function buscarPrazo(periodoId, cursoId, etapa) {
  const rows = await q(
    `SELECT * FROM prazos
      WHERE periodo_id = ? AND etapa = ? AND (curso_id = ? OR curso_id IS NULL)
      ORDER BY (curso_id IS NULL), id DESC LIMIT 1`, [periodoId, etapa, cursoId]);
  return rows[0] || null;
}

/** Bloqueia envios fora do prazo definido pela coordenação (RF-013). */
async function exigirNoPrazo(periodoId, cursoId, etapa) {
  const prazo = await buscarPrazo(periodoId, cursoId, etapa);
  if (prazo && prazoVencido(prazo.data_limite)) {
    throw erro(403, `Prazo encerrado: "${prazo.titulo}" terminou em ${dataBR(prazo.data_limite)}. Procure a coordenação.`);
  }
}

async function periodoVigente() {
  const rows = await q('SELECT * FROM periodos_letivos WHERE vigente = 1 ORDER BY id DESC LIMIT 1');
  return rows[0] || null;
}

async function lerConfiguracoes() {
  const rows = await q('SELECT chave, valor FROM configuracoes');
  const c = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  return {
    limiteOrientandos: Number(c.limite_orientandos_padrao) || 8,
    mediaAprovacao: Number(c.media_aprovacao) || 7,
    mediaRessalvas: Number(c.media_ressalvas) || 5,
  };
}

function removerArquivo(caminho) {
  if (caminho) fs.unlink(caminho, () => {});
}

module.exports = {
  HttpError, erro, wrap, texto, inteiro, dataISO,
  registrarStatus, idsPorPapel, notificar,
  buscarPrazo, exigirNoPrazo, periodoVigente, lerConfiguracoes, removerArquivo,
};
