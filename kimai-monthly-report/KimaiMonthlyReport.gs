/**
 * Kimai Monthly Hours Report
 * ---------------------------
 * Fetches your Kimai timesheet entries for a period (previous month, or
 * this month to date) via the Kimai REST API and emails you a summary:
 * total hours, a breakdown by project/activity, how that compares to
 * your expected hours at your work pensum, and a month-by-month
 * (January onward) pensum-tracking table.
 *
 * SETUP (do this once):
 *   1. Open this project in script.google.com (paste this file in, or
 *      create a new Apps Script project and paste this in as Code.gs).
 *   2. In File > Project properties > Time zone, set it to your local
 *      timezone (e.g. Europe/Zurich), so "the month" matches your local
 *      calendar and Kimai's dates line up correctly.
 *   3. Fill in the values inside setup() below, then select "setup" in
 *      the function dropdown at the top and click "Run". This stores
 *      your API token in Script Properties (not in the visible code),
 *      and you only need to do it once.
 *   4. Select "createMonthlyTrigger" in the function dropdown and click
 *      "Run" once. This installs a trigger that fires automatically on
 *      the 1st of every month at 06:00 and emails you the report for
 *      the month that just ended. The first run will ask you to
 *      authorize the script (Kimai network access + Gmail send) -
 *      that's expected.
 *   5. (Optional) Select "sendMonthlyKimaiReport" and click "Run" once
 *      to send yourself a test report right now, for last month.
 *
 * TRIGGER_NOW FLAG:
 *   Set in setup() below (TRIGGER_NOW: true/false), stored as a Script
 *   Property so both the manual run and the installed trigger read the
 *   same value:
 *     - false (default): reports the *previous* full calendar month -
 *       the normal monthly-on-the-1st behaviour.
 *     - true: reports *this* month so far - 1st of the current month
 *       through today. Handy for an ad-hoc "how am I doing this month"
 *       check; flip it back to false before the next monthly trigger
 *       fires, or it'll keep sending month-to-date instead of the full
 *       closed month.
 *
 * WORK PENSUM (the only place this is explained - see WORK_PENSUM_PERCENT
 * and WEEKLY_HOURS_FULLTIME in setup() below):
 *   WORK_PENSUM_PERCENT (e.g. '15' for a 15% pensum) and
 *   WEEKLY_HOURS_FULLTIME (default '40', a full-time work week) are
 *   used to calculate your expected hours: weeklyHours * (pensum / 100)
 *   * PENSUM_WEEKS_PER_MONTH (a fixed 4 weeks, see that constant near
 *   pensumStats()). That's a fixed monthly target - it does NOT scale up
 *   or down with how many days the specific reported month has, so the
 *   same expected-hours figure shows up next to a full month's total, a
 *   partial month-to-date total, and every single month in the history
 *   table below.
 *   The email shows how your actual hours compare, both for the
 *   reported period and, month by month, from January of that year
 *   through whichever is later: the reported month, or the month the
 *   script is actually running in.
 *
 * THEME:
 *   Colors and the logo in getTheme() / LOGO_BASE64 below come from your
 *   own ICT Scouts brand files (the vector logo's fill colors, the ICT
 *   Scouts PowerPoint template's color theme, and the Coaches Sales
 *   Template deck) - not guessed. Edit getTheme() if the brand colors
 *   ever change.
 *
 * HOW TO GET YOUR KIMAI API TOKEN:
 *   In Kimai, open your user menu (top right) > "API access" / "API
 *   Token" page > "Create new token". Copy it immediately - Kimai only
 *   shows it once. Treat it like a password.
 */

// ---- ONE-TIME SETUP ----
function setup() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    KIMAI_BASE_URL: 'https://kimai.int.ict-scouts.ch', // no trailing slash
    KIMAI_API_TOKEN: 'NO_TOKEN_SET',
    RECIPIENT_EMAIL: 'YOUR_MAIL',
    // true  -> report 1st of THIS month through today (month-to-date)
    // false -> report the previous full calendar month (normal monthly behaviour)
    TRIGGER_NOW: 'false',
    // See "WORK PENSUM" at the top of this file for what these two do.
    WORK_PENSUM_PERCENT: '15',
    WEEKLY_HOURS_FULLTIME: '40'
  });
  Logger.log('Kimai settings saved to Script Properties.');
}

// German month names, used throughout the emailed report (translated
// explicitly here rather than relying on Utilities.formatDate's locale,
// which depends on the Google account/script locale and isn't reliable).
const MONTH_NAMES_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTH_ABBR_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function getScriptSettings() {
  const props = PropertiesService.getScriptProperties();
  return {
    baseUrl: props.getProperty('KIMAI_BASE_URL'),
    token: props.getProperty('KIMAI_API_TOKEN'),
    recipient: props.getProperty('RECIPIENT_EMAIL'),
    triggerNow: props.getProperty('TRIGGER_NOW') === 'true',
    pensumPercent: parseFloat(props.getProperty('WORK_PENSUM_PERCENT')) || 0,
    weeklyHours: parseFloat(props.getProperty('WEEKLY_HOURS_FULLTIME')) || 40
  };
}

// ---- MAIN ENTRY POINT (this is what the monthly trigger calls) ----
function sendMonthlyKimaiReport() {
  const s = getScriptSettings();

  if (!s.baseUrl || !s.token || !s.recipient || s.token === 'NO_TOKEN_SET') {
    throw new Error('Kimai settings are missing. Fill in setup() with your base URL, API token and recipient email, then run it once.');
  }

  const now = new Date();
  let periodBegin, periodEnd, periodLabel; // periodEnd is a Date, inclusive "as of" day

  if (s.triggerNow) {
    periodBegin = new Date(now.getFullYear(), now.getMonth(), 1);
    periodEnd = now;
    const monthName = MONTH_NAMES_DE[now.getMonth()] + ' ' + now.getFullYear();
    periodLabel = '1.–' + now.getDate() + '. ' + monthName + ' (bis heute)';
  } else {
    const targetMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    periodBegin = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
    periodEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0); // last day of that month
    periodLabel = MONTH_NAMES_DE[targetMonth.getMonth()] + ' ' + targetMonth.getFullYear();
  }

  const beginIso = formatLocalIso(new Date(periodBegin.getFullYear(), periodBegin.getMonth(), 1, 0, 0, 0));
  const endIso = s.triggerNow
    ? formatLocalIso(periodEnd)
    : formatLocalIso(new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 23, 59, 59));

  const entries = fetchAllTimesheets(s.baseUrl, s.token, beginIso, endIso);
  const { totalSeconds, byGroup } = summarize(entries);
  const pensum = pensumStats(totalSeconds, s.pensumPercent, s.weeklyHours);
  // Always extends through the month the script is running in, even when
  // that's later than the reported month (e.g. a normal run on 1 Sept
  // reports August, but still shows September month-to-date too).
  const history = buildPensumHistory(s, periodBegin.getFullYear(), periodBegin.getMonth(), totalSeconds, now);

  const subject = entries.length
    ? 'Stunden im ' + periodLabel + ': ' + formatDuration(totalSeconds)
    : 'Stunden im ' + periodLabel + ': keine Einträge gefunden';

  const body = buildEmailBody(periodLabel, entries, totalSeconds, byGroup, pensum, history, periodBegin.getFullYear(), s);
  const logoBlob = getLogoBlob();
  const wizardBlob = getWizardBlob();

  // Also build a PDF copy of the same report and attach it to the email,
  // built natively (see buildReportPdfBlob) rather than by converting the
  // HTML - see the comment above that function for why. This is
  // best-effort: if it fails for any reason, the report still sends
  // normally, just without the attachment.
  let pdfBlob = null;
  try {
    pdfBlob = buildReportPdfBlob(periodLabel, entries, totalSeconds, byGroup, pensum, history, s, getTheme(), logoBlob, wizardBlob);
  } catch (err) {
    Logger.log('Could not create the PDF version, sending the email without it: ' + err);
    pdfBlob = null;
  }

  const mailOptions = {
    to: s.recipient,
    subject: subject,
    htmlBody: body,
    inlineImages: {
      logo: logoBlob,
      wizard: wizardBlob
    }
  };
  if (pdfBlob) {
    mailOptions.attachments = [pdfBlob];
  }
  MailApp.sendEmail(mailOptions);

  Logger.log('Sent report for ' + periodLabel + ': ' + entries.length + ' entries, ' + formatDuration(totalSeconds) + ' total.');
}

// ---- KIMAI API ----
function fetchAllTimesheets(baseUrl, token, begin, end) {
  const all = [];
  let page = 1;
  const size = 100;

  while (true) {
    const url = baseUrl + '/api/timesheets'
      + '?begin=' + encodeURIComponent(begin)
      + '&end=' + encodeURIComponent(end)
      + '&full=true'
      + '&size=' + size
      + '&page=' + page
      + '&order_by=begin&order=ASC';

    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();

    // Kimai returns 404 once you page past the last available page.
    if (code === 404 && page > 1) break;

    if (code !== 200) {
      throw new Error('Kimai API error (HTTP ' + code + '): ' + response.getContentText());
    }

    const data = JSON.parse(response.getContentText());
    if (!data || data.length === 0) break;

    all.push.apply(all, data);
    if (data.length < size) break; // last page
    page++;
  }

  return all;
}

// ---- SUMMARY / PENSUM MATH ----
function summarize(entries) {
  let totalSeconds = 0;
  const byGroup = {};

  entries.forEach(function (e) {
    const duration = e.duration || 0;
    totalSeconds += duration;

    const projectName = (e.project && e.project.name) ? e.project.name : ('Project #' + e.project);
    const activityName = (e.activity && e.activity.name) ? e.activity.name : ('Activity #' + e.activity);
    const key = projectName + ' — ' + activityName;

    byGroup[key] = (byGroup[key] || 0) + duration;
  });

  return { totalSeconds: totalSeconds, byGroup: byGroup };
}

// A "pensum month" is treated as a fixed 4 weeks, regardless of how many
// days the actual calendar month has - so a 15% pensum expects the same
// number of hours whether the reported month was a 28-day February or a
// 31-day month. This constant is the only place that "4" lives.
const PENSUM_WEEKS_PER_MONTH = 4;

// Expected hours for the reported period: your weekly quota - weeklyHours
// * (pensumPercent / 100) - times the fixed PENSUM_WEEKS_PER_MONTH. This
// is intentionally NOT scaled by the actual number of days/weeks in the
// specific reported period: the same expected-hours figure is used for a
// full month, a month-to-date partial period, or any single month in the
// history table below, so the target itself never moves around.
function pensumStats(totalSeconds, pensumPercent, weeklyHours) {
  const expectedHours = weeklyHours * (pensumPercent / 100) * PENSUM_WEEKS_PER_MONTH;
  const actualHours = totalSeconds / 3600;
  const diffHours = actualHours - expectedHours;
  const percent = expectedHours > 0 ? (actualHours / expectedHours) * 100 : 0;
  return { expectedHours: expectedHours, actualHours: actualHours, diffHours: diffHours, percent: percent };
}

function fetchMonthTotalSeconds(s, year, monthIndex, endIso) {
  const beginIso = formatLocalIso(new Date(year, monthIndex, 1, 0, 0, 0));
  const monthEntries = fetchAllTimesheets(s.baseUrl, s.token, beginIso, endIso);
  return monthEntries.reduce(function (sum, e) { return sum + (e.duration || 0); }, 0);
}

// Builds one entry per month from January (month index 0) of `year` through
// whichever is later: `targetMonthIndex` (the reported month) or the month
// `now` falls in (the month the script is actually running in - shown even
// when it's after the reported month, e.g. a normal run on 1 Sept reports
// August but still shows September month-to-date). Reuses the
// already-fetched totals for the reported month instead of fetching twice.
function buildPensumHistory(s, year, targetMonthIndex, currentTotalSeconds, now) {
  const months = [];
  const currentMonthIndex = now.getFullYear() === year ? now.getMonth() : targetMonthIndex;
  const uptoMonthIndex = Math.max(targetMonthIndex, currentMonthIndex);

  for (let m = 0; m <= uptoMonthIndex; m++) {
    let totalSeconds;

    if (m === targetMonthIndex) {
      totalSeconds = currentTotalSeconds;
    } else if (m === currentMonthIndex) {
      totalSeconds = fetchMonthTotalSeconds(s, year, m, formatLocalIso(now));
    } else {
      const monthEndDate = new Date(year, m + 1, 0); // last day of month m
      const mEndIso = formatLocalIso(new Date(monthEndDate.getFullYear(), monthEndDate.getMonth(), monthEndDate.getDate(), 23, 59, 59));
      totalSeconds = fetchMonthTotalSeconds(s, year, m, mEndIso);
    }

    const stats = pensumStats(totalSeconds, s.pensumPercent, s.weeklyHours);
    const label = MONTH_ABBR_DE[m];
    months.push({ label: label, totalSeconds: totalSeconds, stats: stats });
  }

  return months;
}

// ---- EMAIL BODY ----
function buildEmailBody(periodLabel, entries, totalSeconds, byGroup, pensum, history, year, s) {
  const theme = getTheme();
  const radius = '14px';

  let html = ''
    + '<div style="background:' + theme.bg + ';padding:24px 12px;font-family:' + theme.font + '">'
    + '<div style="max-width:600px;margin:0 auto;background:' + theme.card + ';border:1px solid ' + theme.border
    + ';border-radius:' + radius + ';overflow:hidden">';

  // --- Header: logo on white, title ribbon below it ---
  html += '<div style="padding:22px 28px 16px;text-align:center;background:' + theme.card + '">'
    + '<img src="cid:logo" width="190" height="78" alt="ICT Scouts" style="display:inline-block;vertical-align:middle;border:0">'
    + '</div>';
  html += '<div style="background:' + theme.primary + ';padding:12px 28px;text-align:center">'
    + '<span style="color:' + theme.primaryText + ';font-size:17px;font-weight:700;letter-spacing:0.2px">Campusleitung Stunden im ' + escapeHtml(periodLabel) + '</span>'
    + '</div>';

  html += '<div style="padding:24px 28px 8px;color:' + theme.text + ';font-size:13px;line-height:1.55">';

  if (entries.length === 0) {
    html += '<p>Für diesen Zeitraum wurden keine Kimai-Zeiterfassungen gefunden.</p>';
  } else {

    const rows = Object.keys(byGroup)
      .sort(function (a, b) { return byGroup[b] - byGroup[a]; })
      .map(function (key, i) {
        const bg = i % 2 === 0 ? theme.card : theme.primaryLight;
        return '<tr style="background:' + bg + '">'
          + '<td style="padding:7px 16px 7px 12px;font-size:' + TABLE_FONT_SIZE + ';border-right:1px solid ' + theme.border + '">' + escapeHtml(key) + '</td>'
          + '<td style="padding:7px 12px 7px 0;text-align:right;font-weight:600;font-size:' + TABLE_FONT_SIZE + '">' + formatDuration(byGroup[key]) + '</td>'
          + '</tr>';
      })
      .join('');

    // Thin vertical rule between the two columns for a cleaner separation,
    // in addition to the row divider lines.
    html += '<div style="border:1px solid ' + theme.border + ';border-radius:10px;overflow:hidden;margin-bottom:16px">'
      + '<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">'
      + '<tr style="background:' + theme.primary + '">'
      + '<th align="left" style="padding:8px 16px 8px 12px;color:' + theme.primaryText + ';font-size:' + TABLE_FONT_SIZE + ';text-transform:uppercase;letter-spacing:0.4px;border-right:1px solid ' + theme.border + '">Projekt — Aktivität</th>'
      + '<th align="right" style="padding:8px 12px 8px 0;color:' + theme.primaryText + ';font-size:' + TABLE_FONT_SIZE + ';text-transform:uppercase;letter-spacing:0.4px">Stunden</th>'
      + '</tr>'
      + rows
      + '</table></div>';

    // Total, as a rounded stat card - always the same background color -
    // with the pensum comparison, a progress bar and a motivational
    // sticker inside it.
    const over = pensum.diffHours >= 0;
    const cardAccent = over ? theme.positive : theme.negative;
    const diffSign = over ? '+' : '-';
    // The Digital Wizard sticker is used in both states (at/over and under
    // pensum) - same size either way, mirrored horizontally (facing left)
    // via a CSS transform.
    const stickerCid = 'wizard';
    const stickerSize = 144;
    // "Überschuss" (surplus) when at/over pensum, "Minus" when under.
    const diffLabel = over ? 'Überschuss ' : 'Minus: ';

    const totalText = '<div style="font-size:20px;font-weight:800;color:' + theme.text + '">Gesamt: ' + formatDuration(totalSeconds)
      + '<span style="font-weight:400;font-size:12px;color:' + theme.textMuted + '"> bei ' + entries.length + ' Einträgen</span></div>'
      + '<div style="margin-top:6px;font-size:13px;color:' + theme.text + '">'
      + 'Pensum von <strong>' + s.pensumPercent + ' %</strong> sind <strong>' + formatDuration(pensum.expectedHours * 3600) + '</strong>. ' + diffLabel
      + '<strong style="color:' + cardAccent + '">' + diffSign + formatDuration(Math.abs(pensum.diffHours) * 3600) + '</strong>.'
      + '</div>'
      + '<div style="margin-top:8px">' + progressBar(pensum.percent, theme, '100%') + '</div>';

    html += '<div style="background:' + theme.totalCardBg + ';border:1px solid ' + cardAccent
      + ';border-radius:12px;padding:8px 10px;margin-bottom:20px">'
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
      + '<td style="vertical-align:middle">' + totalText + '</td>'
      + '<td width="' + (stickerSize + 4) + '" style="vertical-align:middle;text-align:right;padding-left:10px">'
      + '<img src="cid:' + stickerCid + '" width="' + stickerSize + '" height="' + stickerSize + '" alt="Digital Wizard" style="display:block;margin-left:auto;transform:scaleX(-1);border:0">'
      + '</td></tr></table>'
      + '</div>';
  }

  html += buildHistoryTable(history, theme);

  html += '</div>'; // content padding div

  html += '<div style="padding:14px 28px;border-top:1px solid ' + theme.border + ';text-align:center">'
    + '<span style="font-size:11px;color:' + theme.textMuted + '">Automatisch generiert von deinem Kimai-Monatsreport-Skript.</span>'
    + '</div>';

  html += '</div></div>'; // card, outer bg
  return html;
}

// ---- PDF VERSION ----
//
// This used to be a straight HTML->PDF conversion of the emailed body
// (Utilities.newBlob(html, 'text/html').getAs('application/pdf')). That
// turned out to be unreliable for a report like this one: the real
// Apps Script PDF came out both missing the CSS background colors from
// the email, and still cutting off the pensum table's rightmost
// column(s), even after the table's own width/margins were tuned and
// verified extensively with a local HTML->PDF tool. That local tool
// (wkhtmltopdf) is simply a different, more capable rendering engine
// than whatever Apps Script uses internally for this conversion, so it
// wasn't actually a faithful stand-in for testing the real PDF - it's
// why those two rounds of CSS tuning didn't fix the real thing.
//
// The PDF is now built natively instead, as a temporary Google Doc
// (DocumentApp): table cell background colors and text colors are set
// directly via the Docs API (no CSS involved), and column widths are
// fixed points on a wide landscape page, so both the colors and the
// layout are deterministic and guaranteed rather than hoped-for. The
// temporary Doc is exported to PDF and then deleted.
//
// Trade-off: Google Docs can't reproduce the email's rounded corners,
// pill-shaped bar, or the mirrored (flipped) sticker image - those are
// noted inline below where they're simplified. The PDF will look like a
// clean, correctly-colored, correctly-fitting report rather than a
// pixel-identical copy of the HTML email.
const PDF_PAGE_WIDTH = 792;   // landscape US Letter, points (11in)
const PDF_PAGE_HEIGHT = 612;  // points (8.5in)
const PDF_MARGIN = 28;        // points on every side (~1cm)
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2; // 736pt usable width
const PDF_TEXT_SIZE = 10;
const PDF_TABLE_FONT_SIZE = 9;
const PDF_HOURS_COL_WIDTH = 110;
const PDF_WIZARD_COL_WIDTH = 90;
const PDF_WIZARD_IMAGE_SIZE = 70;
// History block column widths, in points. Unlike the HTML/CSS table used
// for the email, a Docs table's setColumnWidth is exact and guaranteed,
// so a full 6-month row (70 + 6 x 100 = 670pt) simply can't overflow the
// 736pt usable page width, whatever the widest value in it turns out to
// be - there's no padding-on-top-of-width gotcha here to re-measure.
const PDF_HISTORY_LABEL_COL_WIDTH = 70;
const PDF_HISTORY_MONTH_COL_WIDTH = 100;

function buildReportPdfBlob(periodLabel, entries, totalSeconds, byGroup, pensum, history, s, theme, logoBlob, wizardBlob) {
  const doc = DocumentApp.create('Kimai-Bericht ' + periodLabel + ' (temp)');
  try {
    const body = doc.getBody();
    body.setPageWidth(PDF_PAGE_WIDTH);
    body.setPageHeight(PDF_PAGE_HEIGHT);
    body.setMarginTop(PDF_MARGIN);
    body.setMarginBottom(PDF_MARGIN);
    body.setMarginLeft(PDF_MARGIN);
    body.setMarginRight(PDF_MARGIN);

    appendPdfHeader(body, periodLabel, theme, logoBlob);

    if (entries.length === 0) {
      const p = body.appendParagraph('Für diesen Zeitraum wurden keine Kimai-Zeiterfassungen gefunden.');
      stylePdfText(p.editAsText(), { size: PDF_TEXT_SIZE, color: theme.text });
    } else {
      appendPdfBreakdownTable(body, byGroup, theme);
      appendPdfTotalCard(body, totalSeconds, entries.length, pensum, s, theme, wizardBlob);
    }

    appendPdfHistoryTables(body, history, theme);

    doc.saveAndClose();
    return DriveApp.getFileById(doc.getId()).getAs('application/pdf').setName('Kimai-Bericht ' + periodLabel + '.pdf');
  } finally {
    // Always clean up the temporary Doc, even if something above threw.
    try {
      DriveApp.getFileById(doc.getId()).setTrashed(true);
    } catch (cleanupErr) {
      Logger.log('Could not trash the temporary PDF doc ' + doc.getId() + ': ' + cleanupErr);
    }
  }
}

function stylePdfText(text, opts) {
  if (opts.bold) text.setBold(true);
  if (opts.size) text.setFontSize(opts.size);
  if (opts.color) text.setForegroundColor(opts.color);
}

// Logo, then the green title ribbon. A Docs paragraph can't have its own
// background color, so the ribbon is a single-cell, borderless table
// instead - the same trick used below for the total/pensum card.
function appendPdfHeader(body, periodLabel, theme, logoBlob) {
  const logoPara = body.appendParagraph('');
  logoPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  const logoImg = logoPara.appendInlineImage(logoBlob);
  const logoRatio = logoImg.getHeight() / logoImg.getWidth();
  logoImg.setWidth(160);
  logoImg.setHeight(Math.round(160 * logoRatio));

  const ribbon = body.appendTable([['Campusleitung Stunden im ' + periodLabel]]);
  ribbon.setBorderWidth(0);
  const cell = ribbon.getCell(0, 0);
  cell.setBackgroundColor(theme.primary);
  cell.setPaddingTop(8);
  cell.setPaddingBottom(8);
  cell.setWidth(PDF_CONTENT_WIDTH);
  const titlePara = cell.getChild(0).asParagraph();
  titlePara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  stylePdfText(titlePara.editAsText(), { bold: true, size: 14, color: theme.primaryText });

  body.appendParagraph('').setSpacingAfter(2);
}

function appendPdfBreakdownTable(body, byGroup, theme) {
  const keys = Object.keys(byGroup).sort(function (a, b) { return byGroup[b] - byGroup[a]; });
  const rows = [['Projekt — Aktivität', 'Stunden']].concat(keys.map(function (k) {
    return [k, formatDuration(byGroup[k])];
  }));

  const table = body.appendTable(rows);
  table.setBorderColor(theme.border);
  table.setBorderWidth(0.75);
  table.setColumnWidth(0, PDF_CONTENT_WIDTH - PDF_HOURS_COL_WIDTH);
  table.setColumnWidth(1, PDF_HOURS_COL_WIDTH);

  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    const isHeader = r === 0;
    const bg = isHeader ? theme.primary : ((r - 1) % 2 === 0 ? theme.card : theme.primaryLight);
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      cell.setBackgroundColor(bg);
      cell.setPaddingTop(5);
      cell.setPaddingBottom(5);
      const para = cell.getChild(0).asParagraph();
      if (c === 1) para.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      stylePdfText(para.editAsText(), {
        bold: isHeader || c === 1,
        size: PDF_TEXT_SIZE,
        color: isHeader ? theme.primaryText : theme.text
      });
    }
  }

  body.appendParagraph('').setSpacingAfter(4);
}

function appendPdfTotalCard(body, totalSeconds, entryCount, pensum, s, theme, wizardBlob) {
  const over = pensum.diffHours >= 0;
  const cardAccent = over ? theme.positive : theme.negative;
  const diffLabel = over ? 'Überschuss ' : 'Minus: ';
  const diffSign = over ? '+' : '-';
  const diffPortion = diffSign + formatDuration(Math.abs(pensum.diffHours) * 3600);

  const table = body.appendTable([['', '']]);
  table.setBorderColor(cardAccent);
  table.setBorderWidth(1);
  const textCellWidth = PDF_CONTENT_WIDTH - PDF_WIZARD_COL_WIDTH;
  table.setColumnWidth(0, textCellWidth);
  table.setColumnWidth(1, PDF_WIZARD_COL_WIDTH);

  const textCell = table.getCell(0, 0);
  textCell.setBackgroundColor(theme.totalCardBg);
  textCell.setPaddingTop(8);
  textCell.setPaddingBottom(8);
  textCell.setPaddingLeft(4);

  const totalPara = textCell.getChild(0).asParagraph();
  totalPara.setText('Gesamt: ' + formatDuration(totalSeconds));
  stylePdfText(totalPara.editAsText(), { bold: true, size: 15, color: theme.text });

  const entriesPara = textCell.appendParagraph('bei ' + entryCount + ' Einträgen');
  stylePdfText(entriesPara.editAsText(), { size: 9, color: theme.textMuted });

  const pensumPara = textCell.appendParagraph(
    'Pensum von ' + s.pensumPercent + ' % sind ' + formatDuration(pensum.expectedHours * 3600) + '. '
    + diffLabel + diffPortion + '.'
  );
  const pensumText = pensumPara.editAsText();
  stylePdfText(pensumText, { size: PDF_TEXT_SIZE, color: theme.text });
  // Bold + accent-color just the "Überschuss/Minus: ±Xh Ym" portion, same
  // emphasis as the email.
  const diffStart = pensumPara.getText().indexOf(diffLabel);
  if (diffStart >= 0) {
    const diffEnd = diffStart + diffLabel.length + diffPortion.length - 1;
    pensumText.setBold(diffStart, diffEnd, true);
    pensumText.setForegroundColor(diffStart, diffEnd, cardAccent);
  }

  const pctPara = textCell.appendParagraph(pensum.percent.toFixed(0) + ' %');
  stylePdfText(pctPara.editAsText(), { bold: true, size: PDF_TEXT_SIZE, color: '#000000' });
  appendPdfBarTable(textCell, pensum.percent, theme, textCellWidth - 12);

  const wizardCell = table.getCell(0, 1);
  wizardCell.setBackgroundColor(theme.totalCardBg);
  wizardCell.setPaddingTop(4);
  wizardCell.setPaddingBottom(4);
  const wizardPara = wizardCell.getChild(0).asParagraph();
  wizardPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  const wizardImg = wizardPara.appendInlineImage(wizardBlob);
  wizardImg.setWidth(PDF_WIZARD_IMAGE_SIZE);
  wizardImg.setHeight(PDF_WIZARD_IMAGE_SIZE);
  // Note: unlike the email (which mirrors the sticker with a CSS
  // transform), Google Docs' InlineImage has no built-in horizontal
  // flip, so the PDF shows the sticker facing its original direction.

  body.appendParagraph('').setSpacingAfter(4);
}

// A small two-segment bar (filled / unfilled) built from a borderless
// 1x2 table, used both next to the total and, smaller, per month in the
// history tables below - the same purple/lavender banding as the
// emailed report's progressBar(), via percentBarColor().
function appendPdfBarTable(container, percent, theme, widthPoints) {
  const clamped = Math.max(0, Math.min(100, percent));
  const color = percentBarColor(percent);
  const filledWidth = Math.max(4, Math.round(widthPoints * clamped / 100));
  const emptyWidth = Math.max(0, widthPoints - filledWidth);

  const barTable = container.appendTable(emptyWidth > 0 ? [['', '']] : [['']]);
  barTable.setBorderWidth(0);

  const filledCell = barTable.getCell(0, 0);
  filledCell.setBackgroundColor(color);
  filledCell.setPaddingTop(3);
  filledCell.setPaddingBottom(3);
  filledCell.setPaddingLeft(0);
  filledCell.setPaddingRight(0);
  filledCell.setWidth(filledWidth);

  if (emptyWidth > 0) {
    const emptyCell = barTable.getCell(0, 1);
    emptyCell.setBackgroundColor(theme.border);
    emptyCell.setPaddingTop(3);
    emptyCell.setPaddingBottom(3);
    emptyCell.setPaddingLeft(0);
    emptyCell.setPaddingRight(0);
    emptyCell.setWidth(emptyWidth);
  }

  return barTable;
}

function appendPdfHistoryTables(body, history, theme) {
  const chunkSize = 6;
  for (let i = 0; i < history.length; i += chunkSize) {
    appendPdfHistoryBlock(body, history.slice(i, i + chunkSize), theme);
  }
  appendPdfHistoryTotalRow(body, history, theme);
}

function appendPdfHistoryBlock(body, months, theme) {
  const header = [''].concat(months.map(function (h) { return h.label; }));
  const hoursRow = ['Deine Stunden'].concat(months.map(function (h) { return formatDuration(h.totalSeconds); }));
  const diffRow = ['Differenz'].concat(months.map(function (h) {
    const d = h.stats.diffHours;
    return (d >= 0 ? '+' : '-') + formatDuration(Math.abs(d) * 3600);
  }));
  // Percentage text for the "Pensum erreicht" row is filled in per-cell
  // below (alongside its bar), not here - these start blank.
  const pctRow = ['Pensum erreicht'].concat(months.map(function () { return ''; }));

  const table = body.appendTable([header, hoursRow, diffRow, pctRow]);
  table.setBorderColor(theme.border);
  table.setBorderWidth(0.75);
  table.setColumnWidth(0, PDF_HISTORY_LABEL_COL_WIDTH);
  for (let c = 1; c <= months.length; c++) {
    table.setColumnWidth(c, PDF_HISTORY_MONTH_COL_WIDTH);
  }

  for (let r = 0; r < 4; r++) {
    const row = table.getRow(r);
    const rowBg = r === 0 ? theme.primary : (r === 2 ? theme.primaryLight : theme.card);

    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      cell.setBackgroundColor(rowBg);
      cell.setPaddingTop(4);
      cell.setPaddingBottom(4);
      cell.setPaddingLeft(4);
      cell.setPaddingRight(4);

      if (r === 3 && c > 0) {
        const percent = months[c - 1].stats.percent;
        const para = cell.getChild(0).asParagraph();
        para.setText(percent.toFixed(0) + ' %');
        para.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        stylePdfText(para.editAsText(), { bold: true, size: PDF_TABLE_FONT_SIZE, color: '#000000' });
        appendPdfBarTable(cell, percent, theme, PDF_HISTORY_MONTH_COL_WIDTH - 8);
        continue;
      }

      const para = cell.getChild(0).asParagraph();
      if (c > 0) {
        para.setAlignment(r === 0 ? DocumentApp.HorizontalAlignment.CENTER : DocumentApp.HorizontalAlignment.RIGHT);
      }

      let color = r === 0 ? theme.primaryText : theme.text;
      const bold = r === 0 || c === 0 || r === 2;
      if (r === 2 && c > 0) {
        const d = months[c - 1].stats.diffHours;
        color = d >= 0 ? theme.positive : theme.negative;
      }
      stylePdfText(para.editAsText(), { bold: bold, size: PDF_TABLE_FONT_SIZE, color: color });
    }
  }

  body.appendParagraph('').setSpacingAfter(2);
}

function appendPdfHistoryTotalRow(body, history, theme) {
  const totalDiffSeconds = history.reduce(function (sum, h) { return sum + h.stats.diffHours * 3600; }, 0);
  const over = totalDiffSeconds >= 0;
  const color = over ? theme.positive : theme.negative;
  const sign = over ? '+' : '-';

  const table = body.appendTable([['Gesamtstunden zu viel/zu wenig', sign + formatDuration(Math.abs(totalDiffSeconds))]]);
  table.setBorderColor(theme.border);
  table.setBorderWidth(0.75);
  table.setColumnWidth(0, PDF_CONTENT_WIDTH - PDF_HOURS_COL_WIDTH);
  table.setColumnWidth(1, PDF_HOURS_COL_WIDTH);

  const row = table.getRow(0);
  for (let c = 0; c < row.getNumCells(); c++) {
    const cell = row.getCell(c);
    cell.setBackgroundColor(theme.primaryLight);
    cell.setPaddingTop(6);
    cell.setPaddingBottom(6);
    const para = cell.getChild(0).asParagraph();
    if (c === 1) para.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    stylePdfText(para.editAsText(), { bold: true, size: PDF_TEXT_SIZE, color: c === 1 ? color : theme.text });
  }
}

function sectionEyebrow(text, theme) {
  // Uses the darker green (not the light primary accent) so it stays
  // legible as text on a white background.
  return '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:' + theme.positive
    + ';margin:4px 0 8px">' + escapeHtml(text) + '</div>';
}

// Progress-bar banding for "% of pensum reached", expressed as a small
// bar instead of a colored pill so the number itself stays plain black
// text with no background. Three purple/lavender bands (from
// styles/colors): pale lavender for a low share of pensum reached,
// mid lavender for a partial share, solid purple once you're mostly or
// fully there.
function percentBarColor(percent) {
  if (percent >= 61) return '#5C4FC8';
  if (percent >= 30) return '#C8C8FF';
  return '#dedefc';
}

// `width` can be a number (interpreted as px, for the small per-column
// bars in the pensum table) or a CSS width string like '100%' (used next
// to the total, so the bar fills the whole line - otherwise it's not
// clear from a short fixed-width bar where it actually ends).
function progressBar(percent, theme, width) {
  const clamped = Math.max(0, Math.min(100, percent));
  const color = percentBarColor(percent);
  const widthCss = typeof width === 'number' ? (width + 'px') : width;
  return '<div style="display:block;text-align:left;width:' + widthCss + '">'
    + '<div style="font-size:' + TABLE_FONT_SIZE + ';font-weight:700;color:#000000;margin-bottom:2px">' + percent.toFixed(0) + ' %</div>'
    + '<div style="background:' + theme.border + ';border-radius:4px;height:7px;overflow:hidden">'
    + '<div style="width:' + clamped + '%;background:' + color + ';height:7px"></div>'
    + '</div></div>';
}

// Splits the months into rows of at most 6 columns each, so the table
// doesn't get cramped once several months have accumulated (hours +
// minutes plus a colored pill don't fit comfortably in more columns than
// that) - the second half of the year renders as a second block below
// the first, rather than one very wide table.
function buildHistoryTable(history, theme) {
  const chunkSize = 6;
  const chunks = [];
  for (let i = 0; i < history.length; i += chunkSize) {
    chunks.push(history.slice(i, i + chunkSize));
  }

  const blocks = chunks.map(function (chunk) {
    return buildHistoryTableBlock(chunk, theme, '10px');
  }).join('');

  const totalDiffSeconds = history.reduce(function (sum, h) { return sum + h.stats.diffHours * 3600; }, 0);

  return blocks + buildHistoryTotalRow(totalDiffSeconds, theme);
}

// Summary row below all the month blocks: adds up the over/under hours of
// every listed month (from January through the last column shown) into a
// single running total.
function buildHistoryTotalRow(totalDiffSeconds, theme) {
  const over = totalDiffSeconds >= 0;
  const sign = over ? '+' : '-';
  const color = over ? theme.positive : theme.negative;
  return '<div style="border:1px solid ' + theme.border + ';border-radius:10px;overflow:hidden;margin-bottom:12px">'
    + '<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">'
    + '<tr style="background:' + theme.primaryLight + '">'
    + '<td style="padding:8px 10px;text-align:left;font-weight:600;font-size:' + TABLE_FONT_SIZE + ';color:' + theme.text + '">Gesamtstunden zu viel/zu wenig</td>'
    + '<td style="padding:8px 10px;text-align:right;font-weight:700;font-size:' + TABLE_FONT_SIZE + ';color:' + color + ';white-space:nowrap">' + sign + formatDuration(Math.abs(totalDiffSeconds)) + '</td>'
    + '</tr></table></div>';
}

// Fixed per-column widths (rather than a table stretched to width:100%)
// so that a block with fewer months (e.g. a trailing Jul-Aug block) sizes
// to its own content and sits flush left, instead of its columns being
// stretched out to fill the full card width.
//
// IMPORTANT: with table-layout:fixed, a cell's declared width is its
// CONTENT width - padding is added on top of it, not absorbed into it.
// A 6-column row's total rendered width is therefore
// label(content+padding) + 6 x month(content+padding) + borders, and
// that must stay under the card's usable content width (~540px: a 600px
// card, minus its own padding/border) or the card's overflow:hidden
// silently clips the rightmost month(s) - which was exactly the "table
// getting cut off" bug. Keep padding tight, especially on the month
// columns since it's multiplied by 6.
// Sized (and measured with wkhtmltopdf) to comfortably fit the widest
// realistic value on one line - a large negative "Differenz" like
// "-128h 48m" - within the fixed column width, with margin to spare.
// The label column (HISTORY_LABEL_COL_WIDTH) only has to fit "Pensum
// erreicht", the longest of the three row labels, which stays legible
// down to 66px at this font size/weight - narrower than that starts
// clipping the label onto two lines.
const HISTORY_LABEL_COL_WIDTH = 66;
const HISTORY_MONTH_COL_WIDTH = 66;
const TABLE_FONT_SIZE = '10px'; // same size used everywhere in both tables

// Thin vertical rules between columns, for a cleaner grid-like
// separation - every cell gets a right-hand border except the last
// column in the row, whose border is handled by the table/card edge.
function historyColBorder(theme, isLast) {
  return isLast ? '' : ('border-right:1px solid ' + theme.border + ';');
}

function buildHistoryTableBlock(months, theme, marginBottom) {
  const colgroup = '<colgroup><col style="width:' + HISTORY_LABEL_COL_WIDTH + 'px">'
    + months.map(function () { return '<col style="width:' + HISTORY_MONTH_COL_WIDTH + 'px">'; }).join('')
    + '</colgroup>';

  const headerCells = months.map(function (h, i) {
    return '<th width="' + HISTORY_MONTH_COL_WIDTH + '" style="padding:6px 3px;text-align:center;color:' + theme.primaryText + ';font-size:' + TABLE_FONT_SIZE + ';text-transform:uppercase;letter-spacing:0.3px;' + historyColBorder(theme, i === months.length - 1) + '">' + h.label + '</th>';
  }).join('');

  const hoursCells = months.map(function (h, i) {
    return '<td width="' + HISTORY_MONTH_COL_WIDTH + '" style="padding:6px 3px;text-align:right;border-bottom:1px solid ' + theme.border + ';font-size:' + TABLE_FONT_SIZE + ';white-space:nowrap;' + historyColBorder(theme, i === months.length - 1) + '">' + formatDuration(h.totalSeconds) + '</td>';
  }).join('');

  const diffCells = months.map(function (h, i) {
    const d = h.stats.diffHours;
    const sign = d >= 0 ? '+' : '-';
    const color = d >= 0 ? theme.positive : theme.negative;
    return '<td width="' + HISTORY_MONTH_COL_WIDTH + '" style="padding:6px 3px;text-align:right;border-bottom:1px solid ' + theme.border + ';font-weight:600;font-size:' + TABLE_FONT_SIZE + ';white-space:nowrap;color:' + color + ';' + historyColBorder(theme, i === months.length - 1) + '">'
      + sign + formatDuration(Math.abs(d) * 3600) + '</td>';
  }).join('');

  const pctCells = months.map(function (h, i) {
    return '<td width="' + HISTORY_MONTH_COL_WIDTH + '" style="padding:6px 3px;text-align:center;border-bottom:1px solid ' + theme.border + ';' + historyColBorder(theme, i === months.length - 1) + '">'
      + progressBar(h.stats.percent, theme, 50) + '</td>';
  }).join('');

  return '<div style="border:1px solid ' + theme.border + ';border-radius:10px;overflow:hidden;margin-bottom:' + marginBottom + '">'
    + '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;text-align:left;">'
    + colgroup
    + '<tr style="background:' + theme.primary + '">'
    + '<th width="' + HISTORY_LABEL_COL_WIDTH + '" style="padding:4px 6px;text-align:left;color:' + theme.primaryText + ';font-size:' + TABLE_FONT_SIZE + ';text-transform:uppercase;letter-spacing:0.3px;border-right:1px solid ' + theme.border + '">&nbsp;</th>' + headerCells + '</tr>'
    + '<tr style="background:' + theme.card + '"><td width="' + HISTORY_LABEL_COL_WIDTH + '" style="padding:6px 6px;text-align:left;font-weight:600;font-size:' + TABLE_FONT_SIZE + ';border-bottom:1px solid ' + theme.border + ';white-space:nowrap;border-right:1px solid ' + theme.border + '">Deine Stunden</td>' + hoursCells + '</tr>'
    + '<tr style="background:' + theme.primaryLight + '"><td width="' + HISTORY_LABEL_COL_WIDTH + '" style="padding:6px 6px;text-align:left;font-weight:600;font-size:' + TABLE_FONT_SIZE + ';border-bottom:1px solid ' + theme.border + ';white-space:nowrap;border-right:1px solid ' + theme.border + '">Differenz</td>' + diffCells + '</tr>'
    + '<tr style="background:' + theme.card + '"><td width="' + HISTORY_LABEL_COL_WIDTH + '" style="padding:6px 6px;text-align:left;font-weight:600;font-size:' + TABLE_FONT_SIZE + ';border-bottom:1px solid ' + theme.border + ';white-space:nowrap;border-right:1px solid ' + theme.border + '">Pensum erreicht</td>' + pctCells + '</tr>'
    + '</table></div>';
}

// Colors and the logo/stickers (see the base64 constants near the end of
// this file) come from your own ICT Scouts brand assets, not guessed -
// specifically the palette you saved in styles/colors:
//  - primary green   #ABE8B1 - accent background (header ribbon, table
//    headers, borders)
//  - total-box green #E4F8E6 - always used for the total/pensum card
//  - accent green     #079374 - darker green used as text/values (the
//    logo file's second brand color) so it stays readable
//  - accent red       #C1283A - "under pensum" text, from
//    styles/Logos/.../Logo Sign.svg
// Edit these hex codes any time the brand palette changes.
function getTheme() {
  return {
    font: "'Segoe UI', Arial, sans-serif",
    text: '#1B1B2F',
    textMuted: '#6B6B85',
    bg: '#F3FBF4',              // page background tint
    card: '#FFFFFF',
    border: '#D9EEDD',
    primary: '#ABE8B1',         // ICT Scouts green (replaces the earlier violet)
    primaryText: '#173B22',     // dark text used on top of the primary background
    primaryLight: '#F0FAF1',    // light green tint (row stripes)
    totalCardBg: '#E4F8E6',     // total/pensum card background - always this color
    positive: '#079374',        // darker green - over/met pensum text & values
    positiveLight: '#E1F7EF',
    warning: '#FF7F57',         // coral/orange (from styles/colors) - 80-99% of pensum bar color
    negative: '#C1283A',        // under pensum
    negativeLight: '#FBE6E9'
  };
}

function formatDuration(totalSeconds) {
  const sign = totalSeconds < 0 ? -1 : 1;
  const abs = Math.abs(totalSeconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.round((abs % 3600) / 60);
  return (sign < 0 ? '-' : '') + hours + 'h ' + (minutes < 10 ? '0' + minutes : minutes) + 'm';
}

function formatLocalIso(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---- TRIGGER INSTALLATION (run this once) ----
function createMonthlyTrigger() {
  // Remove any previous trigger for this function first, so re-running
  // this doesn't create duplicates.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendMonthlyKimaiReport') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('sendMonthlyKimaiReport')
    .timeBased()
    .onMonthDay(1)
    .atHour(6)
    .create();

  Logger.log('Monthly trigger installed: runs on the 1st of every month around 06:00. Reports the previous full month unless TRIGGER_NOW is set to true in Script Properties, in which case it reports this month to date instead.');
}


// ---- LOGO (embedded so the email doesn't depend on external hosting) ----
// Base64-encoded PNG of styles/Logos/ICTScouts_Logo-Package/ICT Scouts - Logo horizontal.png
function getLogoBlob() {
  return Utilities.newBlob(Utilities.base64Decode(LOGO_BASE64), 'image/png', 'ict-scouts-logo.png');
}

const LOGO_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAABwgAAALlCAYAAADQcbJ9AAAACXBIWXMAABYlAAAWJQFJUiTwAAAE2mlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSfvu78nIGlkPSdXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQnPz4KPHg6eG1wbWV0YSB4bWxuczp4PSdhZG9iZTpuczptZXRhLyc+CjxyZGY6UkRGIHhtbG5zOnJkZj0naHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyc+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczpBdHRyaWI9J2h0dHA6Ly9ucy5hdHRyaWJ1dGlvbi5jb20vYWRzLzEuMC8nPgogIDxBdHRyaWI6QWRzPgogICA8cmRmOlNlcT4KICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0nUmVzb3VyY2UnPgogICAgIDxBdHRyaWI6Q3JlYXRlZD4yMDI1LTA0LTExPC9BdHRyaWI6Q3JlYXRlZD4KICAgICA8QXR0cmliOkV4dElkPjVlNTk4ZjM3LTI5MzAtNGUyMC1hM2VkLTlkMjE3YjViZWM5NTwvQXR0cmliOkV4dElkPgogICAgIDxBdHRyaWI6RmJJZD41MjUyNjU5MTQxNzk1ODA8L0F0dHJpYjpGYklkPgogICAgIDxBdHRyaWI6VG91Y2hUeXBlPjI8L0F0dHJpYjpUb3VjaFR5cGU+CiAgICA8L3JkZjpsaT4KICAgPC9yZGY6U2VxPgogIDwvQXR0cmliOkFkcz4KIDwvcmRmOkRlc2NyaXB0aW9uPgoKIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PScnCiAgeG1sbnM6ZGM9J2h0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvJz4KICA8ZGM6dGl0bGU+CiAgIDxyZGY6QWx0PgogICAgPHJkZjpsaSB4bWw6bGFuZz0neC1kZWZhdWx0Jz5Mb2dvIElDVCBTY291dHMgLSBJQ1QgU2NvdXRzIC0gTG9nbyBob3Jpem9udGFsPC9yZGY6bGk+CiAgIDwvcmRmOkFsdD4KICA8L2RjOnRpdGxlPgogPC9yZGY6RGVzY3JpcHRpb24+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczpwZGY9J2h0dHA6Ly9ucy5hZG9iZS5jb20vcGRmLzEuMy8nPgogIDxwZGY6QXV0aG9yPlNlYmFzdGlhbiBTaWdyaXN0PC9wZGY6QXV0aG9yPgogPC9yZGY6RGVzY3JpcHRpb24+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczp4bXA9J2h0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8nPgogIDx4bXA6Q3JlYXRvclRvb2w+Q2FudmEgKFJlbmRlcmVyKSBkb2M9REFGN1ctdWNQaEkgdXNlcj1VQUZ4Zzl4Qk1hUSBicmFuZD1JQ1QgU2NvdXRzIHRlbXBsYXRlPTwveG1wOkNyZWF0b3JUb29sPgogPC9yZGY6RGVzY3JpcHRpb24+CjwvcmRmOlJERj4KPC94OnhtcG1ldGE+Cjw/eHBhY2tldCBlbmQ9J3InPz7riER+AABxWElEQVR4nOzZMQEAMAyAsNa/6brYDhIF/OwAAAAAAAAAGfs7AAAAAAAAAHjHIAQAAAAAAIAQgxAAAAAAAABCDEIAAAAAAAAIMQgBAAAAAAAgxCAEAAAAAACAEIMQAAAAAAAAQgxCAAAAAAAACDEIAQAAAAAAIMQgBAAAAAAAgBCDEAAAAAAAAEIMQgAAAAAAAAgxCAEAAAAAACDEIAQAAAAAAIAQgxAAAAAAAABCDEIAAAAAAAAIMQgBAAAAAAAgxCAEAAAAAACAEIMQAAAAAAAAQgxCAAAAAAAACDEIAQAAAAAAIMQgBAAAAAAAgBCDEAAAAAAAAEIMQgAAAAAAAAgxCAEAAAAAACDEIAQAAAAAAIAQgxAAAAAAAABCDEIAAAAAAAAIMQgBAAAAAAAgxCAEAAAAAACAEIMQAAAAAAAAQgxCAAAAAAAACDEIAQAAAAAAIMQgBAAAAAAAgBCDEAAAAAAAAEIMQgAAAAAAAAg5AAAA///s2YEAAAAAgCB/60EujQQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMBIAAAA///s2YEAAAAAgCB/60EujQQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMBIAAAA///s2YEAAAAAgCB/60EujQQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAA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AAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMBIAAAA///t2YEAAAAAgCB/60EujQQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAICRAFj8Uz3to+4rAAAAAElFTkSuQmCC';


function getWizardBlob() {
  return Utilities.newBlob(Utilities.base64Decode(WIZARD_BASE64), 'image/png', 'sticker-digital-wizard.png');
}


// styles/Stickers/Sticker Digital Wizard.png (shown when under pensum)
const WIZARD_BASE64 =
  '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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACA1P4P9jSUL2Fx/IUAAAAASUVORK5CYII=';
