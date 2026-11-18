// Aplicação principal (SPA simples em JavaScript puro)
// Rotas controladas por hash (#/painel, #/tccs, #/tcc/:id, #/bancas, #/banca/:id, #/ata/:id, #/cronograma, #/relatorios, #/usuarios, #/notificacoes, #/perfil)

import { icone } from './icons.js';
import { get, post, put, patch, del, qs } from './api.js';
import {
  esc, fmtData, fmtHora, fmtDataHora, fmtNota, fmtTamanho, hojeISO, diasAte,
  STATUS, ETAPAS_STATUS, rotuloStatus, chipStatus, VERSAO_STATUS, VERSAO_TIPO,
  RESULTADO, BANCA_STATUS, PAPEL_ROTULO, MEMBRO_ROTULO, ETAPA_ROTULO,
  chip, opcoes, formDados, toast, abrirModal, confirmarAcao, baixarCSV,
  cabecalho, botao, ligarAcoes,
} from './ui.js';

const elConteudo = document.getElementById('conteudo');
const elTopo = document.getElementById('topo');
const elMenu = document.getElementById('menu');
const elSino = document.getElementById('sino');

let usuario = null;

// =====================================================================
//  INICIALIZAÇÃO E MENU SUPERIOR
// =====================================================================

async function iniciar() {
  try {
    const r = await get('/auth/me');
    usuario = r.usuario;
  } catch {
    location.href = '/login.html';
    return;
  }

  montarTopo();
  await atualizarSino();
  window.addEventListener('hashchange', rotear);
  rotear();
}

function montarTopo() {
  elTopo.hidden = false;
  const iniciais = usuario.nome.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  document.getElementById('avatar').textContent = iniciais || 'U';
  document.getElementById('usuario-nome').textContent = usuario.nome;

  const itens = [
    { href: '#/painel', ic: 'painel', texto: 'Painel' },
    { href: '#/tccs', ic: 'livro', texto: usuario.papeis.includes('ALUNO') && !usuario.ehGestor ? 'Meu TCC' : 'TCCs' },
    { href: '#/bancas', ic: 'usuarios', texto: 'Bancas' },
    { href: '#/cronograma', ic: 'calendario', texto: 'Cronograma' },
  ];
  if (usuario.ehGestor) {
    itens.push({ href: '#/relatorios', ic: 'grafico', texto: 'Relatórios' });
    itens.push({ href: '#/usuarios', ic: 'usuario', texto: 'Usuários' });
  }
  elMenu.innerHTML = itens.map((i) => `<a href="${i.href}">${icone(i.ic, 15)}<span>${esc(i.texto)}</span></a>`).join('');

  const btnMenu = document.getElementById('btn-menu');
  btnMenu.innerHTML = icone('menu', 20);
  btnMenu.onclick = () => {
    const aberto = elMenu.classList.toggle('aberto');
    btnMenu.setAttribute('aria-expanded', String(aberto));
  };
  elMenu.addEventListener('click', () => elMenu.classList.remove('aberto'));

  document.getElementById('btn-sair').onclick = async () => {
    await post('/auth/logout');
    location.href = '/login.html';
  };
}

async function atualizarSino() {
  try {
    const { naoLidas } = await get('/notificacoes/contagem');
    elSino.innerHTML = `${icone('sino', 18)}${naoLidas ? `<span class="contador">${naoLidas > 9 ? '9+' : naoLidas}</span>` : ''}`;
  } catch {
    elSino.innerHTML = icone('sino', 18);
  }
}

function marcarMenuAtivo(rota) {
  const prefixo = rota.startsWith('tcc') ? '#/tccs' : (rota.startsWith('banca') || rota.startsWith('ata') ? '#/bancas' : `#/${rota}`);
  elMenu.querySelectorAll('a').forEach((a) => a.classList.toggle('ativo', a.getAttribute('href') === prefixo));
}

async function rotear() {
  const hash = location.hash.replace(/^#\/?/, '') || 'painel';
  const [rota, param] = hash.split('/');
  marcarMenuAtivo(rota);
  elConteudo.innerHTML = '<p class="carregando">Carregando…</p>';

  try {
    if (rota === 'painel') await telaPainel();
    else if (rota === 'tccs') await telaTccs();
    else if (rota === 'tcc' && param) await telaTccDetalhe(Number(param));
    else if (rota === 'bancas') await telaBancas();
    else if (rota === 'banca' && param) await telaBancaDetalhe(Number(param));
    else if (rota === 'ata' && param) await telaAta(Number(param));
    else if (rota === 'cronograma') await telaCronograma();
    else if (rota === 'relatorios') await telaRelatorios();
    else if (rota === 'usuarios') await telaUsuarios();
    else if (rota === 'notificacoes') await telaNotificacoes();
    else if (rota === 'perfil') await telaPerfil();
    else await telaPainel();
  } catch (e) {
    elConteudo.innerHTML = `<div class="card"><p class="aviso-bloco danger">${esc(e.message)}</p><a class="btn neutro" href="#/painel">Voltar ao painel</a></div>`;
  }
}

// =====================================================================
//  1. PAINEL DE CONTROLE (DASHBOARD)
// =====================================================================

async function telaPainel() {
  const d = await get('/dashboard');
  const perfis = usuario.papeis.map((p) => PAPEL_ROTULO[p] || p).join(' • ');
  const sub = `${perfis}${d.periodo ? ` — Período letivo ${d.periodo.nome}` : ''}`;

  let colPrincipal = '';

  // Bloco do Aluno
  if (usuario.alunoId) {
    const t = d.aluno;
    if (!t) {
      colPrincipal += `
        <div class="card destaque">
          <h2><span class="esq">${icone('livro')} Meu Trabalho de Conclusão de Curso</span></h2>
          <p class="suave">Você ainda não cadastrou uma proposta de TCC neste período letivo.</p>
          <a class="btn" href="#/tccs">${icone('mais', 15)} Cadastrar proposta de TCC</a>
        </div>`;
    } else {
      colPrincipal += `
        <div class="card destaque">
          <h2><span class="esq">${icone('livro')} ${esc(t.tipo)} — ${esc(t.periodo_nome)}</span> ${chipStatus(t.status)}</h2>
          <p style="font-weight:700; margin:4px 0 8px;">${esc(t.titulo)}</p>
          <p class="suave peq" style="margin:0 0 12px;">Orientador(a): <strong>${esc(t.orientador_nome || 'Não definido')}</strong> • Versões enviadas: ${t.versoes}</p>
          ${t.status === 'RECUSADO' && t.justificativa ? `<div class="aviso-bloco danger">Motivo para ajuste: ${esc(t.justificativa)}</div>` : ''}
          <a class="btn" href="#/tcc/${t.id}">Acompanhar TCC</a>
        </div>`;
    }
  }

  // Bloco do Professor / Orientador
  if (d.docente) {
    const dc = d.docente;
    colPrincipal += `
      <div class="grade c3" style="margin-bottom:16px;">
        <div class="card indicador"><div class="num">${dc.ativos}/${dc.limite}</div><div class="rot">Orientandos ativos</div></div>
        <div class="card indicador"><div class="num">${dc.pendentes.length}</div><div class="rot">Pedidos de orientação</div></div>
        <div class="card indicador"><div class="num">${dc.paraRevisar.length}</div><div class="rot">Versões para revisar</div></div>
      </div>
      <div class="card">
        <h2><span class="esq">${icone('prancheta')} Pendências de orientação e avaliação</span></h2>
        ${(!dc.pendentes.length && !dc.paraRevisar.length && !dc.avaliacoesPendentes.length)
        ? '<p class="vazio">Nenhuma pendência no momento.</p>'
        : `<ul class="lista">
              ${dc.pendentes.map((t) => `<li><div class="linha"><div><span class="tit">${esc(t.titulo)}</span><div class="suave peq">Solicitação de ${esc(t.aluno_nome)}</div></div><a class="btn mini" href="#/tcc/${t.id}">Responder</a></div></li>`).join('')}
              ${dc.paraRevisar.map((t) => `<li><div class="linha"><div><span class="tit">${esc(t.titulo)}</span><div class="suave peq">Nova versão de ${esc(t.aluno_nome)}</div></div><a class="btn mini sec" href="#/tcc/${t.id}">Avaliar versão</a></div></li>`).join('')}
              ${dc.avaliacoesPendentes.map((b) => `<li><div class="linha"><div><span class="tit">Banca de ${esc(b.aluno_nome)}</span><div class="suave peq">Defesa em ${fmtData(b.data)} — nota pendente</div></div><a class="btn mini" href="#/banca/${b.id}">Lançar nota</a></div></li>`).join('')}
            </ul>`}
      </div>`;
  }

  // Bloco da Coordenação / Administração
  if (d.gestao) {
    const g = d.gestao;
    colPrincipal += `
      <div class="grade c4" style="margin-bottom:16px;">
        <div class="card indicador"><div class="num">${g.total}</div><div class="rot">TCCs cadastrados</div></div>
        <div class="card indicador"><div class="num">${g.aguardandoHomologacao}</div><div class="rot">Aguardando homologação</div></div>
        <div class="card indicador"><div class="num">${g.aguardandoBanca}</div><div class="rot">Aguardando banca</div></div>
        <div class="card indicador"><div class="num">${(g.porStatus.APROVADO || 0) + (g.porStatus.APROVADO_RESSALVAS || 0) + (g.porStatus.ARQUIVADO || 0)}</div><div class="rot">Aprovados / Arquivados</div></div>
      </div>
      <div class="card">
        <h2><span class="esq">${icone('grafico')} Resumo por status</span> <a class="btn mini neutro" href="#/tccs">Ver todos</a></h2>
        <div class="tabela-wrap">
          <table>
            <thead><tr><th>Status</th><th>Quantidade</th></tr></thead>
            <tbody>
              ${Object.entries(STATUS).map(([chave]) => `<tr><td>${chipStatus(chave)}</td><td><strong>${g.porStatus[chave] || 0}</strong></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // Coluna lateral: prazos e próximas bancas
  const prazosHtml = d.prazos.length
    ? `<ul class="lista">${d.prazos.map((p) => {
      const dias = diasAte(p.data_limite);
      const tag = dias === 0 ? chip('Vence hoje', 'danger') : (dias <= 7 ? chip(`Em ${dias} dia(s)`, 'warn') : chip(fmtData(p.data_limite), ''));
      return `<li><div class="linha"><div><div class="tit">${esc(p.titulo)}</div><div class="suave peq">${esc(ETAPA_ROTULO[p.etapa] || p.etapa)} — até ${fmtData(p.data_limite)}</div></div>${tag}</div></li>`;
    }).join('')}</ul>`
    : '<p class="vazio">Nenhum prazo próximo cadastrado.</p>';

  const bancasLista = (d.gestao && d.gestao.proximasBancas) || (d.docente && d.docente.proximasBancas) || [];
  const bancasHtml = bancasLista.length
    ? `<ul class="lista">${bancasLista.map((b) => `<li><div class="linha"><div><a class="tit" href="#/banca/${b.id}">Defesa de ${esc(b.aluno_nome)}</a><div class="suave peq">${fmtData(b.data)} às ${fmtHora(b.hora)} • ${esc(b.local_defesa)}</div></div></div></li>`).join('')}</ul>`
    : '<p class="vazio">Nenhuma banca agendada.</p>';

  elConteudo.innerHTML = `
    ${cabecalho('Painel de controle', sub)}
    <div class="grade principal">
      <div>${colPrincipal}</div>
      <div>
        <div class="card">
          <h2><span class="esq">${icone('calendario')} Próximos prazos</span> <a class="peq" href="#/cronograma">Ver cronograma</a></h2>
          ${prazosHtml}
        </div>
        <div class="card">
          <h2><span class="esq">${icone('usuarios')} Próximas bancas</span> <a class="peq" href="#/bancas">Ver bancas</a></h2>
          ${bancasHtml}
        </div>
      </div>
    </div>`;
}

// =====================================================================
//  2. LISTAGEM E CADASTRO DE TCC (RF-004, RF-005, RF-006, RF-014)
// =====================================================================

async function telaTccs() {
  const [cursos, periodos, docentes, tccs] = await Promise.all([
    get('/cursos'),
    get('/periodos'),
    get('/docentes?para=orientacao'),
    get('/tccs'),
  ]);

  const podeCadastrar = usuario.papeis.includes('ALUNO') && !tccs.some((t) => t.aluno_id === usuario.alunoId && t.status !== 'REPROVADO');

  elConteudo.innerHTML = `
    ${cabecalho(
    usuario.papeis.includes('ALUNO') && !usuario.ehGestor ? 'Meu TCC' : 'Trabalhos de Conclusão de Curso',
    'Consulte o andamento, filtre por status ou cadastre uma nova proposta.',
    podeCadastrar ? botao('Nova proposta de TCC', { acao: 'novo-tcc', icon: 'mais' }) : ''
  )}
    <div class="card">
      <form id="f-filtro" class="filtros sem-impressao">
        <div class="campo"><label>Buscar</label><input type="search" name="q" placeholder="Aluno, matrícula ou título"></div>
        <div class="campo"><label>Status</label><select name="status">${opcoes(Object.entries(STATUS), (e) => e[0], (e) => e[1][0], '', 'Todos')}</select></div>
        ${usuario.ehGestor ? `
          <div class="campo"><label>Curso</label><select name="curso_id">${opcoes(cursos, 'id', 'nome', '', 'Todos')}</select></div>
          <div class="campo"><label>Período</label><select name="periodo_id">${opcoes(periodos, 'id', 'nome', '', 'Todos')}</select></div>
          <div class="campo"><label>Orientador</label><select name="orientador_id">${opcoes(docentes, 'id', 'nome', '', 'Todos')}</select></div>
        ` : ''}
        <button type="submit" class="btn neutro">${icone('busca', 14)} Filtrar</button>
      </form>
      <div id="lista-tccs"></div>
    </div>`;

  function renderLista(lista) {
    const box = document.getElementById('lista-tccs');
    if (!lista.length) {
      box.innerHTML = '<p class="vazio">Nenhum TCC encontrado.</p>';
      return;
    }
    box.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Título</th><th>Aluno</th><th>Curso / Período</th><th>Orientador</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${lista.map((t) => `
              <tr class="clicavel" data-href="#/tcc/${t.id}">
                <td><strong>${esc(t.titulo)}</strong><div class="suave peq">${esc(t.tipo)} • ${esc(t.area)}</div></td>
                <td>${esc(t.aluno_nome)}<div class="suave peq">Mat. ${esc(t.matricula)}</div></td>
                <td>${esc(t.curso_nome)}<div class="suave peq">${esc(t.periodo_nome)}</div></td>
                <td>${esc(t.orientador_nome || '—')}</td>
                <td>${chipStatus(t.status)}</td>
                <td class="acoes"><a class="btn mini neutro" href="#/tcc/${t.id}">Abrir</a></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    box.querySelectorAll('tr[data-href]').forEach((tr) => {
      tr.onclick = (e) => { if (!e.target.closest('a,button')) location.hash = tr.dataset.href; };
    });
  }

  renderLista(tccs);

  document.getElementById('f-filtro').onsubmit = async (e) => {
    e.preventDefault();
    const filtros = formDados(e.currentTarget);
    renderLista(await get(`/tccs${qs(filtros)}`));
  };

  ligarAcoes(elConteudo, {
    'novo-tcc': () => modalProposta({ docentes }),
  });
}

async function modalProposta({ docentes, tcc = null }) {
  const editando = !!tcc;
  const disponiveis = docentes.filter((d) => d.vagas > 0 || (tcc && d.id === tcc.orientador_id));
  const ok = await abrirModal({
    titulo: editando ? 'Editar proposta de TCC' : 'Nova proposta de TCC',
    larga: true,
    confirmar: editando ? 'Salvar e reenviar' : 'Enviar proposta',
    html: `
      <form id="f-proposta">
        <div class="campo"><label>Título provisório *</label><input type="text" name="titulo" required minlength="5" maxlength="255" value="${esc(tcc ? tcc.titulo : '')}"></div>
        <div class="linha-campos">
          <div class="campo"><label>Área temática *</label><input type="text" name="area" required maxlength="120" placeholder="Ex.: Engenharia de Software" value="${esc(tcc ? tcc.area : '')}"></div>
          <div class="campo"><label>Palavras-chave *</label><input type="text" name="palavras_chave" required maxlength="255" placeholder="Separadas por vírgula" value="${esc(tcc ? tcc.palavras_chave : '')}"></div>
        </div>
        <div class="campo"><label>Resumo (mínimo 30 caracteres) *</label><textarea name="resumo" required minlength="30" maxlength="5000">${esc(tcc ? tcc.resumo : '')}</textarea></div>
        <div class="linha-campos">
          <div class="campo">
            <label>Orientador pretendido *</label>
            <select name="orientador_id" required>
              ${opcoes(disponiveis, 'id', (d) => `${d.nome} (${d.vagas} vaga(s) — ${d.area || 'Geral'})`, tcc ? tcc.orientador_id : '', 'Selecione um docente')}
            </select>
          </div>
          <div class="campo">
            <label>Coorientador (opcional)</label>
            <select name="coorientador_id">
              ${opcoes(docentes, 'id', (d) => `${d.nome} (${d.area || 'Geral'})`, tcc ? tcc.coorientador_id : '', 'Sem coorientador')}
            </select>
          </div>
        </div>
        <div class="campo">
          <label>Pré-projeto em PDF (opcional, máx. 50 MB)</label>
          <input type="file" name="pre_projeto" accept="application/pdf,.pdf">
        </div>
      </form>`,
    onConfirm: async (modal) => {
      const fd = new FormData(modal.querySelector('#f-proposta'));
      if (!fd.get('pre_projeto') || !fd.get('pre_projeto').size) fd.delete('pre_projeto');
      if (editando) {
        await put(`/tccs/${tcc.id}`, fd);
        toast('Proposta atualizada com sucesso.', 'ok');
        await telaTccDetalhe(tcc.id);
      } else {
        const novo = await post('/tccs', fd);
        toast('Proposta cadastrada com sucesso!', 'ok');
        location.hash = `#/tcc/${novo.id}`;
      }
    },
  });
  return ok;
}

// =====================================================================
//  3. DETALHE DO TCC (ORIENTAÇÃO, VERSÕES, REUNIÕES, HISTÓRICO)
// =====================================================================

async function telaTccDetalhe(id) {
  const { tcc, papel, versoes, reunioes, historico, banca } = await get(`/tccs/${id}`);

  // Barra de etapas
  const idxEtapa = ETAPAS_STATUS.indexOf(
    ['APROVADO_RESSALVAS', 'ARQUIVADO'].includes(tcc.status) ? 'APROVADO' : tcc.status
  );
  const barraProgresso = `<div class="progresso" title="Etapa atual: ${esc(rotuloStatus(tcc.status))}">${ETAPAS_STATUS.map((_, i) => `<i class="${i <= idxEtapa ? 'feito' : ''}"></i>`).join('')}</div>`;

  // Botões de ação conforme perfil e status
  const acoes = [];
  if (papel.aluno && ['PROPOSTA', 'RECUSADO'].includes(tcc.status)) {
    acoes.push(botao('Editar / Reenviar proposta', { acao: 'editar-proposta', icon: 'editar', classe: 'sec' }));
  }
  if (papel.orientador && tcc.status === 'PROPOSTA') {
    acoes.push(botao('Aceitar orientação', { acao: 'aceitar-orientacao', icon: 'ok' }));
    acoes.push(botao('Recusar orientação', { acao: 'recusar-orientacao', icon: 'fechar', classe: 'perigo' }));
  }
  if (papel.gestor && tcc.status === 'AGUARDANDO_HOMOLOGACAO') {
    acoes.push(botao('Homologar TCC', { acao: 'homologar', icon: 'ok' }));
    acoes.push(botao('Devolver para ajustes', { acao: 'recusar-homologacao', icon: 'fechar', classe: 'perigo' }));
  }
  if (papel.aluno && ['EM_DESENVOLVIMENTO', 'EM_REVISAO', 'APROVADO_RESSALVAS'].includes(tcc.status)) {
    acoes.push(botao('Enviar nova versão (PDF)', { acao: 'enviar-versao', icon: 'upload' }));
  }
  const ultimaVersao = versoes[0];
  if (papel.orientador && ['EM_DESENVOLVIMENTO', 'EM_REVISAO'].includes(tcc.status) && ultimaVersao && ultimaVersao.tipo === 'FINAL' && ultimaVersao.status === 'APROVADA') {
    acoes.push(botao('Liberar para a banca', { acao: 'liberar-banca', icon: 'ok' }));
  }
  if (papel.gestor && tcc.status === 'AGUARDANDO_BANCA' && !banca) {
    acoes.push(botao('Formar banca examinadora', { acao: 'agendar-banca', icon: 'usuarios' }));
  }
  if (papel.gestor && ['APROVADO', 'APROVADO_RESSALVAS'].includes(tcc.status)) {
    acoes.push(botao('Arquivar TCC', { acao: 'arquivar', icon: 'premio' }));
  }
  if (papel.gestor && !['APROVADO', 'APROVADO_RESSALVAS', 'REPROVADO', 'ARQUIVADO'].includes(tcc.status)) {
    acoes.push(botao('Trocar orientador', { acao: 'trocar-orientador', classe: 'neutro' }));
  }

  elConteudo.innerHTML = `
    <a class="voltar" href="#/tccs">${icone('voltar', 15)} Voltar para TCCs</a>
    ${cabecalho(tcc.titulo, `${tcc.tipo} • ${tcc.curso_nome} (${tcc.periodo_nome})`, acoes.join(''))}

    ${tcc.status === 'RECUSADO' && tcc.justificativa ? `<div class="aviso-bloco danger"><strong>Justificativa registrada:</strong> ${esc(tcc.justificativa)}</div>` : ''}

    <div class="grade principal">
      <div>
        <!-- Dados gerais -->
        <div class="card">
          <h2><span class="esq">${icone('livro')} Dados do trabalho</span> ${chipStatus(tcc.status)}</h2>
          ${barraProgresso}
          <dl class="dados" style="margin-top:12px;">
            <dt>Aluno(a)</dt><dd><strong>${esc(tcc.aluno_nome)}</strong> (Mat. ${esc(tcc.matricula)} — ${esc(tcc.aluno_email)})</dd>
            <dt>Orientador(a)</dt><dd>${esc(tcc.orientador_nome || 'Aguardando definição')}</dd>
            <dt>Coorientador(a)</dt><dd>${esc(tcc.coorientador_nome || 'Não possui')} ${(papel.gestor || papel.orientador) ? `<button type="button" class="link-botao peq" data-acao="definir-coorientador" style="margin-left:6px;border:0;background:none;color:var(--marca);cursor:pointer;font-weight:700;">[alterar]</button>` : ''}</dd>
            <dt>Área / Palavras-chave</dt><dd>${esc(tcc.area)} — <span class="suave">${esc(tcc.palavras_chave)}</span></dd>
            <dt>Resumo</dt><dd style="white-space:pre-wrap;">${esc(tcc.resumo)}</dd>
          </dl>
        </div>

        <!-- Versões enviadas -->
        <div class="card">
          <h2>
            <span class="esq">${icone('arquivo')} Versões do documento (${versoes.length})</span>
            ${papel.aluno && ['EM_DESENVOLVIMENTO', 'EM_REVISAO', 'APROVADO_RESSALVAS'].includes(tcc.status) ? botao('Enviar PDF', { acao: 'enviar-versao', icon: 'upload', classe: 'mini sec' }) : ''}
          </h2>
          ${!versoes.length ? '<p class="vazio">Nenhuma versão em PDF enviada até o momento.</p>' : versoes.map((v) => {
    const [rotV, tomV] = VERSAO_STATUS[v.status] || [v.status, ''];
    return `
              <div class="versao">
                <div class="topo-v">
                  <div>
                    <strong>Versão #${v.numero} — ${esc(VERSAO_TIPO[v.tipo] || v.tipo)}</strong>
                    <span class="suave peq"> (${esc(v.arquivo_nome)} • ${fmtTamanho(v.tamanho)} • ${fmtDataHora(v.data_envio)})</span>
                  </div>
                  <div style="display:flex; gap:6px; align-items:center;">
                    ${chip(rotV, tomV)}
                    <a class="btn mini neutro" href="/api/tccs/${tcc.id}/versoes/${v.id}/arquivo?inline=1" target="_blank" rel="noopener">${icone('olho', 13)} Abrir PDF</a>
                    <a class="btn mini neutro" href="/api/tccs/${tcc.id}/versoes/${v.id}/arquivo">${icone('baixar', 13)} Baixar</a>
                    ${papel.orientador && v.status === 'ENVIADA' ? botao('Avaliar', { acao: 'avaliar-versao', classe: 'mini', dados: { id: v.id, num: v.numero } }) : ''}
                  </div>
                </div>
                ${v.descricao ? `<div class="peq" style="margin-top:6px;"><strong>Descrição do aluno:</strong> ${esc(v.descricao)}</div>` : ''}
                ${v.feedback ? `<div class="fb"><strong>Parecer do orientador (${esc(v.avaliada_por_nome || '')}):</strong>\n${esc(v.feedback)}</div>` : ''}
              </div>`;
  }).join('')}
        </div>

        <!-- Reuniões de orientação -->
        <div class="card">
          <h2>
            <span class="esq">${icone('calendario')} Reuniões de orientação (${reunioes.length})</span>
            ${(papel.orientador || papel.coorientador) && !['PROPOSTA', 'RECUSADO'].includes(tcc.status) ? botao('Registrar reunião', { acao: 'nova-reuniao', icon: 'mais', classe: 'mini sec' }) : ''}
          </h2>
          ${!reunioes.length ? '<p class="vazio">Nenhuma reunião registrada.</p>' : `<ul class="lista">${reunioes.map((r) => `
            <li>
              <div class="linha">
                <div>
                  <div class="tit">${fmtData(r.data)} — ${esc(r.pauta)}</div>
                  <div class="peq" style="white-space:pre-wrap; margin-top:3px;">${esc(r.deliberacoes)}</div>
                  <div class="suave peq">Registrado por ${esc(r.registrado_por_nome || '—')}</div>
                </div>
                ${(r.registrado_por === usuario.id || papel.gestor) ? botao('Excluir', { acao: 'excluir-reuniao', classe: 'mini neutro', dados: { id: r.id } }) : ''}
              </div>
            </li>`).join('')}</ul>`}
        </div>
      </div>

      <!-- Coluna lateral: Banca e Histórico -->
      <div>
        <div class="card">
          <h2><span class="esq">${icone('usuarios')} Banca examinadora</span></h2>
          ${!banca ? '<p class="vazio">Banca ainda não agendada.</p>' : `
            <p style="margin:0 0 8px;"><strong>${fmtData(banca.data)} às ${fmtHora(banca.hora)}</strong> (${esc(banca.modalidade)})<br>
            <span class="suave peq">${esc(banca.local_defesa)}</span></p>
            ${banca.resultado ? `<p>Média final: <strong>${fmtNota(banca.media)}</strong> — ${chip(RESULTADO[banca.resultado] || banca.resultado, banca.resultado === 'REPROVADO' ? 'danger' : 'ok')}</p>` : ''}
            <ul class="lista" style="margin-bottom:10px;">
              ${banca.membros.map((m) => `<li class="peq"><strong>${esc(MEMBRO_ROTULO[m.tipo])}:</strong> ${esc(m.nome)}</li>`).join('')}
            </ul>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <a class="btn mini" href="#/banca/${banca.id}">Abrir banca</a>
              ${banca.status === 'REALIZADA' ? `<a class="btn mini neutro" href="#/ata/${banca.id}">${icone('impressora', 13)} Ata de defesa</a>` : ''}
            </div>
          `}
        </div>

        <div class="card">
          <h2><span class="esq">${icone('relogio')} Histórico e auditoria</span></h2>
          <ul class="tempo">
            ${historico.map((h) => `
              <li>
                <div><strong>${esc(rotuloStatus(h.status_novo))}</strong></div>
                ${h.justificativa ? `<div class="peq">${esc(h.justificativa)}</div>` : ''}
                <div class="suave peq">${fmtDataHora(h.criado_em)} • ${esc(h.usuario_nome || 'Sistema')}</div>
              </li>`).join('')}
          </ul>
        </div>
      </div>
    </div>`;

  ligarAcoes(elConteudo, {
    'editar-proposta': async () => {
      const docentes = await get('/docentes?para=orientacao');
      await modalProposta({ docentes, tcc });
    },
    'aceitar-orientacao': async () => {
      if (!(await confirmarAcao('Aceitar orientação', `Confirmar a orientação do TCC "${tcc.titulo}"?`))) return;
      await post(`/tccs/${tcc.id}/orientacao`, { acao: 'ACEITAR' });
      toast('Orientação aceita! Enviado para homologação da coordenação.', 'ok');
      await telaTccDetalhe(id);
    },
    'recusar-orientacao': async () => {
      await abrirModal({
        titulo: 'Recusar solicitação de orientação',
        confirmar: 'Recusar orientação',
        perigo: true,
        html: `<form><div class="campo"><label>Justificativa obrigatória (mín. 10 caracteres) *</label><textarea name="justificativa" required minlength="10"></textarea></div></form>`,
        onConfirm: async (m) => {
          const { justificativa } = formDados(m.querySelector('form'));
          await post(`/tccs/${tcc.id}/orientacao`, { acao: 'RECUSAR', justificativa });
          toast('Solicitação recusada.', 'ok');
          location.hash = '#/tccs';
        },
      });
    },
    'homologar': async () => {
      if (!(await confirmarAcao('Homologar TCC', 'Aprovar o tema e o orientador deste TCC para iniciar o desenvolvimento?'))) return;
      await post(`/tccs/${tcc.id}/homologar`, { aprovar: true });
      toast('TCC homologado com sucesso!', 'ok');
      await telaTccDetalhe(id);
    },
    'recusar-homologacao': async () => {
      await abrirModal({
        titulo: 'Devolver proposta para ajustes',
        confirmar: 'Devolver proposta',
        perigo: true,
        html: `<form><div class="campo"><label>Motivo / ajustes necessários *</label><textarea name="justificativa" required minlength="10"></textarea></div></form>`,
        onConfirm: async (m) => {
          const { justificativa } = formDados(m.querySelector('form'));
          await post(`/tccs/${tcc.id}/homologar`, { aprovar: false, justificativa });
          toast('Proposta devolvida ao aluno.', 'ok');
          await telaTccDetalhe(id);
        },
      });
    },
    'enviar-versao': async () => {
      const ultima = versoes[0];
      const podeFinal = tcc.status === 'APROVADO_RESSALVAS' || (ultima && ultima.status === 'APROVADA');
      await abrirModal({
        titulo: 'Enviar nova versão em PDF',
        confirmar: 'Enviar versão',
        html: `
          <form id="f-versao">
            <div class="campo">
              <label>Tipo de versão *</label>
              <select name="tipo" required>
                ${tcc.status !== 'APROVADO_RESSALVAS' ? '<option value="PARCIAL">Versão parcial (para revisão do orientador)</option>' : ''}
                <option value="FINAL" ${!podeFinal ? 'disabled' : ''}>Versão final ${!podeFinal ? '(requer versão anterior aprovada pelo orientador)' : ''}</option>
              </select>
            </div>
            <div class="campo"><label>Descrição das alterações *</label><textarea name="descricao" required minlength="5" placeholder="Resumo do que foi desenvolvido ou corrigido nesta versão"></textarea></div>
            <div class="campo"><label>Arquivo PDF (máx. 50 MB) *</label><input type="file" name="arquivo" accept="application/pdf,.pdf" required></div>
          </form>`,
        onConfirm: async (m) => {
          const fd = new FormData(m.querySelector('#f-versao'));
          await post(`/tccs/${tcc.id}/versoes`, fd);
          toast('Versão enviada com sucesso!', 'ok');
          await telaTccDetalhe(id);
        },
      });
    },
    'avaliar-versao': async (btn) => {
      await abrirModal({
        titulo: `Avaliar versão #${btn.dataset.num}`,
        confirmar: 'Registrar avaliação',
        html: `
          <form>
            <div class="campo">
              <label>Decisão *</label>
              <select name="status" required>
                <option value="APROVADA">Aprovar versão</option>
                <option value="AJUSTES">Solicitar ajustes / correções</option>
              </select>
            </div>
            <div class="campo"><label>Parecer / feedback para o aluno *</label><textarea name="feedback" required minlength="5" placeholder="Comentários sobre o texto, metodologia e pontos de melhoria"></textarea></div>
          </form>`,
        onConfirm: async (m) => {
          const dados = formDados(m.querySelector('form'));
          await post(`/tccs/${tcc.id}/versoes/${btn.dataset.id}/feedback`, dados);
          toast('Parecer registrado!', 'ok');
          await telaTccDetalhe(id);
        },
      });
    },
    'liberar-banca': async () => {
      if (!(await confirmarAcao('Liberar TCC para a banca', 'Confirma que a versão final está aprovada e apta para defesa em banca?'))) return;
      await post(`/tccs/${tcc.id}/liberar-banca`);
      toast('TCC liberado para formação de banca!', 'ok');
      await telaTccDetalhe(id);
    },
    'nova-reuniao': async () => {
      await abrirModal({
        titulo: 'Registrar reunião de orientação',
        confirmar: 'Salvar reunião',
        html: `
          <form>
            <div class="campo"><label>Data da reunião *</label><input type="date" name="data" value="${hojeISO()}" required></div>
            <div class="campo"><label>Pauta *</label><input type="text" name="pauta" required minlength="3" placeholder="Ex.: Revisão da metodologia e capítulos 2 e 3"></div>
            <div class="campo"><label>Deliberações e orientações *</label><textarea name="deliberacoes" required minlength="3"></textarea></div>
          </form>`,
        onConfirm: async (m) => {
          await post(`/tccs/${tcc.id}/reunioes`, formDados(m.querySelector('form')));
          toast('Reunião registrada!', 'ok');
          await telaTccDetalhe(id);
        },
      });
    },
    'excluir-reuniao': async (btn) => {
      if (!(await confirmarAcao('Excluir reunião', 'Deseja excluir este registro de reunião?', { perigo: true }))) return;
      await del(`/tccs/${tcc.id}/reunioes/${btn.dataset.id}`);
      toast('Reunião removida.');
      await telaTccDetalhe(id);
    },
    'trocar-orientador': async () => {
      const docentes = await get('/docentes?para=orientacao');
      await abrirModal({
        titulo: 'Trocar orientador do TCC',
        confirmar: 'Confirmar troca',
        html: `
          <form>
            <div class="campo"><label>Novo orientador *</label><select name="orientador_id" required>${opcoes(docentes.filter((d) => d.id !== tcc.orientador_id && d.vagas > 0), 'id', (d) => `${d.nome} (${d.vagas} vaga(s))`, '', 'Selecione')}</select></div>
            <div class="campo"><label>Justificativa obrigatória *</label><textarea name="justificativa" required minlength="10"></textarea></div>
          </form>`,
        onConfirm: async (m) => {
          await post(`/tccs/${tcc.id}/trocar-orientador`, formDados(m.querySelector('form')));
          toast('Orientador alterado.', 'ok');
          await telaTccDetalhe(id);
        },
      });
    },
    'definir-coorientador': async () => {
      const docentes = await get('/docentes');
      await abrirModal({
        titulo: 'Definir coorientador',
        confirmar: 'Salvar',
        html: `<form><div class="campo"><label>Coorientador</label><select name="docente_id">${opcoes(docentes.filter((d) => d.id !== tcc.orientador_id), 'id', 'nome', tcc.coorientador_id || '', 'Nenhum coorientador')}</select></div></form>`,
        onConfirm: async (m) => {
          const { docente_id } = formDados(m.querySelector('form'));
          await post(`/tccs/${tcc.id}/coorientador`, { docente_id: docente_id || null });
          toast('Coorientador atualizado.', 'ok');
          await telaTccDetalhe(id);
        },
      });
    },
    'agendar-banca': async () => {
      await modalAgendarBanca(tcc);
      await telaTccDetalhe(id);
    },
    'arquivar': async () => {
      if (!(await confirmarAcao('Arquivar TCC', 'Confirmar o arquivamento definitivo da versão final deste TCC?'))) return;
      await post(`/tccs/${tcc.id}/arquivar`);
      toast('TCC arquivado com sucesso!', 'ok');
      await telaTccDetalhe(id);
    },
  });
}

// =====================================================================
//  4. BANCAS E AVALIAÇÃO (RF-010, RF-011, RF-012, RN-003 a RN-005)
// =====================================================================

async function modalAgendarBanca(tcc, bancaAtual = null) {
  const docentes = await get('/docentes');
  const avaliadoresPossiveis = docentes.filter((d) => d.id !== tcc.orientador_id);

  const presId = bancaAtual ? (bancaAtual.membros.find((m) => m.tipo === 'PRESIDENTE') || {}).docente_id : (tcc.orientador_id || '');
  const avs = bancaAtual ? bancaAtual.membros.filter((m) => m.tipo === 'AVALIADOR').map((m) => m.docente_id) : [];
  const supId = bancaAtual ? (bancaAtual.membros.find((m) => m.tipo === 'SUPLENTE') || {}).docente_id : '';

  await abrirModal({
    titulo: bancaAtual ? 'Editar banca examinadora' : 'Formar banca examinadora',
    larga: true,
    confirmar: bancaAtual ? 'Salvar alterações' : 'Agendar banca',
    html: `
      <form>
        <p class="suave peq" style="margin-top:0;">TCC: <strong>${esc(tcc.titulo)}</strong> — Orientador(a): ${esc(tcc.orientador_nome || '—')}</p>
        <div class="linha-campos">
          <div class="campo"><label>Data da defesa *</label><input type="date" name="data" required value="${esc(bancaAtual ? bancaAtual.data : hojeISO())}"></div>
          <div class="campo"><label>Horário *</label><input type="time" name="hora" required value="${esc(bancaAtual ? fmtHora(bancaAtual.hora) : '19:00')}"></div>
          <div class="campo"><label>Modalidade *</label><select name="modalidade"><option value="PRESENCIAL" ${bancaAtual && bancaAtual.modalidade === 'PRESENCIAL' ? 'selected' : ''}>Presencial</option><option value="REMOTO" ${bancaAtual && bancaAtual.modalidade === 'REMOTO' ? 'selected' : ''}>Remota (online)</option></select></div>
        </div>
        <div class="campo"><label>Local ou link da sala virtual *</label><input type="text" name="local_defesa" required placeholder="Ex.: Sala 12 — Bloco B ou link do Meet/Teams" value="${esc(bancaAtual ? bancaAtual.local_defesa : '')}"></div>
        <div class="linha-campos">
          <div class="campo"><label>Presidente da banca *</label><select name="presidente" required>${opcoes(docentes, 'id', 'nome', presId, 'Selecione')}</select></div>
          <div class="campo"><label>1º Avaliador (exceto orientador) *</label><select name="av1" required>${opcoes(avaliadoresPossiveis, 'id', (d) => `${d.nome}${d.externo ? ' (Externo)' : ''}`, avs[0] || '', 'Selecione')}</select></div>
        </div>
        <div class="linha-campos">
          <div class="campo"><label>2º Avaliador (exceto orientador) *</label><select name="av2" required>${opcoes(avaliadoresPossiveis, 'id', (d) => `${d.nome}${d.externo ? ' (Externo)' : ''}`, avs[1] || '', 'Selecione')}</select></div>
          <div class="campo"><label>Suplente (opcional)</label><select name="suplente">${opcoes(avaliadoresPossiveis, 'id', 'nome', supId || '', 'Sem suplente')}</select></div>
        </div>
        <p class="suave peq">Regra RN-003 e RN-004: mínimo de 1 presidente + 2 avaliadores. O orientador pode presidir a banca, mas não atua como avaliador do próprio orientando.</p>
      </form>`,
    onConfirm: async (m) => {
      const f = formDados(m.querySelector('form'));
      const membros = [
        { docente_id: Number(f.presidente), tipo: 'PRESIDENTE' },
        { docente_id: Number(f.av1), tipo: 'AVALIADOR' },
        { docente_id: Number(f.av2), tipo: 'AVALIADOR' },
      ];
      if (f.suplente) membros.push({ docente_id: Number(f.suplente), tipo: 'SUPLENTE' });
      const payload = { tcc_id: tcc.id, data: f.data, hora: f.hora, modalidade: f.modalidade, local_defesa: f.local_defesa, membros };
      if (bancaAtual) await put(`/bancas/${bancaAtual.id}`, payload);
      else await post('/bancas', payload);
      toast('Banca salva com sucesso!', 'ok');
    },
  });
}

async function telaBancas() {
  const [bancas, aguardando] = await Promise.all([
    get('/bancas'),
    usuario.ehGestor ? get('/tccs?status=AGUARDANDO_BANCA') : Promise.resolve([]),
  ]);

  elConteudo.innerHTML = `
    ${cabecalho(
    'Bancas examinadoras',
    'Agendamento de defesas, lançamento de notas por critérios e emissão de atas.',
    usuario.ehGestor && aguardando.length ? botao(`Agendar banca (${aguardando.length} aguardando)`, { acao: 'nova-banca', icon: 'mais' }) : ''
  )}
    <div class="card">
      ${!bancas.length ? '<p class="vazio">Nenhuma banca cadastrada.</p>' : `
        <div class="tabela-wrap">
          <table>
            <thead><tr><th>Data / Hora</th><th>Aluno / TCC</th><th>Local</th><th>Membros</th><th>Status / Resultado</th><th></th></tr></thead>
            <tbody>
              ${bancas.map((b) => {
    const [rotS, tomS] = BANCA_STATUS[b.status] || [b.status, ''];
    return `
                  <tr class="clicavel" data-href="#/banca/${b.id}">
                    <td><strong>${fmtData(b.data)}</strong><div class="suave peq">${fmtHora(b.hora)} (${esc(b.modalidade)})</div></td>
                    <td><strong>${esc(b.aluno_nome)}</strong><div class="suave peq">${esc(b.titulo)}</div></td>
                    <td>${esc(b.local_defesa)}</td>
                    <td class="peq">${b.membros.map((m) => `<div><strong>${esc(MEMBRO_ROTULO[m.tipo])}:</strong> ${esc(m.nome)}</div>`).join('')}</td>
                    <td>${chip(rotS, tomS)} ${b.resultado ? `<div class="peq" style="margin-top:4px;">Média <strong>${fmtNota(b.media)}</strong> (${esc(RESULTADO[b.resultado])})</div>` : ''}</td>
                    <td class="acoes"><a class="btn mini neutro" href="#/banca/${b.id}">Abrir</a></td>
                  </tr>`;
  }).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;

  elConteudo.querySelectorAll('tr[data-href]').forEach((tr) => {
    tr.onclick = (e) => { if (!e.target.closest('a,button')) location.hash = tr.dataset.href; };
  });

  ligarAcoes(elConteudo, {
    'nova-banca': async () => {
      await abrirModal({
        titulo: 'Escolher TCC aguardando banca',
        confirmar: 'Continuar',
        html: `<form><div class="campo"><label>TCC liberado pelo orientador *</label><select name="tcc_id" required>${opcoes(aguardando, 'id', (t) => `${t.aluno_nome} — ${t.titulo}`, '', 'Selecione')}</select></div></form>`,
        onConfirm: async (m) => {
          const { tcc_id } = formDados(m.querySelector('form'));
          const { tcc } = await get(`/tccs/${tcc_id}`);
          setTimeout(async () => {
            await modalAgendarBanca(tcc);
            await telaBancas();
          }, 50);
        },
      });
    },
  });
}

async function telaBancaDetalhe(id) {
  const d = await get(`/bancas/${id}`);
  const { banca, tcc, membros, avaliacoes, minhaAvaliacao, euAvalio, souPresidente, pendentes } = d;
  const [rotS, tomS] = BANCA_STATUS[banca.status] || [banca.status, ''];

  const acoes = [];
  if (banca.status === 'REALIZADA') {
    acoes.push(`<a class="btn" href="#/ata/${banca.id}">${icone('impressora', 15)} Ver / Imprimir Ata de Defesa</a>`);
  }
  if (banca.status === 'AGENDADA' && (usuario.ehGestor || souPresidente)) {
    acoes.push(botao('Encerrar banca e calcular nota final', { acao: 'encerrar', icon: 'ok' }));
  }
  if (banca.status === 'AGENDADA' && usuario.ehGestor) {
    acoes.push(botao('Editar banca', { acao: 'editar', icon: 'editar', classe: 'neutro' }));
    acoes.push(botao('Cancelar banca', { acao: 'cancelar', classe: 'perigo' }));
  }

  elConteudo.innerHTML = `
    <a class="voltar" href="#/bancas">${icone('voltar', 15)} Voltar para bancas</a>
    ${cabecalho(`Banca de defesa — ${tcc.aluno_nome}`, tcc.titulo, acoes.join(''))}

    <div class="grade principal">
      <div>
        <div class="card">
          <h2><span class="esq">${icone('calendario')} Dados da defesa</span> ${chip(rotS, tomS)}</h2>
          <dl class="dados">
            <dt>Trabalho</dt><dd><a href="#/tcc/${tcc.id}"><strong>${esc(tcc.titulo)}</strong></a> (${esc(tcc.tipo)} — ${esc(tcc.curso_nome)})</dd>
            <dt>Aluno(a)</dt><dd>${esc(tcc.aluno_nome)} (Mat. ${esc(tcc.matricula)})</dd>
            <dt>Orientador(a)</dt><dd>${esc(tcc.orientador_nome || '—')}</dd>
            <dt>Data e horário</dt><dd>${fmtData(banca.data)} às ${fmtHora(banca.hora)} (${esc(banca.modalidade)})</dd>
            <dt>Local / Sala</dt><dd>${esc(banca.local_defesa)}</dd>
            ${banca.resultado ? `<dt>Resultado final</dt><dd><strong>Média ${fmtNota(banca.media)} — ${esc(RESULTADO[banca.resultado])}</strong></dd>` : ''}
          </dl>
        </div>

        ${euAvalio && banca.status === 'AGENDADA' ? `
          <div class="card destaque">
            <h2><span class="esq">${icone('prancheta')} Minha avaliação (RF-011)</span></h2>
            <form id="f-avaliacao">
              <div class="linha-campos">
                <div class="campo"><label>Conteúdo (0 a 10) *</label><input type="number" step="0.1" min="0" max="10" name="nota_conteudo" required value="${minhaAvaliacao ? minhaAvaliacao.nota_conteudo : ''}"></div>
                <div class="campo"><label>Metodologia (0 a 10) *</label><input type="number" step="0.1" min="0" max="10" name="nota_metodologia" required value="${minhaAvaliacao ? minhaAvaliacao.nota_metodologia : ''}"></div>
                <div class="campo"><label>Apresentação (0 a 10) *</label><input type="number" step="0.1" min="0" max="10" name="nota_apresentacao" required value="${minhaAvaliacao ? minhaAvaliacao.nota_apresentacao : ''}"></div>
                <div class="campo"><label>Arguição (0 a 10) *</label><input type="number" step="0.1" min="0" max="10" name="nota_arguicao" required value="${minhaAvaliacao ? minhaAvaliacao.nota_arguicao : ''}"></div>
              </div>
              <div class="campo"><label>Parecer técnico (mínimo 10 caracteres) *</label><textarea name="parecer" required minlength="10">${esc(minhaAvaliacao ? minhaAvaliacao.parecer : '')}</textarea></div>
              <button type="submit" class="btn">${icone('ok', 15)} Salvar nota e parecer</button>
            </form>
          </div>` : ''}

        <div class="card">
          <h2><span class="esq">${icone('premio')} Avaliações registradas</span></h2>
          ${pendentes.length && banca.status === 'AGENDADA' ? `<p class="aviso-bloco warn">Aguardando lançamento de nota de: <strong>${esc(pendentes.join(', '))}</strong></p>` : ''}
          ${!avaliacoes.length ? '<p class="vazio">As notas ficarão visíveis aqui após o registro.</p>' : `
            <div class="tabela-wrap">
              <table>
                <thead><tr><th>Avaliador</th><th>Conteúdo</th><th>Metodologia</th><th>Apresentação</th><th>Arguição</th><th>Média</th></tr></thead>
                <tbody>
                  ${avaliacoes.map((a) => `
                    <tr>
                      <td><strong>${esc(a.nome)}</strong><div class="suave peq">${esc(a.parecer)}</div></td>
                      <td>${fmtNota(a.nota_conteudo)}</td>
                      <td>${fmtNota(a.nota_metodologia)}</td>
                      <td>${fmtNota(a.nota_apresentacao)}</td>
                      <td>${fmtNota(a.nota_arguicao)}</td>
                      <td><strong>${fmtNota(a.media)}</strong></td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`}
        </div>
      </div>

      <div>
        <div class="card">
          <h2><span class="esq">${icone('usuarios')} Composição da banca</span></h2>
          <ul class="lista">
            ${membros.map((m) => `
              <li>
                <div class="tit">${esc(m.nome)}</div>
                <div class="suave peq">${esc(MEMBRO_ROTULO[m.tipo])} ${m.titulacao ? `• ${esc(m.titulacao)}` : ''} ${m.externo ? '• Avaliador externo' : ''}</div>
              </li>`).join('')}
          </ul>
        </div>
      </div>
    </div>`;

  const formAv = document.getElementById('f-avaliacao');
  if (formAv) {
    formAv.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await post(`/bancas/${banca.id}/avaliacao`, formDados(formAv));
        toast(`Avaliação salva! Sua média: ${fmtNota(r.media)}`, 'ok');
        await telaBancaDetalhe(id);
      } catch (err) {
        toast(err.message, 'erro');
      }
    };
  }

  ligarAcoes(elConteudo, {
    encerrar: async () => {
      if (!(await confirmarAcao('Encerrar banca', 'Calcular a média final dos avaliadores e publicar o resultado definitivo da defesa?'))) return;
      const r = await post(`/bancas/${banca.id}/encerrar`);
      toast(`Banca encerrada! Média: ${fmtNota(r.media)} (${RESULTADO[r.resultado]})`, 'ok');
      await telaBancaDetalhe(id);
    },
    editar: async () => {
      await modalAgendarBanca(tcc, { ...banca, membros });
      await telaBancaDetalhe(id);
    },
    cancelar: async () => {
      if (!(await confirmarAcao('Cancelar banca', 'Deseja cancelar esta banca examinadora?', { perigo: true }))) return;
      await post(`/bancas/${banca.id}/cancelar`);
      toast('Banca cancelada.');
      location.hash = '#/bancas';
    },
  });
}

// =====================================================================
//  5. ATA DE DEFESA OFICIAL (RF-012)
// =====================================================================

async function telaAta(id) {
  const { instituicao, banca, tcc, membros, avaliacoes } = await get(`/bancas/${id}/ata`);

  elConteudo.innerHTML = `
    <a class="voltar sem-impressao" href="#/banca/${banca.id}">${icone('voltar', 15)} Voltar para a banca</a>
    ${cabecalho('Ata de Defesa de TCC', 'Documento oficial gerado automaticamente pelo sistema.', botao('Imprimir / Salvar em PDF', { acao: 'imprimir', icon: 'impressora' }))}

    <article class="documento">
      <h1>Ata de Defesa de Trabalho de Conclusão de Curso (${esc(tcc.tipo)})</h1>
      <div class="inst"><strong>${esc(instituicao)}</strong><br>Curso de ${esc(tcc.curso_nome)} — Período ${esc(tcc.periodo_nome)}</div>

      <p>Em <strong>${fmtData(banca.data)}</strong>, às <strong>${fmtHora(banca.hora)}</strong>, reuniu-se em sessão ${banca.modalidade === 'REMOTO' ? 'remota' : 'presencial'} (${esc(banca.local_defesa)}) a Banca Examinadora designada para avaliar o Trabalho de Conclusão de Curso intitulado <strong>"${esc(tcc.titulo)}"</strong>, de autoria do(a) discente <strong>${esc(tcc.aluno_nome)}</strong> (matrícula ${esc(tcc.matricula)}), sob orientação de <strong>${esc(tcc.orientador_nome || '—')}</strong>${tcc.coorientador_nome ? ` e coorientação de <strong>${esc(tcc.coorientador_nome)}</strong>` : ''}.</p>

      <h2>1. Composição da Banca Examinadora</h2>
      <ul>
        ${membros.map((m) => `<li><strong>${esc(MEMBRO_ROTULO[m.tipo])}:</strong> ${esc(m.nome)}${m.titulacao ? ` (${esc(m.titulacao)})` : ''}${m.externo && m.instituicao ? ` — ${esc(m.instituicao)}` : ''}</li>`).join('')}
      </ul>

      <h2>2. Notas por Critério e Pareceres</h2>
      <table>
        <thead><tr><th>Avaliador</th><th>Conteúdo</th><th>Metodologia</th><th>Apresentação</th><th>Arguição</th><th>Média</th></tr></thead>
        <tbody>
          ${avaliacoes.map((a) => `
            <tr>
              <td>${esc(a.nome)}</td>
              <td>${fmtNota(a.nota_conteudo)}</td>
              <td>${fmtNota(a.nota_metodologia)}</td>
              <td>${fmtNota(a.nota_apresentacao)}</td>
              <td>${fmtNota(a.nota_arguicao)}</td>
              <td><strong>${fmtNota(a.media)}</strong></td>
            </tr>`).join('')}
        </tbody>
      </table>

      ${avaliacoes.map((a) => `<p class="peq"><strong>Parecer de ${esc(a.nome)}:</strong> ${esc(a.parecer)}</p>`).join('')}

      <h2>3. Resultado Final</h2>
      <p>Após a apresentação e arguição, a Banca Examinadora atribuiu ao trabalho a média final <strong>${fmtNota(banca.media)}</strong>, considerando o(a) discente <strong>${esc((RESULTADO[banca.resultado] || banca.resultado).toUpperCase())}</strong>.</p>

      <p style="margin-top:20px;">Ji-Paraná — RO, ${fmtData(banca.data)}.</p>

      <div class="assinaturas">
        ${membros.filter((m) => m.tipo !== 'SUPLENTE').map((m) => `<div><strong>${esc(m.nome)}</strong><br>${esc(MEMBRO_ROTULO[m.tipo])}</div>`).join('')}
        <div><strong>${esc(tcc.aluno_nome)}</strong><br>Discente</div>
      </div>
    </article>`;

  ligarAcoes(elConteudo, { imprimir: () => window.print() });
}

// =====================================================================
//  6. CRONOGRAMA, PERÍODOS E CURSOS (RF-013)
// =====================================================================

async function telaCronograma() {
  const [periodos, cursos, prazos, cal] = await Promise.all([
    get('/periodos'),
    get('/cursos'),
    get('/prazos'),
    get('/calendario'),
  ]);

  elConteudo.innerHTML = `
    ${cabecalho(
    'Cronograma e prazos do semestre',
    'Prazos oficiais definidos pela coordenação (envios fora do prazo são bloqueados automaticamente).',
    usuario.ehGestor ? botao('Novo prazo', { acao: 'novo-prazo', icon: 'mais' }) : ''
  )}

    <div class="grade principal">
      <div>
        <div class="card">
          <h2><span class="esq">${icone('calendario')} Prazos de entrega (RF-013)</span></h2>
          ${!prazos.length ? '<p class="vazio">Nenhum prazo cadastrado para o período vigente.</p>' : `
            <div class="tabela-wrap">
              <table>
                <thead><tr><th>Etapa</th><th>Descrição</th><th>Curso</th><th>Data limite</th>${usuario.ehGestor ? '<th></th>' : ''}</tr></thead>
                <tbody>
                  ${prazos.map((p) => `
                    <tr>
                      <td><strong>${esc(ETAPA_ROTULO[p.etapa] || p.etapa)}</strong></td>
                      <td>${esc(p.titulo)}</td>
                      <td>${esc(p.curso_nome || 'Todos os cursos')}</td>
                      <td>${fmtData(p.data_limite)} ${diasAte(p.data_limite) < 0 ? chip('Encerrado', 'danger') : ''}</td>
                      ${usuario.ehGestor ? `<td class="acoes">${botao('Excluir', { acao: 'excluir-prazo', classe: 'mini neutro', dados: { id: p.id } })}</td>` : ''}
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`}
        </div>

        ${usuario.ehGestor ? `
          <div class="card">
            <h2><span class="esq">${icone('relogio')} Períodos letivos</span> ${botao('Novo período', { acao: 'novo-periodo', icon: 'mais', classe: 'mini sec' })}</h2>
            <div class="tabela-wrap">
              <table>
                <thead><tr><th>Período</th><th>Início</th><th>Término</th><th>Situação</th></tr></thead>
                <tbody>
                  ${periodos.map((p) => `<tr><td><strong>${esc(p.nome)}</strong></td><td>${fmtData(p.data_inicio)}</td><td>${fmtData(p.data_fim)}</td><td>${p.vigente ? chip('Vigente', 'ok') : chip('Encerrado')}</td></tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>` : ''}
      </div>

      <div>
        <div class="card">
          <h2><span class="esq">${icone('prancheta')} Agenda unificada</span></h2>
          ${!cal.eventos.length ? '<p class="vazio">Sem eventos agendados.</p>' : `<ul class="lista">${cal.eventos.map((ev) => `
            <li>
              <span class="tag-evento ${ev.tipo}">${ev.tipo === 'BANCA' ? 'Defesa' : 'Prazo'}</span>
              <strong>${fmtData(ev.data)}${ev.hora ? ` às ${ev.hora}` : ''}</strong>
              <div class="peq">${esc(ev.titulo)}${ev.detalhe ? ` — ${esc(ev.detalhe)}` : ''}</div>
            </li>`).join('')}</ul>`}
        </div>
      </div>
    </div>`;

  ligarAcoes(elConteudo, {
    'novo-prazo': async () => {
      const vigente = periodos.find((p) => p.vigente) || periodos[0];
      await abrirModal({
        titulo: 'Cadastrar prazo de etapa',
        confirmar: 'Salvar prazo',
        html: `
          <form>
            <div class="linha-campos">
              <div class="campo"><label>Período letivo *</label><select name="periodo_id" required>${opcoes(periodos, 'id', 'nome', vigente ? vigente.id : '')}</select></div>
              <div class="campo"><label>Curso</label><select name="curso_id">${opcoes(cursos, 'id', 'nome', '', 'Todos os cursos')}</select></div>
            </div>
            <div class="linha-campos">
              <div class="campo"><label>Etapa *</label><select name="etapa" required>${opcoes(Object.entries(ETAPA_ROTULO), (e) => e[0], (e) => e[1])}</select></div>
              <div class="campo"><label>Data limite *</label><input type="date" name="data_limite" required value="${hojeISO()}"></div>
            </div>
            <div class="campo"><label>Título / descrição *</label><input type="text" name="titulo" required placeholder="Ex.: Entrega da versão parcial do TCC"></div>
          </form>`,
        onConfirm: async (m) => {
          await post('/prazos', formDados(m.querySelector('form')));
          toast('Prazo cadastrado!', 'ok');
          await telaCronograma();
        },
      });
    },
    'excluir-prazo': async (btn) => {
      if (!(await confirmarAcao('Excluir prazo', 'Deseja remover este prazo do cronograma?', { perigo: true }))) return;
      await del(`/prazos/${btn.dataset.id}`);
      toast('Prazo removido.');
      await telaCronograma();
    },
    'novo-periodo': async () => {
      await abrirModal({
        titulo: 'Novo período letivo',
        confirmar: 'Salvar período',
        html: `
          <form>
            <div class="campo"><label>Nome (ex.: 2027/1) *</label><input type="text" name="nome" required placeholder="2027/1"></div>
            <div class="linha-campos">
              <div class="campo"><label>Data de início *</label><input type="date" name="data_inicio" required></div>
              <div class="campo"><label>Data de término *</label><input type="date" name="data_fim" required></div>
            </div>
            <label class="check"><input type="checkbox" name="vigente" value="1" checked> Definir como período letivo vigente</label>
          </form>`,
        onConfirm: async (m) => {
          const d = formDados(m.querySelector('form'));
          await post('/periodos', { ...d, vigente: !!d.vigente });
          toast('Período salvo!', 'ok');
          await telaCronograma();
        },
      });
    },
  });
}

// =====================================================================
//  7. RELATÓRIOS GERENCIAIS (RF-014, RF-015 — PDF / EXCEL CSV)
// =====================================================================

async function telaRelatorios() {
  const [andamento, aprovacao, carga] = await Promise.all([
    get('/relatorios/andamento'),
    get('/relatorios/aprovacao'),
    get('/relatorios/carga'),
  ]);

  elConteudo.innerHTML = `
    ${cabecalho(
    'Relatórios gerenciais',
    'Indicadores de andamento, taxa de aprovação em banca e carga de orientação por docente.',
    `${botao('Exportar Excel (CSV)', { acao: 'csv', icon: 'baixar', classe: 'sec' })} ${botao('Imprimir / PDF', { acao: 'pdf', icon: 'impressora' })}`
  )}

    <div class="card">
      <h2><span class="esq">${icone('premio')} Taxa de aprovação por curso e período</span></h2>
      ${!aprovacao.length ? '<p class="vazio">Ainda não há bancas encerradas para cálculo de aprovação.</p>' : `
        <div class="tabela-wrap">
          <table>
            <thead><tr><th>Curso</th><th>Período</th><th>Defesas</th><th>Aprovados</th><th>Com ressalvas</th><th>Reprovados</th><th>Média geral</th><th>Taxa de aprovação</th></tr></thead>
            <tbody>
              ${aprovacao.map((a) => `
                <tr>
                  <td><strong>${esc(a.curso_nome)}</strong></td>
                  <td>${esc(a.periodo_nome)}</td>
                  <td>${a.total}</td>
                  <td>${a.aprovados}</td>
                  <td>${a.ressalvas}</td>
                  <td>${a.reprovados}</td>
                  <td>${fmtNota(a.media_geral)}</td>
                  <td><strong>${fmtNota(a.taxa_aprovacao)}%</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>

    <div class="card">
      <h2><span class="esq">${icone('usuarios')} Carga de orientação por professor</span></h2>
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Docente</th><th>Área</th><th>Orientandos ativos / Limite</th><th>TCCs concluídos</th><th>Participações em banca</th></tr></thead>
          <tbody>
            ${carga.map((c) => `
              <tr>
                <td><strong>${esc(c.nome)}</strong> ${c.externo ? chip('Externo') : ''}</td>
                <td>${esc(c.area || '—')}</td>
                <td>${c.orientandos_ativos} / ${c.limite}</td>
                <td>${c.concluidos}</td>
                <td>${c.participacoes_banca}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2><span class="esq">${icone('livro')} Relação geral de TCCs (${andamento.tccs.length})</span></h2>
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Aluno</th><th>Matrícula</th><th>Curso / Período</th><th>Título</th><th>Orientador</th><th>Status</th></tr></thead>
          <tbody>
            ${andamento.tccs.map((t) => `
              <tr>
                <td>${esc(t.aluno_nome)}</td>
                <td>${esc(t.matricula)}</td>
                <td>${esc(t.curso_nome)} (${esc(t.periodo_nome)})</td>
                <td>${esc(t.titulo)}</td>
                <td>${esc(t.orientador_nome || '—')}</td>
                <td>${chipStatus(t.status)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  ligarAcoes(elConteudo, {
    pdf: () => window.print(),
    csv: () => {
      baixarCSV(
        'relatorio-tccs-afya.csv',
        ['Aluno', 'Matricula', 'Curso', 'Periodo', 'Tipo', 'Titulo', 'Orientador', 'Status'],
        andamento.tccs.map((t) => [t.aluno_nome, t.matricula, t.curso_nome, t.periodo_nome, t.tipo, t.titulo, t.orientador_nome || '', rotuloStatus(t.status)])
      );
    },
  });
}

// =====================================================================
//  8. GESTÃO DE USUÁRIOS (RF-002, RF-003, RF-04)
// =====================================================================

async function telaUsuarios() {
  const [usuarios, cursos] = await Promise.all([get('/usuarios'), get('/cursos')]);

  elConteudo.innerHTML = `
    ${cabecalho(
    'Gestão de usuários',
    'Cadastro de alunos, professores orientadores, avaliadores externos e coordenação.',
    botao('Novo usuário', { acao: 'novo-usuario', icon: 'mais' })
  )}
    <div class="card">
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfis</th><th>Vínculo acadêmico</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            ${usuarios.map((u) => `
              <tr>
                <td><strong>${esc(u.nome)}</strong></td>
                <td>${esc(u.email)}</td>
                <td>${u.papeis.map((p) => chip(PAPEL_ROTULO[p] || p)).join(' ')}</td>
                <td class="peq">
                  ${u.matricula ? `Aluno Mat. ${esc(u.matricula)} (${esc(u.curso_nome || '')})` : ''}
                  ${u.matricula_funcional ? `Docente Mat. ${esc(u.matricula_funcional)} — ${esc(u.area || 'Geral')}${u.externo ? ' (Externo)' : ''}` : ''}
                </td>
                <td>${u.ativo ? chip('Ativo', 'ok') : chip('Inativo', 'danger')}</td>
                
                <td class="acoes">
                  ${u.id !== usuario.id ? `
                    ${botao(u.ativo ? 'Inativar' : 'Ativar', {
    acao: 'alternar-ativo',
    classe: 'mini neutro',
    dados: { id: u.id, ativo: u.ativo ? '0' : '1' }
  })}
                  
                  ${botao('Excluir', {
    acao: 'excluir-usuario',
    classe: 'mini perigo',
    dados: { id: u.id, nome: u.nome }
  })}
                   ` : ''}
                  </td>


              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  ligarAcoes(elConteudo, {
    'alternar-ativo': async (btn) => {
      await patch(`/usuarios/${btn.dataset.id}/ativo`, { ativo: btn.dataset.ativo === '1' });
      toast('Situação do usuário atualizada.', 'ok');
      await telaUsuarios();
    },
    'excluir-usuario': async (btn) => {
      const nome = btn.dataset.nome;

      const confirmado = await confirmarAcao(
        'Excluir usuário',
        `Tem certeza de que deseja excluir permanentemente o usuário "${nome}"? Esta ação não poderá ser desfeita.`,
        {
          confirmar: 'Excluir definitivamente',
          perigo: true
        }
      );

      if (!confirmado) return;

      await del(`/usuarios/${btn.dataset.id}`);

      toast('Usuário excluído com sucesso!', 'ok');

      await telaUsuarios();
    },
    'novo-usuario': async () => {
      await abrirModal({
        titulo: 'Cadastrar novo usuário',
        larga: true,
        confirmar: 'Criar usuário',
        html: `
          <form id="f-usr">
            <div class="linha-campos">
              <div class="campo"><label>Nome completo *</label><input type="text" name="nome" required minlength="3"></div>
              <div class="campo"><label>E-mail institucional *</label><input type="email" name="email" required></div>
            </div>
            <div class="linha-campos">
              <div class="campo"><label>Senha inicial (mín. 8 caracteres, letras e números) *</label><input type="password" name="senha" required minlength="8" value="Afya@2026"></div>
              <div class="campo"><label>Perfil principal *</label>
                <select name="papel" id="sel-papel" required>
                  <option value="ALUNO">Aluno</option>
                  <option value="PROFESSOR">Professor / Orientador / Avaliador</option>
                  ${usuario.ehAdmin ? '<option value="COORDENADOR">Coordenador de Curso</option><option value="ADMIN">Administrador</option>' : ''}
                </select>
              </div>
            </div>
            <div id="bloco-aluno" class="linha-campos">
              <div class="campo"><label>Matrícula do aluno *</label><input type="text" name="matricula" placeholder="Ex.: 2026010"></div>
              <div class="campo"><label>Curso *</label><select name="curso_id">${opcoes(cursos, 'id', 'nome')}</select></div>
            </div>
            <div id="bloco-docente" hidden>
              <div class="linha-campos">
                <div class="campo"><label>Matrícula funcional *</label><input type="text" name="matricula_funcional" placeholder="Ex.: DOC010"></div>
                <div class="campo"><label>Área de atuação</label><input type="text" name="area" placeholder="Ex.: Engenharia de Software"></div>
                <div class="campo"><label>Titulação</label><input type="text" name="titulacao" placeholder="Mestre / Doutor"></div>
              </div>
              <label class="check"><input type="checkbox" name="externo" value="1"> Avaliador convidado externo à instituição</label>
            </div>
          </form>`,
        onAbrir: (m) => {
          const sel = m.querySelector('#sel-papel');
          const bAluno = m.querySelector('#bloco-aluno');
          const bDoc = m.querySelector('#bloco-docente');
          sel.onchange = () => {
            bAluno.hidden = sel.value !== 'ALUNO';
            bDoc.hidden = sel.value !== 'PROFESSOR';
          };
        },
        onConfirm: async (m) => {
          const f = formDados(m.querySelector('#f-usr'));
          const corpo = {
            nome: f.nome, email: f.email, senha: f.senha, papeis: [f.papel],
            aluno: f.papel === 'ALUNO' ? { matricula: f.matricula, curso_id: Number(f.curso_id), status: 'ATIVO' } : undefined,
            docente: f.papel === 'PROFESSOR' ? { matricula_funcional: f.matricula_funcional, area: f.area, titulacao: f.titulacao, limite_orientandos: 8, externo: !!f.externo } : undefined,
          };
          await post('/usuarios', corpo);
          toast('Usuário cadastrado com sucesso!', 'ok');
          await telaUsuarios();
        },
      });
    },
  });
}

// =====================================================================
//  9. NOTIFICAÇÕES E PERFIL DO USUÁRIO
// =====================================================================

async function telaNotificacoes() {
  const { lista, naoLidas } = await get('/notificacoes');

  elConteudo.innerHTML = `
    ${cabecalho('Notificações', 'Avisos automáticos sobre mudanças de status, versões e bancas.', naoLidas ? botao('Marcar todas como lidas', { acao: 'ler-todas', icon: 'ok', classe: 'neutro' }) : '')}
    <div class="card">
      ${!lista.length ? '<p class="vazio">Nenhuma notificação até o momento.</p>' : `<ul class="lista">${lista.map((n) => `
        <li>
          <div class="linha">
            <div>
              <div class="tit">${!n.lida ? chip('Nova', 'primary') : ''} ${esc(n.titulo)}</div>
              <div class="peq" style="margin-top:3px;">${esc(n.mensagem)}</div>
              <div class="suave peq">${fmtDataHora(n.criado_em)}</div>
            </div>
            ${n.link ? `<a class="btn mini neutro" href="${esc(n.link)}">Abrir</a>` : ''}
          </div>
        </li>`).join('')}</ul>`}
    </div>`;

  if (naoLidas) {
    await post('/notificacoes/lidas');
    await atualizarSino();
  }
  ligarAcoes(elConteudo, {
    'ler-todas': async () => {
      await post('/notificacoes/lidas');
      await atualizarSino();
      await telaNotificacoes();
    },
  });
}

async function telaPerfil() {
  elConteudo.innerHTML = `
    ${cabecalho('Minha conta', 'Seus dados de acesso e alteração de senha.')}
    <div class="grade c2">
      <div class="card">
        <h2><span class="esq">${icone('usuario')} Dados cadastrais</span></h2>
        <dl class="dados">
          <dt>Nome</dt><dd><strong>${esc(usuario.nome)}</strong></dd>
          <dt>E-mail</dt><dd>${esc(usuario.email)}</dd>
          <dt>Perfis</dt><dd>${usuario.papeis.map((p) => chip(PAPEL_ROTULO[p] || p)).join(' ')}</dd>
          ${usuario.aluno ? `<dt>Matrícula / Curso</dt><dd>${esc(usuario.aluno.matricula)} — ${esc(usuario.aluno.curso_nome)}</dd>` : ''}
          ${usuario.docente ? `<dt>Registro docente</dt><dd>${esc(usuario.docente.matricula_funcional)} — ${esc(usuario.docente.area || 'Geral')}</dd>` : ''}
        </dl>
      </div>
      <div class="card">
        <h2><span class="esq">${icone('cadeado')} Alterar senha</span></h2>
        <form id="f-senha">
          <div class="campo"><label>Senha atual *</label><input type="password" name="atual" required></div>
          <div class="campo"><label>Nova senha (mín. 8 caracteres, letras e números) *</label><input type="password" name="nova" required minlength="8"></div>
          <button type="submit" class="btn">Atualizar senha</button>
        </form>
      </div>
    </div>`;

  document.getElementById('f-senha').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    try {
      await post('/auth/alterar-senha', formDados(f));
      f.reset();
      toast('Senha atualizada com sucesso!', 'ok');
    } catch (err) {
      toast(err.message, 'erro');
    }
  };
}

iniciar();
