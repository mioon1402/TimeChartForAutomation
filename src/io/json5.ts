/**
 * 느슨한 JSON 파서 (WaveDrom 소스용): 따옴표 없는 키, 작은따옴표 문자열,
 * 주석, 후행 콤마, 16진수 허용. eval 을 사용하지 않는다.
 */
export function parseLooseJson(src: string): unknown {
  let i = 0;
  const n = src.length;
  const err = (msg: string): never => {
    const line = src.slice(0, i).split('\n').length;
    throw new Error(`${msg} (줄 ${line})`);
  };
  const ws = () => {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src.startsWith('//', i)) {
        while (i < n && src[i] !== '\n') i++;
      } else if (src.startsWith('/*', i)) {
        const e = src.indexOf('*/', i + 2);
        i = e < 0 ? n : e + 2;
      } else return;
    }
  };
  const str = (q: string): string => {
    i++;
    let out = '';
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') {
        i++;
        const c = src[i];
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '0': '\0' };
        if (c === 'u') {
          out += String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16));
          i += 4;
        } else out += map[c] ?? c;
        i++;
      } else out += src[i++];
    }
    if (src[i] !== q) err('문자열이 닫히지 않았습니다');
    i++;
    return out;
  };
  const ident = (): string => {
    const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200));
    if (!m) err(`예상하지 못한 문자 '${src[i] ?? 'EOF'}'`);
    i += m![0].length;
    return m![0];
  };
  const value = (): unknown => {
    ws();
    const c = src[i];
    if (c === '{') {
      i++;
      const obj: Record<string, unknown> = {};
      ws();
      while (src[i] !== '}') {
        ws();
        const key = src[i] === '"' || src[i] === "'" ? str(src[i]) : ident();
        ws();
        if (src[i] !== ':') err("':' 가 필요합니다");
        i++;
        obj[key] = value();
        ws();
        if (src[i] === ',') {
          i++;
          ws();
        } else if (src[i] !== '}') err("',' 또는 '}' 가 필요합니다");
      }
      i++;
      return obj;
    }
    if (c === '[') {
      i++;
      const arr: unknown[] = [];
      ws();
      while (src[i] !== ']') {
        arr.push(value());
        ws();
        if (src[i] === ',') {
          i++;
          ws();
        } else if (src[i] !== ']') err("',' 또는 ']' 가 필요합니다");
      }
      i++;
      return arr;
    }
    if (c === '"' || c === "'") return str(c);
    const num = /^[-+]?(0x[0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)/.exec(src.slice(i, i + 64));
    if (num) {
      i += num[0].length;
      return num[1].startsWith('0x') ? parseInt(num[0], 16) : parseFloat(num[0]);
    }
    const id = ident();
    if (id === 'true') return true;
    if (id === 'false') return false;
    if (id === 'null') return null;
    return err(`알 수 없는 값 '${id}'`);
  };
  ws();
  const v = value();
  ws();
  if (i < n) err('JSON 뒤에 불필요한 내용이 있습니다');
  return v;
}
