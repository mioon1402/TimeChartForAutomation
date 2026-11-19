import { describe, expect, it } from "vitest";
import type { Circuit } from "../src/circuit/types";
import {
  CircuitModel,
  runScenario,
  type ScenarioResult,
  type Track,
} from "../src/circuit/engine";
import { circuitExamples } from "../src/circuit/examples";
import { checkCircuit } from "../src/circuit/bom";
import { sanitizeCircuit } from "../src/circuit/sanitize";
import { partPins } from "../src/circuit/parts";
import { energyUse, DEFAULT_PRICE } from "../src/circuit/energy";
import { earthStudy } from "../src/circuit/earth";

const H = 3600000;
/** 값이 바뀌는 점만 */
const pts = (res: ScenarioResult, key: string) =>
  res.tracks
    .find((t) => t.key === key)!
    .points.filter((p, i, a) => i === 0 || p.v !== a[i - 1].v)
    .map((p) => [p.t, p.v] as [number, number | string]);

describe("예제: 열풍기 온도 제어 + 24시간 타이머", () => {
  const c = circuitExamples()
    .find((e) => e.id === "blower-timer")!
    .build();
  const model = new CircuitModel(c);
  const res = runScenario(c, model);
  const coil = pts(res, "coil:MC1");

  it("타이머 08시에 켜져 5 → 20℃ (0.01 ℃/s, 1500 초) 에 끄고, 18 ↔ 20℃ 사이를 오간다", () => {
    expect(res.end).toBe(24 * H);
    expect(res.warnings).toEqual([]);
    expect(pts(res, "ts:TSW1")).toEqual([
      [0, 0],
      [8 * H, 1],
      [18 * H, 0],
    ]);
    expect(coil.slice(0, 3)).toEqual([
      [0, 0],
      [8 * H, 1],
      [8 * H + 1500000, 0],
    ]);
    // 20 → 18℃ 내려가는 데 2 / 0.0033 초, 18 → 20℃ 올라가는 데 200 초
    expect(coil[3][0]).toBeCloseTo(8 * H + 1500000 + (2 / 0.0033) * 1000, 0);
    expect(coil[4][0] - coil[3][0]).toBeCloseTo(200000, 0);
  });

  it("18시에 타이머가 끊어 멈추고, 19시 수동 (잔업) 에 다시 돌다가 20시 자동으로 돌리면 꺼진 채로 하루가 끝난다", () => {
    const at = (t: number) => {
      let v: number | string = 0;
      for (const [pt, pv] of coil) if (pt <= t) v = pv;
      return v;
    };
    expect(at(18 * H)).toBe(0);
    expect(coil.filter(([t]) => t > 18 * H && t < 19 * H)).toEqual([]);
    expect(at(19 * H)).toBe(1);
    expect(at(20 * H)).toBe(0);
    expect(coil.filter(([t]) => t > 20 * H)).toEqual([]);
    expect(coil.filter(([t]) => t < 8 * H && t > 0)).toEqual([]);
    // 운전등은 MC1 보조 a접점을 따른다
    expect(pts(res, "load:GL1")).toEqual(pts(res, "load:HT1"));
  });

  it("[검사] 가 깨끗하고, 열풍기 외함은 PE 로 접지되어 지락이면 누전차단기가 끊는다", () => {
    expect(checkCircuit(c, model).map((i) => i.msg)).toEqual([]);
    const st = earthStudy(c, model);
    const ht = st.rows.find((r) => r.part.tag === "HT1")!;
    expect(ht.r.earthed).toBe(true);
    expect(ht.r.trip?.part.tag).toBe("ELB1");
  });

  it("측온저항체가 빠지면 조절기는 센서 끊김 (oPEn) 으로 출력을 끄고 [검사] 가 알린다", () => {
    const cut: Circuit = {
      ...c,
      parts: c.parts.filter((p) => p.tag !== "PT1"),
    };
    const m2 = new CircuitModel(cut);
    expect(m2.tempDef.get("TC1")?.sensorOk).toBe(false);
    const r2 = runScenario(cut, m2);
    expect(pts(r2, "coil:MC1")).toEqual([[0, 0]]);
    expect(checkCircuit(cut, m2).some((i) => i.msg.includes("oPEn"))).toBe(
      true,
    );
    expect(model.tempDef.get("TC1")?.sensorOk).toBe(true);
  });

  it("하루 전력량 · 요금: 켜져 있던 시간 × kW × 182원", () => {
    const e = energyUse(c, res);
    expect(e.day).toBe(true);
    expect(e.price).toBe(DEFAULT_PRICE);
    // 코일 기록으로 켜진 시간을 직접 더한 값과 같다
    let on = 0;
    coil.forEach(([t, v], i) => {
      if (v === 1) on += (coil[i + 1]?.[0] ?? res.end) - t;
    });
    const ht = e.rows.find((r) => r.tag === "HT1")!;
    expect(ht.kw).toBe(5);
    expect(ht.onMs).toBeCloseTo(on, 3);
    expect(ht.kwh).toBeCloseTo((5 * on) / H, 6);
    expect(ht.kwh).toBeCloseTo(16.28, 2);
    expect(e.kwh).toBeCloseTo(16.32, 2);
    expect(e.cost).toBeCloseTo(e.kwh * 182, 6);
    expect(e.contractKw).toBe(5);
    expect(e.month).toEqual({
      kwh: e.kwh * 30,
      energy: e.cost * 30,
      base: 0,
      total: e.cost * 30,
    });
    // 단가 · 기본요금 · 계약 전력을 넣으면
    const e2 = energyUse(
      { ...c, price: 150, basePrice: 6000, contractKw: 7 },
      res,
    );
    expect(e2.cost).toBeCloseTo(e.kwh * 150, 6);
    expect(e2.month?.base).toBe(42000);
    expect(e2.month?.total).toBeCloseTo(e.kwh * 150 * 30 + 42000, 6);
  });

  it("손계산: 5 kW 를 1시간 켜면 5 kWh = 910원 (조작 순서 3시간, 하루가 아님)", () => {
    const ht = c.parts.find((p) => p.tag === "HT1")!;
    const tr: Track = {
      key: "load:HT1",
      tag: "HT1",
      kind: "load",
      part: ht,
      last: 0,
      points: [
        { t: 0, v: 0 },
        { t: H, v: 1 },
        { t: 2 * H, v: 0 },
      ],
    };
    const fake: ScenarioResult = {
      model: new CircuitModel({
        ...c,
        parts: c.parts.filter((p) => p.type !== "r_tsw"),
      }),
      tracks: [tr],
      end: 3 * H,
      lastChange: 2 * H,
      warnings: [],
      times: [],
    };
    const e = energyUse(c, fake);
    expect(e.rows.map((r) => [r.tag, r.kwh, r.cost])).toEqual([
      ["HT1", 5, 910],
    ]);
    expect(e.day).toBe(false);
    expect(e.month).toBeNull();
  });

  it("부하의 PE 단자 · 요금 설정은 저장해도 남는다", () => {
    const ht = c.parts.find((p) => p.tag === "HT1")!;
    expect(partPins(ht).map((p) => p.label)).toEqual(["L", "N", "PE"]);
    expect(partPins({ ...ht, pe: undefined }).map((p) => p.label)).toEqual([
      "L",
      "N",
    ]);
    const back = sanitizeCircuit(
      JSON.parse(
        JSON.stringify({ ...c, price: 150, basePrice: 6000, contractKw: 7 }),
      ),
    )!;
    expect([back.price, back.basePrice, back.contractKw]).toEqual([
      150, 6000, 7,
    ]);
    expect(back.parts.find((p) => p.tag === "HT1")?.pe).toBe(true);
    expect(back.parts.find((p) => p.tag === "TC1")).toMatchObject({
      type: "r_tc8",
      sv: 20,
      hys: 2,
      spec: "T3S-B4RP2C-N",
    });
  });
});
