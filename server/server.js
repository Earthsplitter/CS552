const http = require('http');
const url = require('url');
const fs = require('fs');

let serveFileDir = '';

// Set static file path
function setServeFilePath(path) {
  serveFileDir = path;
}

exports.serveFilePath = setServeFilePath;

// Router start point
function start(handle, port) {
  function onRequest(req, res) {
    let urlData = url.parse(req.url, true);
    let pathName = urlData.pathname;
    let info = { 'res': res, 'query': urlData.query, 'postData': '' };

    console.log('Request for ' + pathName + ' received');

    req.setEncoding('utf8');
    req.addListener('data', postDataChunk => {
      info.postData += postDataChunk;
      console.log('Received post data chunk ' + postDataChunk + '.');
    });

    req.addListener('end', _ => route(handle, pathName, info));
  }

  http.createServer(onRequest).listen(port);
  console.log('Server started on port ' + port);
}

// Public functions
exports.serveFilePath = setServeFilePath;
exports.start = start;

function route(handle, pathName, info) {
  console.log('About to route request for ', pathName);
  // 检查前导斜杠后的路径是否为可处理的现有文件
  let filePath = createFilePath(pathName);
  console.log('Attempting to locate ' + filePath);
  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      // 处理静态文件
      serveFile(filePath, info);
    } else {
      // 必须为自定义路径
      handleCustom(handle, pathName, info);
    }
  })
}

// 先从给定路径名称中去除... ~等特殊字符，再向其开头添加serveFileDir
function createFilePath(pathName) {
  let components = pathName.substr(1).split('/');
  let filtered = new Array();
  let temp = "";
  for (let i = 0, len = components.length; i < len; i++) {
    temp = components[i];
    if (temp == '..' || temp == '') {
        continue;
    }

    temp = temp.replace(/~/g, '');   // 没有用户目录
    filtered.push(temp);
  }
  return serveFileDir + '/' + filtered.join('/');
}

// 打开指定文件，读取内容，将内容返回给客户端
function serveFile(filePath, info) {
  let res = info.res;
  let query = info.query;
  console.log('Serving file ' + filePath);

  fs.open(filePath, 'r', (err, fd) => {
    if (err) {
      console.log(err.message);
      noHandlerError(filePath, res);
      return;
    }

    let readBuffer = new Buffer(20480)
    fs.read(fd, readBuffer, 0, 20480, 0, (err, readBytes) => {
      if (err) {
        console.log(err.message);
        fs.close(fd);
        noHandlerError(filePath, res);
        return;
      }

      console.log('Just read ' + readBytes + ' bytes');
      if (readBytes > 0) {
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.write(addQuery(readBuffer.toString('utf8', 0, readBytes), query));
      }
      res.end();
    })
  })
}

// 确定提取到的文件类型
function contentType(filePath) {
  let index = filePath.lastIndexOf('.');
  if (index > 0) {
    switch (filePath.substr(index + 1)) {
      case 'html':
        return 'text/html';
      case 'js':
        return 'application/javascript';
      case 'css':
        return 'text/css';
      case 'txt':
        return 'text/plain';
      default:
        return 'text/html';
    }
  }
  return 'text/html';
}

// 确定自定义路由的处理
function handleCustom(handle, pathName, info) {
  if (typeof handle[pathName] == 'function') {
    handle[pathName](info);
  } else {
    noHandlerError(pathName, info.res);
  }
}

// 404
function noHandlerError(pathName, res) {
  console.log('No request handler found for ' + pathName);
  res.writeHead(404, {'Content-Type': 'text/plain'});
  res.write('404 Page Not Found');
  res.end();
}

// 将html文件中的第一个空脚本替换成特定对象，该对象包含url中的query参数
function addQuery(str, query) {
  if (query) {
    return str.replace('<script></script>', `<script>var queryParams = ${JSON.stringify(query)}</script>`);
  } 
  return str;
}