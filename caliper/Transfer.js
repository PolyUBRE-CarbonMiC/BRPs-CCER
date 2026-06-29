'use strict';

const setup = require('./Open.js');

let bc;
let contx;
let index = 0;

module.exports.init = async (blockchain, context) => {
  bc = blockchain;
  contx = context;
  index = 0;
  console.log(`Transfer callback: initialized accounts in this worker = ${setup.accounts.length}`);
};

module.exports.run = async () => {
  const total = setup.accounts.length;
  if (total < 2) {
    throw new Error('Transfer baseline requires at least two initialized accounts. Run the Open round first.');
  }

  const src = setup.accounts[index % total];
  const dst = setup.accounts[(total - index - 1 + total) % total];
  const amount = index < total / 2 ? '1' : '20';
  index += 1;

  const txArgs = {
    chaincodeFunction: 'transfer',
    chaincodeArguments: [src, dst, amount],
  };

  return bc.invokeSmartContract(contx, setup.contractID, setup.contractVer, txArgs, 300000);
};

module.exports.end = async () => {};
