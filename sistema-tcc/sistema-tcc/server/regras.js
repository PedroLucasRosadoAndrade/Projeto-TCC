/**
 * Regras de negócio puras (sem acesso a banco), cobertas por tests/regras.test.js.
 * Referências: ERS (RN-001 a RN-006) e diagrama de classes.
 */

const STATUS_APROVADOS = ['APROVADO', 'APROVADO_RESSALVAS', 'ARQUIVADO'];
// Status em que o orientador já aceitou e o TCC "pesa" no limite de orientandos (RN-002)
const STATUS_ORIENTACAO_ATIVA = ['AGUARDANDO_HOMOLOGACAO', 'EM_DESENVOLVIMENTO', 'EM_REVISAO', 'AGUARDANDO_BANCA'];
const STATUS_FINAIS = ['APROVADO', 'APROVADO_RESSALVAS', 'REPROVADO', 'ARQUIVADO'];

const BANCA_MIN_AVALIADORES = 2; // RN-004
const BANCA_MAX_AVALIADORES = 4; // + 1 presidente = no máximo 5 titulares
const CRITERIOS = ['conteudo', 'metodologia', 'apresentacao', 'arguicao'];

function arredondar(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Converte "7,5" ou "7.5" em número; devolve null se inválido ou fora de 0–10. */
function lerNota(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return arredondar(n);
}

/** Média dos quatro critérios de um avaliador (RF-011). */
function mediaCriterios(notas) {
  const soma = CRITERIOS.reduce((acc, c) => acc + Number(notas[c]), 0);
  return arredondar(soma / CRITERIOS.length);
}

/** Nota final = média das notas dos avaliadores (RN-005). */
function mediaFinal(medias) {
  if (!medias.length) return null;
  return arredondar(medias.reduce((a, b) => a + Number(b), 0) / medias.length);
}

/** >= aprovação: APROVADO | >= ressalvas: RESSALVAS | abaixo: REPROVADO (RN-005). */
function resultadoPorMedia(media, { aprovacao = 7, ressalvas = 5 } = {}) {
  if (media >= aprovacao) return 'APROVADO';
  if (media >= ressalvas) return 'RESSALVAS';
  return 'REPROVADO';
}

function statusPorResultado(resultado) {
  return { APROVADO: 'APROVADO', RESSALVAS: 'APROVADO_RESSALVAS', REPROVADO: 'REPROVADO' }[resultado];
}

/** Política mínima de senha: 8+ caracteres, com letra e número. */
function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (senha.length > 72) return 'A senha deve ter no máximo 72 caracteres.';
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'A senha deve conter letras e números.';
  return null;
}

function emailValido(email) {
  return typeof email === 'string' && email.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Valida a composição da banca.
 * membros: [{ docente_id, tipo: 'PRESIDENTE'|'AVALIADOR'|'SUPLENTE' }]
 * RN-004: mínimo de 2 avaliadores e 1 presidente.
 * RN-003: o orientador do TCC não pode atuar como avaliador do próprio orientando
 *         (pode presidir a banca, mas não lança nota).
 */
function validarComposicaoBanca(membros, { orientadorId }) {
  const erros = [];
  if (!Array.isArray(membros) || membros.length === 0) return ['Informe os membros da banca.'];

  const ids = membros.map((m) => Number(m.docente_id));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) erros.push('Há membro da banca inválido.');
  if (new Set(ids).size !== ids.length) erros.push('Um docente não pode ocupar duas posições na mesma banca.');
  if (membros.some((m) => !['PRESIDENTE', 'AVALIADOR', 'SUPLENTE'].includes(m.tipo))) {
    erros.push('Tipo de membro inválido.');
  }

  const presidentes = membros.filter((m) => m.tipo === 'PRESIDENTE');
  const avaliadores = membros.filter((m) => m.tipo === 'AVALIADOR');
  if (presidentes.length !== 1) erros.push('A banca deve ter exatamente 1 presidente.');
  if (avaliadores.length < BANCA_MIN_AVALIADORES) {
    erros.push(`A banca deve ter no mínimo ${BANCA_MIN_AVALIADORES} avaliadores.`);
  }
  if (avaliadores.length > BANCA_MAX_AVALIADORES) {
    erros.push(`A banca pode ter no máximo ${BANCA_MAX_AVALIADORES} avaliadores (mais o presidente).`);
  }
  if (orientadorId && avaliadores.some((m) => Number(m.docente_id) === Number(orientadorId))) {
    erros.push('O orientador não pode ser avaliador da banca do próprio orientando (pode apenas presidir).');
  }
  return erros;
}

/**
 * Quem lança nota: membros titulares (presidente e avaliadores), exceto o orientador (RN-003).
 */
function membrosQueAvaliam(membros, orientadorId) {
  return membros.filter(
    (m) => m.tipo !== 'SUPLENTE' && Number(m.docente_id) !== Number(orientadorId || 0)
  );
}

/**
 * Define se o aluno cursará TCC 1 ou TCC 2.
 * O aluno só pode ter TCC 2 após aprovação no TCC 1.
 * anteriores: [{ tipo, status }] do aluno no curso.
 */
function proximoTipoTcc(anteriores) {
  const aprovado = (tipo) => anteriores.some((t) => t.tipo === tipo && STATUS_APROVADOS.includes(t.status));
  if (aprovado('TCC2')) return { erro: 'Você já concluiu o TCC 2 neste curso.' };
  if (aprovado('TCC1')) return { tipo: 'TCC2' };
  return { tipo: 'TCC1' };
}

/** Data de hoje no formato YYYY-MM-DD (fuso local). */
function hojeISO(data = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`;
}

/** Prazo vencido quando hoje é posterior à data limite (o próprio dia limite ainda vale). */
function prazoVencido(dataLimite, hoje = hojeISO()) {
  return hoje > String(dataLimite).slice(0, 10);
}

function dataBR(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10).split('-').reverse().join('/');
}

module.exports = {
  STATUS_APROVADOS, STATUS_ORIENTACAO_ATIVA, STATUS_FINAIS,
  BANCA_MIN_AVALIADORES, BANCA_MAX_AVALIADORES, CRITERIOS,
  arredondar, lerNota, mediaCriterios, mediaFinal, resultadoPorMedia, statusPorResultado,
  validarSenha, emailValido, validarComposicaoBanca, membrosQueAvaliam, proximoTipoTcc,
  hojeISO, prazoVencido, dataBR,
};
