//node server
var express = require("express");
const bodyParser = require('body-parser');

//pacotes
const fs = require('fs');
const AWS = require('aws-sdk');
var mktemp = require("mktemp");
var path = require('path');
var pdf = require('pdf-poppler');
var wf = require('async-waterfall');


//var porta = 240;
var porta = 3000;

var app = express();

//declarações
app.use(bodyParser.json({ limit: '1000mb', extended: true }));
app.use(bodyParser.urlencoded({ limit: '1000mb', extended: true }))
app.use(express.static("./"));

app.listen(porta, function () {
    console.log(new Date().toLocaleString() + ": Serviço de pdf2img  iniciado na porta " + porta + "..");
});

let lista = [];

app.get("/", function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(new Date().toLocaleString() + ": Serviço de pdf2img para sites iniciado na porta " + porta + "..");
});

app.post("/converter", function (req, res) {

    let region = req.body.region;
    let accesskey = req.body.accesskey;
    let secretKey = req.body.secretKey;
    let bucket = req.body.bucket;
    let filekey = req.body.filekey;


    var s3 = new AWS.S3();
    s3.config.update({ region: region, accessKeyId: accesskey, secretAccessKey: secretKey });

    wf([
        function (next) {

            //download do pdf do s3
            s3.getObject({
                Bucket: bucket,
                Key: filekey
            }, function (err, data) {
                if (err) {
                    callback(res, 's3 download [err]: ' + err);
                }
                next(null, data);
             });
        },
        function (response, next) {

            if (!fs.existsSync("tmp")) {
                fs.mkdirSync("tmp");
            }

            //criando arquivo com nome randômico
            var temp_file = mktemp.createFileSync("tmp/XXXXXXXXXX.pdf");

            //preenchendo arquivo random
           fs.writeFileSync(temp_file, response.Body);

            next(null, temp_file);
        },
        async function (filepath, next) {

            //montando diretório em que as imagens serão salvas
            var dir = GetDiretorioImagens(filepath);

            //verificando existência
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
            }

            //opções de conversão das páginas
            let opts = {
                format: 'jpeg',
                out_dir: dir,
                out_prefix: 'page',
                page: null,
                scale:2048
            };

            //iniciando conversão
           var result = await convert(filepath, opts);

           if(result){
            next(null, dir, filepath);
           }

        },
        function (dir, filepath, next) {

            //deletando arquivo pdf
            fs.unlink(filepath, function (err) {
                if (err) {
                    callback(res, '[err] delete pdf: ' + err);
                }
            });

            //lendo imagens geradas das páginas
            fs.readdir(dir, function (err, files) {

                if (err) {
                    callback(res, '[err] Unable to scan directory: ' + err);
                }

                lista = [files.length];

                //upload das páginas para o s3
                files.forEach((file, i) => {

                    try {

                        var keyname = filekey.replace(path.basename(filekey, path.extname(filekey)) + '.pdf', '') + file.replace('-', '_');

                        var dirr = dir + '/' + file;

                        //configurando os dados para o upload
                        let params = {
                            ACL: 'public-read',
                            Key: keyname,
                            Body: fs.readFileSync(dirr),
                            ContentType: 'binary',
                            Bucket: bucket
                        };

                        //salvando caminho final da imagem para o retorno
                        lista[i] = 'https://s3.amazonaws.com/' + bucket + '/' + keyname;

                        //upload da imagem no s3
                        s3.putObject(params, function (err, data) {

                            if (err) {
                                callback(res, '[err] ao subir ' + dirr + ': ' + err);
                            }

                        });
                    } catch (e) {
                        callback(res, '[err] processo upload s3: ' + e + '-  arquivo: ' + dir + '/' + file);
                    }
                });

                rmdir(dir);
                next(null, lista);
            });
        }
    ], function (err, result) {

        if (err) {
            callback(res, '[err] final do processo: ' + err);
        }

        callback(res, result.toString());
    });
});

function rmdir(d) {
    var self = arguments.callee;
    if (fs.existsSync(d)) {
        fs.readdirSync(d).forEach(function (file) {
            var C = d + '/' + file;
            if (fs.statSync(C).isDirectory()) self(C);
            else fs.unlinkSync(C);
        });
        fs.rmdirSync(d);
    }
}

async function convert(filepath, opts){
    await pdf.convert(filepath, opts);
    return true;
}

function callback(res, message) {
    res.header('Content-Type', 'application/json');
    res.json(message);
}

function GetDiretorioImagens(filepath){
    var filenamewithoutextension = path.basename(filepath, path.extname(filepath));
    return path.dirname(filepath) + '/' + filenamewithoutextension;
}
