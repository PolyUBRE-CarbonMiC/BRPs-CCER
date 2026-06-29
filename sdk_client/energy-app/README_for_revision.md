# Role of `energy-app` in the Manuscript Revision

This folder is not a browser-based front end. It is a Node.js client application
that uses the Hyperledger Fabric SDK (`fabric-network@1.4.11`) to connect to a
Fabric network and invoke the deployed chaincode.

## What It Does

Main file:

```text
index.js
```

Execution logic:

1. Read `energy_consumption.json`, `energy_invalid_type.json`, and
   `trading_small.json`.
2. Load the Fabric connection profile from `connection-org1.json`.
3. Load an identity from the local `wallet`.
4. Connect to channel `mychannel`.
5. Get chaincode contract `money_demo`.
6. Submit or evaluate the same chaincode functions used in the CLI correctness
   tests: `register`, `QueryProject`, `EmissionReduction`,
   `QueryEmissionResult`, `RevenueAllocation`, `QueryRevenueRecord`,
   `QueryLastRevenueAllocation`, `Trading`, and `QueryTransaction`.
7. Capture expected failures for duplicate registration, invalid energy type,
   and manual revenue input.
8. Print the raw and parsed chaincode responses to the terminal.

Therefore, this folder provides evidence of SDK-based chaincode invocation, not
a web interface.

## How It Differs from the Evidence Dashboard

| Item | Purpose | Directly connects to Fabric? | Suitable as paper screenshot? |
| --- | --- | --- | --- |
| `energy-app/index.js` | Invoke chaincode through Fabric SDK | Yes, when run on the server/network environment | Only as terminal evidence |
| `experiments/reproducible_data/evidence_dashboard/index.html` | Present correctness evidence from logs | No, generated from recorded outputs | Yes |
| `experiments/dapp_prototype/standalone_prototype.html` | Show a DApp-style prototype interface | No, generated from recorded outputs | Yes, as prototype UI |

## Recommended Use in the Paper

Use `energy-app` in the methodology or validation text as an SDK-based client
used to invoke the smart contract from the application layer. Use the generated
logs or returned JSON from the SDK invocation as evidence. Do not describe it as
a browser front end.

Recommended wording:

```text
A Node.js client based on the Hyperledger Fabric SDK was used to submit
application-layer transactions to the deployed `money_demo` chaincode. The
client loaded the Fabric connection profile and user identity from a local
wallet, connected to `mychannel`, invoked `register`, `EmissionReduction`, and
`RevenueAllocation`, and printed the returned project, CER, and revenue-allocation
results. Fabric CLI commands were used only to independently capture channel and
block metadata after the SDK-submitted transactions.
```

## Can It Be Turned into a Real Front End?

Yes. The proper architecture is:

```text
Browser UI -> Node.js/Express API -> Fabric SDK -> Fabric network
```

The browser should not hold Fabric private keys or wallet material. The wallet
should remain on the server side. An Express API can wrap the existing
`index.js` logic and expose endpoints such as:

```text
POST /api/emission-reduction
GET  /api/project/:id
POST /api/revenue-allocation
```

This would be more realistic than a static prototype, but it requires the Fabric
network, connection profile, wallet, chaincode, and Node dependencies to work on
the server at the time of demonstration.

## Security Note

The `wallet` directory contains identity material and private keys. Do not
publish it in an open repository or include it as manuscript supplementary data.
