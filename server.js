const express = require('express');
const cors = require('cors');
// const bodyParser = require('body-parser');
const db = require('./db.js');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));


app.get('/', (req, res) => {
    res.sendFile(__dirname + './public/home.html');
});

app.listen(3601, () => {
    console.log('Servidor rodando em http://localhost:3601');
});
