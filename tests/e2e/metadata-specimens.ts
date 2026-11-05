/**
 * get_metadata の検体（#42）を、その場でバイト列から組み立てる。
 *
 * 文書情報辞書の有無・XMP の書き方（`rdf:Alt`・`rdf:Seq`・属性の形）・ヘッダーの版を
 * 1 つずつ変えたいので、生成器ではなく小さな組み立て関数にした。xref の位置は数えて書く。
 */

export interface MetadataSpecimen {
  /** ヘッダーの版（`%PDF-<version>`）。 */
  version: '1.7' | '2.0';
  /** 文書情報辞書のキーと値（PDF の文字列リテラルの中身）。省くと /Info を書かない。 */
  info?: Record<string, string>;
  /** XMP の rdf:Description の中身。省くと /Metadata を書かない。 */
  xmp?: string;
}

const XMP_HEAD =
  '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"';
const XMP_TAIL = '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';

/** `xmp` は rdf:Description の開始タグの残り（属性と `>`）と中身。 */
export function xmpPacket(rest: string): string {
  return `${XMP_HEAD}${rest}${XMP_TAIL}`;
}

export function buildMetadataPdf(spec: MetadataSpecimen): Buffer {
  const objects: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
    return objects.length;
  };
  const catalog = add(''); // 後で書く
  const pages = add('');
  const page = add('');
  objects[pages - 1] = Buffer.from(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`, 'latin1');
  objects[page - 1] = Buffer.from(
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 200 200] >>`,
    'latin1',
  );
  let metadata = 0;
  if (spec.xmp !== undefined) {
    const xml = Buffer.from(xmpPacket(spec.xmp), 'utf8');
    metadata = add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /Metadata /Subtype /XML /Length ${xml.length} >>\nstream\n`,
          'latin1',
        ),
        xml,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  }
  objects[catalog - 1] = Buffer.from(
    `<< /Type /Catalog /Pages ${pages} 0 R${metadata ? ` /Metadata ${metadata} 0 R` : ''} >>`,
    'latin1',
  );
  let info = 0;
  if (spec.info) {
    const entries = Object.entries(spec.info)
      .map(([k, v]) => `/${k} (${v})`)
      .join(' ');
    info = add(`<< ${entries} >>`);
  }

  const chunks: Buffer[] = [Buffer.from(`%PDF-${spec.version}\n%\xE2\xE3\xCF\xD3\n`, 'latin1')];
  let offset = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    const obj = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
      body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    chunks.push(obj);
    offset += obj.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\n` +
    `startxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}
