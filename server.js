const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express(); 
const https = require('https');


const axios = require('axios');
const cheerio = require("cheerio"); 

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
        let theRemovedElement = data.shift()
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
    res.json({'ok':'ok'});
});

app.get('/takeSalary', function(req, res){
    fs.readFile('vagasdb.json', 'utf8', function(err, data){
        if (err) {
          var response = {status: 'falha', resultado: err};
          res.json(response);
        } else {
          var obj = JSON.parse(data);
					var returnObj = [];
          obj.forEach(function(role) {
						if (role != null) {
										axios.get('https://www.vagas.com.br/mapa-de-carreiras/servico/cargos/'+role[0], config)
										.then(function(response) {
												data = response.data
												let $ = cheerio.load(data)
												$(".mobileButton ").each((index, element) => { 
														let paginationURL = $(element).attr("href") 
														role.push('https://www.vagas.com.br/mapa-de-carreiras/servico/'+paginationURL)
														returnObj.push(role);
														fs.writeFileSync('vagawithurl.json', JSON.stringify(returnObj), function(err) {
															if (err) {
																res.json({'nok':'ok'});
															} else {
																res.json({'ok':'ok'});
															}
													});
												})
								});
						}
          });
					res.json({'nok':'ok'});
					
        }
      });
    
});

app.get('/takeSalaryV2', async function(req, res){
	fs.readFile('vagasdb.json', 'utf8', async function(err, data){
			if (err) {
				var response = {status: 500, resultado: err};
				res.json(response);
			} 
			else {
				var obj = JSON.parse(data);
				var returnObj = await takeurl(obj);
				fs.writeFileSync('vagawithurl.json', JSON.stringify(returnObj), function(err) {
					if (err) {
						var response = {status: 500, resultado: err};
						res.json({'nok':'nok'});
					} 
					else{
						res.json({'ok':'ok'});
					}
				});
			}
		});
	
});


async function delay(url) {
  return new Promise(resolve => {
    setTimeout(() => {
			console.log(url)
      resolve('resolved');
    }, 10);
  });
}

async function takeurl($obj){
	let returnObj = [];
	for (let role of $obj) {
		let delayRequest = await delay(role[0]);
		let response = await  axios.get('https://www.vagas.com.br/mapa-de-carreiras/servico/cargos/'+role[0])
		data = response.data
		let $ = cheerio.load(data)
		let paginationURL =''
		$(".mobileButton ").each((index, element) => { 
				paginationURL = $(element).attr("href") 
		})
		let orderData = 'https://www.vagas.com.br/mapa-de-carreiras/servico/'+paginationURL;

		let responseData = await  axios.get(orderData)
		data = responseData.data

		let $2 = cheerio.load(data)
		let salaryHigh ='N/I'
		let salaryAverage ='N/I'
		let salaryLower ='N/I'
		$2(".higher .money").each((index, element) => { 
			salaryHigh = $(element).html()
		})
		$2(".average .money").each((index, element) => { 
			salaryAverage = $(element).html()
		})
		$2(".lower .money").each((index, element) => { 
			salaryLower = $(element).html()
		})
		role.push(salaryHigh);
		role.push(salaryAverage);
		role.push(salaryLower);
		role.push(orderData);
		returnObj.push(role);
	}
	return returnObj

}

