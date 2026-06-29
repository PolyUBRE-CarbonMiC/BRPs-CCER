# Aggregation / Trading 性能实验服务器命令

这个文件用于重新运行论文中 Aggregation 与 Trading 相关的性能实验。实验设计直接对应 reviewer 对可复现性、Caliper 测试细节、Aggregation 机制验证、Transfer baseline 和敏感性分析的意见。

## 0. 实验目的

本实验包含三类对照：

```text
1. Transfer baseline
   每次调用只完成一次账户间 transfer，不读取大 request 文件，不执行 Trading、撮合和聚合。
   作用：作为 PBFT Fabric 网络、背书、排序、提交和简单账本写入的基础开销对照组。

2. Trading without aggregation
   使用同一批 request 数据，但关闭小额 sell request 聚合。
   作用：作为 Trading 业务逻辑下的非聚合对照。

3. Trading with aggregation
   使用同一批 request 数据，启用小额 sell request 聚合。
   作用：验证 Aggregation 是否提升吞吐量、降低延迟或提高成功率。
```

主实验使用 `Saggregation = 4000`。这个阈值的含义是：小额 sell request 的 amount 为 300-700，普通 sell request 的 amount 为 4000-6000，因此 4000 相当于把若干小额卖单聚合到接近普通卖单的最小规模。

补充敏感性实验使用 `Saggregation = 2000 / 4000 / 6000`。


运行时注意三点：
network.yaml 要保持 start: scripts/utils.sh down;scripts/gen.sh;scripts/utils.sh up
运行 Caliper 时要带 NODE_PATH=/root/fabric-sample/pbft-network/node_modules:$(npm root -g)
不要再用带 docker monitor 的 config


## 1. 本地需要上传的文件

```text
experiments/aggregation_trading/caliper/Trading.js
  -> /root/fabric-sample/chaincode/demo/callback/Trading.js

experiments/aggregation_trading/caliper/Open.js
  -> /root/fabric-sample/chaincode/demo/callback/Open.js

experiments/aggregation_trading/caliper/Transfer.js
  -> /root/fabric-sample/chaincode/demo/callback/Transfer.js

experiments/aggregation_trading/caliper/config-trading.yaml
  -> /root/fabric-sample/pbft-network/benchmarks/config-trading.yaml

experiments/aggregation_trading/caliper/config-transfer-baseline.yaml
  -> /root/fabric-sample/pbft-network/benchmarks/config-transfer-baseline.yaml

experiments/reproducible_data/generated/
  -> /root/fabric-sample/pbft-network/trading_requests/

experiments/aggregation_trading/chaincode_variants/chaincode_with_aggregation.go
  -> /root/fabric-sample/chaincode/demo/demo.go

experiments/aggregation_trading/chaincode_variants/chaincode_no_aggregation.go
  -> /root/fabric-sample/chaincode/demo/demo.go
```

敏感性分析需要额外上传以下文件之一，并覆盖为 `/root/fabric-sample/chaincode/demo/demo.go`：

```text
experiments/aggregation_trading/chaincode_variants/chaincode_with_aggregation_threshold_2000.go
experiments/aggregation_trading/chaincode_variants/chaincode_with_aggregation_threshold_4000.go
experiments/aggregation_trading/chaincode_variants/chaincode_with_aggregation_threshold_6000.go
```

注意：`/root/fabric-sample/chaincode/demo/` 目录里每次只保留一个 `demo.go`。不要同时放多个 `.go` 文件。

## 2. Caliper 环境检查和安装

先检查：

```bash
cd /root/fabric-sample/pbft-network

node -v
npm -v
caliper --version || true
ls -lh node_modules/fabric-client || true
```

如果已经满足下面三个条件，可以跳过安装：

```text
caliper --version 输出 v0.3.2
/root/fabric-sample/pbft-network/node_modules/fabric-client 存在
/root/fabric-sample/pbft-network/node_modules/fabric-network 存在
```

如果没有安装成功，按这套命令安装。不要安装最新版 Caliper，当前 Fabric 1.4.4 环境使用 `@hyperledger/caliper-cli@0.3.2`。

```bash
cd /root/fabric-sample/pbft-network

npm uninstall -g @hyperledger/caliper-cli || true
npm config set registry https://registry.npmmirror.com
npm config set unsafe-perm true
npm install -g --unsafe-perm --only=prod @hyperledger/caliper-cli@0.3.2

export CALIPER_DIR=$(npm root -g)/@hyperledger/caliper-cli
cd ${CALIPER_DIR}
npm install --unsafe-perm --no-save @dabh/diagnostics@2.0.3 colorspace@1.1.2

cd ${CALIPER_DIR}/node_modules/winston
npm install --unsafe-perm --no-save @dabh/diagnostics@2.0.3 colorspace@1.1.2

find ${CALIPER_DIR}/node_modules -path "*/@so-ric/colorspace/dist/index.cjs.js" -print -exec sed -i 's/\([0-9]\)_\([0-9]\)/\1\2/g' {} \;

caliper --version

cd /root/fabric-sample/pbft-network
export PYTHON=/usr/bin/python2.7
caliper bind --caliper-bind-sut fabric:1.4.4
```

说明：

```text
1. Node.js 8.15.1 不支持 0.003_130_8 这种数字分隔符，所以需要 sed 修复 @so-ric/colorspace。
2. Caliper worker 运行 callback 时需要通过 NODE_PATH 找到 Fabric SDK 包。
3. node-gyp 编译 warning 通常不是失败，只要 caliper bind 最后完成即可。
```

## 3. 准备目录

```bash
export PBFT_NETWORK=/root/fabric-sample/pbft-network
export CHAINCODE_DIR=/root/fabric-sample/chaincode/demo
export CALLBACK_DIR=/root/fabric-sample/chaincode/demo/callback
export REQUEST_ROOT=/root/fabric-sample/pbft-network/trading_requests
export RESULT_ROOT=/root/fabric-sample/pbft-network/aggregation_trading_results

mkdir -p ${CALLBACK_DIR}
mkdir -p ${REQUEST_ROOT}
mkdir -p ${RESULT_ROOT}/with_aggregation
mkdir -p ${RESULT_ROOT}/no_aggregation
mkdir -p ${RESULT_ROOT}/threshold_2000
mkdir -p ${RESULT_ROOT}/threshold_4000
mkdir -p ${RESULT_ROOT}/threshold_6000
mkdir -p ${RESULT_ROOT}/logs
```

上传文件后检查：

```bash
ls -lh ${CALLBACK_DIR}/Trading.js
ls -lh ${CALLBACK_DIR}/Open.js
ls -lh ${CALLBACK_DIR}/Transfer.js
ls -lh ${PBFT_NETWORK}/benchmarks/config-trading.yaml
ls -lh ${PBFT_NETWORK}/benchmarks/config-transfer-baseline.yaml
find ${REQUEST_ROOT} -maxdepth 2 -name Request.json | sort
```

如果上传后多了一层 `generated`，整理为：

```bash
if [ -d ${REQUEST_ROOT}/generated ]; then
  mv ${REQUEST_ROOT}/generated/* ${REQUEST_ROOT}/
  rmdir ${REQUEST_ROOT}/generated
fi
```

## 4. 校验 request 数据

```bash
cd ${PBFT_NETWORK}

node -e 'const fs=require("fs"); const sizes=[100,300,500,700,1000,1300,1500,1800,2000,2300,2500]; for (const n of sizes) { const req=`trading_requests/${n}_requests/Request.json`; const meta=`trading_requests/${n}_requests/metadata.json`; const a=JSON.parse(fs.readFileSync(req)); const m=JSON.parse(fs.readFileSync(meta)); const buy=a.filter(x=>x.Type==="Buy").length; const sell=a.filter(x=>x.Type==="Sell").length; const small=a.filter(x=>x.Smallsell===1).length; console.log(`${n}: total=${a.length}, buy=${buy}, sell=${sell}, smallSell=${small}, seed=${m.summary.seed_used}, priceMean=${m.summary.all_price_mean.toFixed(4)}`); }'
```

论文中应报告：

```text
request size = 100, 300, 500, 700, 1000, 1300, 1500, 1800, 2000, 2300, 2500
buy : normal sell : small sell = 1 : 1 : 3
price_mean = 68
price_sd = 0.3
price_min = 67
price_max = 69
small sell amount = 300-700
normal sell amount = 4000-6000
buy amount = 4000-9000
```

## 5. 检查链码版本

每次上传一个链码变体后都检查：

```bash
cd ${CHAINCODE_DIR}
ls -lh *.go
grep -n "case \"open\"" demo.go
grep -n "case \"transfer\"" demo.go
grep -n "Trading(APIstub" demo.go
grep -n "Saggregation" demo.go || true
grep -n "Aggregation disabled" demo.go || true
```

如果目录下有其他 `.go` 文件，先移走：

```bash
cd ${CHAINCODE_DIR}
mkdir -p backup_go_files
find . -maxdepth 1 -type f -name "*.go" ! -name "demo.go" -exec mv {} backup_go_files/ \;
ls -lh *.go
```

## 6. 修改 Caliper 网络启动命令

PBFT 网络必须让 Caliper 每次从干净状态启动。否则 Caliper 可能复用旧容器，而 `scripts/gen.sh` 又生成新的 crypto 文件，导致 `Admin@orga.com/msp does not exist` 或 `access denied: channel [] creator org [OrgAMSP]`。

只需要修改一次：

```bash
cd ${PBFT_NETWORK}

cp benchmarks/network.yaml benchmarks/network.yaml.bak

sed -i 's#start: scripts/gen.sh;scripts/utils.sh up#start: scripts/utils.sh down;scripts/gen.sh;scripts/utils.sh up#' benchmarks/network.yaml
sed -i 's#end: scripts/utils.sh$#end: scripts/utils.sh down#' benchmarks/network.yaml

grep -n "start:" benchmarks/network.yaml
grep -n "end:" benchmarks/network.yaml
```

应看到：

```text
start: scripts/utils.sh down;scripts/gen.sh;scripts/utils.sh up
end: scripts/utils.sh down
```

## 7. 定义通用运行函数

```bash
cd ${PBFT_NETWORK}

export NODE_PATH=/root/fabric-sample/pbft-network/node_modules:$(npm root -g)
export REPEAT_LIST="1 2 3"
export SIZE_LIST="100 300 500 700 1000 1300 1500 1800 2000 2300 2500"

run_transfer_size_sweep () {
  CASE_NAME="$1"
  OUT_DIR=${RESULT_ROOT}/${CASE_NAME}/transfer
  mkdir -p ${OUT_DIR}
  rm -f ${OUT_DIR}/caliper_transfer*.log ${OUT_DIR}/report_transfer*.html ${OUT_DIR}/config_transfer*.yaml

  for R in ${REPEAT_LIST}; do
    for N in ${SIZE_LIST}; do
      echo "===== ${CASE_NAME}: Transfer baseline, ${N} transfers, repeat ${R} ====="
      rm -f report.html

      BENCH_CONFIG=${OUT_DIR}/config_transfer_${N}_r${R}.yaml
      sed "s/txNumber: 2000/txNumber: ${N}/g" benchmarks/config-transfer-baseline.yaml > ${BENCH_CONFIG}

      NODE_PATH=${NODE_PATH} npx caliper launch master \
        --caliper-workspace ./ \
        --caliper-benchconfig ${BENCH_CONFIG} \
        --caliper-networkconfig benchmarks/network.yaml \
        > ${OUT_DIR}/caliper_transfer_${N}_r${R}.log 2>&1

      if [ ! -f report.html ]; then
        echo "ERROR: Caliper did not generate report.html. Check ${OUT_DIR}/caliper_transfer_${N}_r${R}.log"
        return 1
      fi

      cp report.html ${OUT_DIR}/report_transfer_${N}_r${R}.html
    done
  done
}

# Backward-compatible alias. It now runs the full SIZE_LIST transfer sweep.
run_transfer_baseline () {
  run_transfer_size_sweep "$1"
}

run_trading_size_sweep () {
  CASE_NAME="$1"
  OUT_DIR=${RESULT_ROOT}/${CASE_NAME}/trading
  mkdir -p ${OUT_DIR}

  for R in ${REPEAT_LIST}; do
    for N in ${SIZE_LIST}; do
      echo "===== ${CASE_NAME}: Trading, ${N} requests, repeat ${R} ====="

      cp ${REQUEST_ROOT}/${N}_requests/Request.json ${CALLBACK_DIR}/Request.json
      cp ${REQUEST_ROOT}/${N}_requests/metadata.json ${OUT_DIR}/metadata_${N}_r${R}.json
      node -e "const fs=require('fs'); const a=JSON.parse(fs.readFileSync('${CALLBACK_DIR}/Request.json')); console.log('callback Request.json records =', a.length)"

      rm -f report.html

      NODE_PATH=${NODE_PATH} npx caliper launch master \
        --caliper-workspace ./ \
        --caliper-benchconfig benchmarks/config-trading.yaml \
        --caliper-networkconfig benchmarks/network.yaml \
        > ${OUT_DIR}/caliper_${N}_r${R}.log 2>&1

      if [ ! -f report.html ]; then
        echo "ERROR: Caliper did not generate report.html. Check ${OUT_DIR}/caliper_${N}_r${R}.log"
        return 1
      fi

      cp report.html ${OUT_DIR}/report_${N}_r${R}.html
    done
  done
}

run_trading_selected_sizes () {
  CASE_NAME="$1"
  SELECTED_SIZE_LIST="$2"
  OUT_DIR=${RESULT_ROOT}/${CASE_NAME}/trading
  mkdir -p ${OUT_DIR}

  for R in ${REPEAT_LIST}; do
    for N in ${SELECTED_SIZE_LIST}; do
      echo "===== ${CASE_NAME}: Trading, ${N} requests, repeat ${R} ====="

      cp ${REQUEST_ROOT}/${N}_requests/Request.json ${CALLBACK_DIR}/Request.json
      cp ${REQUEST_ROOT}/${N}_requests/metadata.json ${OUT_DIR}/metadata_${N}_r${R}.json

      rm -f report.html

      NODE_PATH=${NODE_PATH} npx caliper launch master \
        --caliper-workspace ./ \
        --caliper-benchconfig benchmarks/config-trading.yaml \
        --caliper-networkconfig benchmarks/network.yaml \
        > ${OUT_DIR}/caliper_${N}_r${R}.log 2>&1

      if [ ! -f report.html ]; then
        echo "ERROR: Caliper did not generate report.html. Check ${OUT_DIR}/caliper_${N}_r${R}.log"
        return 1
      fi

      cp report.html ${OUT_DIR}/report_${N}_r${R}.html
    done
  done
}
```

## 8. Smoke test

先只跑 1 次、100 requests，确认流程成功：

```bash
export REPEAT_LIST="1"
export SIZE_LIST="100"

run_transfer_size_sweep with_aggregation
run_trading_size_sweep with_aggregation
```

检查：

```bash
ls -lh ${RESULT_ROOT}/with_aggregation/transfer/report_transfer_100_r1.html
ls -lh ${RESULT_ROOT}/with_aggregation/trading/report_100_r1.html
tail -n 80 ${RESULT_ROOT}/with_aggregation/transfer/caliper_transfer_100_r1.log
tail -n 80 ${RESULT_ROOT}/with_aggregation/trading/caliper_100_r1.log
```

如果 report 存在，并且日志里 `Succ` 大于 0、`Fail = 0`，可以开始完整实验。

## 9. 主实验 A：启用 Aggregation

上传：

```text
experiments/aggregation_trading/chaincode_variants/chaincode_with_aggregation.go
覆盖为 /root/fabric-sample/chaincode/demo/demo.go
```

检查：

```bash
cd ${CHAINCODE_DIR}
grep -n "Saggregation" demo.go
grep -n "Aggregation disabled" demo.go || true
```

运行：

```bash
cd ${PBFT_NETWORK}
export REPEAT_LIST="1 2 3"
export SIZE_LIST="100 300 500 700 1000 1300 1500 1800 2000 2300 2500"

run_transfer_size_sweep with_aggregation
run_trading_size_sweep with_aggregation
```

## 10. 主实验 B：关闭 Aggregation

上传：

```text
experiments/aggregation_trading/chaincode_variants/chaincode_no_aggregation.go
覆盖为 /root/fabric-sample/chaincode/demo/demo.go
```

检查：

```bash
cd ${CHAINCODE_DIR}
grep -n "Aggregation disabled" demo.go
grep -n "Saggregation" demo.go || true
```

运行：

```bash
cd ${PBFT_NETWORK}
export REPEAT_LIST="1 2 3"
export SIZE_LIST="100 300 500 700 1000 1300 1500 1800 2000 2300 2500"

run_transfer_size_sweep no_aggregation
run_trading_size_sweep no_aggregation
```

说明：`transfer` 不调用 aggregation 逻辑，因此 with/no aggregation 两个版本下的 Transfer 结果应接近。它用于证明性能差异主要来自 Trading 中的 aggregation 逻辑，而不是 PBFT 网络或简单账本写入本身。

## 11. 补充实验：阈值敏感性分析

建议运行 `Saggregation = 2000, 4000, 6000`。每个阈值都从 300 条 request 开始逐步增加到 2500 条 request：

```bash
export THRESHOLD_SIZE_LIST="300 500 700 1000 1300 1500 1800 2000 2300 2500"
```

每个阈值会生成 30 个 Trading report：

```text
10 个 request size × 3 次重复 = 30
```

三个阈值合计 90 个 report。敏感性分析只比较 Trading，不需要再跑 Transfer baseline。no aggregation 使用主实验中同一批 `300, 500, 700, 1000, 1300, 1500, 1800, 2000, 2300, 2500` 结果作为基准曲线，不需要重复运行。

如果你已经跑过每个阈值的 `1000 2000 2500`，可以只补缺失规模：

```bash
export THRESHOLD_SIZE_LIST="300 500 700 1300 1500 1800 2300"
```

如果希望结果目录完全干净一致，也可以直接使用完整 `THRESHOLD_SIZE_LIST` 重跑，旧的同名 report 会被覆盖。

开始前确认通用函数仍在当前 shell 中。如果提示 `run_trading_selected_sizes: command not found`，重新复制第 7 节中的函数定义。

### 11.1 阈值 2000

上传：

```text
experiments/aggregation_trading/chaincode_variants/chaincode_with_aggregation_threshold_2000.go
覆盖为 /root/fabric-sample/chaincode/demo/demo.go
```

运行：

```bash
cd ${PBFT_NETWORK}
grep -n "Saggregation" ${CHAINCODE_DIR}/demo.go
export REPEAT_LIST="1 2 3"
run_trading_selected_sizes threshold_2000 "${THRESHOLD_SIZE_LIST}"
```

检查：

```bash
find ${RESULT_ROOT}/threshold_2000/trading -name "report_*.html" | sort | wc -l
```

完整重跑时，期望输出 `30`；只补缺失规模时，跑完后最终也应为 `30`。

### 11.2 阈值 4000

上传：

```text
experiments/aggregation_trading/chaincode_variants/chaincode_with_aggregation_threshold_4000.go
覆盖为 /root/fabric-sample/chaincode/demo/demo.go
```

运行：

```bash
cd ${PBFT_NETWORK}
grep -n "Saggregation" ${CHAINCODE_DIR}/demo.go
export REPEAT_LIST="1 2 3"
run_trading_selected_sizes threshold_4000 "${THRESHOLD_SIZE_LIST}"
```

检查：

```bash
find ${RESULT_ROOT}/threshold_4000/trading -name "report_*.html" | sort | wc -l
```

完整重跑时，期望输出 `30`；只补缺失规模时，跑完后最终也应为 `30`。

### 11.3 阈值 6000

上传：

```text
experiments/aggregation_trading/chaincode_variants/chaincode_with_aggregation_threshold_6000.go
覆盖为 /root/fabric-sample/chaincode/demo/demo.go
```

运行：

```bash
cd ${PBFT_NETWORK}
grep -n "Saggregation" ${CHAINCODE_DIR}/demo.go
export REPEAT_LIST="1 2 3"
run_trading_selected_sizes threshold_6000 "${THRESHOLD_SIZE_LIST}"
```

检查：

```bash
find ${RESULT_ROOT}/threshold_6000/trading -name "report_*.html" | sort | wc -l
```

完整重跑时，期望输出 `30`；只补缺失规模时，跑完后最终也应为 `30`。

全部阈值跑完后检查总数：

```bash
find ${RESULT_ROOT}/threshold_2000 ${RESULT_ROOT}/threshold_4000 ${RESULT_ROOT}/threshold_6000 -name "report_*.html" | wc -l
```

期望输出 `90`。

## 12. 账本写入抽查

某一次 Trading 运行结束后，可以查询 `tx_1`。

```bash
cd ${PBFT_NETWORK}

./scripts/gen.sh
./scripts/utils.sh up

docker exec cli /bin/bash -lc '
cd /opt/gopath/src/github.com/hyperledger/fabric/peer
export CHANNEL_NAME=mychannel
export CC_NAME=money_demo
export ORDERER=orderer1.yzm.com:6051
export PEER_ADDRESS=peer0.orga.com:7051
export PEERROOT=/opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations
export CORE_PEER_MSPCONFIGPATH=${PEERROOT}/orga.com/users/Admin@orga.com/msp
export CORE_PEER_ADDRESS=${PEER_ADDRESS}
export CORE_PEER_LOCALMSPID=OrgAMSP

peer chaincode query -C ${CHANNEL_NAME} -n ${CC_NAME} -c "{\"Args\":[\"QueryTransaction\",\"1\"]}"
'
```

注意：Caliper 每次结束后会执行 `scripts/utils.sh down`，所以如果要抽查账本，需要在某次运行后临时修改 `benchmarks/network.yaml` 的 `end`，或单独重新启动网络并运行一次 Trading。

## 13. 结果整理

每个 report 至少记录：

```text
Name
Succ
Fail
Send Rate (TPS)
Throughput (TPS)
Min Latency (s)
Max Latency (s)
Avg Latency (s)
```

3 次重复后报告：

```text
mean
standard deviation
95% confidence interval = mean ± 1.96 * sd / sqrt(3)
```

论文表述建议谨慎：可以写 “three repeated benchmark runs were conducted to check result stability”，不要把 3 次重复过度解释为严格统计显著性。

## 14. 打包下载结果

如果只下载主实验结果，即 `with_aggregation` 和 `no_aggregation`：

```bash
cd ${PBFT_NETWORK}

tar -czf aggregation_main_results.tar.gz \
  aggregation_trading_results/with_aggregation \
  aggregation_trading_results/no_aggregation

ls -lh aggregation_main_results.tar.gz
sz aggregation_main_results.tar.gz
```

如果 `sz` 不存在，先安装：

```bash
apt-get update
apt-get install -y lrzsz
sz aggregation_main_results.tar.gz
```

如果敏感性分析也已经跑完，下载全部结果：

```bash
cd ${PBFT_NETWORK}

tar -czf aggregation_trading_results.tar.gz aggregation_trading_results
ls -lh aggregation_trading_results.tar.gz
sz aggregation_trading_results.tar.gz
```

如果只下载敏感性分析结果：

```bash
cd ${PBFT_NETWORK}

tar -czf aggregation_threshold_results.tar.gz \
  aggregation_trading_results/threshold_2000 \
  aggregation_trading_results/threshold_4000 \
  aggregation_trading_results/threshold_6000

ls -lh aggregation_threshold_results.tar.gz
sz aggregation_threshold_results.tar.gz
```

建议保留：

```text
aggregation_trading_results/with_aggregation/transfer/report_transfer_*_r*.html
aggregation_trading_results/with_aggregation/trading/report_*_r*.html
aggregation_trading_results/no_aggregation/transfer/report_transfer_*_r*.html
aggregation_trading_results/no_aggregation/trading/report_*_r*.html
aggregation_trading_results/threshold_*/trading/report_*_r*.html
所有 caliper_*.log
所有 metadata_*.json
```

## 15. 本地重新生成链码变体

如果之后修改了 `experiments/chaincode/chaincode.go`：

```bash
node experiments/aggregation_trading/tools/make_no_aggregation_chaincode.mjs
node experiments/aggregation_trading/tools/make_threshold_chaincode_variants.mjs
```
