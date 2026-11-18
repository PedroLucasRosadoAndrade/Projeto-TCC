// Testes das regras de negócio puras. Execute: npm test
const assert = require('assert');
const R = require('../server/regras');

let ok = 0;
function t(nome, fn) {
  try { fn(); ok += 1; console.log('  ✓', nome); } catch (e) { console.error('  ✗', nome, '\n   ', e.message); process.exitCode = 1; }
}

console.log('\nRegras de negócio');

t('RN-005: média >= 7,0 aprova', () => assert.strictEqual(R.resultadoPorMedia(7), 'APROVADO'));
t('RN-005: 6,99 cai em ressalvas', () => assert.strictEqual(R.resultadoPorMedia(6.99), 'RESSALVAS'));
t('RN-005: 5,0 ainda é ressalvas', () => assert.strictEqual(R.resultadoPorMedia(5), 'RESSALVAS'));
t('RN-005: 4,99 reprova', () => assert.strictEqual(R.resultadoPorMedia(4.99), 'REPROVADO'));
t('RN-005: régua configurável', () => assert.strictEqual(R.resultadoPorMedia(6, { aprovacao: 6, ressalvas: 4 }), 'APROVADO'));

t('RF-011: média dos 4 critérios', () =>
  assert.strictEqual(R.mediaCriterios({ conteudo: 8, metodologia: 7, apresentacao: 9, arguicao: 6 }), 7.5));
t('RN-005: nota final = média dos avaliadores', () => assert.strictEqual(R.mediaFinal([7.5, 8, 6.5]), 7.33));
t('mediaFinal sem notas devolve null', () => assert.strictEqual(R.mediaFinal([]), null));
t('lerNota aceita vírgula', () => assert.strictEqual(R.lerNota('7,5'), 7.5));
t('lerNota rejeita >10, <0 e texto', () => {
  assert.strictEqual(R.lerNota('10,5'), null);
  assert.strictEqual(R.lerNota('-1'), null);
  assert.strictEqual(R.lerNota('abc'), null);
});
t('status por resultado', () => {
  assert.strictEqual(R.statusPorResultado('RESSALVAS'), 'APROVADO_RESSALVAS');
  assert.strictEqual(R.statusPorResultado('REPROVADO'), 'REPROVADO');
});

const banca = (...tipos) => tipos.map((tipo, i) => ({ docente_id: i + 1, tipo }));
t('RN-004: banca válida (1 presidente + 2 avaliadores)', () =>
  assert.deepStrictEqual(R.validarComposicaoBanca(banca('PRESIDENTE', 'AVALIADOR', 'AVALIADOR'), { orientadorId: 99 }), []));
t('RN-004: exige no mínimo 2 avaliadores', () =>
  assert.ok(R.validarComposicaoBanca(banca('PRESIDENTE', 'AVALIADOR'), { orientadorId: 99 }).length > 0));
t('RN-004: exige exatamente 1 presidente', () => {
  assert.ok(R.validarComposicaoBanca(banca('AVALIADOR', 'AVALIADOR', 'AVALIADOR'), { orientadorId: 99 }).length > 0);
  assert.ok(R.validarComposicaoBanca(banca('PRESIDENTE', 'PRESIDENTE', 'AVALIADOR', 'AVALIADOR'), { orientadorId: 99 }).length > 0);
});
t('RN-003: orientador não pode ser avaliador', () =>
  assert.ok(R.validarComposicaoBanca(banca('PRESIDENTE', 'AVALIADOR', 'AVALIADOR'), { orientadorId: 2 }).length > 0));
t('RN-003: orientador pode presidir (sem avaliar)', () =>
  assert.deepStrictEqual(R.validarComposicaoBanca(banca('PRESIDENTE', 'AVALIADOR', 'AVALIADOR'), { orientadorId: 1 }), []));
t('Banca: docente repetido é recusado', () => {
  const m = [{ docente_id: 1, tipo: 'PRESIDENTE' }, { docente_id: 1, tipo: 'AVALIADOR' }, { docente_id: 3, tipo: 'AVALIADOR' }];
  assert.ok(R.validarComposicaoBanca(m, { orientadorId: 99 }).length > 0);
});
t('Banca: no máximo 4 avaliadores + presidente', () =>
  assert.ok(R.validarComposicaoBanca(banca('PRESIDENTE', 'AVALIADOR', 'AVALIADOR', 'AVALIADOR', 'AVALIADOR', 'AVALIADOR'), { orientadorId: 99 }).length > 0));
t('RN-003: orientador que preside não lança nota', () => {
  const membros = banca('PRESIDENTE', 'AVALIADOR', 'AVALIADOR', 'SUPLENTE');
  assert.deepStrictEqual(R.membrosQueAvaliam(membros, 1).map((m) => m.docente_id), [2, 3]);
  assert.deepStrictEqual(R.membrosQueAvaliam(membros, 99).map((m) => m.docente_id), [1, 2, 3]);
});

t('TCC 2 só após aprovação no TCC 1', () => {
  assert.deepStrictEqual(R.proximoTipoTcc([]), { tipo: 'TCC1' });
  assert.deepStrictEqual(R.proximoTipoTcc([{ tipo: 'TCC1', status: 'REPROVADO' }]), { tipo: 'TCC1' });
  assert.deepStrictEqual(R.proximoTipoTcc([{ tipo: 'TCC1', status: 'EM_REVISAO' }]), { tipo: 'TCC1' });
  assert.deepStrictEqual(R.proximoTipoTcc([{ tipo: 'TCC1', status: 'APROVADO_RESSALVAS' }]), { tipo: 'TCC2' });
  assert.ok(R.proximoTipoTcc([{ tipo: 'TCC1', status: 'ARQUIVADO' }, { tipo: 'TCC2', status: 'APROVADO' }]).erro);
});

t('RF-013: o próprio dia do prazo ainda vale', () => {
  assert.strictEqual(R.prazoVencido('2026-12-10', '2026-12-10'), false);
  assert.strictEqual(R.prazoVencido('2026-12-10', '2026-12-11'), true);
  assert.strictEqual(R.prazoVencido('2026-12-10 00:00:00', '2026-12-09'), false);
});
t('data BR', () => assert.strictEqual(R.dataBR('2026-12-10'), '10/12/2026'));

t('RNF-003: política de senha', () => {
  assert.ok(R.validarSenha('curta1'));
  assert.ok(R.validarSenha('somenteletras'));
  assert.ok(R.validarSenha('12345678'));
  assert.strictEqual(R.validarSenha('Afya@2026'), null);
});
t('e-mail válido', () => {
  assert.ok(R.emailValido('aluno@afya.teste'));
  assert.ok(!R.emailValido('sem-arroba'));
});

console.log(`\n${ok} testes aprovados.\n`);
