const nodemailer = require('nodemailer');
const config = require('./config');

const transporter = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

/**
 * Envia e-mail por SMTP. Sem SMTP configurado (.env), o conteúdo é apenas
 * exibido no console do servidor — útil para testes locais.
 * Nunca lança erro: falha de e-mail não deve derrubar a operação principal.
 */
async function enviarEmail(para, assunto, texto) {
  if (!transporter) {
    console.log(`\n[E-MAIL SIMULADO — configure SMTP no .env para enviar de verdade]\nPara: ${para}\nAssunto: ${assunto}\n${texto}\n`);
    return;
  }
  try {
    await transporter.sendMail({ from: config.smtp.from, to: para, subject: assunto, text: texto });
  } catch (e) {
    console.error('Falha ao enviar e-mail para', para, '-', e.message);
  }
}

module.exports = { enviarEmail };
