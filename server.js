const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express(); 

const axios = require('axios');

var config = {
    /* Your settings here like Accept / Headers etc. */
}


app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended:true }));
app.use(bodyParser.json());

app.use(function(req, res, next){
 res.setHeader("Access-Control-Allow-Origin", "*");
 res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
 res.setHeader("Access-Control-Allow-Headers", "content-type");
 res.setHeader("Content-Type", "application/json");
 res.setHeader("Access-Control-Allow-Credentials", true);
 next();
});

app.listen(3333);

app.get('/api', function(req, res){
    fs.readFile('vagasdb.json', 'utf8', function(err, data){
      if (err) {
        var response = {status: 'falha', resultado: err};
        res.json(response);
      } else {
        var obj = JSON.parse(data);
        res.json(obj);
      }
    });
   });

   app.get('/saveDBVagas', function(req, res){

    axios.get('https://www.vagas.com.br/mapa-de-carreiras/api/mapa', config)
    .then(function(response) {
        data = response.data['cargos']
        fs.writeFileSync('vagasdb.json', JSON.stringify(data), function(err) {
            if (err) {
              var response = {status: 'falha', resultado: err};
              res.json(response);
            } else {
              var response = {status: 'sucesso', resultado: 'Registro feito com sucesso'};
              res.json(response);
            }
          });
    });
   });