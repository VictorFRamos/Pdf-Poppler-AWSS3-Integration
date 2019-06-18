//node server
var express = require("express");
const bodyParser = require('body-parser');

//packages
const fs = require('fs');
const AWS = require('aws-sdk');
var mktemp = require("mktemp");
var path = require('path');
var pdf = require('pdf-poppler');
var wf = require('async-waterfall');


//port 
var port = 3000;

//statements  ////////////////////////////////////////////////////
var app = express();
app.use(bodyParser.json({ limit: '100mb', extended: true }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }))
app.use(express.static("./"));
//////////////////////////////////////////////////////////////////

app.listen(port, function () {
    console.log(new Date().toLocaleString() + ": Service de PDF Conversion  is started on " + port + "..");
});

let returnlist = [];

app.get("/", function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(new Date().toLocaleString() + ": Service de PDF Conversion  is started on " + port + "..");
});

app.post("/converter", function (req, res) {

    //configs
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

            //create random file for pdf 
            var temp_file = mktemp.createFileSync("tmp/XXXXXXXXXX.pdf");

            //write
           fs.writeFileSync(temp_file, response.Body);

            next(null, temp_file);
        },
        async function (filepath, next) {

            //making directory for images
            var dir = GetDiretorioImagens(filepath);

            //verify
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
            }

            //options for conversion
            let opts = {
                format: 'jpeg',
                out_dir: dir,
                out_prefix: 'page',
                page: null,
                scale:2048
            };

            //start..
           var result = await convert(filepath, opts);

           if(result){
            next(null, dir, filepath);
           }

        },
        function (dir, filepath, next) {

            //delete pdf
            fs.unlink(filepath, function (err) {
                if (err) {
                    callback(res, '[err] delete pdf: ' + err);
                }
            });

            //reading images and upload to aws s3
            fs.readdir(dir, function (err, files) {

                if (err) {
                    callback(res, '[err] Unable to scan directory: ' + err);
                }

                lista = [files.length];

                //loop images
                files.forEach((file, i) => {

                    try {

                        var keyname = filekey.replace(path.basename(filekey, path.extname(filekey)) + '.pdf', '') + file.replace('-', '_');

                        var dirr = dir + '/' + file;

                        //config to s3
                        let params = {
                            ACL: 'public-read',
                            Key: keyname,
                            Body: fs.readFileSync(dirr),
                            ContentType: 'binary',
                            Bucket: bucket
                        };

                        //make uri for image to return after process
                        returnlist[i] = 'https://s3.amazonaws.com/' + bucket + '/' + keyname;

                        //upload to s3
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
                next(null, returnlist);
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
