#!/usr/bin/env node
"use strict";

const http = require("node:http");
const path = require("node:path");
const { createStaticHandler } = require("../src/static");

const handle = createStaticHandler(path.join(__dirname, "..", "public"));
http.createServer(async (req, res) => {
  const result = await handle(req.url);
  res.writeHead(result.status, { "content-type": result.contentType });
  res.end(result.body);
}).listen(Number(process.env.PORT || 8000));
