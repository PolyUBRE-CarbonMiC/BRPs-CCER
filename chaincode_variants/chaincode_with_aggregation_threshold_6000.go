package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hyperledger/fabric/core/chaincode/shim"
	sc "github.com/hyperledger/fabric/protos/peer"
)

type SmartContract struct{}

// -------------------- Init --------------------

func (s *SmartContract) Init(APIstub shim.ChaincodeStubInterface) sc.Response {
	return shim.Success(nil)
}

// -------------------- Invoke  --------------------

func (s *SmartContract) Invoke(APIstub shim.ChaincodeStubInterface) sc.Response {
	function, args := APIstub.GetFunctionAndParameters()
	switch function {
	case "register":
		return s.register(APIstub, args)
	case "EmissionReduction":
		return s.EmissionReduction(APIstub, args)
	case "RevenueAllocation":
		return s.RevenueAllocation(APIstub, args)
	case "QueryProject":
		return s.QueryProject(APIstub, args)
	case "QueryEmissionResult":
		return s.QueryEmissionResult(APIstub, args)
	case "QueryRevenueRecord":
		return s.QueryRevenueRecord(APIstub, args)
	case "QueryLastRevenueAllocation":
		return s.QueryLastRevenueAllocation(APIstub, args)
	case "Trading":
		return s.Trading(APIstub, args)
	case "QueryTransaction":
		return s.QueryTransaction(APIstub, args)
	case "open":
		return s.open(APIstub, args)
	case "transfer":
		return s.transfer(APIstub, args)
	default:
		return shim.Error("Invalid Smart Contract function name.")
	}
}

// ============================================================================
// register
// ============================================================================

func (s *SmartContract) register(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	if len(args) != 6 {
		return shim.Error("Incorrect number of arguments. Expecting 6: ProjectID, ProjectName, FM, Verifier, RegistrationTimestamp, CreditStatus")
	}

	projectID := args[0]
	projectName := args[1]
	personInCharge := args[2] // FM
	verifier := args[3]       // V
	registrationTimestamp := args[4]
	creditStatus := args[5]

	projectBytes, err := APIstub.GetState(projectID)
	if err != nil {
		return shim.Error("Failed to get state for project")
	}
	if projectBytes != nil {
		return shim.Error("Project already exists")
	}

	creditBalance := 0

	// log
	fmt.Println("========== Project Registration ==========")
	fmt.Printf("Project ID: %s\n", projectID)
	fmt.Printf("Project Name: %s\n", projectName)
	fmt.Printf("Person in Charge (FM): %s\n", personInCharge)
	fmt.Printf("Verifier (V): %s\n", verifier)
	fmt.Printf("Registration Timestamp: %s\n", registrationTimestamp)
	fmt.Printf("Credit Balance: %d\n", creditBalance)
	fmt.Printf("Credit Status: %s\n", creditStatus)
	fmt.Println("==========================================")

	valueStr := projectID + "|" +
		projectName + "|" +
		personInCharge + "|" +
		verifier + "|" +
		registrationTimestamp + "|" +
		strconv.Itoa(creditBalance) + "|" +
		creditStatus

	err = APIstub.PutState(projectID, []byte(valueStr))
	if err != nil {
		return shim.Error("Failed to register project")
	}

	return shim.Success(nil)
}

func (s *SmartContract) QueryProject(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	if len(args) != 1 {
		return shim.Error("QueryProject expects 1 arg: ProjectID")
	}

	projectBytes, err := APIstub.GetState(args[0])
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to get project: %s", err.Error()))
	}
	if projectBytes == nil {
		return shim.Error("project not found")
	}
	return shim.Success(projectBytes)
}

// ============================================================================
// EmissionReduction
// ============================================================================

// energyconsumption
type EnergyRecord struct {
	UnitID            int     `json:"unit_id"`
	DetectionTime     string  `json:"detection_time"`
	TimePeriod        string  `json:"time_period"`
	EnergyType        string  `json:"energy_type"`        // "electricity" or "gas"
	EnergyConsumption float64 `json:"energy_consumption"` // kWh or Nm3
	Baseline          float64 `json:"baseline"`
}

// EmissionReduction
type EmissionResult struct {
	UnitID            int     `json:"unit_id"`
	AccountingTime    string  `json:"accounting_time"` // yyyy-MM-dd
	EnergyType        string  `json:"energy_type"`
	EmissionReduction float64 `json:"emission_reduction"` // gCO2
}

// RevenueAllocation
type RevenueRecord struct {
	UnitID      string  `json:"unit_id"`      // "1".."10" 或 "FM"
	RevenueTime string  `json:"revenue_time"` // yyyy-MM-dd
	Revenue     float64 `json:"revenue"`      // 金额
}

// Emission Factor（eg：gCO2 / unit）
const (
	FElec = 146.0  // gCO2 / kWh
	FGas  = 2100.0 // gCO2 / Nm3
)

// lastEmissionResults
const LastEmissionResultsKey = "lastEmissionResults"
const LastRevenueAllocationKey = "lastRevenueAllocation"
const CarbonPriceCNYPerCredit = 68.0

func (s *SmartContract) resolveDate(APIstub shim.ChaincodeStubInterface, args []string, optionalIndex int) (string, error) {
	if len(args) > optionalIndex && strings.TrimSpace(args[optionalIndex]) != "" {
		return args[optionalIndex], nil
	}

	txTime, err := APIstub.GetTxTimestamp()
	if err != nil {
		return "", err
	}
	return time.Unix(txTime.Seconds, int64(txTime.Nanos)).UTC().Format("2006-01-02"), nil
}

// EmissionReduction
func (s *SmartContract) EmissionReduction(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	if len(args) < 1 || len(args) > 2 {
		return shim.Error("EmissionReduction expects 1 or 2 args: energy consumption JSON array, optional accountingTime(yyyy-MM-dd)")
	}

	inputJSON := args[0]

	var records []EnergyRecord
	if err := json.Unmarshal([]byte(inputJSON), &records); err != nil {
		return shim.Error(fmt.Sprintf("failed to parse input JSON: %s", err.Error()))
	}

	fmt.Printf("=== EmissionReduction Input ===\n%s\n", inputJSON)

	accountingTime, err := s.resolveDate(APIstub, args, 1)
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to resolve accounting time: %s", err.Error()))
	}

	// calculate emission reduction
	var results []EmissionResult

	for _, rec := range records {
		energySaving := rec.Baseline - rec.EnergyConsumption
		if energySaving < 0 {
			fmt.Printf("Warning: negative energy saving for unit %d: %.2f\n", rec.UnitID, energySaving)
		}

		var ef float64
		switch rec.EnergyType {
		case "electricity":
			ef = FElec
		case "gas":
			ef = FGas
		default:
			return shim.Error(fmt.Sprintf("invalid energy_type for unit %d: %s", rec.UnitID, rec.EnergyType))
		}

		emissionReduction := ef * energySaving // gCO2

		result := EmissionResult{
			UnitID:            rec.UnitID,
			AccountingTime:    accountingTime,
			EnergyType:        rec.EnergyType,
			EmissionReduction: emissionReduction,
		}
		results = append(results, result)
	}

	// serialize results
	resultJSON, err := json.Marshal(results)
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to marshal results: %s", err.Error()))
	}

	// emissionResult:<unitID>:<accountingTime>
	for _, r := range results {
		key := fmt.Sprintf("emissionResult:%d:%s", r.UnitID, r.AccountingTime)

		b, err := json.Marshal(r)
		if err != nil {
			return shim.Error(fmt.Sprintf(
				"failed to marshal emission result for unit %d: %s",
				r.UnitID, err.Error(),
			))
		}

		if err := APIstub.PutState(key, b); err != nil {
			return shim.Error(fmt.Sprintf(
				"failed to put result for unit %d: %s",
				r.UnitID, err.Error(),
			))
		}
	}

	// store lastEmissionResults
	if err := APIstub.PutState(LastEmissionResultsKey, resultJSON); err != nil {
		return shim.Error(fmt.Sprintf("failed to put lastEmissionResults: %s", err.Error()))
	}

	fmt.Printf("=== EmissionReduction Output ===\n%s\n", string(resultJSON))

	return shim.Success(resultJSON)
}

// ============================================================================
// RevenueAllocation
// ============================================================================

func (s *SmartContract) RevenueAllocation(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	if len(args) > 1 {
		return shim.Error("RevenueAllocation expects 0 or 1 arg: optional revenueTime(yyyy-MM-dd)")
	}

	revenueTime, err := s.resolveDate(APIstub, args, 0)
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to resolve revenue time: %s", err.Error()))
	}

	// read lastEmissionResults
	b, err := APIstub.GetState(LastEmissionResultsKey)
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to get lastEmissionResults: %s", err.Error()))
	}
	if b == nil {
		return shim.Error("no emission results found on chain (lastEmissionResults is nil)")
	}

	var emissionResults []EmissionResult
	if err := json.Unmarshal(b, &emissionResults); err != nil {
		return shim.Error(fmt.Sprintf("failed to unmarshal lastEmissionResults: %s", err.Error()))
	}
	if len(emissionResults) == 0 {
		return shim.Error("lastEmissionResults is empty")
	}

	// calculate credits
	type unitCreditInfo struct {
		UnitID int
		Credit float64
	}

	var unitCredits []unitCreditInfo
	var totalCredit float64

	for _, er := range emissionResults {
		credit := 0.000001 * er.EmissionReduction // 1 ton CO2 -> 1 credit, emission_reduction is in g
		if credit < 0 {
			fmt.Printf("Warning: negative credit for unit %d: %f\n", er.UnitID, credit)
		}

		unitCredits = append(unitCredits, unitCreditInfo{
			UnitID: er.UnitID,
			Credit: credit,
		})
		totalCredit += credit
	}

	if totalCredit == 0 {
		return shim.Error("total credit is 0, cannot allocate revenue")
	}

	totalRevenue := CarbonPriceCNYPerCredit * totalCredit

	// allocate revenue
	fmRevenue := totalRevenue * 0.10
	unitPool := totalRevenue - fmRevenue // 相当于 90%

	var records []RevenueRecord

	fmRecord := RevenueRecord{
		UnitID:      "FM",
		RevenueTime: revenueTime,
		Revenue:     fmRevenue,
	}
	records = append(records, fmRecord)

	// key: revenue:FM:<revenueTime>
	fmKey := fmt.Sprintf("revenue:FM:%s", revenueTime)
	fmBytes, err := json.Marshal(fmRecord)
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to marshal FM revenue record: %s", err.Error()))
	}
	if err := APIstub.PutState(fmKey, fmBytes); err != nil {
		return shim.Error(fmt.Sprintf("failed to put FM revenue record: %s", err.Error()))
	}

	// allocate to units
	for _, uc := range unitCredits {
		ratio := uc.Credit / totalCredit
		unitRevenue := unitPool * ratio

		rec := RevenueRecord{
			UnitID:      strconv.Itoa(uc.UnitID),
			RevenueTime: revenueTime,
			Revenue:     unitRevenue,
		}
		records = append(records, rec)

		// 写入账本 key: revenue:<unitID>:<revenueTime>
		key := fmt.Sprintf("revenue:%d:%s", uc.UnitID, revenueTime)
		b, err := json.Marshal(rec)
		if err != nil {
			return shim.Error(fmt.Sprintf("failed to marshal revenue record for unit %d: %s", uc.UnitID, err.Error()))
		}
		if err := APIstub.PutState(key, b); err != nil {
			return shim.Error(fmt.Sprintf("failed to put revenue record for unit %d: %s", uc.UnitID, err.Error()))
		}
	}

	// return records as JSON
	out, err := json.Marshal(records)
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to marshal revenue allocation result: %s", err.Error()))
	}
	if err := APIstub.PutState(LastRevenueAllocationKey, out); err != nil {
		return shim.Error(fmt.Sprintf("failed to put lastRevenueAllocation: %s", err.Error()))
	}

	fmt.Printf("=== RevenueAllocation Carbon price === %f CNY/credit\n", CarbonPriceCNYPerCredit)
	fmt.Printf("=== RevenueAllocation Total credit === %f\n", totalCredit)
	fmt.Printf("=== RevenueAllocation Estimated revenue === %f\n", totalRevenue)
	fmt.Printf("=== RevenueAllocation Output ===\n%s\n", string(out))

	return shim.Success(out)
}

// ============================================================================
// QueryEmissionResult
// ============================================================================

func (s *SmartContract) QueryEmissionResult(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	if len(args) != 2 {
		return shim.Error("expects 2 args: unitID, accountingTime(yyyy-MM-dd)")
	}

	unitID, err := strconv.Atoi(args[0])
	if err != nil {
		return shim.Error("invalid unitID")
	}
	accountingTime := args[1]

	key := fmt.Sprintf("emissionResult:%d:%s", unitID, accountingTime)
	b, err := APIstub.GetState(key)
	if err != nil {
		return shim.Error(err.Error())
	}
	if b == nil {
		return shim.Error("emission result not found")
	}
	return shim.Success(b)
}

func (s *SmartContract) QueryRevenueRecord(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	if len(args) != 2 {
		return shim.Error("QueryRevenueRecord expects 2 args: unitID, revenueTime(yyyy-MM-dd)")
	}

	unitID := args[0]
	revenueTime := args[1]
	key := fmt.Sprintf("revenue:%s:%s", unitID, revenueTime)

	b, err := APIstub.GetState(key)
	if err != nil {
		return shim.Error(err.Error())
	}
	if b == nil {
		return shim.Error("revenue record not found")
	}
	return shim.Success(b)
}

func (s *SmartContract) QueryLastRevenueAllocation(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	if len(args) != 0 {
		return shim.Error("QueryLastRevenueAllocation expects no args")
	}

	b, err := APIstub.GetState(LastRevenueAllocationKey)
	if err != nil {
		return shim.Error(err.Error())
	}
	if b == nil {
		return shim.Error("last revenue allocation not found")
	}
	return shim.Success(b)
}

// ============================================================================
// Trading
// ============================================================================

type Request struct {
	ID        string  `json:"ID"`
	Type      string  `json:"Type"`
	Amount    float64 `json:"Amount"`
	Price     float64 `json:"Price"`
	RP        int     `json:"RP"`
	Smallsell int     `json:"Smallsell"`
	PV        float64 `json:"PV"`
}

type Transaction struct {
	ID     string  `json:"ID"`
	BuyID  string  `json:"BuyID"`
	SellID string  `json:"SellID"`
	Amount float64 `json:"Amount"`
	Price  float64 `json:"Price"`
}

func (s *SmartContract) Trading(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	fmt.Println("Trading called with args:")
	if len(args) < 1 {
		return shim.Error("Missing argument: JSON array of requests expected")
	}
	reqsJson := args[0]
	if len(reqsJson) > 300 {
		fmt.Println("reqsJson content (first 300 chars):")
	} else {
		fmt.Println("reqsJson content:")
	}

	// 1. 反序列化原始请求
	var reqs []Request
	err := json.Unmarshal([]byte(reqsJson), &reqs)
	if err != nil {
		return shim.Error("Invalid input: " + err.Error())
	}

	// 2. 拆分 BuyQueue 和 SellQueue
	var buyQueue []Request
	var sellQueue []Request
	for _, req := range reqs {
		if req.Type == "Buy" {
			buyQueue = append(buyQueue, req)
		} else if req.Type == "Sell" {
			sellQueue = append(sellQueue, req)
		}
	}

	// 3. 排序
	sort.Slice(buyQueue, func(i, j int) bool {
		return buyQueue[i].PV > buyQueue[j].PV
	})
	sort.Slice(sellQueue, func(i, j int) bool {
		return sellQueue[i].Price < sellQueue[j].Price
	})

	// ============================ Aggregation ==============================
	var smallSell []Request
	var normalSell []Request
	for _, sReq := range sellQueue {
		if sReq.Smallsell == 1 {
			smallSell = append(smallSell, sReq)
		} else {
			normalSell = append(normalSell, sReq)
		}
	}

	// 排序
	sort.Slice(smallSell, func(i, j int) bool {
		return smallSell[i].Price < smallSell[j].Price
	})

	// 聚合
	const Saggregation = 6000.0
	var aggregationSell []Request
	i := 0
	for i < len(smallSell) {
		aggIDs := []string{fmt.Sprintf("%v", smallSell[i].ID)}
		aggAmount := smallSell[i].Amount
		aggPrices := []float64{smallSell[i].Price}
		aggRP := smallSell[i].RP
		j := i + 1
		for aggAmount <= Saggregation && j < len(smallSell) {
			aggIDs = append(aggIDs, fmt.Sprintf("%v", smallSell[j].ID))
			aggAmount += smallSell[j].Amount
			aggPrices = append(aggPrices, smallSell[j].Price)
			j++
		}

		avgPrice := 0.0
		for _, p := range aggPrices {
			avgPrice += p
		}
		avgPrice /= float64(len(aggPrices))
		aggIDStr := strings.Join(aggIDs, ",")
		aggSell := Request{
			ID:        aggIDStr,
			Type:      "Sell",
			Amount:    aggAmount,
			Price:     avgPrice,
			RP:        aggRP,
			Smallsell: 0,
			PV:        0,
		}
		aggregationSell = append(aggregationSell, aggSell)
		i = j
	}

	// SellQueue
	sellQueue = append(normalSell, aggregationSell...)

	// 排序
	sort.Slice(sellQueue, func(i, j int) bool {
		return sellQueue[i].Price < sellQueue[j].Price
	})

	// 撮合
	var transactionQueue []Transaction
	transactionID := 1

	buyRemain := make([]float64, len(buyQueue))
	sellRemain := make([]float64, len(sellQueue))
	for i := range buyQueue {
		buyRemain[i] = buyQueue[i].Amount
	}
	for i := range sellQueue {
		sellRemain[i] = sellQueue[i].Amount
	}

	for buyIdx, buy := range buyQueue {
		buyLeft := buyRemain[buyIdx]
		sellIdx := 0
		for buyLeft > 0 && sellIdx < len(sellQueue) {
			sell := sellQueue[sellIdx]
			sellLeft := sellRemain[sellIdx]
			// 撮合条件
			if buy.Price > sell.Price && sellLeft > 0 {
				matchAmount := buyLeft
				if sellLeft < buyLeft {
					matchAmount = sellLeft
				}
				tx := Transaction{
					ID:     strconv.Itoa(transactionID),
					BuyID:  buy.ID,
					SellID: sell.ID,
					Price:  sell.Price,
					Amount: matchAmount,
				}
				transactionQueue = append(transactionQueue, tx)
				transactionID++

				buyLeft -= matchAmount
				buyRemain[buyIdx] -= matchAmount
				sellRemain[sellIdx] -= matchAmount

				if sellRemain[sellIdx] == 0 {
					sellIdx++
				}
			} else {
				sellIdx++
			}
		}
	}

	// 剩余未成交挂单
	var remainBuyQueue []Request
	var remainSellQueue []Request
	for i, amount := range buyRemain {
		if amount > 0 {
			b := buyQueue[i]
			b.Amount = amount
			remainBuyQueue = append(remainBuyQueue, b)
		}
	}
	for i, amount := range sellRemain {
		if amount > 0 {
			sReq := sellQueue[i]
			sReq.Amount = amount
			remainSellQueue = append(remainSellQueue, sReq)
		}
	}

	remainRequestQueue := map[string]interface{}{
		"BuyQueue":  remainBuyQueue,
		"SellQueue": remainSellQueue,
	}

	// 写入账本
	for _, tx := range transactionQueue {
		key := "tx_" + tx.ID
		val, err := json.Marshal(tx)
		if err != nil {
			return shim.Error(fmt.Sprintf("Failed to marshal tx %s: %s", tx.ID, err))
		}
		err = APIstub.PutState(key, val)
		if err != nil {
			return shim.Error(fmt.Sprintf("Failed to put tx %s: %s", tx.ID, err))
		}
	}

	// 返回
	result := map[string]interface{}{
		"TransactionQueue":   transactionQueue,
		"RemainRequestQueue": remainRequestQueue,
	}
	resultBytes, err := json.Marshal(result)
	if err != nil {
		return shim.Error(fmt.Sprintf("结果序列化失败: %v", err))
	}

	fmt.Println("resultBytes:")
	return shim.Success(resultBytes)
}

func (s *SmartContract) QueryTransaction(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	if len(args) != 1 {
		return shim.Error("QueryTransaction expects 1 arg: transactionID")
	}

	key := "tx_" + args[0]
	b, err := APIstub.GetState(key)
	if err != nil {
		return shim.Error(err.Error())
	}
	if b == nil {
		return shim.Error("transaction not found")
	}
	return shim.Success(b)
}

// ============================================================================
//  transfer
// ============================================================================

func (s *SmartContract) open(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	if len(args) != 2 {
		return shim.Error("Incorrect number of arguments. Expecting 2")
	}

	account := args[0]
	value, err := strconv.Atoi(args[1])
	if err != nil {
		return shim.Error("Expecting integer value " + args[0] + ":" + args[1])
	}

	existing, err := APIstub.GetState(account)
	if err != nil {
		return shim.Error("Failed to get state")
	}
	if existing != nil {
		return shim.Error("Entity already exists")
	}

	err = APIstub.PutState(account, []byte(strconv.Itoa(value)))
	if err != nil {
		return shim.Error(err.Error())
	}

	return shim.Success(nil)
}

func (s *SmartContract) transfer(APIstub shim.ChaincodeStubInterface, args []string) sc.Response {
	var A, B string
	var Aval, Bval int
	var X int
	var err error

	if len(args) != 3 {
		return shim.Error("Incorrect number of arguments. Expecting 3")
	}

	A = args[0]
	B = args[1]

	Avalbytes, err := APIstub.GetState(A)
	if err != nil {
		return shim.Error("Failed to get state")
	}
	if Avalbytes == nil {
		return shim.Error("Entity not found")
	}
	Aval, _ = strconv.Atoi(string(Avalbytes))

	Bvalbytes, err := APIstub.GetState(B)
	if err != nil {
		return shim.Error("Failed to get state")
	}
	if Bvalbytes == nil {
		return shim.Error("Entity not found")
	}
	Bval, _ = strconv.Atoi(string(Bvalbytes))

	X, err = strconv.Atoi(args[2])
	if err != nil {
		return shim.Error("Invalid transaction amount, expecting an integer value")
	}
	Aval = Aval - X
	Bval = Bval + X
	fmt.Printf("Aval = %d, Bval = %d\n", Aval, Bval)

	// 写回账本
	err = APIstub.PutState(A, []byte(strconv.Itoa(Aval)))
	if err != nil {
		return shim.Error(err.Error())
	}

	err = APIstub.PutState(B, []byte(strconv.Itoa(Bval)))
	if err != nil {
		return shim.Error(err.Error())
	}

	return shim.Success(nil)
}

func main() {
	err := shim.Start(new(SmartContract))
	if err != nil {
		fmt.Printf("Error starting SmartContract chaincode: %s", err)
	}
}
