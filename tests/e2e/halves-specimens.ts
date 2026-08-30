/**
 * 「抽出」と「観測」が別々に成功・失敗する 4 通りの検体（#26）。
 *
 * バイト列をここに置いてあるのは、この 4 通りを試験に持たせるためである。
 * 3 件は手で組み立てられるが、fail/ok を立てるには利用者パスワードの付いた文書が要り、
 * それには暗号化の実装（qpdf）が要る。CI に qpdf を要求するより、
 * バイト列を置くほうがこの試験の意図に忠実になる —— **試験が飛ばされない。**
 *
 * 生成元: scripts/golden-specimens-halves.mjs（.golden/specimens/ に同じものを書く）。
 * 🔴 sha が合わなくなったら、生成元を変えたということ。試験がそう言う。
 */

export interface HalvesSpecimen {
  /** ファイル名（生成元と .golden/specimens/ でのもの）。 */
  name: string;
  /** 何を測る検体か。 */
  note: string;
  /** バイト列の sha256（先頭 32 桁）。 */
  sha256: string;
  /** バイト列そのもの。 */
  base64: string;
}

export const HALVES_SPECIMENS = {
  okOk: {
    name: 'halves-ok-ok-page2-unobserved.pdf',
    note: '2 ページ目の内容ストリームが /FlateDecode を名乗って deflate ではない。抽出は 1 ページ目の文字を返し、観測は 2 ページ目を not_observed と言う',
    sha256: 'ffd6e5b0a63087a87d0443911f95beaf',
    base64:
      'JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUiA1IDAgUl0gL0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA3IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0OSA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDcyIDcyMCBUZCAoUGFnZSBvbmUgaGFzIHRleHQpIFRqIEVUCgplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA3IDAgUiA+PiA+PiAvQ29udGVudHMgNiAwIFIgPj4KZW5kb2JqCjYgMCBvYmoKPDwgL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0xlbmd0aCAyMyA+PgpzdHJlYW0Kbm90LWRlZmxhdGUtZGF0YS1hdC1hbGwKZW5kc3RyZWFtCmVuZG9iago3IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyNyAwMDAwMCBuIAowMDAwMDAwMjUzIDAwMDAwIG4gCjAwMDAwMDAzNTIgMDAwMDAgbiAKMDAwMDAwMDQ3OCAwMDAwMCBuIAowMDAwMDAwNTcyIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgOCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNjQyCiUlRU9GCg==',
  },
  okFail: {
    name: 'halves-ok-fail-header.pdf',
    note: 'ヘッダが "%PDF-" で版が無い（§7.5.2）。pdfjs は読み進めるが、pdf-lib は版の数を読もうとして止まる',
    sha256: '1ea2bc609416ad1875f13b841bb919fa',
    base64:
      'JVBERi0KJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1OSA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDcyIDcyMCBUZCAoT25lIHBhZ2Ugd2l0aCByZWFkYWJsZSB0ZXh0KSBUaiBFVAoKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEyIDAwMDAwIG4gCjAwMDAwMDAwNjEgMDAwMDAgbiAKMDAwMDAwMDExOCAwMDAwMCBuIAowMDAwMDAwMjQ0IDAwMDAwIG4gCjAwMDAwMDAzNTMgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MjMKJSVFT0YK',
  },
  failOk: {
    name: 'halves-fail-ok-password.pdf',
    note: '空でない利用者パスワードが設定されている（/V 2 /R 3・RC4 128）。§7.6.4.3.2 のとおり鍵が導けないので pdfjs は開けない。pdf-lib は ignoreEncryption で構造を歩く',
    sha256: '600979071ac725c14ce803bad7b17430',
    base64:
      'JVBERi0xLjcKJb/3ov4KMSAwIG9iago8PCAvUGFnZXMgMiAwIFIgL1R5cGUgL0NhdGFsb2cgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcyA+PgplbmRvYmoKMyAwIG9iago8PCAvQ29udGVudHMgNCAwIFIgL01lZGlhQm94IFsgMCAwIDU5NSA4NDIgXSAvUGFyZW50IDIgMCBSIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgL0YxIDUgMCBSID4+ID4+IC9UeXBlIC9QYWdlID4+CmVuZG9iago0IDAgb2JqCjw8IC9MZW5ndGggNjUgL0ZpbHRlciAvRmxhdGVEZWNvZGUgPj4Kc3RyZWFtCrce4tXxLn+U0PwplZNqM42P0db8GIKBO/oVNVJECOZhpjVD0ay8x2y1FwNMvvBW/kIVeO2ndXVJTJmYwMXX02udZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9CYXNlRm9udCAvSGVsdmV0aWNhIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udCA+PgplbmRvYmoKNiAwIG9iago8PCAvRmlsdGVyIC9TdGFuZGFyZCAvTGVuZ3RoIDEyOCAvTyA8Mzg0YTE2ZGJjNDIyMTYzZTE3NGEyNjhhOGMwODNjOTg3YTlkNWY0ZTQ5NWQwMzUyMzYzOTBiZDYxOTlmOGQzND4gL1AgLTQgL1IgMyAvVSA8MDYyOTFmNjZmOTcyM2ViMGU3ODM5M2RhODJiNmQwOWYwMTIyNDU2YTkxYmFlNTEzNDI3M2E2ZGIxMzRjODdjND4gL1YgMiA+PgplbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMyAwMDAwMCBuIAowMDAwMDAwMjUxIDAwMDAwIG4gCjAwMDAwMDAzODYgMDAwMDAgbiAKMDAwMDAwMDQ1NiAwMDAwMCBuIAp0cmFpbGVyIDw8IC9Sb290IDEgMCBSIC9TaXplIDcgL0lEIFs8MzE0MTU5MjY1MzU4OTc5MzIzODQ2MjY0MzM4MzI3OTU+PDMxNDE1OTI2NTM1ODk3OTMyMzg0NjI2NDMzODMyNzk1Pl0gL0VuY3J5cHQgNiAwIFIgPj4Kc3RhcnR4cmVmCjY2MwolJUVPRgo=',
  },
  failFail: {
    name: 'halves-fail-fail-no-objects.pdf',
    note: '%PDF- が無く、間接オブジェクトも 1 つも無い。どちらの読み手も開けない',
    sha256: '5aa1144699b1ffe99640b53a53bd431b',
    base64:
      'JSFOb3QtQS1QREYtQXQtQWxsClRoaXMgZmlsZSBoYXMgbm8gUERGIGhlYWRlciBhbmQgbm8gaW5kaXJlY3Qgb2JqZWN0cy4KVGhlcmUgaXMgbm90aGluZyBoZXJlIGZvciBlaXRoZXIgcmVhZGVyIHRvIHJlY29uc3RydWN0Lgo=',
  },
} satisfies Record<string, HalvesSpecimen>;
