const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express(); 

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
    fs.readFile('usuarios.json', 'utf8', function(err, data){
      if (err) {
        var response = {status: 'falha', resultado: err};
        res.json(response);
      } else {
        var obj = JSON.parse(data);
        var result = 'Nenhum usuário foi encontrado';
    
        obj.usuarios.forEach(function(usuario) {
          if (usuario != null) {
            if (usuario.usuario_id == req.query.usuario_id) {
              result = usuario;
            }
          }
        });
    
        var response = {status: 'sucesso', resultado: result};
        res.json(response);
      }
    });
   });


   app.post('/api', function(req, res){
    fs.readFile('usuarios.json', 'utf8', function(err, data){
      if (err) {
        var response = {status: 'falha', resultado: err};
        res.json(response);
      } else {
        var obj = JSON.parse(data);
        req.body.usuario_id = obj.usuarios.length + 1;
    
        obj.usuarios.push(req.body);
    
        fs.writeFile('usuarios.json', JSON.stringify(obj), function(err) {
          if (err) {
            var response = {status: 'falha', resultado: err};
            res.json(response);
          } else {
            var response = {status: 'sucesso', resultado: 'Registro incluso com sucesso'};
            res.json(response);
          }
        });
      }
    });
   });