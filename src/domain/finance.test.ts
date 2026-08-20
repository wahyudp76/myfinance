import {
  accountImpact,
  convertCurrency,
  isCashflowTransaction,
  roundMoney,
} from "./finance";

describe("convertCurrency", () => {
  it("converts USD to IDR using IDR-per-unit rates", () => {
    const result = convertCurrency({
      sourceAmount: 100,
      sourceRate: { idrPerUnit: 16000 },
      destinationRate: { idrPerUnit: 1 },
    });

    expect(result.sourceAmountIdr).toBe(1_600_000);
    expect(result.destinationAmount).toBe(1_600_000);
    expect(result.destinationAmountIdr).toBe(1_600_000);
  });

  it("converts IDR to USD", () => {
    const result = convertCurrency({
      sourceAmount: 1_600_000,
      sourceRate: { idrPerUnit: 1 },
      destinationRate: { idrPerUnit: 16000 },
    });

    expect(result.destinationAmount).toBe(100);
    expect(result.destinationAmountIdr).toBe(1_600_000);
  });

  it("rejects non-positive amounts or rates", () => {
    expect(() => convertCurrency({
      sourceAmount: 0,
      sourceRate: { idrPerUnit: 16000 },
      destinationRate: { idrPerUnit: 1 },
    })).toThrow();
  });
});

describe("cashflow semantics", () => {
  it("excludes transfers from income/expense reporting", () => {
    expect(isCashflowTransaction("Transfer")).toBe(false);
    expect(isCashflowTransaction("Pemasukan")).toBe(true);
    expect(isCashflowTransaction("Pengeluaran")).toBe(true);
  });

  it("calculates ordinary account impact", () => {
    expect(accountImpact("Pemasukan", 100)).toBe(100);
    expect(accountImpact("Pengeluaran", 100)).toBe(-100);
  });
});

describe("roundMoney", () => {
  it("rounds floating point residue at the UI/domain boundary", () => {
    expect(roundMoney(100.005)).toBe(100.01);
    expect(roundMoney(12.3456, 2)).toBe(12.35);
  });
});
