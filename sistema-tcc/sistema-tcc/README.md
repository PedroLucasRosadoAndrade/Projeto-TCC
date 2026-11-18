# TCC+ | Sistema Web de Gestão de TCC — Afya Ji-Paraná

Sistema desenvolvido exclusivamente com **HTML, CSS, JavaScript** e banco de dados **MySQL (MySQL Workbench)**, atendendo aos Requisitos Funcionais (`RF-001` a `RF-014`), Requisitos Não Funcionais (`RNF-001` a `RNF-005`) e Regras de Negócio (`RN-001` a `RN-006`) da documentação.

---

## 1. Como compilar o Banco de Dados no MySQL Workbench

1. Abra o **MySQL Workbench** e entre na sua conexão local (ex.: `Local instance MySQL80`).
2. No menu superior, clique em **File > Open SQL Script...** e selecione o arquivo:
   `database/tcc_afya.sql`
3. Clique no ícone de **Raio (Execute)** ou pressione `Ctrl + Shift + Enter`.
4. Pronto! O banco `tcc_afya`, todas as tabelas e os dados iniciais de demonstração serão criados.

---

## 2. Como configurar e iniciar o sistema

1. Abra o arquivo `.env` na raiz da pasta `sistema-tcc` e informe a senha do seu MySQL em `DB_PASSWORD`:
   ```env
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=SUA_SENHA_DO_MYSQL
   DB_NAME=tcc_afya
   ```
2. No terminal, dentro da pasta `sistema-tcc`, execute:
   ```bash
   npm start
   ```
3. Acesse no navegador:
   **http://localhost:3000**

---

## 3. Contas de demonstração (Senha de todas: `Afya@2026`)

| Perfil | E-mail | Papel no sistema |
| :--- | :--- | :--- |
| **Administrador** | `admin@afya.teste` | Gerencia cursos, períodos, configurações, usuários e relatórios |
| **Coordenação** | `coordenacao@afya.teste` | Homologa propostas, define cronograma, forma bancas e arquiva TCCs |
| **Professor / Orientador** | `professor1@afya.teste` | Aceita/recusa orientações, avalia versões PDF, registra reuniões e avalia bancas (`professor2`, `professor3` e `professor4` também disponíveis) |
| **Aluno** | `aluno1@afya.teste` | Possui TCC em desenvolvimento (`aluno2@afya.teste` possui banca agendada; `aluno3@afya.teste` está livre para cadastrar nova proposta) |

---

## 4. Estrutura simples para edição

- `database/tcc_afya.sql` — Script SQL completo para o MySQL Workbench.
- `public/login.html` e `public/css/login.css` — Telas de Login, Esqueci minha senha e Verifique seu e-mail.
- `public/app.html` e `public/css/app.css` — Estrutura e estilo minimalista do painel e módulos internos.
- `public/js/` — Código JavaScript do front-end (`login.js`, `app.js`, `ui.js`, `api.js`, `icons.js`).
- `server/` — Servidor em JavaScript (`server.js`, conexão MySQL em `db.js`, regras em `regras.js` e rotas em `server/routes/`).
