'use strict';

const contractID = process.env.CC_NAME || 'money_demo';
const contractVer = process.env.CC_VERSION || '1.0';
const initMoney = process.env.TRANSFER_INIT_MONEY || '1000000';

let bc;
let contx;
let index = 0;
const accounts = [];

function makeAccountId() {
  const random = Math.random().toString(36).slice(2, 10);
  const pid = process.pid || 0;
  return `acct_${pid}_${index}_${random}`;
}

module.exports.init = async (blockchain, context) => {
  bc = blockchain;
  contx = context;
  index = 0;
  accounts.length = 0;
  console.log(`Open callback: transfer baseline account initialization value = ${initMoney}`);
};

module.exports.run = async () => {
  const account = makeAccountId();
  accounts.push(account);
  index += 1;

  const txArgs = {
    chaincodeFunction: 'open',
    chaincodeArguments: [account, initMoney],
  };

  return bc.invokeSmartContract(contx, contractID, contractVer, txArgs, 300000);
};

module.exports.end = async () => {};

module.exports.contractID = contractID;
module.exports.contractVer = contractVer;
module.exports.accounts = accounts;
