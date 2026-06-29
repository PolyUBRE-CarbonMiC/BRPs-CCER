'use strict';

const fs = require('fs');
const path = require('path');
const { FileSystemWallet, Gateway } = require('fabric-network');

const CHANNEL_NAME = process.env.CHANNEL_NAME || 'mychannel';
const CC_NAME = process.env.CC_NAME || 'money_demo';
const IDENTITY = process.env.FABRIC_IDENTITY || 'appUser';
const ACCOUNTING_DATE = process.env.ACCOUNTING_DATE || '2025-11-15';
const REVENUE_DATE = process.env.REVENUE_DATE || '2025-11-19';
const PROJECT_ID = process.env.PROJECT_ID || 'GD001001';
const SDK_STEP = process.env.SDK_STEP || 'all';
const DISCOVERY_ENABLED = String(process.env.FABRIC_DISCOVERY || 'false').toLowerCase() === 'true';
const AS_LOCALHOST = String(process.env.FABRIC_AS_LOCALHOST || 'true').toLowerCase() !== 'false';
const RESULTS_DIR = path.join(__dirname, 'correctness_results');

if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR);
}

function writeResult(filename, text) {
  fs.writeFileSync(path.join(RESULTS_DIR, filename), `${text.trim()}\n`, 'utf8');
}

function readJSON(filename) {
  const filePath = path.join(__dirname, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filename} not found at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function stringifyResult(buffer) {
  const text = buffer.toString('utf8');
  if (!text) {
    return '';
  }
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch (error) {
    return text;
  }
}

async function submit(contract, label, fn, logName, ...args) {
  printSection(`SUBMIT ${label}`);
  console.log(`Function: ${fn}`);
  console.log(`Args: ${args.map((arg) => String(arg).slice(0, 120)).join(' | ')}`);
  const startedAt = new Date().toISOString();
  const result = await contract.submitTransaction(fn, ...args);
  const endedAt = new Date().toISOString();
  const output = stringifyResult(result);
  console.log(`Started: ${startedAt}`);
  console.log(`Ended:   ${endedAt}`);
  console.log('Result:');
  console.log(output || '<empty success response>');
  if (logName) {
    const payload = output ? ` payload:${JSON.stringify(output)}` : '';
    writeResult(logName, `${endedAt} [fabric-sdk] Chaincode invoke successful. result: status:200${payload}`);
  }
  return output;
}

async function evaluate(contract, label, fn, logName, ...args) {
  printSection(`EVALUATE ${label}`);
  console.log(`Function: ${fn}`);
  console.log(`Args: ${args.join(' | ')}`);
  const result = await contract.evaluateTransaction(fn, ...args);
  const output = stringifyResult(result);
  console.log('Result:');
  console.log(output || '<empty response>');
  if (logName) {
    writeResult(logName, output || '<empty response>');
  }
  return output;
}

async function expectFailure(operation, expectedText, logName) {
  try {
    await operation();
    console.log(`EXPECTED FAILURE NOT OBSERVED: ${expectedText}`);
    if (logName) {
      writeResult(logName, `EXPECTED FAILURE NOT OBSERVED: ${expectedText}`);
    }
    return false;
  } catch (error) {
    const message = error.message || String(error);
    console.log('Expected failure captured:');
    console.log(message);
    const matched = message.includes(expectedText);
    console.log(`Matched expected text "${expectedText}": ${matched ? 'yes' : 'no'}`);
    if (logName) {
      writeResult(logName, `Error: ${message}`);
    }
    return matched;
  }
}

function shouldRun(step) {
  return SDK_STEP === 'all' || SDK_STEP === step;
}

async function main() {
  const ccpPath = path.resolve(__dirname, 'connection-org1.json');
  const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

  const walletPath = path.join(__dirname, 'wallet');
  const wallet = new FileSystemWallet(walletPath);
  const userExists = await wallet.exists(IDENTITY);
  if (!userExists) {
    throw new Error(`Identity "${IDENTITY}" does not exist in wallet ${walletPath}`);
  }

  const energyData = readJSON('energy_consumption.json');
  const invalidEnergyData = readJSON('energy_invalid_type.json');
  const tradingData = readJSON('trading_small.json');

  const gateway = new Gateway();
  try {
    await gateway.connect(ccp, {
      wallet,
      identity: IDENTITY,
      discovery: { enabled: DISCOVERY_ENABLED, asLocalhost: AS_LOCALHOST },
    });

    const network = await gateway.getNetwork(CHANNEL_NAME);
    const contract = network.getContract(CC_NAME);

    printSection('FABRIC SDK CLIENT CONFIGURATION');
    console.log(`Channel:   ${CHANNEL_NAME}`);
    console.log(`Chaincode: ${CC_NAME}`);
    console.log(`Identity:  ${IDENTITY}`);
    console.log(`SDK step:  ${SDK_STEP}`);
    console.log(`Discovery: ${DISCOVERY_ENABLED ? 'enabled' : 'disabled'}`);
    writeResult('sdk_client_config.log', `Channel: ${CHANNEL_NAME}\nChaincode: ${CC_NAME}\nIdentity: ${IDENTITY}\nSDK step: ${SDK_STEP}\nDiscovery: ${DISCOVERY_ENABLED ? 'enabled' : 'disabled'}`);

    if (shouldRun('register')) {
      await submit(
        contract,
        'Project registration',
        'register',
        'register_valid.log',
        PROJECT_ID,
        'Energy Retrofit Project for 20 Residential Buildings',
        'LYJ',
        'Carbon Emissions Audit Institution',
        ACCOUNTING_DATE,
        'Pending',
      );

      await evaluate(contract, 'Project query', 'QueryProject', 'query_project.log', PROJECT_ID);

      await expectFailure(
        () => submit(
          contract,
          'Duplicate project registration',
          'register',
          null,
          PROJECT_ID,
          'Energy Retrofit Project for 20 Residential Buildings',
          'LYJ',
          'Carbon Emissions Audit Institution',
          ACCOUNTING_DATE,
          'Pending',
        ),
        'Project already exists',
        'register_duplicate.log',
      );
    }

    if (shouldRun('emission')) {
      await submit(
        contract,
        'EmissionReduction',
        'EmissionReduction',
        'emission_reduction_valid.log',
        JSON.stringify(energyData),
        ACCOUNTING_DATE,
      );

      await evaluate(contract, 'Unit-level CER query', 'QueryEmissionResult', 'query_emission_unit_1.log', '1', ACCOUNTING_DATE);

      await expectFailure(
        () => submit(
          contract,
          'Invalid energy type rejection',
          'EmissionReduction',
          null,
          JSON.stringify(invalidEnergyData),
          ACCOUNTING_DATE,
        ),
        'invalid energy_type',
        'emission_reduction_invalid_type.log',
      );
    }

    if (shouldRun('revenue')) {
      await submit(contract, 'Revenue allocation', 'RevenueAllocation', 'revenue_allocation_valid.log', REVENUE_DATE);
      await evaluate(contract, 'FM revenue query', 'QueryRevenueRecord', 'query_revenue_fm.log', 'FM', REVENUE_DATE);
      await evaluate(contract, 'Last revenue allocation query', 'QueryLastRevenueAllocation', 'query_last_revenue_allocation.log');

      await expectFailure(
        () => submit(contract, 'Manual revenue input rejection', 'RevenueAllocation', null, '100', REVENUE_DATE),
        'RevenueAllocation expects 0 or 1 arg',
        'revenue_allocation_manual_input_rejected.log',
      );
    }

    if (shouldRun('trading')) {
      await submit(contract, 'Trading sanity check', 'Trading', 'trading_small.log', JSON.stringify(tradingData));
      await evaluate(contract, 'Transaction query', 'QueryTransaction', 'query_transaction_1.log', 'tx_1');
    }

    printSection('SDK VALIDATION COMPLETE');
  } finally {
    gateway.disconnect();
  }
}

main().catch((error) => {
  console.error('\n*** SDK validation failed ***');
  console.error(error);
  process.exit(1);
});
