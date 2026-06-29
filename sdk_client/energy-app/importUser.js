'use strict';

const fs = require('fs');
const path = require('path');
const { FileSystemWallet, X509WalletMixin } = require('fabric-network');

async function main() {
  try {
    const walletPath = path.join(__dirname, 'wallet');
    const wallet = new FileSystemWallet(walletPath);
    console.log(`Wallet path: ${walletPath}`);

    const identityLabel = process.env.FABRIC_IDENTITY || 'appUser';
    const mspId = process.env.FABRIC_MSPID || 'OrgAMSP';
    const userDir = path.resolve(
      process.env.FABRIC_MSP_PATH ||
        path.join(
          __dirname,
          '..',
          'fabric-sample',
          'pbft-network',
          'crypto-config',
          'peerOrganizations',
          'orga.com',
          'users',
          'Admin@orga.com',
          'msp',
        ),
    );

    const exists = await wallet.exists(identityLabel);
    if (exists) {
      console.log(`Identity "${identityLabel}" already exists in wallet`);
      return;
    }

    console.log('Using MSP directory:', userDir);

    const certPath = path.join(userDir, 'signcerts');
    const keyPath = path.join(userDir, 'keystore');

    const certFiles = fs.readdirSync(certPath).filter((name) => !name.startsWith('.'));
    const keyFiles = fs.readdirSync(keyPath).filter((name) => !name.startsWith('.'));
    if (!certFiles.length || !keyFiles.length) {
      throw new Error('No cert or key files found in MSP directories');
    }

    const cert = fs.readFileSync(path.join(certPath, certFiles[0]), 'utf8');
    const key = fs.readFileSync(path.join(keyPath, keyFiles[0]), 'utf8');
    const identity = X509WalletMixin.createIdentity(mspId, cert, key);

    await wallet.import(identityLabel, identity);
    console.log(`Successfully imported identity "${identityLabel}" into wallet`);
  } catch (error) {
    console.error(`Failed to import identity: ${error}`);
    process.exit(1);
  }
}

main();
