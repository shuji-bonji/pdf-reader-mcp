/**
 * 子プロセスで `read_url` の取得を 1 回だけ行い、構造化エラーを JSON で標準出力に書く。
 *
 * `NODE_EXTRA_CA_CERTS` はプロセスの起動時にしか読まれないので、テスト用の CA を信頼させて
 * 名前の検査まで進めるには、別のプロセスが要る（SPEC-READER-COMMON-ERRORS-007）。
 */
import { fetchPdfFromUrlUnlimited } from '../../src/services/url-fetcher.js';
import { handleStructuredError } from '../../src/utils/error-handler.js';

try {
  await fetchPdfFromUrlUnlimited(process.argv[2] ?? '');
  process.stdout.write(JSON.stringify({ ok: true }));
} catch (error) {
  process.stdout.write(JSON.stringify(handleStructuredError(error)));
}
