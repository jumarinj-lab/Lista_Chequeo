import { Fragment, useEffect, useMemo, useState } from "react";
import {
  RecordFilters,
  createEmptyRecordFilters,
  getRecordFilterOptions,
  matchesRecordFilters,
  toggleRecordFilterValue
} from "./RecordFilters";
import {
  RB_MONITORING_AGE_TIMES,
  RB_MONITORING_CONTROL_SCORE,
  RB_MONITORING_ITEMS,
  RB_MONITORING_RENDIMIENTO_SCORE,
  RB_MONITORING_SIMULACROS_SCORE,
  RB_MONITORING_TOTAL_SCORE
} from "./data/rbMonitoringConfig";
import {
  loadRbMonitoringRecords,
  saveRbMonitoringRecord,
  updateRbMonitoringRecord
} from "./lib/rbMonitoringRecords";
import { formatNumber } from "./lib/checklistMath";
import {
  downloadRbRecordsExcel,
  getCurrentWeekCode,
  getRbRecordWeekCode
} from "./lib/excelExport";
import { hasSupabaseConfig } from "./lib/supabase";
import { sanitizeDecimalInput } from "./lib/inputFormat";

const CHECKLIST_VIEW = "checklist";
const RECORDS_VIEW = "records";

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

function createInitialForm() {
  return {
    monitorName: "",
    assurerName: "",
    assignedBeds: "",
    cropAge: RB_MONITORING_AGE_TIMES[0].id,
    rendimientoStatus: null,
    simulacrosMode: null,
    sites: Array.from({ length: 3 }, () => ({
      block: "",
      bed: "",
      disposed: "",
      found: ""
    })),
    bedMarking: null,
    controlAnswers: RB_MONITORING_ITEMS.reduce((answers, item) => {
      answers[item.id] = null;
      return answers;
    }, {}),
    commitments: ""
  };
}

function createExpandedSections(expanded = true) {
  return {
    rendimiento: expanded,
    simulacros: expanded,
    control: expanded
  };
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

function calculateMonitoringScore(form) {
  const rendimientoScore =
    form.rendimientoStatus === "yes" ? RB_MONITORING_RENDIMIENTO_SCORE : 0;
  const simulacrosMode = form.simulacrosMode ?? null;
  const isSpecialSimulacros = Boolean(simulacrosMode);

  const rawTotalDisposed = form.sites.reduce(
    (sum, site) => sum + (Number(site.disposed) || 0),
    0
  );
  const rawTotalFound = form.sites.reduce((sum, site) => sum + (Number(site.found) || 0), 0);
  const totalDisposed = isSpecialSimulacros ? 0 : rawTotalDisposed;
  const totalFound = isSpecialSimulacros ? 0 : rawTotalFound;
  const simulacrosPercent = isSpecialSimulacros ? 100 : totalDisposed > 0 ? (totalFound / totalDisposed) * 100 : 0;
  const simulacrosScore = isSpecialSimulacros
    ? RB_MONITORING_SIMULACROS_SCORE
    : totalDisposed <= 0
      ? 0
      : simulacrosPercent >= 90
        ? 20
        : simulacrosPercent >= 80
          ? 15
          : 5;

  const controlScore = RB_MONITORING_ITEMS.reduce((sum, item) => {
    return sum + (form.controlAnswers[item.id] === "yes" ? item.weight : 0);
  }, 0);

  const totalScore = rendimientoScore + simulacrosScore + controlScore;
  const percent = (totalScore / RB_MONITORING_TOTAL_SCORE) * 100;

  const compliant = [];
  const nonCompliant = [];

  const rendimientoRow = {
    sectionTitle: "Rendimiento",
    itemLabel: "Cumplimiento con los tiempos establecidos",
    criterion: "Cumple con los tiempos definidos por edad.",
    weight: RB_MONITORING_RENDIMIENTO_SCORE
  };

  if (form.rendimientoStatus === "yes") {
    compliant.push(rendimientoRow);
  } else if (form.rendimientoStatus === "no") {
    nonCompliant.push(rendimientoRow);
  }

  const simulacrosModeLabel =
    simulacrosMode === "revision"
      ? "Revisión"
      : simulacrosMode === "camara_humeda"
        ? "Cámara húmeda"
        : "";
  const simulacrosRow = {
    sectionTitle: "Muestreo de simulacros",
    itemLabel: simulacrosModeLabel || "Simulacros encontrados",
    criterion: simulacrosModeLabel
      ? simulacrosModeLabel + ": aplica puntaje completo."
      : formatNumber(totalFound) + " encontrados de " + formatNumber(totalDisposed) + " dispuestos.",
    weight: simulacrosScore
  };

  if (simulacrosModeLabel || (totalDisposed > 0 && simulacrosPercent >= 90)) {
    compliant.push(simulacrosRow);
  } else if (totalDisposed > 0) {
    nonCompliant.push(simulacrosRow);
  }
  for (const item of RB_MONITORING_ITEMS) {
    const row = {
      sectionTitle: "Ítems de control calidad",
      itemLabel: item.label,
      criterion: item.criterion,
      weight: item.weight
    };

    if (form.controlAnswers[item.id] === "yes") {
      compliant.push(row);
    } else if (form.controlAnswers[item.id] === "no") {
      nonCompliant.push(row);
    }
  }

  return {
    rendimientoScore,
    simulacrosScore,
    simulacrosPercent,
    totalDisposed,
    totalFound,
    controlScore,
    totalScore,
    percent,
    compliant,
    nonCompliant
  };
}

function RbMonitoringStartScreen({ saveState, permissions, onCreate }) {
  return (
    <section className="checklist-start">
      <div>
        <p className="eyebrow">Chequeo</p>
        <h2>Aseguramiento de monitoreo roya blanca</h2>
        <p>Inicia un nuevo registro para desplegar las 3 secciones del chequeo.</p>
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

function RecordsLoadingState() {
  return (
    <div className="records-loading" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>Cargando registros...</span>
    </div>
  );
}

function RbMonitoringRecords({ records, recordsSource, isLoading, permissions, onEditRecord }) {
  const [expandedRecordId, setExpandedRecordId] = useState(null);
  const [draftFilters, setDraftFilters] = useState(createEmptyRecordFilters);
  const [appliedFilters, setAppliedFilters] = useState(createEmptyRecordFilters);

  function getFilterValues(record) {
    return {
      week: getRbRecordWeekCode(record),
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

    downloadRbRecordsExcel(filteredRecords);
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
                <span>{getRbRecordWeekCode(record)}</span>
                <span>
                  {formatNumber(record.score)} / {formatNumber(RB_MONITORING_TOTAL_SCORE)}
                </span>
                <span>{formatNumber(record.percent)}%</span>
                <span>
                  {record.syncStatus === "pending" ? (
                    <em className="sync-status-pill">Pendiente</em>
                  ) : null}
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
                      {formatNumber(record.score)} / {formatNumber(RB_MONITORING_TOTAL_SCORE)} -{" "}
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
                      <h3>Compromisos</h3>
                      {record.form?.commitments?.trim() ? (
                        <p>{record.form.commitments}</p>
                      ) : (
                        <p className="empty-state">Sin compromisos.</p>
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

function RendimientoSection({ form, expanded, onToggle, onChange, score, readOnly = false }) {
  const isComplete =
    form.monitorName.trim() &&
    form.assurerName.trim() &&
    String(form.assignedBeds).trim() &&
    form.cropAge &&
    form.rendimientoStatus;

  return (
    <section className={isComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="01"
        title="Rendimiento"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={
          <div className="section-score">
            {formatNumber(score)} / {formatNumber(RB_MONITORING_RENDIMIENTO_SCORE)}
          </div>
        }
      />

      {expanded ? (
        <div className="collapsible-content">
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
              <span>Número de camas asignadas en una hora</span>
              <input
                type="text"
                inputMode="decimal"
                value={form.assignedBeds}
                disabled={readOnly}
                onChange={(event) =>
                  onChange({ assignedBeds: sanitizeDecimalInput(event.target.value) })
                }
              />
            </label>
            <label className="form-field">
              <span>Edad</span>
              <select
                value={form.cropAge}
                disabled={readOnly}
                onChange={(event) => onChange({ cropAge: event.target.value })}
              >
                {RB_MONITORING_AGE_TIMES.map((age) => (
                  <option key={age.id} value={age.id}>
                    {age.label} - {age.minutes}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="rb-inline-check">
            <span>Cumple con los tiempos establecidos</span>
            <StatusToggle
              value={form.rendimientoStatus}
              disabled={readOnly}
              onChange={(status) => onChange({ rendimientoStatus: status })}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SimulacrosSection({ form, expanded, onToggle, onChange, result, readOnly = false }) {
  const simulacrosMode = form.simulacrosMode ?? null;
  const isSpecialSimulacros = Boolean(simulacrosMode);
  const isComplete =
    isSpecialSimulacros ||
    (form.bedMarking &&
      form.sites.every(
        (site) =>
          site.block.trim() &&
          site.bed.trim() &&
          String(site.disposed).trim() &&
          String(site.found).trim()
      ));

  function updateSite(index, patch) {
    onChange({
      sites: form.sites.map((site, siteIndex) =>
        siteIndex === index ? { ...site, ...patch } : site
      )
    });
  }

  function updateSimulacrosMode(mode) {
    const nextMode = simulacrosMode === mode ? null : mode;
    const modeLabel =
      nextMode === "revision"
        ? "Revisión"
        : nextMode === "camara_humeda"
          ? "Cámara húmeda"
          : "";

    onChange({
      simulacrosMode: nextMode,
      sites: form.sites.map((site) => ({
        ...site,
        block: modeLabel,
        bed: modeLabel,
        disposed: nextMode ? "0" : "",
        found: nextMode ? "0" : ""
      }))
    });
  }

  return (
    <section className={isComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="02"
        title="Muestreo de simulacros"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={
          <div className="section-score">
            {formatNumber(result.simulacrosScore)} / {formatNumber(RB_MONITORING_SIMULACROS_SCORE)}
          </div>
        }
      />

      {expanded ? (
        <div className="collapsible-content">
          <div className="simulacros-mode-actions">
            <button
              type="button"
              className={simulacrosMode === "revision" ? "selected" : ""}
              disabled={readOnly}
              onClick={() => updateSimulacrosMode("revision")}
            >
              Revisión
            </button>
            <button
              type="button"
              className={simulacrosMode === "camara_humeda" ? "selected" : ""}
              disabled={readOnly}
              onClick={() => updateSimulacrosMode("camara_humeda")}
            >
              Cámara húmeda
            </button>
          </div>
          <div className="simulacros-table">
            <div className="simulacros-head">
              <span>Sitio</span>
              <span>Bloque</span>
              <span>Cama</span>
              <span># dispuestos</span>
              <span># encontrados</span>
            </div>
            {form.sites.map((site, index) => (
              <div className="simulacros-row" key={index}>
                <div>Sitio {index + 1}</div>
                <div>
                  <input
                    type="text"
                    value={site.block}
                    disabled={readOnly || isSpecialSimulacros}
                    onChange={(event) => updateSite(index, { block: event.target.value })}
                  />
                </div>
                <div>
                  <input
                    type="text"
                    value={site.bed}
                    disabled={readOnly || isSpecialSimulacros}
                    onChange={(event) => updateSite(index, { bed: event.target.value })}
                  />
                </div>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={isSpecialSimulacros ? "0" : site.disposed}
                    disabled={readOnly || isSpecialSimulacros}
                    onChange={(event) =>
                      updateSite(index, { disposed: sanitizeDecimalInput(event.target.value) })
                    }
                  />
                </div>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={isSpecialSimulacros ? "0" : site.found}
                    disabled={readOnly || isSpecialSimulacros}
                    onChange={(event) =>
                      updateSite(index, { found: sanitizeDecimalInput(event.target.value) })
                    }
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="matrix-score-note">
            <span>
              Encontrados: {formatNumber(result.totalFound)} / Dispuestos:{" "}
              {formatNumber(result.totalDisposed)}
            </span>
            <span>{formatNumber(result.simulacrosPercent)}%</span>
            <strong>
              Puntaje aplicado: {formatNumber(result.simulacrosScore)} /{" "}
              {formatNumber(RB_MONITORING_SIMULACROS_SCORE)}
            </strong>
          </div>

          <div className="rb-inline-check">
            <span>Marcación de cama</span>
            <StatusToggle
              value={form.bedMarking}
              disabled={readOnly}
              onChange={(status) => onChange({ bedMarking: status })}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ControlQualitySection({ form, expanded, onToggle, onChange, score, readOnly = false }) {
  const isComplete = RB_MONITORING_ITEMS.every((item) => form.controlAnswers[item.id]);

  return (
    <section className={isComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="03"
        title="Ítems de control calidad"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={
          <div className="section-score">
            {formatNumber(score)} / {formatNumber(RB_MONITORING_CONTROL_SCORE)}
          </div>
        }
      />

      {expanded ? (
        <div className="collapsible-content">
          <div className="item-table without-value monitoring-control-table">
            <div className="item-table-head">
              <span>Item</span>
              <span>Criterio</span>
              <span>Peso</span>
              <span>Cumple</span>
            </div>
            {RB_MONITORING_ITEMS.map((item) => (
              <div className="item-row" key={item.id}>
                <div className="item-title">{item.label}</div>
                <div className="item-criterion">{item.criterion}</div>
                <div className="item-weight">{formatNumber(item.weight)}</div>
                <StatusToggle
                  value={form.controlAnswers[item.id]}
                  disabled={readOnly}
                  onChange={(status) =>
                    onChange({
                      controlAnswers: {
                        ...form.controlAnswers,
                        [item.id]: status
                      }
                    })
                  }
                />
              </div>
            ))}
          </div>

          <div className="field-grid rb-monitoring-fields commitments-grid">
            <label className="form-field commitments-field">
              <span>Compromisos</span>
              <textarea
                rows="4"
                value={form.commitments}
                readOnly={readOnly}
                onChange={(event) => onChange({ commitments: event.target.value })}
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function RbMonitoringApp({ currentUser, permissions, onHome, onLogout }) {
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

  const result = useMemo(() => calculateMonitoringScore(form), [form]);
  const answeredCount =
    (form.rendimientoStatus ? 1 : 0) +
    (form.bedMarking ? 1 : 0) +
    RB_MONITORING_ITEMS.filter((item) => form.controlAnswers[item.id]).length;
  const answerableCount = RB_MONITORING_ITEMS.length + 2;

  async function refreshRecords() {
    setIsRecordsLoading(true);

    try {
      const loaded = await loadRbMonitoringRecords();
      setRecords(loaded.records);
      setRecordsSource(loaded.sourceLabel);
    } finally {
      setIsRecordsLoading(false);
    }
  }

  useEffect(() => {
    refreshRecords();

    function handleConnectivityChange() {
      refreshRecords();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshRecords();
      }
    }

    window.addEventListener("online", handleConnectivityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleConnectivityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (view === RECORDS_VIEW) {
      refreshRecords();
      const intervalId = window.setInterval(refreshRecords, 15000);

      return () => {
        window.clearInterval(intervalId);
      };
    }

    return undefined;
  }, [view]);

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
    setView(CHECKLIST_VIEW);
  }

  function returnHome() {
    if (isChecklistActive) {
      const shouldLeave = window.confirm("¿seguro que quieres salir sin terminar el chequeo?");

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
    const weekCode = getCurrentWeekCode();
    const record = {
      id: editingRecord?.id ?? crypto.randomUUID(),
      createdAt: editingRecord?.createdAt ?? savedAt.toISOString(),
      finishedAt: savedAt.toISOString(),
      savedDate: formatSavedDate(savedAt),
      savedTime: formatSavedTime(savedAt),
      weekCode,
      form,
      score: result.totalScore,
      percent: result.percent,
      summary: {
        compliant: result.compliant,
        nonCompliant: result.nonCompliant
      }
    };

    const nextRecords = editingRecord
      ? await updateRbMonitoringRecord(record)
      : await saveRbMonitoringRecord(record);
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
          <h1>Aseguramiento de monitoreo roya blanca</h1>
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
                  {formatNumber(result.totalScore)} / {formatNumber(RB_MONITORING_TOTAL_SCORE)}
                </strong>
              </div>
              <div>
                <span>% Calificación</span>
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

            <RendimientoSection
              form={form}
              expanded={expandedSections.rendimiento}
              onToggle={() => toggleSection("rendimiento")}
              onChange={updateForm}
              score={result.rendimientoScore}
              readOnly={!permissions.canEditRecords}
            />
            <SimulacrosSection
              form={form}
              expanded={expandedSections.simulacros}
              onToggle={() => toggleSection("simulacros")}
              onChange={updateForm}
              result={result}
              readOnly={!permissions.canEditRecords}
            />
            <ControlQualitySection
              form={form}
              expanded={expandedSections.control}
              onToggle={() => toggleSection("control")}
              onChange={updateForm}
              score={result.controlScore}
              readOnly={!permissions.canEditRecords}
            />

            <section className="summary-panel">
              <div className="summary-top">
                <div>
                  <span className="section-index">Resumen</span>
                  <h2>Resultado del chequeo</h2>
                </div>
                <div className="score-card">
                  <span>Calificación</span>
                  <strong>
                    {formatNumber(result.totalScore)} / {formatNumber(RB_MONITORING_TOTAL_SCORE)}
                  </strong>
                  <em>{formatNumber(result.percent)}%</em>
                </div>
              </div>

              <div className="summary-grid">
                <div className="summary-column good">
                  <h3>Cumple</h3>
                  {result.compliant.length ? (
                    result.compliant.map((row) => (
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
                  {result.nonCompliant.length ? (
                    result.nonCompliant.map((row) => (
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
                  <h3>Compromisos</h3>
                  {form.commitments.trim() ? (
                    <p>{form.commitments}</p>
                  ) : (
                    <p className="empty-state">Sin compromisos.</p>
                  )}
                </div>
              </div>

              <div className="summary-actions">
                {permissions.canEditRecords ? (
                  <button type="button" className="primary-action" onClick={handleSaveRecord}>
                    Guardar registro
                  </button>
                ) : null}
              </div>
            </section>
          </>
        ) : (
          <RbMonitoringStartScreen
            saveState={saveState}
            permissions={permissions}
            onCreate={startChecklist}
          />
        )
      ) : (
        <RbMonitoringRecords
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
