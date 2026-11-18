const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');
const { erro } = require('./util');

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  // nome aleatório: o nome original nunca é usado no disco (evita path traversal)
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.pdf`),
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ehPdf = file.mimetype === 'application/pdf' && /\.pdf$/i.test(file.originalname);
    cb(ehPdf ? null : erro(400, 'Envie o arquivo em formato PDF.'), ehPdf);
  },
});

/** Confere a assinatura do arquivo (%PDF-) para não confiar apenas na extensão/mimetype. */
function pdfAutentico(caminho) {
  try {
    const fd = fs.openSync(caminho, 'r');
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    return buf.toString('latin1') === '%PDF-';
  } catch {
    return false;
  }
}

/** Nome original seguro para guardar no banco / exibir. */
function nomeOriginal(file) {
  return path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8')).slice(0, 200);
}

module.exports = { upload, pdfAutentico, nomeOriginal };
