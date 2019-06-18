//node server
var express = require("express");
const bodyParser = require('body-parser');

//pacotes
const fs = require('fs');
const AWS = require('aws-sdk');
var mktemp = require("mktemp");
var path = require('path');
var wf = require('async-waterfall');

//const PDF2Pic = require("pdf2pic");
//var PDFImage = require("pdf-image").PDFImage;

var pdf2img = require('pdf2img');


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

app.post("/converter", async function (req, res) {

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
            var filenamewithoutextension = path.basename(filepath, path.extname(filepath));
            var dir = path.dirname(filepath) + '/' + filenamewithoutextension;

            //verificando existência
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
            }

            //opções de conversão das páginas
            // let opts = {
            //     format: 'jpeg',
            //     out_dir: dir,
            //     out_prefix: 'page',
            //     page: null
            // };


            pdf2img.setOptions({
                type: 'jpg',                                // png or jpg, default jpg
                density: 600,                               // default 600
                outputdir: dir, // output folder, default null (if null given, then it will create folder name same as file name)
                outputname: 'page',                         // output file name, dafault null (if null given, then it will create image name same as input name)
              });
              
              pdf2img.convert(filepath, function(err, info) {
                if (err){
                console.log(err);
                }
          

                callback(null, dir);
              });



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

                        //salndo caminho final da imagem para o retorno
                        lista[i] = 'https://s3.amazonaws.com/' + bucket + '/' + keyname;

                        //upload da imagem no s3
                        s3.putObject(params, function (err, data) {

                            if (err) {
                                callback(res, '[err] ao subir ' + dirr + ': ' + err);
                            }

                            //deletando arquivo imagem
                            //fs.unlink(dirr, function (err) {
                            //    if (err) {
                            //        callback(null, '[err] unlink ' + dirr + ' -  err:' + err);
                            //    }
                            //});
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


async function converter(filepath, opts) {
    await pdf.convert(filepath, opts);
    return true;
}


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

function callback(res, message) {
    res.header('Content-Type', 'application/json');
    res.json(message);
}