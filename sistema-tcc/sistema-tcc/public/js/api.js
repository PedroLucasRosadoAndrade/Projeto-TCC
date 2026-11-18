// Cliente da API. Em caso de sessão expirada (401) volta para o login.
export async function api(metodo, url, corpo) {
  const opcoes = { method: metodo, headers: {}, credentials: 'same-origin' };
  if (corpo instanceof FormData) {
    opcoes.body = corpo;
  } else if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }

  let resp;
  try {
    resp = await fetch(`/api${url}`, opcoes);
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique se ele está em execução.');
  }

  let dados = null;
  try { dados = await resp.json(); } catch { /* resposta sem corpo */ }

  if (!resp.ok) {
    if (resp.status === 401) {
      location.href = '/login.html';
    }
    const erro = new Error((dados && dados.erro) || 'Erro inesperado. Tente novamente.');
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

export const get = (url) => api('GET', url);
export const post = (url, corpo = {}) => api('POST', url, corpo);
export const put = (url, corpo) => api('PUT', url, corpo);
export const patch = (url, corpo) => api('PATCH', url, corpo);
export const del = (url) => api('DELETE', url);

/** Monta querystring ignorando valores vazios. */
export function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
}
