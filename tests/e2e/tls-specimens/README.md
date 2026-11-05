# TLS の検体

`19-read-url-network-errors.test.ts`（SPEC-READER-COMMON-ERRORS-007）が 127.0.0.1 に HTTPS サーバーを立てるための証明書です。テストのためだけのもので、鍵はどこでも使っていません。2026-11-05 に OpenSSL 3.0 で作りました。

| ファイル | 中身 |
| --- | --- |
| `ca.pem` | テスト用の CA（2126 年まで） |
| `self-signed.pem` / `.key` | 自己署名、SAN は IP 127.0.0.1（2126 年まで） |
| `expired.pem` / `.key` | `ca.pem` で署名、SAN は IP 127.0.0.1、有効期間は 2020-01-01〜2021-01-01 |
| `wrong-name.pem` / `.key` | `ca.pem` で署名、SAN は DNS example.invalid だけ（2126 年まで） |
