import http from 'node:http';
import fs from 'node:fs';
const file = new URL('./preview-mobile-ui.html', import.meta.url);
http.createServer((req,res)=>{if(req.url!=='/'&&req.url!=='/preview-mobile-ui.html'){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});fs.createReadStream(file).pipe(res);}).listen(5184,'127.0.0.1',()=>console.log('Design preview http://127.0.0.1:5184/'));
