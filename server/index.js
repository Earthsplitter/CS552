const server = require('./server');
const requestHandlers = require('./serverXHRSignalingChannel');
const port = process.argv[2] || 5001;

// 返回404
function notFound(info) {
  let res = info.res;
  console.log('Request handler NotFound was called.');
  res.writeHead(404, {'Content-Type': 'text/plain'});
  res.write('404 Page Not Found');
  res.end();
}

let handle = {};

handle['/'] = notFound;

handle['/connect'] = requestHandlers.connect;
handle['/send'] = requestHandlers.send;
handle['/get'] = requestHandlers.get;

server.serveFilePath('static');
server.start(handle, port);