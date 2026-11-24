import type { Circuit, Part, PartType } from './types';
import { CONTACT_A, CONTACT_B, compareTags, counterPreset, isPlcPart, isTempDevice, pidSetting, pos3Labels, tempSetting, timerText, lampColorName, OPERATOR, partKindName, partPins, PARTS, plcAddresses, REAL, tbSize, tswSched, VALVES, busSize, BUS_CELL_M } from './parts';
import { airDriven, CircuitModel, normTag, tagKey } from './engine';
import { isContactor } from './chart';
import { formatClock, formatTime } from '../model/format';
import { loadRating } from './power';
import { supplyProblems } from './supply';
import { verifyWiring } from './verify';
import { contactNumbers, parseTerm, termChoices } from './contacts';
import { planLeft } from './plan';
import { tr } from '../i18n';

/** 부품 리스트 한 줄 = 기호 하나 (코일과 그 접점들은 한 기기) */
export interface BomRow {
  tag: string;
  kind: string;
  name: string;
  spec: string;
  /** a접점 수, b접점 수, 주접점 극 수 */
  a: number;
  b: number;
  main: number;
  /** 회로에 그려진 기호 수 */
  count: number;
  cat: number;
}

export interface BomSummary {
  kind: string;
  spec: string;
  qty: number;
  tags: string[];
}

const CAT_ORDER: Partial<Record<PartType, number>> = {
  mcb3: 0,
  mcb: 0,
  fuse3: 1,
  fuse: 1,
  ol3: 2,
  coil: 3,
  km3: 3,
  timer: 4,
  pb_no: 5,
  pb_nc: 5,
  sw_no: 6,
  sw_nc: 6,
  estop: 6,
  ls_no: 7,
  ls_nc: 7,
  lamp: 8,
  buzzer: 8,
  motor3: 9,
  motor: 9,
  sol: 10,
  load: 9,
  cyl: 11,
  plc: 3,
  smps: 0,
  prox: 7,
  r_mcb3: 0,
  r_mcb2: 0,
  r_mcb1: 0,
  r_thr: 2,
  r_mc: 3,
  r_pb: 5,
  r_lamp: 8,
  r_motor3: 9,
  r_relay8: 3,
  r_my2: 3,
  r_my4: 3,
  r_fuse: 0,
  r_smps: 1,
  r_pbl: 5,
  r_ls: 6,
  r_fsw: 6,
  r_float: 6,
  r_psw: 6,
  r_prox: 6,
  r_prox2: 6,
  r_buzzer: 7,
  r_sol: 7,
  r_fan: 8,
  r_outlet: 8,
  r_motor6: 9,
  r_vm: 9,
  r_am: 9,
  r_nbar: 10,
  r_duct: 11,
  r_rail: 11,
  r_timer8: 4,
  r_ss: 6,
  r_ss3: 6,
  r_counter: 4,
  r_plc: 3,
  r_hmi: 3,
  r_tc: 4,
  r_tc8: 4,
  r_tk4: 4,
  r_rtd: 7,
  r_rtd2: 7,
  r_thermo: 6,
  r_ssr: 3,
  r_estop: 6,
  r_tb: 12,
  r_tsw: 4,
  r_light: 8,
  r_sw: 6,
  r_sw3: 6,
  r_load1: 9,
  r_load3: 9,
  r_panel: -1,
  r_mcb4: 0,
  r_bus: 0,
  r_kepco: -1,
  r_vcb: -1,
  r_tr3: -1,
  frl: 10,
  v32: 10,
  v52: 10,
  v52d: 10,
  v53: 10,
  fc: 10,
};

const VALVE_KIND: Partial<Record<PartType, [string, string]>> = {
  v32: ['3/2 솔레노이드 밸브 (NC)', '3/2 solenoid valve (NC)'],
  v52: ['5/2 솔레노이드 밸브 (편솔)', '5/2 solenoid valve (single)'],
  v52d: ['5/2 솔레노이드 밸브 (양솔)', '5/2 solenoid valve (double)'],
  v53: ['5/3 솔레노이드 밸브 (올포트 블록)', '5/3 solenoid valve (closed centre)'],
};

/** 소켓에 꽂아 쓰는 기기의 소켓 (부품 리스트에 함께 적는다) */
export function socketText(p: Part): string {
  switch (p.type) {
    case 'r_relay8':
    case 'r_timer8':
      return tr('소켓 8핀 원형 (PF083A 꼴)', '8-pin round socket (PF083A type)');
    case 'r_my2':
      return tr('소켓 8핀 각형 (PYF08A 꼴)', '8-blade socket (PYF08A type)');
    case 'r_my4':
      return tr('소켓 14핀 각형 (PYF14A 꼴)', '14-blade socket (PYF14A type)');
    default:
      return '';
  }
}

/** 기기의 품명을 정하는 부품 (코일 > 주회로 > 스위치 > 접점) */
function mainOf(parts: Part[]): Part {
  const rank = (p: Part) =>
    p.type === 'coil' || p.type === 'timer' || p.type === 'cyl' || p.type === 'r_mc' || p.type === 'r_relay8' || p.type === 'r_my2' || p.type === 'r_my4' || p.type === 'r_timer8' || p.type === 'r_tsw' || p.type === 'r_counter' || p.type === 'r_ssr' || p.type === 'r_tc' || p.type === 'r_thermo'
      ? 0
      : p.type === 'ol3' || p.type === 'mcb3' || p.type === 'mcb' || p.type === 'r_thr' || p.type === 'r_mcb1' || p.type === 'r_mcb2' || p.type === 'r_mcb3' || p.type === 'r_mcb4' || p.type === 'r_vcb'
        ? 1
        : OPERATOR.has(p.type) || PARTS[p.type].load
          ? 2
          : p.type === 'km3'
            ? 3
            : 4;
  return [...parts].sort((x, y) => rank(x) - rank(y))[0];
}

function contactText(a: number, b: number): string {
  return [a ? `${a}a` : '', b ? `${b}b` : ''].join('') || '';
}

function kindAndSpec(c: Circuit, tag: string, p: Part, a: number, b: number, main: number): { kind: string; spec: string } {
  const ab = contactText(a, b);
  switch (p.type) {
    case 'coil':
    case 'r_mc':
    case 'km3': {
      if (isContactor(c, tag)) return { kind: tr('전자접촉기', 'Magnetic contactor'), spec: [main ? tr(`주접점 ${main}P`, `${main}P main`) : '', ab ? tr(`보조 ${ab}`, `aux ${ab}`) : ''].filter(Boolean).join(', ') };
      return { kind: tr('릴레이', 'Relay'), spec: ab };
    }
    case 'timer':
      if (p.timerMode === 'flicker') return { kind: tr('플리커 릴레이', 'Flicker relay'), spec: `${timerText(p, 500)} ${tr('간격', 'interval')}${ab ? `, ${ab}` : ''}` };
      return { kind: tr('타이머', 'Timer'), spec: `${p.timerMode === 'off' ? tr('OFF 딜레이', 'off-delay') : p.timerMode === 'interval' ? tr('인터벌', 'interval') : tr('ON 딜레이', 'on-delay')} ${formatTime(p.preset ?? 3000, 's')}${ab ? `, ${ab}` : ''}` };
    case 'pb_no':
    case 'pb_nc':
      return { kind: tr('푸시버튼', 'Push button'), spec: [p.color ? lampColorName(p.color) : '', ab].filter(Boolean).join(' ') };
    case 'sw_no':
    case 'sw_nc':
      return { kind: tr('셀렉터 스위치', 'Selector switch'), spec: ab };
    case 'estop':
      return { kind: tr('비상정지 스위치', 'Emergency stop'), spec: ab };
    case 'ls_no':
    case 'ls_nc': {
      if (p.sense === 'temp') {
        const { sv, hys } = tempSetting(p);
        return { kind: tr('온도 스위치', 'Temperature switch'), spec: [tr(`설정 ${sv}℃, 차 ${hys}℃`, `set ${sv}℃, diff. ${hys}℃`), ab].join(', ') };
      }
      const kind =
        p.sense === 'inductive' || p.sense === 'capacitive' || p.sense === 'photo'
          ? tr('근접 센서 (2선식)', 'Proximity sensor (2-wire)')
          : p.sense === 'reed'
          ? tr('리드 스위치 (실린더 센서)', 'Reed switch')
          : p.sense === 'float'
            ? tr('플로트 스위치', 'Float switch')
            : p.sense === 'pressure'
              ? tr('압력 스위치', 'Pressure switch')
              : p.cyl
                ? tr('실린더 센서', 'Cylinder sensor')
                : tr('리밋 스위치', 'Limit switch');
      return { kind, spec: [p.cyl ? `${p.cyl} ${p.end === '-' ? tr('후진단', 'retracted') : tr('전진단', 'extended')}` : '', ab].filter(Boolean).join(', ') };
    }
    case 'prox': {
      const kind = p.sense === 'photo' ? tr('광전 센서', 'Photoelectric sensor') : p.sense === 'capacitive' ? tr('근접 센서 (정전용량형)', 'Capacitive proximity sensor') : tr('근접 센서 (유도형)', 'Inductive proximity sensor');
      return { kind, spec: [`DC 24V ${tr('3선식', '3-wire')} ${p.npn ? 'NPN' : 'PNP'}`, p.cyl ? `${p.cyl} ${p.end === '-' ? tr('후진단', 'retracted') : tr('전진단', 'extended')}` : ''].filter(Boolean).join(', ') };
    }
    case 'smps':
      return { kind: tr('SMPS (DC 전원 공급기)', 'Switching power supply'), spec: 'AC 220V → DC 24V' };
    case 'frl':
      return { kind: tr('에어 서비스 유닛 (FRL)', 'Air service unit (FRL)'), spec: tr('필터 · 레귤레이터 · 압력계', 'filter, regulator, gauge') };
    case 'fc':
      return { kind: tr('속도 제어 밸브', 'Flow control valve'), spec: tr(`미터 아웃, ${p.speed ?? 50}%`, `meter-out, ${p.speed ?? 50}%`) };
    case 'v32':
    case 'v52':
    case 'v52d':
    case 'v53': {
      const [ko, en] = VALVE_KIND[p.type]!;
      const sols = [p.solA?.trim() ? `${p.solA.trim()} (14)` : '', p.type !== 'v32' && p.type !== 'v52' && p.solB?.trim() ? `${p.solB.trim()} (12)` : ''].filter(Boolean).join(', ');
      return { kind: tr(ko, en), spec: sols };
    }
    case 'mcb3':
    case 'mcb':
      return { kind: tr('배선용 차단기', 'Circuit breaker'), spec: p.type === 'mcb3' ? '3P' : '1P' };
    case 'r_mcb1':
    case 'r_mcb2':
    case 'r_mcb3':
    case 'r_mcb4':
      return { kind: p.elb ? tr('누전차단기 (ELB)', 'Earth leakage breaker (ELB)') : tr('배선용 차단기', 'Circuit breaker'), spec: `${p.type.slice(-1)}P${p.amps ? ` ${p.amps}A` : ''}${p.ka ? ` ${p.ka}kA` : ''}` };
    case 'r_fuse':
      return { kind: tr('퓨즈 홀더', 'Fuse holder'), spec: `1P${p.amps ? ` ${p.amps}A` : ''}` };
    case 'r_smps':
      return { kind: 'SMPS', spec: tr('입력 AC 100-240V, 출력 DC 24V', 'in AC 100-240V, out DC 24V') };
    case 'r_prox':
      return { kind: p.sense === 'photo' ? tr('광전 센서 (3선식)', 'Photo sensor (3-wire)') : tr('근접 센서 (3선식)', 'Proximity sensor (3-wire)'), spec: `${p.npn ? 'NPN' : 'PNP'} NO, DC 24V` };
    case 'r_prox2':
      return { kind: tr('근접 센서 (2선식)', 'Proximity sensor (2-wire)'), spec: `${p.ncOut ? 'NC' : 'NO'}, ${p.ac ? 'AC 100-240V' : 'DC 12-24V'}` };
    case 'r_ls':
      return { kind: tr('리밋 스위치', 'Limit switch'), spec: ab };
    case 'r_fsw':
      return { kind: tr('풋 스위치', 'Foot switch'), spec: ab };
    case 'r_float':
      return { kind: tr('플로트 스위치', 'Float switch'), spec: ab };
    case 'r_psw':
      return { kind: tr('압력 스위치', 'Pressure switch'), spec: ab };
    case 'r_pbl':
      return { kind: tr('조광형 푸시버튼', 'Illuminated push button'), spec: [p.color ? lampColorName(p.color) : '', ab].filter(Boolean).join(' ') };
    case 'r_buzzer':
      return { kind: tr('부저', 'Buzzer'), spec: '' };
    case 'r_sol':
      return { kind: tr('솔레노이드 밸브', 'Solenoid valve'), spec: `${tr('코일', 'coil')} ${p.spec?.trim() || 'DC 24V'}, ${p.conn === 'din' ? tr('DIN 커넥터', 'DIN connector') : tr('리드선', 'lead wires')}` };
    case 'r_fan':
      return { kind: tr('판넬 팬', 'Panel fan'), spec: 'AC 220V' };
    case 'r_outlet':
      return { kind: tr('콘센트', 'Socket outlet'), spec: tr('접지형 2구', 'earthed') };
    case 'r_motor6':
      return { kind: tr('3상 유도 전동기 (6단자, Y-Δ 기동)', '3-phase induction motor (6 leads, Y-Δ)'), spec: '' };
    case 'r_vm':
      return { kind: tr('전압계', 'Voltmeter'), spec: '' };
    case 'r_am':
      return { kind: tr('전류계', 'Ammeter'), spec: '' };
    case 'r_nbar':
      return { kind: p.pole === 'PE' ? tr('접지 바 (PE)', 'Earth bar (PE)') : tr('중성선 바 (N)', 'Neutral bar (N)'), spec: `${tbSize(p)}P` };
    case 'r_duct':
      return { kind: tr('배선 덕트', 'Wire duct'), spec: '' };
    case 'r_rail':
      return { kind: tr('DIN 레일', 'DIN rail'), spec: '35 mm' };
    case 'r_vcb':
      return { kind: tr('진공차단기 (VCB)', 'Vacuum circuit breaker (VCB)'), spec: `3P${p.amps ? ` ${p.amps}A` : ''}${p.ka ? ` ${p.ka}kA` : ''}` };
    case 'r_tr3':
      return { kind: tr('변압기 (3상, Δ-Y)', 'Transformer (3-phase, D-Y)'), spec: `${p.kva ?? 500} kVA ${p.kv ?? 22.9} kV, %Z ${p.z ?? 5}` };
    case 'r_kepco':
      return { kind: tr('한전 수전점', 'Utility supply point'), spec: tr(`${p.kv ?? 22.9} kV, 단락 ${p.ka ?? 12.5} kA`, `${p.kv ?? 22.9} kV, fault ${p.ka ?? 12.5} kA`) };
    case 'r_bus': {
      const { bars, len } = busSize(p);
      return { kind: tr('부스바 (구리)', 'Busbar (copper)'), spec: tr(`${bars}극 ${p.mm2 ?? 100} mm²${p.amps ? `, ${p.amps}A` : ''}, 길이 약 ${Math.round(len * BUS_CELL_M * 100) / 100} m`, `${bars}-pole ${p.mm2 ?? 100} mm²${p.amps ? `, ${p.amps}A` : ''}, about ${Math.round(len * BUS_CELL_M * 100) / 100} m`) };
    }
    case 'r_thr':
      return { kind: tr('열동형 과부하 계전기', 'Thermal overload relay'), spec: ab };
    case 'r_pb':
      return { kind: tr('푸시버튼', 'Push button'), spec: [p.color ? lampColorName(p.color) : '', ab].filter(Boolean).join(' ') };
    case 'r_lamp':
      return { kind: tr('파일럿 램프', 'Pilot lamp'), spec: lampColorName(p.color) };
    case 'r_motor3':
      return { kind: tr('3상 유도 전동기', '3-phase induction motor'), spec: '' };
    case 'r_relay8':
      return { kind: tr('릴레이 (8핀) + 소켓', 'Relay (8-pin) + socket'), spec: `${tr('코일 AC 220V', 'coil AC 220V')}, ${ab}` };
    case 'r_my2':
      return { kind: tr('릴레이 (각형 2c) + 소켓', 'Relay (blade, 2-pole) + socket'), spec: `${tr('코일 AC 220V', 'coil AC 220V')}, ${ab}` };
    case 'r_my4':
      return { kind: tr('릴레이 (각형 4c) + 소켓', 'Relay (blade, 4-pole) + socket'), spec: `${tr('코일 AC 220V', 'coil AC 220V')}, ${ab}` };
    case 'r_timer8': {
      const mode = p.timerMode === 'off' ? tr('OFF 딜레이', 'off-delay') : p.timerMode === 'flicker' ? tr('플리커', 'flicker') : p.timerMode === 'interval' ? tr('인터벌', 'interval') : tr('ON 딜레이', 'on-delay');
      const cts = p.inst13 ? tr('한시 1a1b · 순시 1a1b', 'timed 1NO1NC · inst. 1NO1NC') : tr('한시 2a2b', 'timed 2NO2NC');
      return { kind: tr('타이머 (8핀) + 소켓', 'Timer (8-pin) + socket'), spec: `${mode} ${timerText(p)}, ${cts}` };
    }
    case 'r_ss':
      return { kind: tr('셀렉터 스위치 (2단)', 'Selector switch (2-position)'), spec: ab };
    case 'r_ss3':
      return { kind: tr('셀렉터 스위치 (3단)', 'Selector switch (3-position)'), spec: `${pos3Labels(p).join(' · ')}, 2a` };
    case 'r_counter':
      return { kind: tr('프리셋 카운터', 'Preset counter'), spec: tr(`설정 ${counterPreset(p)}, 무전압 입력, 출력 1c, AC 220V`, `preset ${counterPreset(p)}, dry-contact input, 1 c/o output, AC 220V`) };
    case 'r_ssr':
      return { kind: tr('SSR (무접점 릴레이)', 'Solid-state relay'), spec: tr('입력 DC 4-32V, 출력 AC 220V', 'in DC 4-32V, out AC 220V') };
    case 'r_tc8': {
      const { sv, hys } = tempSetting(p);
      return {
        kind: tr('온도 조절기 (48×48, 8핀 소켓)', 'Temperature controller (48×48, 8-pin socket)'),
        spec: [p.spec?.trim(), tr('전원 AC 100-240V, 측온저항체 Pt100 입력, 릴레이 출력 1c', 'AC 100-240V, Pt100 RTD input, 1 c/o relay output'), tr(`ON/OFF ${p.tcMode === 'cool' ? '냉각' : '가열'}, 설정 ${sv}℃, 히스테리시스 ${hys}℃`, `ON/OFF ${p.tcMode === 'cool' ? 'cooling' : 'heating'}, set ${sv}℃, hysteresis ${hys}℃`), tr('8핀 소켓 별도', '8-pin socket separate')]
          .filter(Boolean)
          .join(', '),
      };
    }
    case 'r_rtd':
      return { kind: tr('측온저항체', 'RTD sensor'), spec: [p.spec?.trim() || 'Pt100 Ω', tr('3선식, 보호관 · 나사 고정', '3-wire, sheathed, threaded')].join(', ') };
    case 'r_rtd2':
      return { kind: tr('측온저항체 (더블)', 'RTD sensor (duplex)'), spec: [p.spec?.trim() || 'Pt100 Ω × 2', tr('3선식 소자 2개 (6가닥), 보호관 · 나사 고정', '2 × 3-wire elements (6 leads), sheathed, threaded')].join(', ') };
    case 'r_tk4': {
      const { sv, hys } = tempSetting(p);
      const pid = pidSetting(p);
      return {
        kind: tr('PID 온도 조절기 (48×48, 나사 단자)', 'PID temperature controller (48×48, screw terminals)'),
        spec: [
          p.spec?.trim(),
          tr('전원 AC 100-240V, 멀티 입력 (Pt100 으로 설정), 제어 출력 릴레이 1a, 경보 AL1 릴레이 1a, RS485', 'AC 100-240V, multi-input (set to Pt100), relay 1a control output, AL1 relay 1a, RS485'),
          pid ? tr(`PID ${p.tcMode === 'cool' ? '냉각' : '가열'}, 설정 ${sv}℃, P ${pid.pb}℃ · I ${pid.ti}s · D ${pid.td}s, 제어 주기 ${pid.cycle}s`, `PID ${p.tcMode === 'cool' ? 'cooling' : 'heating'}, set ${sv}℃, P ${pid.pb}℃ I ${pid.ti}s D ${pid.td}s, cycle ${pid.cycle}s`) : tr(`ON/OFF, 설정 ${sv}℃, 히스테리시스 ${hys}℃`, `ON/OFF, set ${sv}℃, hysteresis ${hys}℃`),
          typeof p.alarm === 'number' ? tr(`경보 ${p.alarm}℃ 이상`, `alarm at ${p.alarm}℃`) : '',
        ]
          .filter(Boolean)
          .join(', '),
      };
    }
    case 'r_tc': {
      const { sv, hys } = tempSetting(p);
      return {
        kind: tr('온도 조절기 (48×48)', 'Temperature controller (48×48)'),
        spec: [
          tr('전원 AC 100-240V', 'AC 100-240V'),
          tr(`ON/OFF ${p.tcMode === 'cool' ? '냉각' : '가열'} 제어, 설정 ${sv}℃, 히스테리시스 ${hys}℃`, `ON/OFF ${p.tcMode === 'cool' ? 'cooling' : 'heating'}, set ${sv}℃, hysteresis ${hys}℃`),
          typeof p.alarm === 'number' ? tr(`경보 ${p.alarm}℃`, `alarm ${p.alarm}℃`) : '',
          tr('릴레이 출력 OUT · AL, 센서 K (CA)', 'relay outputs OUT, AL, K thermocouple'),
        ]
          .filter(Boolean)
          .join(', '),
      };
    }
    case 'r_thermo': {
      const { sv, hys } = tempSetting(p);
      return { kind: tr('판넬 서모스탯 (바이메탈)', 'Panel thermostat (bimetal)'), spec: tr(`${p.ncOut ? 'NC (히터용, 오르면 열림)' : 'NO (팬용, 오르면 닫힘)'}, 설정 ${sv}℃, 차 ${hys}℃, AC 250V`, `${p.ncOut ? 'NC (heater, opens on rise)' : 'NO (fan, closes on rise)'}, set ${sv}℃, diff. ${hys}℃, AC 250V`) };
    }
    case 'r_estop':
      return { kind: tr('비상정지 스위치', 'Emergency stop'), spec: [tr('적색 버섯, 잠김', 'red mushroom, latching'), ab].join(', ') };
    case 'r_tb':
      return { kind: tr('단자대', 'Terminal block'), spec: `${tbSize(p)}P` };
    case 'r_tsw': {
      const on = tswSched(p)
        .map(([s, e]) => `${formatClock(s)}~${formatClock(e)}`)
        .join(', ');
      return { kind: tr('24시간 타임 스위치 (다이얼식)', '24-hour dial time switch'), spec: [tr('AC 220V, 접점 1c', 'AC 220V, 1 c/o contact'), on ? `ON ${on}` : ''].filter(Boolean).join(', ') };
    }
    case 'r_light':
      return { kind: tr('전등', 'Light'), spec: 'AC 220V' };
    case 'r_sw':
      return { kind: tr('스위치 (단로)', 'Switch (1-way)'), spec: '' };
    case 'r_sw3':
      return { kind: tr('3로 스위치', '3-way switch'), spec: '' };
    case 'r_load1':
    case 'r_load3': {
      const r = loadRating(p);
      return { kind: tr('부하', 'Load'), spec: `${p.type === 'r_load3' ? tr('3상', '3-phase') : tr('단상', '1-phase')} ${r ? Math.round(r.out / 10) / 100 : 0} kW, pf ${r?.pf ?? 1}` };
    }
    case 'r_panel':
      return { kind: tr('분전반 · 변전함', 'Panel / switchboard'), spec: '' };
    case 'fuse3':
    case 'fuse':
      return { kind: tr('퓨즈', 'Fuse'), spec: p.type === 'fuse3' ? '3P' : '1P' };
    case 'ol3':
      return { kind: tr('열동형 과부하 계전기', 'Thermal overload relay'), spec: ab ? tr(`보조 ${ab}`, `aux ${ab}`) : '' };
    case 'lamp':
      return { kind: tr('파일럿 램프', 'Pilot lamp'), spec: lampColorName(p.color) };
    case 'buzzer':
      return { kind: tr('부저', 'Buzzer'), spec: '' };
    case 'motor3':
      return { kind: tr('3상 유도 전동기', '3-phase induction motor'), spec: '' };
    case 'motor':
      return { kind: tr('전동기', 'Motor'), spec: '' };
    case 'load':
      return { kind: tr('부하 (히터 등)', 'Load (heater …)'), spec: p.watt ? `${p.watt >= 1000 ? `${p.watt / 1000} kW` : `${p.watt} W`}` : '' };
    case 'sol': {
      const cyl = c.parts.find((x) => x.type === 'cyl' && (normTag(x.solPlus ?? '') === normTag(tag) || normTag(x.solMinus ?? '') === normTag(tag)));
      return { kind: tr('솔레노이드 밸브', 'Solenoid valve'), spec: cyl ? `${cyl.tag} ${normTag(cyl.solPlus ?? '') === normTag(tag) ? tr('전진', 'advance') : tr('후진', 'return')}` : '' };
    }
    case 'cyl':
      return { kind: tr('공압 실린더', 'Pneumatic cylinder'), spec: `${p.solMinus?.trim() ? tr('복동', 'double-acting') : tr('단동 (스프링 복귀)', 'single-acting')}, ${tr('전진', 'adv')} ${formatTime(p.stroke ?? 1000, 's')}` };
    case 'plc': {
      const { ins, outs } = plcAddresses(p);
      return { kind: 'PLC', spec: tr(`입력 8 (${ins[0]}~${ins[7]}) · 릴레이 출력 8 (${outs[0]}~${outs[7]})`, `8 in (${ins[0]}–${ins[7]}) · 8 relay out (${outs[0]}–${outs[7]})`) };
    }
    case 'r_plc': {
      const { ins, outs } = plcAddresses(p);
      return {
        kind: tr('PLC (CPU 일체형)', 'PLC (compact CPU)'),
        spec: tr(`전원 DC 24V, 입력 16 (${ins[0]}~${ins[15]}, DC 24V 싱크/소스) · 릴레이 출력 16 (${outs[0]}~${outs[15]}, 2A, 8점/COM)`, `24 V DC supply, 16 in (${ins[0]}–${ins[15]}, 24 V DC sink/source) · 16 relay out (${outs[0]}–${outs[15]}, 2 A, 8 points/COM)`) + (p.name ? `, ${p.name}` : ''),
      };
    }
    case 'r_hmi':
      return { kind: tr('HMI (터치 판넬)', 'HMI (touch panel)'), spec: tr(`전원 DC 24V, 버튼 ${(p.hmi ?? []).filter((x) => x.kind !== 'lamp').length} · 램프 ${(p.hmi ?? []).filter((x) => x.kind === 'lamp').length}, PLC 통신`, `24 V DC, ${(p.hmi ?? []).filter((x) => x.kind !== 'lamp').length} buttons · ${(p.hmi ?? []).filter((x) => x.kind === 'lamp').length} lamps, PLC link`) + (p.name ? `, ${p.name}` : '') };
    default:
      return { kind: partKindName(p.type), spec: ab };
  }
}

/** 회로도 → 부품 리스트 (기호마다 한 줄) */
export function partsList(c: Circuit): BomRow[] {
  const groups = new Map<string, Part[]>();
  // 밸브에 붙은 솔레노이드는 밸브 한 줄에 함께 적는다
  const valveSols = new Set(c.parts.filter((p) => VALVES.has(p.type)).flatMap((p) => [normTag(p.solA ?? ''), p.type === 'v52d' || p.type === 'v53' ? normTag(p.solB ?? '') : '']).filter(Boolean));
  for (const p of c.parts) {
    if (p.type === 'src' || p.type === 'src3' || p.type === 'text' || p.type === 'air' || p.type === 'r_term') continue;
    if ((p.type === 'sol' || p.type === 'r_sol') && valveSols.has(normTag(p.tag))) continue;
    const k = tagKey(p);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const rows: BomRow[] = [];
  for (const [k, parts] of groups) {
    const main = mainOf(parts);
    // 실물 기기는 몸 안의 보조 접점(1a1b)도 센다
    const inside = parts.reduce((n, p) => n + (p.type === 'r_my4' ? 4 : p.type === 'r_relay8' || p.type === 'r_timer8' || p.type === 'r_my2' ? 2 : p.type === 'r_ls' || p.type === 'r_fsw' || p.type === 'r_float' || p.type === 'r_psw' || p.type === 'r_pbl' || p.type === 'r_mc' || p.type === 'r_pb' || p.type === 'r_thr' || p.type === 'r_ss' || p.type === 'r_estop' || p.type === 'r_counter' ? 1 : 0), 0);
    const a = parts.filter((p) => CONTACT_A.has(p.type)).length + inside;
    const b = parts.filter((p) => CONTACT_B.has(p.type)).length + inside;
    const poles = (parts.filter((p) => p.type === 'km3').length + parts.filter((p) => p.type === 'r_mc').length) * 3;
    const ks = kindAndSpec(c, k, main, a, b, poles);
    const named = parts.find((p) => p.name?.trim());
    // 소켓에 꽂는 기기는 사양을 따로 적어도 소켓이 빠지지 않게 (함께 사야 한다)
    const spec = [parts.find((p) => p.spec?.trim())?.spec?.trim() ?? ks.spec, socketText(main)].filter(Boolean).join(', ');
    rows.push({ tag: main.tag.trim(), kind: ks.kind, name: named?.name?.trim() ?? '', spec, a, b, main: poles, count: parts.length, cat: CAT_ORDER[main.type] ?? 20 });
  }
  return rows.sort((x, y) => x.cat - y.cat || compareTags(x.tag, y.tag));
}

/** 같은 품명·사양끼리 수량 집계 (구매용) */
export function bomSummary(rows: BomRow[]): BomSummary[] {
  const m = new Map<string, BomSummary>();
  for (const r of rows) {
    const k = `${r.kind}\u0000${r.spec}`;
    const s = m.get(k) ?? { kind: r.kind, spec: r.spec, qty: 0, tags: [] };
    s.qty++;
    if (r.tag) s.tags.push(r.tag);
    m.set(k, s);
  }
  return [...m.values()];
}

export function contactsLabel(r: BomRow): string {
  return [r.main ? tr(`주 ${r.main}P`, `${r.main}P`) : '', contactText(r.a, r.b)].filter(Boolean).join(' · ');
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 엑셀용 CSV (UTF-8 BOM): 기기별 목록 + 수량 집계 */
export function bomCsv(c: Circuit): string {
  const rows = partsList(c);
  const line = (cells: unknown[]) => cells.map(csvCell).join(',');
  const out = [line([tr('기호', 'Tag'), tr('품명', 'Item'), tr('설명', 'Description'), tr('사양', 'Spec'), tr('접점', 'Contacts'), tr('수량', 'Qty')])];
  for (const r of rows) out.push(line([r.tag, r.kind, r.name, r.spec, contactsLabel(r), 1]));
  out.push('');
  out.push(line([tr('품명', 'Item'), tr('사양', 'Spec'), tr('수량', 'Qty'), tr('기호', 'Tags')]));
  for (const s of bomSummary(rows)) out.push(line([s.kind, s.spec, s.qty, s.tags.join(' ')]));
  return '﻿' + out.join('\r\n') + '\r\n';
}

// ───────────────────────── 검사 ─────────────────────────

export interface CircuitIssue {
  level: 'error' | 'warn';
  msg: string;
  /** 표시할 전선 (배선 검사) */
  wireIds?: string[];
  /** 표시할 부품 */
  partIds: string[];
}

/** 그리다 놓치기 쉬운 것: 코일 없는 접점, 겹친 코일, 떠 있는 단자, 바로 이어진 단자 */
export function checkCircuit(c: Circuit, model: CircuitModel = new CircuitModel(c)): CircuitIssue[] {
  const out: CircuitIssue[] = [];
  const kinds = model.tagKind;
  // 기기만 놓은 실물 배선도: 선을 긋기 전에는 떠 있는 단자 검사가 모두 걸리므로 안내 하나만
  const planned = planLeft(c, model);
  if (planned)
    return [
      {
        level: 'warn',
        msg: tr(`아직 배선 전입니다: 이을 연결 ${planned}개가 점선으로 남아 있습니다. 기기를 판넬 자리에 놓은 뒤 위쪽 [배선 잇기] 를 누르세요 (그 전에는 다른 검사를 하지 않음)`, `Not wired yet: ${planned} planned connection(s) are dashed. Arrange the devices and press [Wire up] (other checks wait until then)`),
        partIds: [],
      },
    ];
  // 접점 번호: 같은 기호에서 두 번 쓴 번호, 실물 기기에 맞출 수 없는 번호
  const seen = new Map<string, Part>();
  for (const p of c.parts) {
    if (p.type !== 'no' && p.type !== 'nc') continue;
    const t = parseTerm(p.term);
    if (!t) continue;
    const key = `${tagKey(p)}|${[...t].sort().join('-')}`;
    const prev = seen.get(key);
    if (prev) out.push({ level: 'warn', msg: tr(`${p.tag}: 접점 번호 ${p.term} 을(를) 두 접점에 적었습니다. 한 단자에 두 접점을 물릴 수 없으니 하나를 고치세요`, `${p.tag}: contact number ${p.term} is used twice`), partIds: [prev.id, p.id] });
    else seen.set(key, p);
  }
  for (const plan of contactNumbers(c, model).plans.values()) {
    if (!plan.bad.length) continue;
    const ch = termChoices(plan.type);
    out.push({
      level: 'warn',
      msg: tr(
        `${model.label(plan.tag)}: 접점 번호 ${plan.bad.map((p) => `${p.term} (${PARTS[p.type].nc ? 'b' : 'a'})`).join(', ')} 은(는) ${partKindName(plan.type)} 에 맞지 않아 [실물 배선도 만들기] 가 자동으로 정합니다. 쓸 수 있는 번호: a접점 ${ch.no.join(' · ')}, b접점 ${ch.nc.join(' · ')} (a 와 b 가 한 쌍이면 공통 단자의 넷이 같아야 함)`,
        `${model.label(plan.tag)}: contact numbers ${plan.bad.map((p) => p.term).join(', ')} do not fit ${partKindName(plan.type)}; they will be assigned automatically. Valid: NO ${ch.no.join(', ')}, NC ${ch.nc.join(', ')}`,
      ),
      partIds: plan.bad.map((p) => p.id),
    });
  }
  for (const p of c.parts) {
    if ((p.type === 'no' || p.type === 'nc' || p.type === 'km3') && !kinds.has(tagKey(p))) {
      out.push({ level: 'error', msg: p.tag.trim() ? tr(`접점 ${p.tag}: 같은 기호의 코일·타이머·스위치가 없습니다`, `Contact ${p.tag}: no coil, timer or switch with this tag`) : tr('기호가 없는 접점이 있습니다', 'A contact has no tag'), partIds: [p.id] });
    }
    if ((p.type === 'ls_no' || p.type === 'ls_nc') && p.cyl && !model.cylDef.has(normTag(p.cyl))) {
      out.push({ level: 'error', msg: tr(`${p.tag || 'LS'}: 실린더 ${p.cyl} 이(가) 없습니다`, `${p.tag || 'LS'}: cylinder ${p.cyl} not found`), partIds: [p.id] });
    }
    if (isTempDevice(p) && p.tLoad?.trim() && !model.loadParts.has(normTag(p.tLoad))) {
      out.push({ level: 'error', msg: tr(`${p.tag || 'TC'}: 온도를 바꾸는 부하 ${p.tLoad} 이(가) 회로에 없습니다`, `${p.tag || 'TC'}: load ${p.tLoad} not in the circuit`), partIds: [p.id] });
    }
    if (p.type === 'r_tc' && typeof p.alarm === 'number' && p.alarm <= tempSetting(p).sv && p.tcMode !== 'cool') {
      out.push({ level: 'warn', msg: tr(`${p.tag || 'TC'}: 경보 온도 ${p.alarm}℃ 가 설정 ${tempSetting(p).sv}℃ 이하라 평소 운전에서도 경보가 납니다`, `${p.tag || 'TC'}: alarm ${p.alarm}℃ is not above the set point`), partIds: [p.id] });
    }
    if (p.type === 'cyl') {
      if (!p.tag.trim()) out.push({ level: 'error', msg: tr('기호가 없는 실린더가 있습니다', 'A cylinder has no tag'), partIds: [p.id] });
      for (const s of [p.solPlus, p.solMinus]) {
        if (s?.trim() && !model.loadParts.has(normTag(s))) out.push({ level: 'error', msg: tr(`${p.tag}: 솔레노이드 ${s} 이(가) 회로에 없습니다`, `${p.tag}: solenoid ${s} not in the circuit`), partIds: [p.id] });
      }
      if (!p.solPlus?.trim() && !airDriven(model, tagKey(p))) out.push({ level: 'warn', msg: tr(`${p.tag}: 배관을 잇거나 전진 솔레노이드를 정하세요`, `${p.tag}: connect air tubes or choose the advance solenoid`), partIds: [p.id] });
    }
  }
  for (const [tag, ids] of [...model.coilParts, ...model.timerParts]) {
    if (ids.length > 1) out.push({ level: 'error', msg: tr(`코일 ${model.label(tag)} 이(가) ${ids.length}개 있습니다 (기호가 겹침)`, `Coil ${model.label(tag)} appears ${ids.length} times`), partIds: ids });
  }
  for (const p of c.parts) {
    const pins = PARTS[p.type].pins;
    // 단자가 많은 실물 기기는 안 쓰는 단자(예비 접점, 남는 극)가 있는 게 보통
    if (!pins.length || p.type === 'src' || p.type === 'plc' || p.type === 'cyl' || (REAL.has(p.type) && p.type !== 'r_lamp' && p.type !== 'r_light' && p.type !== 'r_sw')) continue;
    const nets = pins.map((_, i) => model.net.pinNet.get(`${p.id}:${i}`)!);
    // 공압 포트는 안 쓰는 것이 있어도 정상 (5/2 밸브로 단동 실린더 등)
    const floating = nets.filter((n, i) => !pins[i].air && model.net.pinCount[n] <= 1 && !model.net.hasWire[n]).length;
    if (floating) out.push({ level: 'warn', msg: tr(`${p.tag || partKindName(p.type)}: 이어지지 않은 단자 ${floating}개`, `${p.tag || partKindName(p.type)}: ${floating} unconnected terminal(s)`), partIds: [p.id] });
    const poles = PARTS[p.type].poles ?? (PARTS[p.type].load && nets.length === 2 ? ([[0, 1]] as [number, number][]) : []);
    if (poles.some(([i, j]) => nets[i] === nets[j])) out.push({ level: 'warn', msg: tr(`${p.tag || partKindName(p.type)}: 두 단자가 선으로 바로 이어져 있습니다`, `${p.tag || partKindName(p.type)}: both terminals are wired together`), partIds: [p.id] });
  }
  // 공압: 전기 단자와 배관이 섞임, 밸브 솔레노이드, 공급 포트
  const airIds = new Map<number, string[]>();
  const elecIds = new Map<number, string[]>();
  for (const p of c.parts) {
    partPins(p).forEach((pin, i) => {
      const n = model.net.pinNet.get(`${p.id}:${i}`)!;
      const m = pin.air ? airIds : elecIds;
      m.set(n, [...(m.get(n) ?? []), p.id]);
    });
  }
  for (const [n, ids] of airIds) {
    if (elecIds.has(n)) out.push({ level: 'error', msg: tr('공압 포트와 전기 단자가 같은 선으로 이어졌습니다', 'An air port is wired to an electrical terminal'), partIds: [...ids, ...elecIds.get(n)!] });
  }
  const fed = new Set<number>();
  {
    const parent = new Map<number, number>();
    const find = (i: number): number => {
      const p = parent.get(i);
      if (p === undefined || p === i) return i;
      const r = find(p);
      parent.set(i, r);
      return r;
    };
    for (const [a, b] of model.airAlways) parent.set(find(a), find(b));
    const src = new Set(model.airSrc.map(find));
    for (const v of model.valves) {
      const pIdx = v.part.type === 'v32' ? 1 : 2;
      if (src.has(find(v.ports[pIdx]))) fed.add(v.ports[pIdx]);
    }
  }
  for (const v of model.valves) {
    const p = v.part;
    const name = p.tag || partKindName(p.type);
    const pIdx = p.type === 'v32' ? 1 : 2;
    if (!fed.has(v.ports[pIdx])) out.push({ level: 'warn', msg: tr(`${name}: 공급 포트(1)에 공압원이 이어지지 않았습니다`, `${name}: no air supply on port 1`), partIds: [p.id] });
    if (!p.solA?.trim()) out.push({ level: 'warn', msg: tr(`${name}: 솔레노이드 기호를 정하세요`, `${name}: choose its solenoid`), partIds: [p.id] });
    for (const s of [p.solA, p.type === 'v52d' || p.type === 'v53' ? p.solB : undefined]) {
      if (s?.trim() && !model.loadParts.has(normTag(s))) out.push({ level: 'error', msg: tr(`${name}: 솔레노이드 ${s} 이(가) 회로에 없습니다`, `${name}: solenoid ${s} not in the circuit`), partIds: [p.id] });
    }
  }
  // 타임 스위치: 시계 전원, 설정
  for (const d of model.tswDef.values()) {
    const p = d.part;
    const wired = (n: number) => model.net.pinCount[n] > 1 || model.net.hasWire[n];
    if (!wired(d.l) || !wired(d.n)) out.push({ level: 'warn', msg: tr(`${p.tag}: 시계 전원 L · N 을 이어야 다이얼이 돕니다`, `${p.tag}: wire L and N so the dial runs`), partIds: [p.id] });
    if (!d.sched.some(([a, b]) => a !== b)) out.push({ level: 'warn', msg: tr(`${p.tag}: 켜지는 시각을 정하세요`, `${p.tag}: set the ON periods`), partIds: [p.id] });
  }
  const plcParts = c.parts.filter((p) => isPlcPart(p) || p.type === 'r_hmi').map((p) => p.id);
  for (const msg of model.plcIssues) out.push({ level: model.prog ? 'error' : 'warn', msg, partIds: plcParts });
  if (c.parts.some((p) => partPins(p).length) && !c.parts.some((p) => p.type === 'src' || p.type === 'src3' || p.type === 'r_term' || p.type === 'r_kepco')) {
    out.push({ level: 'error', msg: tr('전원(L·N, +24V·0V, 3상)이 없습니다', 'No supply (L/N, +24V/0V or 3-phase)'), partIds: [] });
  }
  // 전원 계통에 없는 극 (3상 3선식의 N 등) 은 전압이 없다
  out.push(...supplyProblems(c));
  // 배선 검사: 선 빠짐 · 전압 불일치 · 단락 · 접지 · 전선 색 …
  out.push(...verifyWiring(c, model));
  return out;
}
