import { useEffect, useMemo, useState } from "react";
import {
  RecordFilters,
  createEmptyRecordFilters,
  getRecordFilterOptions,
  matchesRecordFilters,
  toggleRecordFilterValue
} from "./RecordFilters";
import { FARM_BLOCKS, getFarmBeds, getFarmNaves } from "./data/farmPlan";
import { formatNumber } from "./lib/checklistMath";
import { downloadTswvRecordsExcel, getCurrentWeekCode } from "./lib/excelExport";
import { sanitizeDecimalInput } from "./lib/inputFormat";
import { hasSupabaseConfig } from "./lib/supabase";
import {
  loadTswvRecords,
  saveTswvRecord,
  updateTswvRecord
} from "./lib/tswvRecords";

const CHECKLIST_VIEW = "checklist";
const RECORDS_VIEW = "records";
const TSWV_ASSIGNED_BEDS = 10;
const TSWV_RENDIMIENTO_SCORE = 10;
const TSWV_ERRADICATION_COUNT = 6;
const TSWV_ERRADICATION_SCORE = 10;

const TSWV_CONTROLS = [
  {
    id: "vara_correcta",
    label: "Uso correcto de la vara",
    criterion: "Para la revisión de la cama se lleva la vara en forma correcta.",
    weight: 5
  },
  {
    id: "desinfeccion_cama",
    label: "Desinfección de camas revisadas",
    criterion: "Se realiza la desinfección cada cama revisada.",
    weight: 5
  },
  {
    id: "erradicacion_paquetes",
    label: "Erradicación por paquetes de 20 tallos",
    criterion: "Se erradican plantas por paquetes de 20 tallos.",
    weight: 5
  },
  {
    id: "registro_camas",
    label: "Registro de número de camas",
    criterion: "Se registra correctamente número de camas.",
    weight: 5
  },
  {
    id: "registro_tallos",
    label: "Registro de tallos erradicados",
    criterion: "Se registra correctamente número de tallos erradicados.",
    weight: 5
  },
  {
    id: "dispositivos_electronicos",
    label: "Uso de dispositivos electrónicos",
    criterion: "El monitor usa adecuadamente los dispositivos electrónicos.",
    weight: 20
  },
  {
    id: "tallos_sin_afectacion",
    label: "Erradicación de tallos sin afectación",
    criterion: "Se erradican tallos sin afectación.",
    weight: 10
  }
];

const TSWV_CONTROL_TOTAL = TSWV_CONTROLS.reduce((total, item) => total + item.weight, 0);
const TSWV_ERRADICATION_TOTAL = TSWV_ERRADICATION_COUNT * TSWV_ERRADICATION_SCORE;
const TSWV_TOTAL_SCORE = TSWV_RENDIMIENTO_SCORE + TSWV_CONTROL_TOTAL + TSWV_ERRADICATION_TOTAL;

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

function createErradications() {
  return Array.from({ length: TSWV_ERRADICATION_COUNT }, () => ({
    block: "",
    nave: "",
    bed: "",
    conforme: null,
    nonConformingStems: ""
  }));
}

function createInitialForm() {
  return {
    monitorName: "",
    assurerName: "",
    monitoredBeds: "",
    controls: TSWV_CONTROLS.reduce((answers, item) => {
      answers[item.id] = null;
      return answers;
    }, {}),
    erradications: createErradications(),
    observations: ""
  };
}

function createExpandedSections(expanded = true) {
  return {
    rendimiento: expanded,
    busqueda: expanded,
    erradicaciones: expanded
  };
}

function sanitizeMonitoredBedsInput(value) {
  const sanitizedValue = sanitizeDecimalInput(value);

  if (!sanitizedValue) {
    return "";
  }

  const numericValue = Number(sanitizedValue);

  if (Number.isFinite(numericValue) && numericValue > TSWV_ASSIGNED_BEDS) {
    return String(TSWV_ASSIGNED_BEDS);
  }

  return sanitizedValue;
}

function calculateRendimientoScore(monitoredBeds) {
  const beds = Math.max(0, Math.min(TSWV_ASSIGNED_BEDS, Number(monitoredBeds) || 0));
  return Math.round((beds / TSWV_ASSIGNED_BEDS) * TSWV_RENDIMIENTO_SCORE);
}

function calculateControlScore(controls) {
  return TSWV_CONTROLS.reduce((score, item) =>
    score + (controls[item.id] === "yes" ? item.weight : 0),
  0);
}

function calculateErradicationScore(erradications) {
  return erradications.reduce((score, item) =>
    score + (item.conforme === "yes" ? TSWV_ERRADICATION_SCORE : 0),
  0);
}

function isRendimientoComplete(form) {
  return Boolean(
    form.monitorName.trim() &&
    form.assurerName.trim() &&
    String(form.monitoredBeds).trim()
  );
}

function isControlsComplete(controls) {
  return TSWV_CONTROLS.every((item) => Boolean(controls[item.id]));
}

function isErradicationComplete(item) {
  return Boolean(
    item.block.trim() &&
    item.nave.trim() &&
    item.bed.trim() &&
    item.conforme &&
    String(item.nonConformingStems).trim()
  );
}

function isErradicationsComplete(erradications) {
  return erradications.every(isErradicationComplete);
}

function calculateTswvScore(form) {
  const rendimientoScore = calculateRendimientoScore(form.monitoredBeds);
  const controlScore = calculateControlScore(form.controls);
  const erradicationScore = calculateErradicationScore(form.erradications);
  const totalScore = rendimientoScore + controlScore + erradicationScore;
  const percent = TSWV_TOTAL_SCORE ? (totalScore / TSWV_TOTAL_SCORE) * 100 : 0;
  const compliant = [];
  const nonCompliant = [];

  if (String(form.monitoredBeds).trim()) {
    const row = {
      sectionTitle: "Rendimiento",
      itemLabel: "Número de camas monitoreadas en el día",
      criterion: `${formatNumber(Number(form.monitoredBeds) || 0)} de ${TSWV_ASSIGNED_BEDS} camas monitoreadas.`,
      weight: TSWV_RENDIMIENTO_SCORE
    };

    if (rendimientoScore >= TSWV_RENDIMIENTO_SCORE) {
      compliant.push(row);
    } else {
      nonCompliant.push(row);
    }
  }

  TSWV_CONTROLS.forEach((item) => {
    if (!form.controls[item.id]) return;

    const row = {
      sectionTitle: "Monitor: búsqueda de la enfermedad de la forma correcta",
      itemLabel: item.label,
      criterion: item.criterion ?? item.label,
      weight: item.weight
    };

    if (form.controls[item.id] === "yes") {
      compliant.push(row);
    } else {
      nonCompliant.push(row);
    }
  });

  form.erradications.forEach((item, index) => {
    if (!isErradicationComplete(item)) return;

    const locationText = "Bloque " + item.block + ", nave " + item.nave + ", cama " + item.bed;
    const row = {
      sectionTitle: "Erradicaciones",
      itemLabel: "Cama " + (index + 1),
      criterion: locationText + ". Tallos no conformes: " + item.nonConformingStems + ".",
      weight: TSWV_ERRADICATION_SCORE
    };

    if (item.conforme === "yes") {
      compliant.push(row);
    } else {
      nonCompliant.push(row);
    }
  });

  return { rendimientoScore, controlScore, erradicationScore, totalScore, percent, compliant, nonCompliant };
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

function SummaryList({ title, items, emptyText, className, detail = "criterion" }) {
  return (
    <div className={className}>
      <h3>{title}</h3>
      {items.length ? items.map((item, index) => (
        <p key={item.sectionTitle + "-" + item.itemLabel + "-" + index}>
          <strong>{item.itemLabel}</strong>
          <span>{detail === "section" ? item.sectionTitle : item.criterion}</span>
        </p>
      )) : <p className="empty-state">{emptyText}</p>}
    </div>
  );
}

function SummaryTable({ result, observations, onSave, canSave = false, compact = false }) {
  return (
    <section className={compact ? "record-summary" : "summary-panel"}>
      <div className={compact ? "record-summary-title" : "summary-top"}>
        {compact ? (
          <>
            <strong>Resumen del registro</strong>
            <span>{formatNumber(result.totalScore)} / {formatNumber(TSWV_TOTAL_SCORE)} - {formatNumber(result.percent)}%</span>
          </>
        ) : (
          <>
            <div>
              <span className="section-index">Resumen</span>
              <h2>Resultado del chequeo</h2>
            </div>
            <div className="score-card">
              <span>Calificación</span>
              <strong>{formatNumber(result.totalScore)} / {formatNumber(TSWV_TOTAL_SCORE)}</strong>
              <small>{formatNumber(result.percent)}% cumplimiento</small>
            </div>
          </>
        )}
      </div>
      <div className="summary-grid">
        <SummaryList className="summary-column good" title="Cumple" items={result.compliant} emptyText="Sin ítems cumplidos." detail="section" />
        <SummaryList className="summary-column bad" title="No cumple" items={result.nonCompliant} emptyText="Sin situaciones por mejorar." />
        <div className="summary-column notes">
          <h3>Observaciones</h3>
          {observations?.trim() ? <p>{observations}</p> : <p className="empty-state">Sin observaciones.</p>}
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

function RendimientoSection({ form, expanded, onToggle, onChange, readOnly }) {
  const complete = isRendimientoComplete(form);
  const score = calculateRendimientoScore(form.monitoredBeds);

  return (
    <section className={complete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="1"
        title="Rendimiento"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(TSWV_RENDIMIENTO_SCORE)}</div>}
      />
      {expanded ? (
        <div className="collapsible-content">
          <div className="field-grid rb-monitoring-fields">
            <label className="form-field">
              <span>Monitor</span>
              <input value={form.monitorName} readOnly={readOnly} onChange={(event) => onChange({ monitorName: event.target.value })} />
            </label>
            <label className="form-field">
              <span>Asegurador</span>
              <input value={form.assurerName} readOnly={readOnly} onChange={(event) => onChange({ assurerName: event.target.value })} />
            </label>
            <label className="form-field">
              <span>Número de camas asignadas en la hora</span>
              <input type="text" value={TSWV_ASSIGNED_BEDS} disabled readOnly />
            </label>
            <label className="form-field">
              <span>Número de camas monitoreadas en el día</span>
              <input
                inputMode="decimal"
                value={form.monitoredBeds}
                readOnly={readOnly}
                onChange={(event) => onChange({ monitoredBeds: sanitizeMonitoredBedsInput(event.target.value) })}
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TswvControlsSection({ form, expanded, onToggle, onAnswerChange, readOnly }) {
  const complete = isControlsComplete(form.controls);
  const score = calculateControlScore(form.controls);

  return (
    <section className={complete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="3"
        title="Monitor: búsqueda de la enfermedad de la forma correcta"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(TSWV_CONTROL_TOTAL)}</div>}
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
            {TSWV_CONTROLS.map((item) => (
              <div className="item-row" key={item.id}>
                <div className="item-title">{item.label}</div>
                <div>{item.criterion}</div>
                <div>{item.weight}</div>
                <div>
                  <StatusToggle
                  value={form.controls[item.id]}
                  disabled={readOnly}
                    onChange={(value) => onAnswerChange(item.id, value)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TswvErradicationsSection({ form, expanded, onToggle, onChange, readOnly }) {
  const complete = isErradicationsComplete(form.erradications);
  const score = calculateErradicationScore(form.erradications);

  function updateErradication(index, patch) {
    const nextErradications = form.erradications.map((item, itemIndex) => {
      if (itemIndex !== index) return item;

      if (Object.prototype.hasOwnProperty.call(patch, "block")) {
        return { ...item, block: patch.block, nave: "", bed: "" };
      }

      if (Object.prototype.hasOwnProperty.call(patch, "nave")) {
        return { ...item, nave: patch.nave, bed: "" };
      }

      return { ...item, ...patch };
    });

    onChange({ erradications: nextErradications });
  }

  return (
    <section className={complete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="2"
        title="Erradicaciones"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(TSWV_ERRADICATION_TOTAL)}</div>}
      />
      {expanded ? (
        <div className="collapsible-content">
          <div className="direct-monitoring-table tswv-erradications-grid">
            {form.erradications.map((item, index) => {
              const naveOptions = getFarmNaves(item.block);
              const bedOptions = getFarmBeds(item.block, item.nave);
              const isComplete = isErradicationComplete(item);

              return (
                <div className={isComplete ? "direct-bed-card completed-direct-bed" : "direct-bed-card"} key={index}>
                  <div className="direct-bed-header">
                    <strong>Peso 10 puntos por cama</strong>
                    <span>Cama {index + 1}</span>
                  </div>
                  <div className="direct-bed-fields">
                    <label>
                      <span>Bloque</span>
                      <select value={item.block} disabled={readOnly} onChange={(event) => updateErradication(index, { block: event.target.value })}>
                        <option value="">Seleccionar</option>
                        {FARM_BLOCKS.map((block) => <option key={block} value={block}>{block}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Nave</span>
                      <select value={item.nave} disabled={readOnly || !item.block} onChange={(event) => updateErradication(index, { nave: event.target.value })}>
                        <option value="">Seleccionar</option>
                        {naveOptions.map((nave) => <option key={nave} value={nave}>{nave}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Cama</span>
                      <select value={item.bed} disabled={readOnly || !item.nave} onChange={(event) => updateErradication(index, { bed: event.target.value })}>
                        <option value="">Seleccionar</option>
                        {bedOptions.map((bed) => <option key={bed} value={bed}>{bed}</option>)}
                      </select>
                    </label>
                    <label>
                      <span># tallos no conformes</span>
                      <input
                        inputMode="decimal"
                        value={item.nonConformingStems}
                        readOnly={readOnly}
                        onChange={(event) => updateErradication(index, { nonConformingStems: sanitizeDecimalInput(event.target.value) })}
                      />
                    </label>
                  </div>
                  <div className="direct-bed-marking">
                    <span>Erradicación conforme</span>
                    <StatusToggle
                      value={item.conforme}
                      disabled={readOnly}
                      onChange={(value) => updateErradication(index, { conforme: value })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
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

function TswvStartScreen({ saveState, permissions, onCreate }) {
  return (
    <section className="checklist-start">
      <div>
        <p className="eyebrow">Chequeo</p>
        <h2>Aseguramiento TSWV</h2>
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

function TswvRecords({ records, recordsSource, isLoading, permissions, onEditRecord }) {
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

  const filterOptions = useMemo(() => getRecordFilterOptions(records, getFilterValues), [records]);
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

    downloadTswvRecordsExcel(filteredRecords);
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
            collaboratorLabel="Monitor"
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
        ) : filteredRecords.length ? filteredRecords.map((record) => (
          <div className="rb-record-wrapper" key={record.id}>
            <div role="button" tabIndex={0} className={expandedRecordId === record.id ? "rb-records-row expanded" : "rb-records-row"} onClick={() => setExpandedRecordId(expandedRecordId === record.id ? null : record.id)}>
              <span>{record.form?.monitorName || "Sin monitor"}</span>
              <span>{record.form?.assurerName || "Sin asegurador"}</span>
              <span>{record.savedDate}</span>
              <span>{record.weekCode}</span>
              <span>{formatNumber(record.score)} / {TSWV_TOTAL_SCORE}</span>
              <span>{formatNumber(record.percent)}%</span>
              <span>
                  {record.syncStatus === "pending" ? (
                    <em className="sync-status-pill">Pendiente</em>
                  ) : null}
                  <button type="button" className="edit-record-button" onClick={(event) => { event.stopPropagation(); onEditRecord(record); }}>{permissions.canEditRecords ? "Editar" : "Ver"}</button>
                </span>
            </div>
            {expandedRecordId === record.id ? <SummaryTable result={{ ...record.summary, totalScore: record.score, percent: record.percent }} observations={record.form?.observations} compact /> : null}
          </div>
        )) : <p className="records-empty">No hay registros con los filtros actuales.</p>}
      </div>
    </section>
  );
}

export default function TswvChecklistApp({ currentUser, permissions, onHome, onLogout }) {
  const [view, setView] = useState(
    permissions.canCreateChecklists ? CHECKLIST_VIEW : RECORDS_VIEW
  );
  const [isChecklistActive, setIsChecklistActive] = useState(false);
  const [form, setForm] = useState(createInitialForm);
  const [records, setRecords] = useState([]);
  const [recordsSource, setRecordsSource] = useState("Local");
  const [isRecordsLoading, setIsRecordsLoading] = useState(true);
  const [saveState, setSaveState] = useState(null);
  const [expandedSections, setExpandedSections] = useState(() => createExpandedSections(true));
  const [editingRecord, setEditingRecord] = useState(null);
  const result = useMemo(() => calculateTswvScore(form), [form]);
  const answeredCount =
    (String(form.monitoredBeds).trim() ? 1 : 0) +
    (isControlsComplete(form.controls) ? 1 : 0) +
    (isErradicationsComplete(form.erradications) ? 1 : 0);

  async function refreshRecords() {
    setIsRecordsLoading(true);

    try {
      const loaded = await loadTswvRecords();
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
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateControl(id, value) {
    setForm((current) => ({
      ...current,
      controls: { ...current.controls, [id]: value }
    }));
  }

  function toggleSection(id) {
    setExpandedSections((current) => ({ ...current, [id]: !current[id] }));
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
    setForm({ ...createInitialForm(), ...(record.form ?? {}) });
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

    const shouldLeave = window.confirm("¿Seguro que quieres dejar de editar este chequeo? No se guardará ningún cambio que hayas hecho.");
    if (!shouldLeave) return;

    clearChecklistData();
    setIsChecklistActive(false);
    setView(CHECKLIST_VIEW);
  }

  function returnHome() {
    if (isChecklistActive && editingRecord && permissions.canEditRecords) {
      const shouldLeave = window.confirm("¿Seguro que quieres dejar de editar este chequeo? No se guardará ningún cambio que hayas hecho.");
      if (!shouldLeave) return;
    } else if (isChecklistActive) {
      const shouldLeave = window.confirm("¿Seguro que quieres salir sin terminar el chequeo?");
      if (!shouldLeave) return;
    }

    clearChecklistData();
    setIsChecklistActive(false);
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
    if (!permissions.canEditRecords) return;

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
      ? await updateTswvRecord(record)
      : await saveTswvRecord(record);
    const isPending = nextRecords.some((item) => item.id === record.id && item.syncStatus === "pending");

    setRecords(nextRecords);
    setRecordsSource(getLocalSourceLabel(nextRecords));
    setSaveState({
      type: "success-message",
      message: isPending
        ? "Registro guardado local. Se sincronizar? con Supabase cuando haya conexi?n."
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
          <h1>Aseguramiento TSWV</h1>
        </div>
        <div className="header-actions">
          <span className="source-pill">{hasSupabaseConfig ? "Supabase activo" : "MVP local"}</span>
          <span className="source-pill">{currentUser.label}</span>
          <button type="button" className="ghost-action" onClick={onLogout}>Cerrar sesión</button>
          <button type="button" className="ghost-action" onClick={returnHome}>Inicio</button>
          <button type="button" className={view === CHECKLIST_VIEW ? "tab-button active" : "tab-button"} onClick={() => setView(CHECKLIST_VIEW)}>Chequeo</button>
          <button type="button" className={view === RECORDS_VIEW ? "tab-button active" : "tab-button"} onClick={() => setView(RECORDS_VIEW)}>Registros</button>
        </div>
      </header>

      {view === CHECKLIST_VIEW ? (
        isChecklistActive ? (
          <>
            <section className="progress-strip">
              <div><span>Secciones completas</span><strong>{answeredCount} / 3</strong></div>
              <div><span>Calificación</span><strong>{formatNumber(result.totalScore)} / {TSWV_TOTAL_SCORE}</strong></div>
              <div><span>% Cumplimiento</span><strong>{formatNumber(result.percent)}%</strong></div>
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
              readOnly={!permissions.canEditRecords}
            />
            <TswvErradicationsSection
              form={form}
              expanded={expandedSections.erradicaciones}
              onToggle={() => toggleSection("erradicaciones")}
              onChange={updateForm}
              readOnly={!permissions.canEditRecords}
            />
            <TswvControlsSection
              form={form}
              expanded={expandedSections.busqueda}
              onToggle={() => toggleSection("busqueda")}
              onAnswerChange={updateControl}
              readOnly={!permissions.canEditRecords}
            />

            <section className="section-band">
              <div className="section-heading">
                <div><span className="section-index">Observaciones</span><h2>Observaciones</h2></div>
              </div>
              <textarea
                className="observations-box"
                value={form.observations}
                readOnly={!permissions.canEditRecords}
                onChange={(event) => updateForm({ observations: event.target.value })}
              />
            </section>

            <SummaryTable result={result} observations={form.observations} onSave={handleSaveRecord} canSave={permissions.canEditRecords} />
          </>
        ) : (
          <TswvStartScreen saveState={saveState} permissions={permissions} onCreate={startChecklist} />
        )
      ) : (
        <TswvRecords
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

