drop schema bd_gestaoTCC;
create database bd_gestaoTCC;
use bd_gestaoTCC; 

create table Usuario (
 id_usu int primary key auto_increment,
 nome_usu varchar(150),
 email_usu varchar(190),
 senha_usu varchar(255),
 telefone_usu varchar(25),
 ativo_usu boolean not null,
 dataCriacao_usu datetime
);

create table  Papel (
 id_pap int auto_increment primary key,
 nome_pap varchar(30) not null unique,
 descricao_pap varchar(255)
);

create table UsuarioPapel (
 id_usu_fk int,
 foreign key (id_usu_fk) references Usuario(id_usu),
 id_pap_fk int,
 foreign key (id_pap_fk) references papel(id_pap)
);

create table Aluno (
 id_alu int auto_increment primary key,
 matricula_alu varchar(30) not null unique,
 status_alu enum('Ativo','Inativo','Concluido') not null default 'ativo',
 id_usu_fk int not null unique,
 foreign key (id_usu_fk) references Usuario(id_usu)
);

create table Professor (
 id_prof int auto_increment primary key,
 matriculaDocente_prof varchar(30) not null,
 titulacao_prof VARCHAR(100),
 area_Atuacao_prof varchar(150),
 limite_orientandos_prof int,
 id_usu_fk int not null,
 foreign key (id_usu_fk) references Usuario(id_usu)
);

create table Curso (
 id_cur int auto_increment primary key,
 nome_cur varchar(150) not null,
 descricao_cur varchar(200),
 ativo_cur boolean not null
);

create table PeriodoLetivo (
 id_peri int auto_increment primary key,
 nome_peri varchar(20) not null,
 dataInicio_peri date,
 dataFim_peri date,
 CHECK (dataFim_peri >= dataInicio_peri)
);

create table Turma (
 id_tur int auto_increment primary key,
 tipo_tur enum('TCC1','TCC2') not null,
 nome_tur varchar(100),status enum('Ativa','Encerrada','Arquivada') not null default 'Ativa',
 id_cur_fk int,
 foreign key (id_cur_fk) references Curso(id_cur),
 id_peri_fk int,
 foreign key (id_peri_fk) references PeriodoLetivo(id_peri)
);

create table MatriculaTurma (
 id_matri int auto_increment primary key,
 dataMatricula date,
 status_matri enum('Cursando','Aprovado','Reprovado','Cancelado') not null default 'Cursando',
 id_alu_fk int,
 foreign key (id_alu_fk) references Aluno(id_alu),
 id_tur_fk int,
 foreign key (id_tur_fk) references Turma(id_tur)
);

create table TCC (
 id_tcc int auto_increment primary key,
 id_alu_fk int,
 id_cur_fk int,
 id_peri_fk int,
 titulo_tcc varchar(255) not null,
 resumo_tcc text,
 area_tcc varchar(150),
 palavrasChave_tcc varchar(255),
 status_tcc enum('Rascunho','Proposta','Em_Desenvolvimento','Em_Revisao','Aguardando_Banca','Aprovado','Ressalvas','Reprovado','Arquivado') not null default 'Rascunho',
 etapaAtual_tcc enum('TCC1','TCC2') not null default 'TCC1',
 dataCriacao_tcc date,
 dataConclusao_tcc date,
 foreign key (id_alu_fk) references Aluno(id_alu),
 foreign key (id_cur_fk) references Curso(id_cur),
 foreign key (id_peri_fk) references PeriodoLetivo(id_peri)
);

create table PropostaTCC (
 id_prop int auto_increment primary key,
 dataSubmissao_prop date,
 status_prop enum('Rascunho','EM_Analise','Aprovado','Recusado','Ajustes') not null default 'Rascunho',
 aprovacaoOrientador_prop enum('Pendente','Aprovado','Recusada') not null default 'Pendente',
 aprovacaoCoordenacao_prop enum('Pendente','Aprovado','Recusada') not null default 'Pendente',
 justificativa_prop text,
 id_tcc_fk int,
 foreign key (id_tcc_fk) references TCC(id_tcc)
);

create table Orientacao (
 id_orie int auto_increment primary key,
 funcao_orie enum('Orientador','Coorientador') not null default 'Orientador',
 status_orie enum('Solicitada','Aceita','Recusada','Encerada') not null default 'Solicitada',
 dataInicio_orie date,
 dataFim_orie date,
 justificativa_orie TEXT,
 orientadorAtivo_tcc BIGINT UNSIGNED GENERATED ALWAYS AS
  (CASE WHEN funcao_orie ='Orientador' AND status_orie='ACEITA' AND dataFim_orie IS NULL THEN id_tcc_fk ELSE NULL END) STORED,
 id_tcc_fk int,
 foreign key (id_tcc_fk) references TCC(id_tcc),
 id_prof_fk int,
 foreign key (id_prof_fk) REFERENCES Professor(id_prof)
);

create table CronogramaEtapa (
id_eta int auto_increment primary key,
 nome_eta varchar(150),
 descricao_eta text,
 dataInicio_eta date,
 dataFim_eta date,
 bloqueiaEnvio boolean default true,
 CHECK (dataFim_eta >= dataInicio_eta),
 id_tur_fk int,
 foreign key (id_tur_fk) references Turma(id_tur)
);

CREATE TABLE VersaoTcc (
 id_vers int auto_increment primary key,
 numero_vers int,
 tipo_vers enum('Proposta','Parcial','Final'),
 arquivo_vers varchar(500),
 descricao_vers text,
 dataEnvio_vers date,
 status_vers enum('Eviada','Em_Revisao','Ajustes','Aprovado') not null default 'Eviada',
 id_tcc_fk int not null,
 foreign key (id_tcc_fk) references TCC(id_tcc),
 id_usu_fk int not null,
 foreign key (id_usu_fk) references Usuario(id_usu)
);

create table Documento (
 id_doc int auto_increment primary key,
 tipo_doc enum('Pre_Projeto','Artigo','Relatorio','Outro'),
 arquivo_doc varchar(500),
 descricao_doc text,
 dataUpload date,
 id_tcc_fk int not null,
 foreign key (id_tcc_fk) references TCC(id_tcc)
);

create table Reuniao (
 id_reu int auto_increment primary key,
 data_reu date,
 hora_reu time,
 pauta_reu text,
 deliberacoes_reu text,
 id_tcc_fk int not null,
 foreign key (id_tcc_fk) references TCC(id_tcc),
 id_prof_fk int,
 foreign key (id_prof_fk) references Professor(id_prof)
);

create table Parecer (
 id_pare int auto_increment primary key,
 tipo ENUM('ORIENTACAO','AVALIACAO','PROPOSTA') NOT NULL,
 texto TEXT NOT NULL,
 data_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 id_tcc_fk int not null,
 foreign key (id_tcc_fk) references TCC(id_tcc),
 id_usu_fk int,
 foreign key (id_usu_fk) references Usuario(id_usu),
 id_vers_fk int,
 foreign key (id_vers_fk) references VersaoTcc(id_vers)
);

create table Banca (
 id_ban int auto_increment primary key,
 data_ban date,
 hora_ban time,
 local_ban varchar(255),
 modalidade_ban enum('Presencial','Remota') not null default 'Presencial',
 status_ban enum('Rascunho','Confirmada','Realizada','Cancelada') not null default 'Rascunho',
 resultado_ban enum('Aprovado','Ressalvas','Reprovado'),
 mediaFinal double,
 id_tcc_fk int not null,
 foreign key (id_tcc_fk) references TCC(id_tcc)
);

create table MembroBanca (
 id_mem int auto_increment primary key,
 funcao_mem enum('Presidente','Avaliador','Suplente') not null,
 id_ban_fk int,
 foreign key (id_ban_fk) references Banca(id_ban),
 id_prof_fk int,
 foreign key (id_prof_fk) references Professor(id_prof)
);

create table Avaliacao (
 id_ava int auto_increment primary key,
 notaConteudo_ava double,
 notaMetodologia_ava double,
 notaApresentacao_ava double,
 notaArguicao_ava double,
 parecer_ava text,
 dataRegistro_ava date,
 check (notaConteudo_ava BETWEEN 0 AND 10),
 check (notaMetodologia_ava BETWEEN 0 AND 10),
 check (notaApresentacao_ava BETWEEN 0 AND 10),
 check (notaArguicao_ava BETWEEN 0 AND 10),
 id_mem_fk int,
 foreign key (id_mem_fk) references MembroBanca(id_mem)
);

create table Notificacao (
 id_not int auto_increment primary key,
 mensagem_not text,
 dataEnvio date,
 lida_not boolean,
 id_usu_fk int,
 foreign key (id_usu_fk) references Usuario(id_usu)
);

create table HistoricoStatus (
 id_hist int auto_increment primary key,
 statusAnterior_hist varchar(40),
 statusNovo_hist varchar(40) NOT NULL,
 dataAlteracao_hist date,
 justificativa_hist text,
 id_tcc_fk int not null,
 foreign key (id_tcc_fk) references TCC(id_tcc),
 id_usu_fk int,
 foreign key (id_usu_fk) references Usuario(id_usu)
);

create table Relatorio (
 id_rela int auto_increment primary key,
 tipo_rela enum('Status','Indicadores','Orientacoes') not null,
 formato_rela enum('PDF','XLSX') not null,
 filtros_rela varchar(100),
 dataGeracao_rela date,
 id_usu_fk int,
 foreign key (id_usu_fk) references Usuario(id_usu)
);

insert into Papel (id_pap,nome_pap,descricao_pap) VALUES (1,'Aluno','Acesso do estudante');
insert into Papel (id_pap,nome_pap,descricao_pap) VALUES (2,'Professor','Docente; pode orientar ou participar de banca');
insert into Papel (id_pap,nome_pap,descricao_pap) VALUES (3,'Coordenador','Gestao academica e administrativa');

select * from Papel;