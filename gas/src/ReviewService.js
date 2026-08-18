/**
 * レビュー対象データの読み取りサービス
 *
 * レビュー対象は、バッチ（USE_TEST_MODE=FALSE の差分チェックモード）が
 * レビューシートに追記した「J-STAGE 差分の修正案」行。
 */

/**
 * シートの全値を読み込み、ヘッダーとデータ行に分けて返す
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @returns {{headers: string[], rows: Array.<Array.<*>>, colIndex: Object.<string, number>}}
 */
function readSheet(spreadsheetId, sheetName) {
  var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('スプレッドシート ' + spreadsheetId + ' にシート "' + sheetName + '" が見つかりません');
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol === 0) {
    return { headers: [], rows: [], colIndex: {} };
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var headers = values[0];
  return {
    headers: headers,
    rows: values.slice(1),
    colIndex: buildColumnIndex(headers),
  };
}

/**
 * レビューシートのヘッダーが想定どおりか検証する
 * @param {string[]} headers - レビューシートの実際のヘッダー行
 * @returns {{ok: boolean, missing: string[], unexpected: string[]}}
 */
function verifyReviewSheetHeaders(headers) {
  var actual = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i] || '').trim();
    if (name) actual[name] = true;
  }

  var missing = REVIEW_SHEET_COLUMNS.filter(function (col) { return !actual[col]; });
  var expected = {};
  REVIEW_SHEET_COLUMNS.forEach(function (col) { expected[col] = true; });
  var unexpected = Object.keys(actual).filter(function (col) { return !expected[col]; });

  return { ok: missing.length === 0, missing: missing, unexpected: unexpected };
}

/**
 * 接続確認：config・レビューシート・本番シートに到達できるかを検査して結果を返す
 *
 * Web アプリの「接続確認」ボタンおよび開発時の単体実行から呼ばれる。
 * @returns {object} 画面表示用の診断結果
 */
function getHealthCheck() {
  var result = {
    checkedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    user: getActiveUserEmail(),
    ok: false,
    steps: [],
  };

  function step(name, fn) {
    try {
      var detail = fn();
      result.steps.push({ name: name, status: 'OK', detail: detail });
      return detail;
    } catch (e) {
      result.steps.push({ name: name, status: 'NG', detail: e.message });
      throw e;
    }
  }

  /** 失敗しても全体を止めない検査（未設定・任意項目むけ） */
  function optionalStep(name, fn) {
    try {
      result.steps.push({ name: name, status: 'OK', detail: fn() });
    } catch (e) {
      result.steps.push({ name: name, status: 'WARN', detail: e.message });
    }
  }

  try {
    var refs = step('config シート読み込み', function () {
      var r = getSheetRefs();
      return 'レビューシート: ' + r.reviewSheetName + ' / 本番シート: ' + r.scpjSheetName;
    });

    step('レビューシート読み込み', function () {
      var t = readSheet(refs.reviewSheetId, refs.reviewSheetName);
      return 'データ行数: ' + t.rows.length + ' 行 / 列数: ' + t.headers.length;
    });

    step('レビューシート列定義の検証', function () {
      var t = readSheet(refs.reviewSheetId, refs.reviewSheetName);
      var v = verifyReviewSheetHeaders(t.headers);
      if (!v.ok) throw new Error('不足している列: ' + v.missing.join(', '));
      return v.unexpected.length > 0
        ? '想定どおり（定義外の列あり: ' + v.unexpected.join(', ') + '）'
        : '想定どおり（' + REVIEW_SHEET_COLUMNS.length + ' 列）';
    });

    step('未レビュー行の集計', function () {
      var t = readSheet(refs.reviewSheetId, refs.reviewSheetName);
      var checkIdx = t.colIndex['チェック'];
      if (checkIdx == null) throw new Error('「チェック」列が見つかりません');
      var pending = t.rows.filter(function (row) {
        return String(row[checkIdx] || '').trim() === '';
      });
      return '未レビュー: ' + pending.length + ' 行 / 全体: ' + t.rows.length + ' 行';
    });

    step('SCPJ本番シート読み込み', function () {
      var s = readSheet(refs.scpjSheetId, refs.scpjSheetName);
      return 'データ行数: ' + s.rows.length + ' 行 / 列数: ' + s.headers.length;
    });

    result.ok = true;

    // 転記先（フォーム連携シート）は未設定でも接続確認全体は失敗させない
    optionalStep('フォーム連携シート読み込み', function () {
      var formRef = getFormSheetRef();
      if (!formRef) {
        throw new Error('config シートに FORM_SHEET_ID / FORM_SHEET_NAME が未設定です');
      }
      var f = readSheet(formRef.formSheetId, formRef.formSheetName);
      var checkIdx = f.colIndex['チェック'];
      return 'データ行数: ' + f.rows.length + ' 行 / 列数: ' + f.headers.length +
        ' / 「チェック」列: ' + (checkIdx == null ? '見つかりません' : (checkIdx + 1) + '列目');
    });
  } catch (e) {
    result.error = e.message;
  }

  return result;
}

/**
 * 実行ユーザーのメールアドレスを取得する
 * Web アプリを USER_DEPLOYING で実行する場合、ドメイン外ユーザーでは空文字になる。
 * @returns {string}
 */
function getActiveUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || '(取得不可)';
  } catch (e) {
    return '(取得不可)';
  }
}
