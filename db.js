const mysql = require('mysql2');

// Ajuste com as credenciais do seu MySQL Workbench
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      // Seu usuário do MySQL
    password: 'root', // Sua senha do MySQL
    database: 'sistema_login'
});

db.connect((err) => {
    if (err) {
        console.error('Erro ao conectar ao MySQL:', err);
        return;
    }
    console.log('Conectado com sucesso ao MySQL!');
});

module.exports = db;