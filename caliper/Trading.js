'use strict';

const fs = require('fs');
const path = require('path');

const contractID = process.env.CC_NAME || 'money_demo';
const contractVer = process.env.CC_VERSION || '1.0';

let bc;
let contx;
let requestsJson;
let requestCount = 0;

function resolveRequestFile(args) {
  if (args && args.requestFile) {
    return args.requestFile;
  }
  if (process.env.REQUEST_FILE) {
    return process.env.REQUEST_FILE;
  }
  return path.resolve(__dirname, 'Request.json');
}

module.exports.init = async (blockchain, context, args) => {
  bc = blockchain;
  contx = context;

  const requestFile = resolveRequestFile(args);
  requestsJson = fs.readFileSync(requestFile, 'utf8');
  const requests = JSON.parse(requestsJson);
  requestCount = Array.isArray(requests) ? requests.length : 0;
  console.log(`Trading callback: loaded ${requestCount} trading requests from ${requestFile}`);
};

module.exports.run = async () => {
  const txArgs = {
    chaincodeFunction: 'Trading',
    chaincodeArguments: [requestsJson],
  };

  return bc.invokeSmartContract(contx, contractID, contractVer, txArgs, 300000);
};

module.exports.end = async () => {};
