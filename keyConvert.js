const fs = require('fs');
const key = fs.readFileSync('./serviceAccountKey.json')
const base64 = Buffer.from(key, 'utf8').toString('base64')
console.log(base64);