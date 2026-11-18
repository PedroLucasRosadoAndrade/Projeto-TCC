// Tela de login: entrar, esqueci a senha, verifique seu e-mail e criar nova senha.

const visoes = {
  login: document.getElementById('v-login'),
  esqueci: document.getElementById('v-esqueci'),
  enviado: document.getElementById('v-enviado'),
  redefinir: document.getElementById('v-redefinir'),
};

let ultimoEmail = '';
let aviso = null; // mensagem de sucesso exibida na próxima vez que o login for mostrado

async function chamar(url, corpo) {
  let resp;
  try {
    resp = await fetch(`/api/auth/${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(corpo || {}),
    });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique se ele está em execução.');
  }
  let dados = {};
  try { dados = await resp.json(); } catch { /* resposta sem corpo */ }
  if (!resp.ok) throw new Error(dados.erro || 'Não foi possível concluir. Tente novamente.');
  return dados;
}

function mostrarErro(id, mensagem, sucesso = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = mensagem || '';
  el.hidden = !mensagem;
  el.classList.toggle('ok', sucesso);
}

function limparErros() {
  document.querySelectorAll('.erro').forEach((e) => { e.hidden = true; e.textContent = ''; });
}

function rotear() {
  const [rota, query = ''] = (location.hash.replace(/^#\/?/, '') || 'login').split('?');
  const token = new URLSearchParams(query).get('token');
  let nome = ['login', 'esqueci', 'enviado', 'redefinir'].includes(rota) ? rota : 'login';
  if (nome === 'redefinir' && !token) nome = 'login';
  if (nome === 'enviado' && !ultimoEmail) nome = 'esqueci';

  Object.entries(visoes).forEach(([k, el]) => { el.hidden = k !== nome; });
  limparErros();
  if (aviso && nome === 'login') {
    mostrarErro('erro-login', aviso, true);
    aviso = null;
  }
  const primeiro = visoes[nome].querySelector('input');
  if (primeiro) primeiro.focus();
}

function ocupado(form, sim) {
  const b = form.querySelector('button[type="submit"]');
  if (b) b.disabled = sim;
}

// ---- Entrar
visoes.login.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const email = f.email.value.trim();
  const senha = f.senha.value;
  if (!email || !senha) return mostrarErro('erro-login', 'Informe e-mail e senha.');
  ocupado(f, true);
  try {
    await chamar('login', { email, senha });
    location.href = '/app.html';
  } catch (err) {
    mostrarErro('erro-login', err.message);
    f.senha.value = '';
    f.senha.focus();
  } finally {
    ocupado(f, false);
  }
});

// ---- Esqueci a senha
async function pedirLink(email, idErro) {
  await chamar('esqueci', { email });
  ultimoEmail = email;
  location.hash = '#/enviado';
  mostrarErro(idErro, '');
}

visoes.esqueci.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const email = f.email.value.trim();
  if (!email) return mostrarErro('erro-esqueci', 'Informe o seu e-mail.');
  ocupado(f, true);
  try {
    await pedirLink(email, 'erro-esqueci');
  } catch (err) {
    mostrarErro('erro-esqueci', err.message);
  } finally {
    ocupado(f, false);
  }
});

document.getElementById('reenviar').addEventListener('click', async () => {
  try {
    await chamar('esqueci', { email: ultimoEmail });
    mostrarErro('erro-enviado', 'Pronto! Enviamos o link novamente.', true);
  } catch (err) {
    mostrarErro('erro-enviado', err.message);
  }
});

// ---- Nova senha
visoes.redefinir.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const token = new URLSearchParams((location.hash.split('?')[1]) || '').get('token');
  if (f.nova.value !== f.confirma.value) return mostrarErro('erro-redefinir', 'As senhas não conferem.');
  ocupado(f, true);
  try {
    await chamar('redefinir', { token, senha: f.nova.value });
    f.reset();
    aviso = 'Senha alterada com sucesso. Entre com a nova senha.';
    location.hash = '#/login';
  } catch (err) {
    mostrarErro('erro-redefinir', err.message);
  } finally {
    ocupado(f, false);
  }
});

// Quem já tem sessão válida vai direto ao sistema
fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => {
  if (r.ok && !location.hash.startsWith('#/redefinir')) location.href = '/app.html';
}).catch(() => {});

window.addEventListener('hashchange', rotear);
rotear();
