// Utilitários de interface: escape de HTML, formatação, chips, modal, toasts, CSV.
import { icone } from './icons.js';

export function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
export const fmtHora = (h) => (h ? String(h).slice(0, 5) : '');
export const fmtDataHora = (iso) => (iso ? `${fmtData(iso)} às ${String(iso).slice(11, 16)}` : '—');
export const fmtNota = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(2).replace('.', ','));
export const fmtTamanho = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function hojeISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Dias entre hoje e a data (negativo = já passou). */
export function diasAte(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const alvo = new Date(a, m - 1, d);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje) / 86400000);
}

export const STATUS = {
  PROPOSTA: ['Aguardando orientador', 'info'],
  AGUARDANDO_HOMOLOGACAO: ['Aguardando homologação', 'warn'],
  RECUSADO: ['Proposta precisa de ajustes', 'danger'],
  EM_DESENVOLVIMENTO: ['Em desenvolvimento', 'primary'],
  EM_REVISAO: ['Em revisão', 'warn'],
  AGUARDANDO_BANCA: ['Aguardando banca', 'info'],
  APROVADO: ['Aprovado', 'ok'],
  APROVADO_RESSALVAS: ['Aprovado com ressalvas', 'ok'],
  REPROVADO: ['Reprovado', 'danger'],
  ARQUIVADO: ['Arquivado', ''],
};
export const ETAPAS_STATUS = ['PROPOSTA', 'AGUARDANDO_HOMOLOGACAO', 'EM_DESENVOLVIMENTO', 'EM_REVISAO', 'AGUARDANDO_BANCA', 'APROVADO'];

export const rotuloStatus = (s) => (STATUS[s] ? STATUS[s][0] : s);
export function chipStatus(s) {
  const [rotulo, tom] = STATUS[s] || [s, ''];
  return `<span class="chip ${tom}">${esc(rotulo)}</span>`;
}

export const VERSAO_STATUS = { ENVIADA: ['Aguardando avaliação', 'warn'], APROVADA: ['Aprovada', 'ok'], AJUSTES: ['Ajustes solicitados', 'danger'] };
export const VERSAO_TIPO = { PRE_PROJETO: 'Pré-projeto', PARCIAL: 'Versão parcial', FINAL: 'Versão final' };
export const RESULTADO = { APROVADO: 'Aprovado', RESSALVAS: 'Aprovado com ressalvas', REPROVADO: 'Reprovado' };
export const BANCA_STATUS = { AGENDADA: ['Agendada', 'info'], REALIZADA: ['Realizada', 'ok'], CANCELADA: ['Cancelada', 'danger'] };
export const PAPEL_ROTULO = { ADMIN: 'Administrador', COORDENADOR: 'Coordenação', PROFESSOR: 'Professor', ALUNO: 'Aluno' };
export const MEMBRO_ROTULO = { PRESIDENTE: 'Presidente', AVALIADOR: 'Avaliador', SUPLENTE: 'Suplente' };
export const ETAPA_ROTULO = { PROPOSTA: 'Cadastro da proposta', VERSAO_PARCIAL: 'Versão parcial', VERSAO_FINAL: 'Versão final', DEFESA: 'Defesas' };

export function chip(texto, tom = '') {
  return `<span class="chip ${tom}">${esc(texto)}</span>`;
}

export function opcoes(lista, valor, rotulo, selecionado, vazio) {
  const ini = vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : '';
  return ini + lista.map((i) => {
    const v = typeof valor === 'function' ? valor(i) : i[valor];
    const r = typeof rotulo === 'function' ? rotulo(i) : i[rotulo];
    return `<option value="${esc(v)}" ${String(v) === String(selecionado ?? '') ? 'selected' : ''}>${esc(r)}</option>`;
  }).join('');
}

export function formDados(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// ---------------------------------------------------------------- Toasts
export function toast(mensagem, tipo = '') {
  const area = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = mensagem;
  area.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 6000 : 3500);
}

// ---------------------------------------------------------------- Modal
/**
 * Abre um modal. onConfirm(modal) pode lançar erro (exibido no modal) ou devolver false para manter aberto.
 * Devolve uma Promise<boolean>: true se confirmado com sucesso.
 */
export function abrirModal({ titulo, html, confirmar = 'Salvar', cancelar = 'Cancelar', perigo = false, larga = false, onConfirm, onAbrir }) {
  return new Promise((resolve) => {
    const anterior = document.activeElement;
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
      <div class="modal ${larga ? 'larga' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-titulo">
        <h2 id="modal-titulo">${esc(titulo)}</h2>
        <div class="modal-erro" hidden role="alert"></div>
        <div class="modal-corpo">${html}</div>
        <div class="modal-rodape">
          ${cancelar ? `<button type="button" class="btn neutro" data-m="cancelar">${esc(cancelar)}</button>` : ''}
          ${confirmar ? `<button type="button" class="btn ${perigo ? 'perigo' : ''}" data-m="confirmar">${esc(confirmar)}</button>` : ''}
        </div>
      </div>`;
    document.body.appendChild(fundo);
    const modal = fundo.querySelector('.modal');
    const erroEl = fundo.querySelector('.modal-erro');
    const btnOk = fundo.querySelector('[data-m="confirmar"]');

    const fechar = (resultado) => {
      document.removeEventListener('keydown', teclas);
      fundo.remove();
      if (anterior && anterior.focus) anterior.focus();
      resolve(resultado);
    };

    async function executar() {
      const form = modal.querySelector('form');
      if (form && !form.checkValidity()) { form.reportValidity(); return; }
      if (!onConfirm) return fechar(true);
      erroEl.hidden = true;
      if (btnOk) btnOk.disabled = true;
      try {
        const r = await onConfirm(modal);
        if (r !== false) fechar(true);
      } catch (e) {
        erroEl.textContent = e.message;
        erroEl.hidden = false;
        erroEl.scrollIntoView({ block: 'nearest' });
      } finally {
        if (btnOk) btnOk.disabled = false;
      }
    }

    function teclas(e) {
      if (e.key === 'Escape') fechar(false);
    }
    document.addEventListener('keydown', teclas);

    fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(false); });
    fundo.querySelector('[data-m="cancelar"]')?.addEventListener('click', () => fechar(false));
    btnOk?.addEventListener('click', executar);
    modal.querySelector('form')?.addEventListener('submit', (e) => { e.preventDefault(); executar(); });

    if (onAbrir) onAbrir(modal);
    const foco = modal.querySelector('input:not([type=hidden]), select, textarea') || btnOk;
    if (foco) foco.focus();
  });
}

export function confirmarAcao(titulo, mensagem, { confirmar = 'Confirmar', perigo = false } = {}) {
  return abrirModal({ titulo, html: `<p>${esc(mensagem)}</p>`, confirmar, perigo });
}

// ---------------------------------------------------------------- CSV (abre no Excel em pt-BR)
export function baixarCSV(nomeArquivo, cabecalhos, linhas) {
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const texto = [cabecalhos, ...linhas].map((l) => l.map(cel).join(';')).join('\r\n');
  const blob = new Blob(['\ufeff' + texto], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function cabecalho(titulo, sub = '', acoes = '') {
  return `<div class="cabecalho"><div><h1>${esc(titulo)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>
    ${acoes ? `<div class="acoes sem-impressao">${acoes}</div>` : ''}</div>`;
}

export function botao(texto, { acao, icon, classe = '', dados = {}, tipo = 'button' } = {}) {
  const attrs = Object.entries(dados).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<button type="${tipo}" class="btn ${classe}" ${acao ? `data-acao="${acao}"` : ''} ${attrs}>${icon ? icone(icon, 15) : ''}${esc(texto)}</button>`;
}

/** Delegação de cliques por data-acao dentro de um container. */
export function ligarAcoes(container, handlers) {
  container.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-acao]');
    if (!el || !container.contains(el)) return;
    const fn = handlers[el.dataset.acao];
    if (!fn) return;
    e.preventDefault();
    try {
      await fn(el, e);
    } catch (err) {
      toast(err.message, 'erro');
    }
  });
}
