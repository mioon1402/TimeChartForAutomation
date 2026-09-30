/**
 * 동작 순서 탭의 예시 설비 (직접 만든 일반적인 예, 고쳐서 쓰도록).
 */
import { defaultSpec, newAction, newDevice, type SeqAction, type SeqDevice, type SeqSpec } from './sequence';

export interface SeqExample {
  id: string;
  name: string;
  /** 무엇을 보여 주는 예인지 */
  note: string;
  build(): SeqSpec;
}

function spec(machine: string, devices: SeqDevice[], actions: SeqAction[], targetCycle = 0): SeqSpec {
  return { ...defaultSpec(), machine, devices, actions, targetCycle };
}

const go = (d: SeqDevice, withPrev = false) => newAction({ device: d.id, dir: 'fwd', withPrev });
const back = (d: SeqDevice, withPrev = false) => newAction({ device: d.id, dir: 'ret', withPrev });
const wait = (ms: number, label: string) => newAction({ device: '', wait: ms, label });

export function seqExamples(): SeqExample[] {
  return [
    {
      id: 'clamp-press',
      name: '클램프 → 프레스',
      note: '가장 기본: 가서 → 기다리고 → 거꾸로 돌아오기',
      build: () => defaultSpec(),
    },
    {
      id: 'press-fit',
      name: '압입 유닛 (흡착 · 동시 동작)',
      note: '흡착을 프레스 하강과 동시에, 목표 사이클 타임 4초',
      build: () => {
        const c = newDevice('cyl2', '클램프', { fwdTime: 400, retTime: 400 });
        const p = newDevice('cyl2', '프레스', { fwdLabel: '하강', retLabel: '상승', fwdTime: 800, retTime: 800 });
        const v = newDevice('vacuum', '진공', { fwdTime: 300, retTime: 200 });
        return spec('압입 유닛', [c, p, v], [go(c), go(p), go(v, true), wait(1200, '가압'), back(p), back(v), back(c)], 4000);
      },
    },
    {
      id: 'pick-place',
      name: '픽앤플레이스 (Z · 흡착 · Y)',
      note: '흡착 확인 센서가 있는 8단계 이송',
      build: () => {
        const z = newDevice('cyl2', 'Z축', { fwdLabel: '하강', retLabel: '상승', fwdTime: 400, retTime: 400 });
        const v = newDevice('vacuum', '흡착', { fwdTime: 300, retTime: 200 });
        const y = newDevice('cyl2', 'Y축', { fwdTime: 800, retTime: 800 });
        return spec('픽앤플레이스', [z, v, y], [go(z), go(v), back(z), go(y), go(z), back(v), back(z), back(y)], 5000);
      },
    },
    {
      id: 'drill',
      name: '드릴 가공 (모터 + 실린더)',
      note: '센서 없는 모터 출력, 모터 기동과 드릴 하강 동시',
      build: () => {
        const c = newDevice('cyl2', '클램프', { fwdTime: 500, retTime: 500 });
        const m = newDevice('motor', '드릴 모터');
        const d = newDevice('cyl2', '드릴', { fwdLabel: '하강', retLabel: '상승', fwdTime: 700, retTime: 500 });
        return spec('드릴 가공 유닛', [c, m, d], [go(c), go(m), go(d, true), wait(1000, '가공'), back(d), back(m), back(c, true)]);
      },
    },
    {
      id: 'stopper-pusher',
      name: '컨베이어 배출 (스토퍼 · 푸셔)',
      note: '싱글 SOL 스토퍼로 제품을 세우고 푸셔로 밀어내기',
      build: () => {
        const s = newDevice('cyl1', '스토퍼', { fwdLabel: '상승', retLabel: '하강', fwdTime: 300, retTime: 250 });
        const p = newDevice('cyl2', '푸셔', { fwdTime: 600, retTime: 500 });
        return spec('컨베이어 배출', [s, p], [go(s), wait(800, '제품 도착'), go(p), back(p), back(s)]);
      },
    },
    {
      id: 'two-clamps',
      name: '양쪽 클램프 · 용접',
      note: '좌우 클램프 동시 동작: 늦게 도착하는 쪽을 기다림',
      build: () => {
        const l = newDevice('cyl2', '좌 클램프', { fwdTime: 500, retTime: 500 });
        const r = newDevice('cyl2', '우 클램프', { fwdTime: 700, retTime: 600 });
        return spec('용접 지그', [l, r], [go(l), go(r, true), wait(1500, '용접'), back(l), back(r, true)]);
      },
    },
  ];
}
