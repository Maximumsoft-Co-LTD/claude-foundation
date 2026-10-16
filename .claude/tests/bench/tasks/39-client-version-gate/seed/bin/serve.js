#!/usr/bin/env node
"use strict";

const http = require("node:http");
const { createApp } = require("../src/app");

const app = createApp({ minClientVersion: process.env.MIN_CLIENT_VERSION });
http.createServer((req, res) => {
  const result = app.handle({ method: req.method, path: req.url, headers: req.headers });
  res.writeHead(result.status, { "content-type": "application/json", ...result.headers });
  res.end(JSON.stringify(result.body));
}).listen(Number(process.env.PORT || 3000));
