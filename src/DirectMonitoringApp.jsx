import { Fragment, useEffect, useMemo, useState } from "react";
import {
  RecordFilters,
  createEmptyRecordFilters,
  getRecordFilterOptions,
  matchesRecordFilters,
  toggleRecordFilterValue
} from "./RecordFilters";
import {
  DIRECT_MONITORING_ITEMS,
  DIRECT_MONITORING_TOTAL_SCORE
} from "./data/directMonitoringConfig";
import { FARM_BLOCKS, getFarmBeds, getFarmNaves } from "./data/farmPlan";
import {
  loadDirectMonitoringRecords,
  saveDirectMonitoringRecord,
  updateDirectMonitoringRecord
} from "./lib/directMonitoringRecords";
import { formatNumber } from "./lib/checklistMath";
import { downloadDirectMonitoringRecordsExcel, getCurrentWeekCode } from "./lib/excelExport";
import { hasSupabaseConfig } from "./lib/supabase";
import { sanitizeDecimalInput } from "./lib/inputFormat";

const CHECKLIST_VIEW = "checklist";
const RECORDS_VIEW = "records";
const DIRECT_MONITORING_ASSIGNED_BEDS = 30;
const DIRECT_MONITORING_BED_COUNT = 5;
const DIRECT_MONITORING_SITE_COUNT = 5;
const DIRECT_MONITORING_SITE_SCORE = 3;

function formatSavedDate(date) {
  return date.toLocaleDateString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function formatSavedTime(date) {
  return date.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createDirectMonitoringBeds() {
  return Array.from({ length: DIRECT_MONITORING_BED_COUNT }, () => ({
    block: "",
    nave: "",
    bed: "",
    sites: Array.from({ length: DIRECT_MONITORING_SITE_COUNT }, () => null),
    bedMarking: null
  }));
}

function getDirectMonitoringBeds(form) {
  return Array.isArray(form.directBeds) && form.directBeds.length
    ? form.directBeds.map((bed) => ({
      block: bed.block ?? "",
      nave: bed.nave ?? "",
      bed: bed.bed ?? "",
      sites: Array.from({ length: DIRECT_MONITORING_SITE_COUNT }, (_, index) =>
        bed.sites?.[index] ?? null
      ),
      bedMarking: bed.bedMarking ?? null
    }))
    : createDirectMonitoringBeds();
}

function createInitialForm() {
  return {
    monitorName: "",
    assurerName: "",
    monitoredBeds: "",
    directBeds: createDirectMonitoringBeds(),
    answers: DIRECT_MONITORING_ITEMS.reduce((answers, item) => {
      answers[item.id] = null;
      item.controls?.forEach((control) => {
        answers[control.id] = null;
      });
      return answers;
    }, {}),
    observations: ""
  };
}

function createExpandedSections(expanded = true) {
  return DIRECT_MONITORING_ITEMS.reduce((sections, item) => {
    sections[item.id] = expanded;
    return sections;
  }, {});
}

function hasControlItems(item) {
  return Array.isArray(item.controls) && item.controls.length > 0;
}

function calculateControlItemsScore(item, answers) {
  if (!hasControlItems(item)) {
    return 0;
  }

  return item.controls.reduce((score, control) =>
    score + (answers[control.id] === "yes" ? control.weight : 0),
  0);
}

function areControlItemsComplete(item, answers) {
  if (!hasControlItems(item)) {
    return false;
  }

  return item.controls.every((control) => Boolean(answers[control.id]));
}

function StatusToggle({ value, onChange, disabled = false }) {
  return (
    <div className="status-toggle" role="group" aria-label="Cumplimiento">
      <button
        type="button"
        className={value === "yes" ? "selected yes" : ""}
        disabled={disabled}
        onClick={() => onChange("yes")}
      >
        Sí
      </button>
      <button
        type="button"
        className={value === "no" ? "selected no" : ""}
        disabled={disabled}
        onClick={() => onChange("no")}
      >
        No
      </button>
    </div>
  );
}

function SectionHeader({ number, title, expanded, onToggle, rightSlot }) {
  return (
    <div className="section-heading">
      <div>
        <span className="section-index">{number}</span>
        <h2>{title}</h2>
      </div>
      <div className="section-heading-actions">
        {rightSlot}
        <button
          type="button"
          className={expanded ? "collapse-button expanded" : "collapse-button collapsed"}
          aria-expanded={expanded}
          aria-label={expanded ? "Plegar apartado" : "Desplegar apartado"}
          title={expanded ? "Plegar apartado" : "Desplegar apartado"}
          onClick={onToggle}
        >
          <span className="collapse-icon" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function sanitizeMonitoredBedsInput(value) {
  const sanitizedValue = sanitizeDecimalInput(value);

  if (!sanitizedValue) {
    return "";
  }

  const numericValue = Number(sanitizedValue);

  if (Number.isFinite(numericValue) && numericValue > DIRECT_MONITORING_ASSIGNED_BEDS) {
    return String(DIRECT_MONITORING_ASSIGNED_BEDS);
  }

  return sanitizedValue;
}

function calculateRendimientoScore(monitoredBeds, maxScore) {
  const beds = Math.max(
    0,
    Math.min(DIRECT_MONITORING_ASSIGNED_BEDS, Number(monitoredBeds) || 0)
  );

  return Math.round((beds / DIRECT_MONITORING_ASSIGNED_BEDS) * maxScore);
}

function getBedSiteScore(bed) {
  return (bed.sites ?? []).reduce((score, status) =>
    score + (status === "yes" ? DIRECT_MONITORING_SITE_SCORE : 0),
  0);
}

function calculateRegistroMarcacionScore(directBeds) {
  return getDirectMonitoringBeds({ directBeds }).reduce((score, bed) =>
    score + getBedSiteScore(bed),
  0);
}

function isDirectMonitoringBedComplete(bed) {
  return Boolean(
    bed.block.trim() &&
    bed.nave.trim() &&
    bed.bed.trim() &&
    bed.bedMarking &&
    bed.sites.every(Boolean)
  );
}

function isRegistroMarcacionComplete(directBeds) {
  return getDirectMonitoringBeds({ directBeds }).every((bed) =>
    isDirectMonitoringBedComplete(bed)
  );
}

function hasRegistroMarcacionData(directBeds) {
  return getDirectMonitoringBeds({ directBeds }).some((bed) =>
    bed.block.trim() ||
    bed.nave.trim() ||
    bed.bed.trim() ||
    bed.bedMarking ||
    bed.sites.some(Boolean)
  );
}

function calculateDirectMonitoringScore(form) {
  const compliant = [];
  const nonCompliant = [];
  const totalScore = DIRECT_MONITORING_ITEMS.reduce((score, item) => {
    if (item.id === "rendimiento") {
      const rendimientoScore = calculateRendimientoScore(form.monitoredBeds, item.weight);
      const monitoredBeds = Number(form.monitoredBeds) || 0;
      const row = {
        sectionTitle: item.sectionTitle,
        itemLabel: item.label,
        criterion: `${formatNumber(monitoredBeds)} de ${DIRECT_MONITORING_ASSIGNED_BEDS} camas monitoreadas.`,
        weight: item.weight
      };

      if (String(form.monitoredBeds).trim()) {
        if (monitoredBeds >= DIRECT_MONITORING_ASSIGNED_BEDS) {
          compliant.push(row);
        } else {
          nonCompliant.push(row);
        }
      }

      return score + rendimientoScore;
    }

    if (item.id === "registro_marcacion") {
      const directBeds = getDirectMonitoringBeds(form);
      const registroScore = calculateRegistroMarcacionScore(directBeds);
      const compliantSites = directBeds.reduce((count, bed) =>
        count + bed.sites.filter((status) => status === "yes").length,
      0);
      const answeredSites = directBeds.reduce((count, bed) =>
        count + bed.sites.filter(Boolean).length,
      0);
      const row = {
        sectionTitle: item.sectionTitle,
        itemLabel: item.label,
        criterion:
          `${compliantSites} de ${DIRECT_MONITORING_BED_COUNT * DIRECT_MONITORING_SITE_COUNT} sitios cumplen.`,
        weight: item.weight
      };

      if (answeredSites > 0 || hasRegistroMarcacionData(directBeds)) {
        if (registroScore >= item.weight) {
          compliant.push(row);
        } else {
          nonCompliant.push(row);
        }
      }

      return score + registroScore;
    }

    if (hasControlItems(item)) {
      const controlScore = calculateControlItemsScore(item, form.answers);

      item.controls.forEach((control) => {
        const answer = form.answers[control.id];
        const row = {
          sectionTitle: item.sectionTitle,
          itemLabel: control.label,
          criterion: control.criterion,
          weight: control.weight
        };

        if (answer === "yes") {
          compliant.push(row);
        } else if (answer === "no") {
          nonCompliant.push(row);
        }
      });

      return score + controlScore;
    }

    const answer = form.answers[item.id];
    const row = {
      sectionTitle: item.sectionTitle,
      itemLabel: item.label,
      criterion: item.criterion,
      weight: item.weight
    };

    if (answer === "yes") {
      compliant.push(row);
      return score + item.weight;
    }

    if (answer === "no") {
      nonCompliant.push(row);
    }

    return score;
  }, 0);

  return {
    totalScore,
    percent: (totalScore / DIRECT_MONITORING_TOTAL_SCORE) * 100,
    compliant,
    nonCompliant
  };
}

function RecordsLoadingState() {
  return (
    <div className="records-loading" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>Cargando registros...</span>
    </div>
  );
}

function DirectMonitoringRecords({ records, recordsSource, isLoading, permissions, onEditRecord }) {
  const [expandedRecordId, setExpandedRecordId] = useState(null);
  const [draftFilters, setDraftFilters] = useState(createEmptyRecordFilters);
  const [appliedFilters, setAppliedFilters] = useState(createEmptyRecordFilters);

  function getFilterValues(record) {
    return {
      week: record.weekCode,
      date: record.savedDate,
      collaborator: record.form?.monitorName,
      assurer: record.form?.assurerName
    };
  }

  const filterOptions = useMemo(() =>
    getRecordFilterOptions(records, getFilterValues),
  [records]);
  const filteredRecords = useMemo(() => records.filter((record) =>
    matchesRecordFilters(getFilterValues(record), appliedFilters)
  ), [records, appliedFilters]);

  function toggleFilter(field, value) {
    setDraftFilters((current) => toggleRecordFilterValue(current, field, value));
  }

  function applyFilters() {
    setAppliedFilters(draftFilters);
  }

  function clearFilters() {
    const emptyFilters = createEmptyRecordFilters();
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
  }

  function handleDownloadExcel() {
    if (!filteredRecords.length) {
      window.alert("No hay registros para descargar con los filtros actuales.");
      return;
    }

    downloadDirectMonitoringRecordsExcel(filteredRecords);
  }

  return (
    <section className="records-section">
      <div className="records-heading">
        <div>
          <span className="section-index">Registros</span>
          <h2>Chequeos guardados</h2>
        </div>
        <div className="records-actions">
          <RecordFilters
            options={filterOptions}
            draftFilters={draftFilters}
            appliedFilters={appliedFilters}
            onToggle={toggleFilter}
            onApply={applyFilters}
            onClear={clearFilters}
          />
          {permissions.canDownloadExcel ? (
            <button type="button" className="secondary-action" onClick={handleDownloadExcel}>
              Descargar Excel
            </button>
          ) : null}
          <span className="source-pill">{recordsSource}</span>
        </div>
      </div>

      <div className="rb-records-table">
        <div className="rb-records-head">
          <span>Monitor</span>
          <span>Asegurador</span>
          <span>Fecha</span>
          <span>Semana</span>
          <span>Calificación</span>
          <span>%</span>
          <span>Acción</span>
        </div>

        {isLoading ? (
          <RecordsLoadingState />
        ) : filteredRecords.length ? (
          filteredRecords.map((record) => (
            <Fragment key={record.id}>
              <div
                role="button"
                tabIndex={0}
                className={expandedRecordId === record.id ? "rb-records-row expanded" : "rb-records-row"}
                onClick={() =>
                  setExpandedRecordId((current) => (current === record.id ? null : record.id))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpandedRecordId((current) =>
                      current === record.id ? null : record.id
                    );
                  }
                }}
              >
                <span>{record.form?.monitorName || "-"}</span>
                <span>{record.form?.assurerName || "-"}</span>
                <span>{record.savedDate || "-"}</span>
                <span>{record.weekCode || "-"}</span>
                <span>
                  {formatNumber(record.score)} / {formatNumber(DIRECT_MONITORING_TOTAL_SCORE)}
                </span>
                <span>{formatNumber(record.percent)}%</span>
                <span>
                  <button
                    type="button"
                    className="edit-record-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditRecord(record);
                    }}
                  >
                    {permissions.canEditRecords ? "Editar" : "Ver"}
                  </button>
                </span>
              </div>
              {expandedRecordId === record.id ? (
                <div className="record-summary">
                  <div className="record-summary-title">
                    <strong>Resumen del registro</strong>
                    <span>
                      {formatNumber(record.score)} / {formatNumber(DIRECT_MONITORING_TOTAL_SCORE)} -{" "}
                      {formatNumber(record.percent)}%
                    </span>
                  </div>
                  <div className="summary-grid">
                    <div className="summary-column good">
                      <h3>Cumple</h3>
                      {record.summary?.compliant?.length ? (
                        record.summary.compliant.map((row) => (
                          <p key={`${row.sectionTitle}-${row.itemLabel}`}>
                            <strong>{row.itemLabel}</strong>
                            <span>{row.sectionTitle}</span>
                          </p>
                        ))
                      ) : (
                        <p className="empty-state">Sin ítems marcados.</p>
                      )}
                    </div>
                    <div className="summary-column bad">
                      <h3>No cumple</h3>
                      {record.summary?.nonCompliant?.length ? (
                        record.summary.nonCompliant.map((row) => (
                          <p key={`${row.sectionTitle}-${row.itemLabel}`}>
                            <strong>{row.itemLabel}</strong>
                            <span>{row.criterion}</span>
                          </p>
                        ))
                      ) : (
                        <p className="empty-state">Sin novedades.</p>
                      )}
                    </div>
                    <div className="summary-column notes">
                      <h3>Observaciones</h3>
                      {record.form?.observations?.trim() ? (
                        <p>{record.form.observations}</p>
                      ) : (
                        <p className="empty-state">Sin observaciones.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </Fragment>
          ))
        ) : (
          <div className="records-empty">No hay registros guardados.</div>
        )}
      </div>
    </section>
  );
}

function SiteComplianceToggle({ value, onChange, disabled = false }) {
  return (
    <div className="direct-site-toggle" role="group" aria-label="Cumplimiento del sitio">
      <button
        type="button"
        className={value === "yes" ? "selected yes" : ""}
        disabled={disabled}
        aria-label="Cumple"
        title="Cumple"
        onClick={() => onChange("yes")}
      >
        ✓
      </button>
      <button
        type="button"
        className={value === "no" ? "selected no" : ""}
        disabled={disabled}
        aria-label="No cumple"
        title="No cumple"
        onClick={() => onChange("no")}
      >
        X
      </button>
    </div>
  );
}

function DirectMonitoringBedsMatrix({ form, onChange, readOnly = false }) {
  const directBeds = getDirectMonitoringBeds(form);

  function updateBed(bedIndex, patch) {
    onChange({
      directBeds: directBeds.map((bed, index) => {
        if (Object.prototype.hasOwnProperty.call(patch, "block")) {
          return {
            ...bed,
            block: patch.block,
            nave: "",
            bed: ""
          };
        }

        return index === bedIndex ? { ...bed, ...patch } : bed;
      })
    });
  }

  function updateSite(bedIndex, siteIndex, status) {
    updateBed(bedIndex, {
      sites: directBeds[bedIndex].sites.map((siteStatus, index) =>
        index === siteIndex ? status : siteStatus
      )
    });
  }

  return (
    <div className="direct-monitoring-table">
      {directBeds.map((bed, bedIndex) => {
        const naveOptions = getFarmNaves(bed.block);
        const bedOptions = getFarmBeds(bed.block, bed.nave);
        const isBedComplete = isDirectMonitoringBedComplete(bed);

        return (
          <div
            className={isBedComplete ? "direct-bed-card completed-direct-bed" : "direct-bed-card"}
            key={bedIndex}
          >
            <div className="direct-bed-header">
              <strong>Cama {bedIndex + 1}</strong>
              <span>{formatNumber(getBedSiteScore(bed))} / 15 puntos</span>
            </div>

            <div className="direct-bed-fields">
              <label>
                <span>Bloque</span>
                <select
                  value={bed.block}
                  disabled={readOnly}
                  onChange={(event) => updateBed(bedIndex, { block: event.target.value })}
                >
                  <option value="">Seleccionar bloque</option>
                  {FARM_BLOCKS.map((block) => (
                    <option key={block} value={block}>
                      {block}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Nave</span>
                <select
                  value={bed.nave}
                  disabled={readOnly || !bed.block}
                  onChange={(event) => updateBed(bedIndex, { nave: event.target.value, bed: "" })}
                >
                  <option value="">Seleccionar nave</option>
                  {naveOptions.map((nave) => (
                    <option key={nave} value={nave}>
                      {nave}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Cama</span>
                <select
                  value={bed.bed}
                  disabled={readOnly || !bed.nave}
                  onChange={(event) => updateBed(bedIndex, { bed: event.target.value })}
                >
                  <option value="">Seleccionar cama</option>
                  {bedOptions.map((bedOption) => (
                    <option key={bedOption} value={bedOption}>
                      {bedOption}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="direct-sites-grid">
              {bed.sites.map((siteStatus, siteIndex) => (
                <div className="direct-site-cell" key={siteIndex}>
                  <span>Sitio {siteIndex + 1}</span>
                  <SiteComplianceToggle
                    value={siteStatus}
                    disabled={readOnly}
                    onChange={(status) => updateSite(bedIndex, siteIndex, status)}
                  />
                </div>
              ))}
            </div>

            <div className="direct-bed-marking">
              <span>Marcación de cama</span>
              <StatusToggle
                value={bed.bedMarking}
                disabled={readOnly}
                onChange={(status) => updateBed(bedIndex, { bedMarking: status })}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DirectMonitoringSection({
  item,
  index,
  form,
  expanded,
  onToggle,
  onChange,
  readOnly = false
}) {
  const answer = form.answers[item.id];
  const isRendimiento = item.id === "rendimiento";
  const isRegistroMarcacion = item.id === "registro_marcacion";
  const hasControls = hasControlItems(item);
  const directBeds = getDirectMonitoringBeds(form);
  const isComplete = isRendimiento
    ? form.monitorName.trim() && form.assurerName.trim() && String(form.monitoredBeds).trim()
    : isRegistroMarcacion
      ? isRegistroMarcacionComplete(directBeds)
      : hasControls
        ? areControlItemsComplete(item, form.answers)
        : Boolean(answer);
  const score = isRendimiento
    ? calculateRendimientoScore(form.monitoredBeds, item.weight)
    : isRegistroMarcacion
      ? calculateRegistroMarcacionScore(directBeds)
      : hasControls
        ? calculateControlItemsScore(item, form.answers)
        : answer === "yes" ? item.weight : 0;

  return (
    <section className={isComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number={String(index + 1).padStart(2, "0")}
        title={item.sectionTitle}
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={
          <div className="section-score">
            {formatNumber(score)} / {formatNumber(item.weight)}
          </div>
        }
      />

      {expanded ? (
        <div className="collapsible-content">
          {item.id === "rendimiento" ? (
            <div className="field-grid rb-monitoring-fields">
              <label className="form-field">
                <span>Monitor</span>
                <input
                  type="text"
                  value={form.monitorName}
                  disabled={readOnly}
                  onChange={(event) => onChange({ monitorName: event.target.value })}
                />
              </label>
              <label className="form-field">
                <span>Asegurador/a</span>
                <input
                  type="text"
                  value={form.assurerName}
                  disabled={readOnly}
                  onChange={(event) => onChange({ assurerName: event.target.value })}
                />
              </label>
              <label className="form-field">
                <span>Número de camas asignadas en la hora</span>
                <input type="text" value={DIRECT_MONITORING_ASSIGNED_BEDS} disabled readOnly />
              </label>
              <label className="form-field">
                <span>Número de camas monitoreadas en el día</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.monitoredBeds}
                  disabled={readOnly}
                  max={DIRECT_MONITORING_ASSIGNED_BEDS}
                  onChange={(event) =>
                    onChange({ monitoredBeds: sanitizeMonitoredBedsInput(event.target.value) })
                  }
                />
              </label>
            </div>
          ) : null}

          {isRegistroMarcacion ? (
            <DirectMonitoringBedsMatrix form={form} onChange={onChange} readOnly={readOnly} />
          ) : isRendimiento ? null : (
            <div className="item-table without-value monitoring-control-table">
              <div className="item-table-head">
                <span>Item</span>
                <span>Criterio</span>
                <span>Peso</span>
                <span>Cumple</span>
              </div>
              {hasControls ? item.controls.map((control) => (
                <div className="item-row" key={control.id}>
                  <div className="item-title">{control.label}</div>
                  <div className="item-criterion">{control.criterion}</div>
                  <div className="item-weight">{formatNumber(control.weight)}</div>
                  <StatusToggle
                    value={form.answers[control.id]}
                    disabled={readOnly}
                    onChange={(status) =>
                      onChange({
                        answers: {
                          ...form.answers,
                          [control.id]: status
                        }
                      })
                    }
                  />
                </div>
              )) : (
                <div className="item-row">
                  <div className="item-title">{item.label}</div>
                  <div className="item-criterion">{item.criterion}</div>
                  <div className="item-weight">{formatNumber(item.weight)}</div>
                  <StatusToggle
                    value={answer}
                    disabled={readOnly}
                    onChange={(status) =>
                      onChange({
                        answers: {
                          ...form.answers,
                          [item.id]: status
                        }
                      })
                    }
                  />
                </div>
              )}
            </div>
          )}

          {item.id === "informe_planos" ? (
            <div className="field-grid rb-monitoring-fields commitments-grid">
              <label className="form-field commitments-field">
                <span>Observaciones</span>
                <textarea
                  rows="4"
                  value={form.observations}
                  readOnly={readOnly}
                  onChange={(event) => onChange({ observations: event.target.value })}
                />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ChecklistStartScreen({ saveState, permissions, onCreate }) {
  return (
    <section className="checklist-start">
      <div>
        <p className="eyebrow">Chequeo</p>
        <h2>Aseguramiento de monitoreo directo</h2>
        <p>Inicia un nuevo registro para desplegar las secciones del chequeo.</p>
      </div>

      {permissions.canCreateChecklists ? (
        <button type="button" className="primary-action create-checklist-button" onClick={onCreate}>
          Crear Chequeo
        </button>
      ) : (
        <p className="permission-note">Tu usuario puede ver registros, pero no crear chequeos.</p>
      )}

      {saveState ? <span className={saveState.type}>{saveState.message}</span> : null}
    </section>
  );
}

export default function DirectMonitoringApp({ currentUser, permissions, onHome, onLogout }) {
  const [view, setView] = useState(
    permissions.canCreateChecklists ? CHECKLIST_VIEW : RECORDS_VIEW
  );
  const [isChecklistActive, setIsChecklistActive] = useState(false);
  const [form, setForm] = useState(createInitialForm);
  const [expandedSections, setExpandedSections] = useState(() => createExpandedSections(true));
  const [records, setRecords] = useState([]);
  const [recordsSource, setRecordsSource] = useState("Local");
  const [isRecordsLoading, setIsRecordsLoading] = useState(true);
  const [saveState, setSaveState] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);

  const result = useMemo(() => calculateDirectMonitoringScore(form), [form]);
  const answeredCount =
    (String(form.monitoredBeds).trim() ? 1 : 0) +
    (isRegistroMarcacionComplete(form.directBeds) ? 1 : 0) +
    DIRECT_MONITORING_ITEMS.filter((item) =>
      item.id !== "rendimiento" &&
      item.id !== "registro_marcacion" &&
      (hasControlItems(item)
        ? areControlItemsComplete(item, form.answers)
        : form.answers[item.id])
    ).length;
  const answerableCount = DIRECT_MONITORING_ITEMS.length;

  async function refreshRecords() {
    setIsRecordsLoading(true);

    try {
      const loaded = await loadDirectMonitoringRecords();
      setRecords(loaded.records);
      setRecordsSource(loaded.sourceLabel);
    } finally {
      setIsRecordsLoading(false);
    }
  }

  useEffect(() => {
    refreshRecords();
  }, []);

  useEffect(() => {
    if (view === RECORDS_VIEW) {
      refreshRecords();
    }
  }, [view]);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      return undefined;
    }

    function handleSupabaseRefresh() {
      refreshRecords();
    }

    window.addEventListener("online", handleSupabaseRefresh);
    window.addEventListener("focus", handleSupabaseRefresh);
    const intervalId = window.setInterval(refreshRecords, 15000);

    return () => {
      window.removeEventListener("online", handleSupabaseRefresh);
      window.removeEventListener("focus", handleSupabaseRefresh);
      window.clearInterval(intervalId);
    };
  }, []);

  function updateForm(patch) {
    setForm((current) => ({
      ...current,
      ...patch
    }));
  }

  function toggleSection(sectionId) {
    setExpandedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId]
    }));
  }

  function clearChecklistData(clearSaveState = true) {
    setForm(createInitialForm());
    setExpandedSections(createExpandedSections(true));
    setEditingRecord(null);
    if (clearSaveState) {
      setSaveState(null);
    }
  }

  function startChecklist() {
    clearChecklistData();
    setIsChecklistActive(true);
    setView(CHECKLIST_VIEW);
  }

  function editRecord(record) {
    setForm({
      ...createInitialForm(),
      ...(record.form ?? {})
    });
    setEditingRecord(record);
    setSaveState(null);
    setExpandedSections(createExpandedSections(true));
    setIsChecklistActive(true);
    setView(CHECKLIST_VIEW);
  }

  function cancelEditRecord() {
    if (!permissions.canEditRecords) {
      clearChecklistData();
      setIsChecklistActive(false);
      setView(RECORDS_VIEW);
      return;
    }

    const shouldLeave = window.confirm(
      "¿Seguro que quieres dejar de editar este chequeo? No se guardará ningún cambio que hayas hecho."
    );

    if (!shouldLeave) {
      return;
    }

    clearChecklistData();
    setIsChecklistActive(false);
    setView(RECORDS_VIEW);
  }

  function returnHome() {
    if (isChecklistActive && !editingRecord) {
      const shouldLeave = window.confirm("¿Seguro que quieres salir sin terminar el chequeo?");

      if (!shouldLeave) {
        return;
      }
    }

    if (isChecklistActive && editingRecord && permissions.canEditRecords) {
      const shouldLeave = window.confirm(
        "¿Seguro que quieres dejar de editar este chequeo? No se guardará ningún cambio que hayas hecho."
      );

      if (!shouldLeave) {
        return;
      }
    }

    clearChecklistData();
    setIsChecklistActive(false);
    setView(CHECKLIST_VIEW);
    onHome();
  }

  function getLocalSourceLabel(nextRecords) {
    const pendingCount = nextRecords.filter((record) => record.syncStatus === "pending").length;

    if (!pendingCount) {
      return hasSupabaseConfig ? "Supabase" : "Local";
    }

    return `Supabase (${pendingCount} pendiente${pendingCount === 1 ? "" : "s"})`;
  }

  async function handleSaveRecord() {
    if (!permissions.canEditRecords) {
      return;
    }

    const savedAt = new Date();
    const record = {
      id: editingRecord?.id ?? crypto.randomUUID(),
      createdAt: editingRecord?.createdAt ?? savedAt.toISOString(),
      finishedAt: savedAt.toISOString(),
      savedDate: formatSavedDate(savedAt),
      savedTime: formatSavedTime(savedAt),
      weekCode: getCurrentWeekCode(),
      form,
      score: result.totalScore,
      percent: result.percent,
      summary: {
        compliant: result.compliant,
        nonCompliant: result.nonCompliant
      }
    };

    const nextRecords = editingRecord
      ? await updateDirectMonitoringRecord(record)
      : await saveDirectMonitoringRecord(record);

    const isPending = nextRecords.some((item) => item.id === record.id && item.syncStatus === "pending");

    setRecords(nextRecords);
    setRecordsSource(getLocalSourceLabel(nextRecords));
    setSaveState({
      type: "success-message",
      message: isPending
        ? "Registro guardado local. Se sincronizará con Supabase cuando haya conexión."
        : editingRecord ? "Registro actualizado y sincronizado." : "Registro guardado y sincronizado."
    });
    clearChecklistData(false);
    setIsChecklistActive(false);
    setView(CHECKLIST_VIEW);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Flores El Trigal</p>
          <h1>Aseguramiento de monitoreo directo</h1>
        </div>
        <div className="header-actions">
          <span className="source-pill">{hasSupabaseConfig ? "Supabase activo" : "MVP local"}</span>
          <span className="source-pill">{currentUser.label}</span>
          <button type="button" className="ghost-action" onClick={onLogout}>
            Cerrar sesión
          </button>
          <button type="button" className="ghost-action" onClick={returnHome}>
            Inicio
          </button>
          <button
            type="button"
            className={view === CHECKLIST_VIEW ? "tab-button active" : "tab-button"}
            onClick={() => setView(CHECKLIST_VIEW)}
          >
            Chequeo
          </button>
          <button
            type="button"
            className={view === RECORDS_VIEW ? "tab-button active" : "tab-button"}
            onClick={() => setView(RECORDS_VIEW)}
          >
            Registros
          </button>
        </div>
      </header>

      {view === CHECKLIST_VIEW ? (
        isChecklistActive ? (
          <>
            <section className="progress-strip">
              <div>
                <span>Ítems evaluados</span>
                <strong>
                  {answeredCount} / {answerableCount}
                </strong>
              </div>
              <div>
                <span>Calificación</span>
                <strong>
                  {formatNumber(result.totalScore)} / {formatNumber(DIRECT_MONITORING_TOTAL_SCORE)}
                </strong>
              </div>
              <div>
                <span>% Cumplimiento</span>
                <strong>{formatNumber(result.percent)}%</strong>
              </div>
              {editingRecord ? (
                <div className="edit-mode-panel">
                  <div>
                    <span>Modo</span>
                    <strong>{permissions.canEditRecords ? "Edición" : "Visualización"}</strong>
                  </div>
                  <button type="button" className="danger-action" onClick={cancelEditRecord}>
                    Salir
                  </button>
                </div>
              ) : null}
            </section>

            {DIRECT_MONITORING_ITEMS.map((item, index) => (
              <DirectMonitoringSection
                item={item}
                index={index}
                key={item.id}
                form={form}
                expanded={expandedSections[item.id]}
                onToggle={() => toggleSection(item.id)}
                onChange={updateForm}
                readOnly={Boolean(editingRecord) && !permissions.canEditRecords}
              />
            ))}

            <DirectMonitoringLiveSummary
              result={result}
              form={form}
              onSave={handleSaveRecord}
              canSave={permissions.canEditRecords}
            />
          </>
        ) : (
          <ChecklistStartScreen
            saveState={saveState}
            permissions={permissions}
            onCreate={startChecklist}
          />
        )
      ) : (
        <DirectMonitoringRecords
          records={records}
          recordsSource={recordsSource}
          isLoading={isRecordsLoading}
          permissions={permissions}
          onEditRecord={editRecord}
        />
      )}
    </main>
  );
}

function DirectMonitoringLiveSummary({ result, form, onSave, canSave }) {
  return (
    <section className="summary-panel">
      <div className="summary-top">
        <div>
          <span className="section-index">Resumen</span>
          <h2>Resultado del chequeo</h2>
        </div>
        <div className="score-card">
          <span>Calificación</span>
          <strong>{formatNumber(result.totalScore)} / {formatNumber(DIRECT_MONITORING_TOTAL_SCORE)}</strong>
          <small>{formatNumber(result.percent)}% cumplimiento</small>
        </div>
      </div>
      <div className="summary-grid">
        <div className="summary-column good">
          <h3>Cumple</h3>
          {result.compliant.length ? result.compliant.map((row) => (
            <p key={row.sectionTitle + row.itemLabel}>
              <strong>{row.itemLabel}</strong>
              <span>{row.sectionTitle}</span>
            </p>
          )) : <p className="empty-state">Sin ítems cumplidos.</p>}
        </div>
        <div className="summary-column bad">
          <h3>No cumple</h3>
          {result.nonCompliant.length ? result.nonCompliant.map((row) => (
            <p key={row.sectionTitle + row.itemLabel}>
              <strong>{row.itemLabel}</strong>
              <span>{row.criterion}</span>
            </p>
          )) : <p className="empty-state">Sin situaciones por mejorar.</p>}
        </div>
        <div className="summary-column notes">
          <h3>Observaciones</h3>
          {form.observations?.trim() ? <p>{form.observations}</p> : <p className="empty-state">Sin observaciones.</p>}
        </div>
      </div>
      {canSave ? (
        <div className="summary-actions">
          <button type="button" className="primary-action" onClick={onSave}>
            Guardar registro
          </button>
        </div>
      ) : null}
    </section>
  );
}
