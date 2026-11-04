// JPEG EXIF 에서 35mm 환산 초점거리(FocalLengthIn35mmFilm, 0xA405)만 읽는 최소 파서.
// 라이브러리 없이 수십 줄로 충분하고, 사진은 서버로 보내지 않고 기기 안에서만 읽는다.

export interface ExifInfo {
  focal35?: number;
  model?: string;
}

export function readExif(buf: ArrayBuffer): ExifInfo {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {};
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    const size = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966) {
      return parseTiff(v, off + 10, Math.min(v.byteLength, off + 2 + size));
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // SOS 이후는 이미지 데이터
    off += 2 + size;
  }
  return {};
}

function parseTiff(v: DataView, start: number, end: number): ExifInfo {
  const bo = v.getUint16(start);
  const le = bo === 0x4949;
  if (!le && bo !== 0x4d4d) return {};
  const u16 = (o: number) => v.getUint16(start + o, le);
  const u32 = (o: number) => v.getUint32(start + o, le);
  const inRange = (o: number, n: number) => start + o + n <= end;
  const out: ExifInfo = {};

  const readIfd = (ifdOff: number, onTag: (tag: number, type: number, count: number, valOff: number) => void) => {
    if (!inRange(ifdOff, 2)) return;
    const n = u16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      if (!inRange(e, 12)) return;
      onTag(u16(e), u16(e + 2), u32(e + 4), e + 8);
    }
  };

  let exifPtr = 0;
  readIfd(u32(4), (tag, type, count, valOff) => {
    if (tag === 0x8769) exifPtr = u32(valOff);
    if (tag === 0x0110 && type === 2) {
      const strOff = count > 4 ? u32(valOff) : valOff;
      if (inRange(strOff, count)) {
        let s = '';
        for (let i = 0; i < count - 1; i++) s += String.fromCharCode(v.getUint8(start + strOff + i));
        out.model = s.trim();
      }
    }
  });
  if (exifPtr) {
    readIfd(exifPtr, (tag, type, _count, valOff) => {
      if (tag === 0xa405 && type === 3) {
        const f = u16(valOff);
        if (f > 0) out.focal35 = f;
      }
    });
  }
  return out;
}
