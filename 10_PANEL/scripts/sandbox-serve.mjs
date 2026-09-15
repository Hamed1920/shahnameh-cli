// Serves the sandbox root over HTTP so the stub CLI's result_url is downloadable.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const root = process.argv[2]
const port = Number(process.argv[3] || 3199)
http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]))
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': p.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream' })
  fs.createReadStream(p).pipe(res)
}).listen(port, () => console.log('serving', root, 'on', port))
