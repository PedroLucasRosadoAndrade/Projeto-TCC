const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const porta = Number(process.env.PORT) || 3601;
const appUrl = (process.env.APP_URL || `http://localhost:${porta}`).replace(/\/$/, '');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('\n[ERRO] Defina JWT_SECRET (mínimo 16 caracteres) no arquivo .env.\n' +
    '       Copie o arquivo .env.example para .env e preencha os valores.\n');
  process.exit(1);
}

module.exports = {
  porta,
  appUrl,
  cookieSeguro: appUrl.startsWith('https://'),
  jwtSecret: process.env.JWT_SECRET,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3601,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'tcc_afya',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'TCC+ Afya Ji-Paraná <nao-responda@afya.teste>',
  },
  uploadDir: path.join(__dirname, '..', 'uploads'),
  publicDir: path.join(__dirname, '..', 'public'),
  maxUploadMb: 50, // requisito de desempenho: arquivos de até 50 MB
};
