import { CHECKLIST_SECTIONS } from "../data/checklistConfig";
import {
  RB_MONITORING_CONTROL_SCORE,
  RB_MONITORING_ITEMS,
  RB_MONITORING_RENDIMIENTO_SCORE,
  RB_MONITORING_SIMULACROS_SCORE
} from "../data/rbMonitoringConfig";
import { calculateMatrixSection } from "./checklistMath";

const SPRAY_LABOR = "APLICACIÓN DE PLAGUICIDAS";
const RB_LABOR = "MONITOREO ROYA BLANCA";
const HEADER_CELLS = [
  { column: "B", value: "SEMANA" },
  { column: "C", value: "ÍTEM" },
  { column: "D", value: "CONCEPTO" },
  { column: "E", value: "NOMBRE DEL COLABORADOR" },
  { column: "F", value: "PUNTUACIÓN ESPERADA" },
  { column: "G", value: "RESULTADO" },
  { column: "H", value: "% RESULTADO" },
  { column: "I", value: "NOMBRE DEL ASEGURADOR" },
  { column: "J", value: "LABOR" },
  { column: "K", value: "TALLOS NO CONFORMES" }
];

const CRC_TABLE = Array.from({ length: 256 }, (_, tableIndex) => {
  let value = tableIndex;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function parseStoredDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const dateMatch = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!dateMatch) {
    return null;
  }

  const [, day, month, year] = dateMatch;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function getWeekCodeFromDate(value) {
  const date = parseStoredDate(value) ?? new Date();
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = utcDate.getUTCDay() || 7;

  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);

  const weekYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);

  return `${String(weekYear).slice(-2)}${String(weekNumber).padStart(2, "0")}`;
}

export function getCurrentWeekCode() {
  return getWeekCodeFromDate(new Date());
}

export function getSprayRecordWeekCode(record) {
  return record.metadata?.weekCode
    ?? getWeekCodeFromDate(
      record.finishedAt
        ?? record.createdAt
        ?? record.metadata?.savedDate
    );
}

export function getRbRecordWeekCode(record) {
  return record.weekCode
    ?? getWeekCodeFromDate(record.finishedAt ?? record.createdAt ?? record.savedDate);
}

export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function matchesExportFilters(values, filters) {
  const weekFilter = normalizeSearchText(filters.week);
  const collaboratorFilter = normalizeSearchText(filters.collaborator);
  const assurerFilter = normalizeSearchText(filters.assurer);

  return (
    (!weekFilter || normalizeSearchText(values.week).includes(weekFilter)) &&
    (!collaboratorFilter || normalizeSearchText(values.collaborator).includes(collaboratorFilter)) &&
    (!assurerFilter || normalizeSearchText(values.assurer).includes(assurerFilter))
  );
}

function getSection(sectionId) {
  return CHECKLIST_SECTIONS.find((section) => section.id === sectionId);
}

function getAnsweredItemScore(section, answers, includeItem = () => true) {
  return section.items.reduce((score, item) => {
    if (!includeItem(item)) {
      return score;
    }

    return score + (answers[item.id]?.status === "yes" ? item.weight : 0);
  }, 0);
}

function roundScore(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getPercent(result, expected) {
  return expected > 0 ? result / expected : 0;
}

function getRbRecordDate(record) {
  return parseStoredDate(record.finishedAt ?? record.createdAt ?? record.savedDate) ?? new Date();
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getExcelDateSerial(date) {
  const utcDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round(utcDate / 86400000 + 25569);
}

function getWeekdayName(date) {
  return new Intl.DateTimeFormat("es-CO", { weekday: "long" }).format(date);
}

function getRbSimulacrosTotals(form = {}) {
  const sites = Array.isArray(form.sites) ? form.sites : [];

  return sites.reduce((totals, site) => ({
    programmed: totals.programmed + (Number(site.disposed) || 0),
    found: totals.found + (Number(site.found) || 0)
  }), { programmed: 0, found: 0 });
}

function buildRbSimulacrosDailyRows(records) {
  const rowsByKey = new Map();

  for (const record of records) {
    const form = record.form ?? {};
    const name = form.monitorName ?? "";
    const date = getRbRecordDate(record);
    const week = getRbRecordWeekCode(record);
    const totals = getRbSimulacrosTotals(form);
    const key = `${getDateKey(date)}|${normalizeSearchText(name)}`;
    const current = rowsByKey.get(key) ?? {
      date,
      day: getWeekdayName(date),
      year: Number(String(date.getFullYear()).slice(-2)),
      week,
      name,
      programmed: 0,
      found: 0
    };

    current.programmed += totals.programmed;
    current.found += totals.found;
    rowsByKey.set(key, current);
  }

  return [...rowsByKey.values()]
    .sort((left, right) => left.date - right.date || left.name.localeCompare(right.name, "es"))
    .map((row) => ({
      ...row,
      dateSerial: getExcelDateSerial(row.date),
      compliance: getPercent(row.found, row.programmed)
    }));
}

function buildRbSimulacrosWeeklyRows(records) {
  const rowsByKey = new Map();

  for (const record of records) {
    const form = record.form ?? {};
    const name = form.monitorName ?? "";
    const week = getRbRecordWeekCode(record);
    const totals = getRbSimulacrosTotals(form);
    const key = `${week}|${normalizeSearchText(name)}`;
    const current = rowsByKey.get(key) ?? {
      week,
      name,
      programmed: 0,
      found: 0
    };

    current.programmed += totals.programmed;
    current.found += totals.found;
    rowsByKey.set(key, current);
  }

  return [...rowsByKey.values()]
    .sort((left, right) => String(left.week).localeCompare(String(right.week)) || left.name.localeCompare(right.name, "es"))
    .map((row) => ({
      ...row,
      compliance: getPercent(row.found, row.programmed)
    }));
}

function buildSprayExportRows(records) {
  const elementos = getSection("elementos");
  const mezclaClima = getSection("mezcla_clima");
  const requerimientos = getSection("requerimientos_aspersion");
  const revisionAspersores = getSection("revision_aspersores");
  const mangueras = getSection("mangueras");

  return records.flatMap((record) => {
    const answers = record.answers ?? {};
    const collaborator = record.metadata?.sprayerGroup ?? "";
    const assurer = record.metadata?.assurerName ?? "";
    const week = getSprayRecordWeekCode(record);
    const sprayerCount = record.metadata?.sprayerCounts?.[revisionAspersores.id]
      ?? revisionAspersores.matrix.defaultSprayerCount;
    const preparationScore =
      getAnsweredItemScore(elementos, answers) +
      getAnsweredItemScore(mezclaClima, answers, (item) =>
        ["ph", "ce", "dureza"].includes(item.id)
      );
    const generalInfoScore =
      getAnsweredItemScore(requerimientos, answers) +
      getAnsweredItemScore(mangueras, answers);
    const performanceResult = calculateMatrixSection(
      revisionAspersores,
      answers,
      sprayerCount
    );

    return [
      {
        scope: `${SPRAY_LABOR}1`,
        week,
        item: 1,
        concept: "PREPARACIÓN",
        collaborator,
        expected: 39,
        result: roundScore(preparationScore),
        percent: getPercent(preparationScore, 39),
        assurer,
        labor: SPRAY_LABOR,
        nonConformingStems: ""
      },
      {
        scope: `${SPRAY_LABOR}2`,
        week,
        item: 2,
        concept: "INFORMACIÓN GENERAL",
        collaborator,
        expected: 81,
        result: roundScore(generalInfoScore),
        percent: getPercent(generalInfoScore, 81),
        assurer,
        labor: SPRAY_LABOR,
        nonConformingStems: ""
      },
      {
        scope: `${SPRAY_LABOR}3`,
        week,
        item: 3,
        concept: "RENDIMIENTO",
        collaborator,
        expected: 294,
        result: roundScore(performanceResult.rawEarnedScore),
        percent: getPercent(performanceResult.rawEarnedScore, 294),
        assurer,
        labor: SPRAY_LABOR,
        nonConformingStems: ""
      }
    ];
  });
}

function getRbSimulacrosScore(form) {
  const totalDisposed = form.sites.reduce(
    (sum, site) => sum + (Number(site.disposed) || 0),
    0
  );
  const totalFound = form.sites.reduce(
    (sum, site) => sum + (Number(site.found) || 0),
    0
  );
  const percent = totalDisposed > 0 ? (totalFound / totalDisposed) * 100 : 0;

  if (totalDisposed <= 0) {
    return 0;
  }

  if (percent >= 90) {
    return 20;
  }

  if (percent >= 80) {
    return 15;
  }

  return 5;
}

function buildRbExportRows(records) {
  return records.flatMap((record) => {
    const form = record.form ?? {};
    const collaborator = form.monitorName ?? "";
    const assurer = form.assurerName ?? "";
    const week = getRbRecordWeekCode(record);
    const rendimientoScore =
      form.rendimientoStatus === "yes" ? RB_MONITORING_RENDIMIENTO_SCORE : 0;
    const simulacrosScore = getRbSimulacrosScore({
      sites: form.sites ?? []
    });
    const controlScore = RB_MONITORING_ITEMS.reduce((score, item) => {
      return score + (form.controlAnswers?.[item.id] === "yes" ? item.weight : 0);
    }, 0);

    return [
      {
        scope: `${RB_LABOR}1`,
        week,
        item: 1,
        concept: "RENDIMIENTO",
        collaborator,
        expected: RB_MONITORING_RENDIMIENTO_SCORE,
        result: rendimientoScore,
        percent: getPercent(rendimientoScore, RB_MONITORING_RENDIMIENTO_SCORE),
        assurer,
        labor: RB_LABOR,
        nonConformingStems: ""
      },
      {
        scope: `${RB_LABOR}2`,
        week,
        item: 2,
        concept: "CALIDAD",
        collaborator,
        expected: RB_MONITORING_SIMULACROS_SCORE,
        result: simulacrosScore,
        percent: getPercent(simulacrosScore, RB_MONITORING_SIMULACROS_SCORE),
        assurer,
        labor: RB_LABOR,
        nonConformingStems: ""
      },
      {
        scope: `${RB_LABOR}3`,
        week,
        item: 3,
        concept: "REQUERIMIENTOS",
        collaborator,
        expected: RB_MONITORING_CONTROL_SCORE,
        result: controlScore,
        percent: getPercent(controlScore, RB_MONITORING_CONTROL_SCORE),
        assurer,
        labor: RB_LABOR,
        nonConformingStems: ""
      }
    ];
  });
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getNumberCell(column, rowIndex, value, style = 1) {
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `<c r="${column}${rowIndex}" s="${style}"><v>${numericValue}</v></c>`;
}

function getTextCell(column, rowIndex, value, style = 1) {
  if (value == null || value === "") {
    return `<c r="${column}${rowIndex}" s="${style}"/>`;
  }

  return `<c r="${column}${rowIndex}" s="${style}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function buildWorksheetXml(rows) {
  const lastRow = Math.max(rows.length + 1, 1);
  const headerCells = HEADER_CELLS
    .map((header) => getTextCell(header.column, 1, header.value, 3))
    .join("");
  const dataRows = rows.map((row, index) => {
    const rowIndex = index + 2;
    const cells = [
      getTextCell("A", rowIndex, row.scope),
      getTextCell("B", rowIndex, row.week),
      getNumberCell("C", rowIndex, row.item),
      getTextCell("D", rowIndex, row.concept),
      getTextCell("E", rowIndex, row.collaborator),
      getNumberCell("F", rowIndex, row.expected),
      getNumberCell("G", rowIndex, row.result),
      getNumberCell("H", rowIndex, row.percent, 2),
      getTextCell("I", rowIndex, row.assurer),
      getTextCell("J", rowIndex, row.labor),
      getTextCell("K", rowIndex, row.nonConformingStems)
    ].join("");

    return `<row r="${rowIndex}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:K${lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="30" customWidth="1"/>
    <col min="2" max="2" width="11" customWidth="1"/>
    <col min="3" max="3" width="8" customWidth="1"/>
    <col min="4" max="4" width="28" customWidth="1"/>
    <col min="5" max="5" width="30" customWidth="1"/>
    <col min="6" max="6" width="20" customWidth="1"/>
    <col min="7" max="7" width="14" customWidth="1"/>
    <col min="8" max="8" width="14" customWidth="1"/>
    <col min="9" max="9" width="30" customWidth="1"/>
    <col min="10" max="10" width="28" customWidth="1"/>
    <col min="11" max="11" width="24" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1">${headerCells}</row>
    ${dataRows}
  </sheetData>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildRbSimulacrosDailyWorksheetXml(rows) {
  const lastRow = Math.max(rows.length + 1, 1);
  const headers = [
    { column: "A", value: "FECHA" },
    { column: "B", value: "DÍA" },
    { column: "C", value: "AÑO" },
    { column: "D", value: "SEMANA" },
    { column: "E", value: "NOMBRE" },
    { column: "F", value: "PROGRAMADO" },
    { column: "G", value: "ENCONTRADO" },
    { column: "H", value: "CUMPLIMIENTO" }
  ];
  const headerCells = headers.map((header) => getTextCell(header.column, 1, header.value, 3)).join("");
  const dataRows = rows.map((row, index) => {
    const rowIndex = index + 2;
    const cells = [
      getNumberCell("A", rowIndex, row.dateSerial, 4),
      getTextCell("B", rowIndex, row.day),
      getNumberCell("C", rowIndex, row.year),
      getTextCell("D", rowIndex, row.week),
      getTextCell("E", rowIndex, row.name),
      getNumberCell("F", rowIndex, row.programmed),
      getNumberCell("G", rowIndex, row.found),
      getNumberCell("H", rowIndex, row.compliance, 2)
    ].join("");

    return `<row r="${rowIndex}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:H${lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="13" customWidth="1"/>
    <col min="2" max="2" width="11" customWidth="1"/>
    <col min="3" max="3" width="8" customWidth="1"/>
    <col min="4" max="4" width="11" customWidth="1"/>
    <col min="5" max="5" width="28" customWidth="1"/>
    <col min="6" max="6" width="18" customWidth="1"/>
    <col min="7" max="7" width="18" customWidth="1"/>
    <col min="8" max="8" width="18" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1">${headerCells}</row>
    ${dataRows}
  </sheetData>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildRbSimulacrosWeeklyWorksheetXml(rows) {
  const lastRow = Math.max(rows.length + 1, 1);
  const headers = [
    { column: "A", value: "SEMANA" },
    { column: "B", value: "NOMBRE" },
    { column: "C", value: "PROGRAMADO" },
    { column: "D", value: "ENCONTRADO" },
    { column: "E", value: "CUMPLIMIENTO" }
  ];
  const headerCells = headers.map((header) => getTextCell(header.column, 1, header.value, 3)).join("");
  const dataRows = rows.map((row, index) => {
    const rowIndex = index + 2;
    const cells = [
      getTextCell("A", rowIndex, row.week),
      getTextCell("B", rowIndex, row.name),
      getNumberCell("C", rowIndex, row.programmed),
      getNumberCell("D", rowIndex, row.found),
      getNumberCell("E", rowIndex, row.compliance, 2)
    ].join("");

    return `<row r="${rowIndex}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:E${lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="11" customWidth="1"/>
    <col min="2" max="2" width="28" customWidth="1"/>
    <col min="3" max="3" width="18" customWidth="1"/>
    <col min="4" max="4" width="18" customWidth="1"/>
    <col min="5" max="5" width="18" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1">${headerCells}</row>
    ${dataRows}
  </sheetData>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildWorkbookXml(sheetNames) {
  const sheets = sheetNames.map((sheetName, index) =>
    `<sheet name="${escapeXml(sheetName).slice(0, 31)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets}
  </sheets>
</workbook>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="0.00%"/>
    <numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF26619C"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF7F91AA"/></left>
      <right style="thin"><color rgb="FF7F91AA"/></right>
      <top style="thin"><color rgb="FF7F91AA"/></top>
      <bottom style="thin"><color rgb="FF7F91AA"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1">
      <alignment vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1">
      <alignment vertical="center"/>
    </xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;
}

function getContentTypesXml(sheetCount = 1) {
  const worksheetOverrides = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${worksheetOverrides}
</Types>`;
}

function getRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function getWorkbookRelsXml(sheetCount = 1) {
  const worksheetRelationships = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRelationships}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function getCrc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return { dosDate, dosTime };
}

function writeUint16(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function buildZip(files) {
  const encoder = new TextEncoder();
  const { dosDate, dosTime } = getDosDateTime();
  const localFileChunks = [];
  const centralDirectoryChunks = [];
  let localOffset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = getCrc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);

    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 6, 0x0800);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, dosTime);
    writeUint16(localHeader, 12, dosDate);
    writeUint32(localHeader, 14, crc);
    writeUint32(localHeader, 18, dataBytes.length);
    writeUint32(localHeader, 22, dataBytes.length);
    writeUint16(localHeader, 26, nameBytes.length);
    writeUint16(localHeader, 28, 0);
    localHeader.set(nameBytes, 30);

    localFileChunks.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, 0x0800);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, dosTime);
    writeUint16(centralHeader, 14, dosDate);
    writeUint32(centralHeader, 16, crc);
    writeUint32(centralHeader, 20, dataBytes.length);
    writeUint32(centralHeader, 24, dataBytes.length);
    writeUint16(centralHeader, 28, nameBytes.length);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, localOffset);
    centralHeader.set(nameBytes, 46);

    centralDirectoryChunks.push(centralHeader);
    localOffset += localHeader.length + dataBytes.length;
  });

  const centralDirectory = concatUint8Arrays(centralDirectoryChunks);
  const endRecord = new Uint8Array(22);

  writeUint32(endRecord, 0, 0x06054b50);
  writeUint16(endRecord, 8, files.length);
  writeUint16(endRecord, 10, files.length);
  writeUint32(endRecord, 12, centralDirectory.length);
  writeUint32(endRecord, 16, localOffset);
  writeUint16(endRecord, 20, 0);

  return concatUint8Arrays([...localFileChunks, centralDirectory, endRecord]);
}

function downloadWorkbook({ worksheets, fileName }) {
  const sheetCount = worksheets.length;
  const files = [
    { name: "[Content_Types].xml", content: getContentTypesXml(sheetCount) },
    { name: "_rels/.rels", content: getRootRelsXml() },
    { name: "xl/workbook.xml", content: buildWorkbookXml(worksheets.map((worksheet) => worksheet.name)) },
    { name: "xl/_rels/workbook.xml.rels", content: getWorkbookRelsXml(sheetCount) },
    { name: "xl/styles.xml", content: buildStylesXml() },
    ...worksheets.map((worksheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: worksheet.content
    }))
  ];
  const blob = new Blob([buildZip(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getExportDateStamp() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function downloadSprayRecordsExcel(records) {
  downloadWorkbook({
    worksheets: [
      {
        name: "Listado chequeo aplicación",
        content: buildWorksheetXml(buildSprayExportRows(records))
      }
    ],
    fileName: `listado-chequeo-aplicacion-${getExportDateStamp()}.xlsx`
  });
}

export function downloadRbRecordsExcel(records) {
  downloadWorkbook({
    worksheets: [
      {
        name: "Monitoreo roya blanca",
        content: buildWorksheetXml(buildRbExportRows(records))
      },
      {
        name: "SIMULACROS DIAS",
        content: buildRbSimulacrosDailyWorksheetXml(buildRbSimulacrosDailyRows(records))
      },
      {
        name: "SIMULACRO SEMANA",
        content: buildRbSimulacrosWeeklyWorksheetXml(buildRbSimulacrosWeeklyRows(records))
      }
    ],
    fileName: `monitoreo-roya-blanca-${getExportDateStamp()}.xlsx`
  });
}
