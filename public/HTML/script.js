
const backdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const fieldLabel = document.getElementById('fieldLabel');
const modalInput = document.getElementById('modalInput');
const modalSelect = document.getElementById('modalSelect');
const form = document.getElementById('modalForm');
const toast = document.getElementById('toast');

let currentModal = 'turma';

// Exibe mensagens na tela
function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 2400);
}

// Abre os formulários
function openModal(type) {
    currentModal = type;

    const config = {
        turma: [
            'Nova turma de TCC',
            'Nome da turma',
            'Ex.: Ciência da Computação — 2026.2'
        ],
        periodo: [
            'Novo período',
            'Período letivo',
            'Ex.: 2026.2'
        ],
        tcc: [
            'Adicionar TCC de aluno',
            'Nome do aluno ou título do TCC',
            'Digite o nome ou título'
        ]
    };

    const dados = config[type];

    modalTitle.textContent = dados[0];
    fieldLabel.textContent = dados[1];
    modalInput.placeholder = dados[2];

    modalInput.value = '';

    modalSelect.style.display =
        type === 'periodo' ? 'none' : 'block';

    backdrop.hidden = false;
    modalInput.focus();
}

// Fecha os formulários
function closeModal() {
    backdrop.hidden = true;
}

// Configura os botões que abrem os formulários


// CONTROLE DOS BOTÕES DE MODAIS

document.addEventListener('click', function (event) {

    const botao = event.target.closest('[data-modal]');

    if (!botao) return;

    const tipo = botao.dataset.modal;

    if (tipo === 'tcc') {

        event.preventDefault();

        const modalTcc = document.getElementById('addTccModal');

        modalTcc.hidden = false;

        return;
    }

    openModal(tipo);

});



// Botões de fechar e cancelar
document.getElementById('closeModal')
    .addEventListener('click', closeModal);

document.getElementById('cancelModal')
    .addEventListener('click', closeModal);

// Fecha ao clicar fora da janela
backdrop.addEventListener('click', event => {
    if (event.target === backdrop) {
        closeModal();
    }
});

// Cadastra informações
form.addEventListener('submit', event => {
    event.preventDefault();

    const value = modalInput.value.trim();

    if (!value) {
        return;
    }

    // Cadastro de nova turma
    if (currentModal === 'turma') {

        const course = modalSelect.value;

        const card = document.createElement('article');

        card.className = 'class-card';

        card.innerHTML = `
            <div class="card-top">
                <span class="eyebrow">
                    ${escapeHtml(course.toUpperCase())}
                </span>

                <span class="semester">2026.2</span>
            </div>

            <h3>${escapeHtml(value)}</h3>

            <p>Nova turma cadastrada</p>

            <div class="pills">
                <span class="pill gray">0 TCC(s)</span>
                <span class="pill blue">TCC 1: 0</span>
                <span class="pill purple">TCC 2: 0</span>
            </div>

            <div class="card-actions">
                <button class="btn mini outline">
                    ▣ Abrir turma
                </button>

                <button class="btn mini outline" data-modal="tcc">
                    ＋ Adicionar TCC
                </button>
            </div>

            <div class="icon-actions">
                <button title="Editar turma">✎</button>
                <button title="Excluir turma">▤</button>
            </div>
        `;

        document.getElementById('turmasGrid')
            .prepend(card);

        // Botão para adicionar TCC
        // Botão para adicionar TCC
        card.querySelector('[data-modal="tcc"]')
            .addEventListener('click', () => {

                document.getElementById('addTccModal').hidden = false;

            });

        // Botão para excluir turma
        card.querySelector('[title="Excluir turma"]')
            .addEventListener('click', () => {

                if (confirm('Deseja remover esta turma?')) {
                    card.remove();
                    showToast('Turma removida da tela.');
                }

            });
    }

    const messages = {
        turma: 'Turma adicionada com sucesso!',
        periodo: 'Período registrado com sucesso!',
        tcc: 'TCC registrado com sucesso!'
    };

    showToast(messages[currentModal]);

    closeModal();
});

// Protege os textos inseridos pelo usuário
function escapeHtml(text) {
    return text.replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

// Filtro de TCC 1 e TCC 2
document.getElementById('stageFilter')
    .addEventListener('change', event => {

        const selected = event.target.value;

        document.querySelectorAll('#studentRows tr')
            .forEach(row => {

                row.hidden =
                    selected !== 'all' &&
                    row.dataset.stage !== selected;

            });
    });

// Navegação do menu superior
document.querySelectorAll('.main-nav a')
    .forEach(link => {

        link.addEventListener('click', event => {

            event.preventDefault();

            document.querySelectorAll('.main-nav a')
                .forEach(item => {
                    item.classList.remove('active');
                });

            link.classList.add('active');

            const section =
                link.querySelector('small')?.textContent || 'Seção';

            showToast(`Seção selecionada: ${section}`);

        });
    });

// Botões para excluir as turmas existentes
document.querySelectorAll(
    '.icon-actions button[title="Excluir turma"]'
).forEach(button => {

    button.addEventListener('click', () => {

        if (confirm('Deseja remover esta turma?')) {

            button.closest('.class-card').remove();

            showToast('Turma removida da tela.');

        }

    });

});


// ELEMENTOS DO MODAL DE TCC
const addTccModal = document.getElementById('addTccModal');
const addTccForm = document.getElementById('addTccForm');

// FECHAR MODAL
function fecharModalTcc() {
    addTccModal.hidden = true;
}

// Botão X
document.getElementById('closeTccModal')
    .addEventListener('click', fecharModalTcc);

// Botão cancelar
document.getElementById('cancelTcc')
    .addEventListener('click', fecharModalTcc);

// Fechar ao clicar fora
addTccModal.addEventListener('click', event => {
    if (event.target === addTccModal) {
        fecharModalTcc();
    }
});

// CADASTRAR TCC
addTccForm.addEventListener('submit', event => {

    event.preventDefault();

    const dadosTcc = {
        tipo: document.getElementById('tipoCadastro').value,
        etapa: document.getElementById('tagProjeto').value,
        aluno: document.getElementById('alunoTcc').value,
        orientador: document.getElementById('orientadorTcc').value,
        titulo: document.getElementById('tituloTcc').value.trim(),
        area: document.getElementById('areaPesquisa').value.trim(),
        palavras: document.getElementById('palavrasChave').value.trim(),
        resumo: document.getElementById('resumoTcc').value.trim()
    };

    // Validação dos campos obrigatórios
    if (
        !dadosTcc.aluno ||
        !dadosTcc.orientador ||
        !dadosTcc.titulo
    ) {
        alert('Preencha todos os campos obrigatórios!');
        return;
    }

    console.log('Dados do TCC:', dadosTcc);

    alert('TCC adicionado à turma com sucesso!');

    addTccForm.reset();

    fecharModalTcc();

});

