import { useEffect, useMemo, useState } from "react";
import { RecordFilters, createEmptyRecordFilters, getRecordFilterOptions, matchesRecordFilters, toggleRecordFilterValue } from "./RecordFilters";
import { formatNumber } from "./lib/checklistMath";
import { downloadAspiradoRecordsExcel, getCurrentWeekCode } from "./lib/excelExport";
import { sanitizeDecimalInput } from "./lib/inputFormat";
import { hasSupabaseConfig } from "./lib/supabase";
import { loadAspiradoRecords, saveAspiradoRecord, updateAspiradoRecord } from "./lib/aspiradoRecords";

const CHECKLIST_VIEW = "checklist";
const RECORDS_VIEW = "records";
const STORAGE_KEY = "aspirado-checklist-records";
const ASSIGNED_BEDS = 16;
const RENDIMIENTO_SCORE = 10;
const REQUIREMENTS = [
  { id: "tapaoidos", label: "El aspirador cuenta con tapaoídos", criterion: "Cuenta con tapaoídos para realizar la labor.", weight: 5 },
  { id: "guantes", label: "El aspirador cuenta con guantes kimberly/baqueta", criterion: "Cuenta con guantes kimberly/baqueta en buen estado.", weight: 5 },
  { id: "bolsas_marcador", label: "El aspirador cuenta con bolsas plásticas y marcador", criterion: "Cuenta con bolsas plásticas y marcador para la captura.", weight: 5 },
  { id: "dispositivos", label: "Uso de dispositivos electrónicos", criterion: "Usa adecuadamente los dispositivos electrónicos durante la labor.", weight: 20 },
  { id: "almacenamiento", label: "Se almacena la máquina de forma adecuada", criterion: "La máquina se almacena en la ubicación definida y con el plástico en buen estado.", weight: 5 },
  { id: "maquina_asignada", label: "La máquina que usa el aspirador es la asignada", criterion: "El aspirador usa la máquina asignada para la labor.", weight: 5 }
];
const QUALITY_ITEMS = [
  { id: "tiempo_cama", label: "Las camas aseguradas se hacen en el tiempo correspondiente", criterion: "Las camas aseguradas se realizan en el tiempo correspondiente: 3 min/cama.", weight: 10 },
  { id: "jamas", label: "El aspirador cuenta con las jamas en buen estado", criterion: "Cuenta con las jamas en buen estado para mosca tigre y minador.", weight: 5 },
  { id: "horarios", label: "El aspirador da inicio o descansa en los horarios establecidos", criterion: "Inicia y toma descansos en los horarios establecidos.", weight: 5 },
  { id: "bolsa_captura", label: "El aspirador marca de forma correcta la bolsa de captura", criterion: "Marca la bolsa con bloque, nave, hora que termina la nave, fecha y aspirador.", weight: 5 },
  { id: "ubicacion", label: "El aspirador está ubicado en la nave correspondiente de la hora", criterion: "Al momento del aseguramiento está ubicado en la nave correspondiente de la hora.", weight: 5 }
];
const REQUIREMENTS_TOTAL = REQUIREMENTS.reduce((total, item) => total + item.weight, 0);
const QUALITY_TOTAL = QUALITY_ITEMS.reduce((total, item) => total + item.weight, 0);
const TOTAL_SCORE = RENDIMIENTO_SCORE + REQUIREMENTS_TOTAL + QUALITY_TOTAL;

function formatSavedDate(date) {
  return date.toLocaleDateString("es-CO", { year: "numeric", month: "2-digit", day: "2-digit" });
}
function formatSavedTime(date) {
  return date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}
function createAnswerMap(items) {
  return items.reduce((answers, item) => ({ ...answers, [item.id]: null }), {});
}
function createInitialForm() {
  return { aspiratorName: "", assurerName: "", monitoredBeds: "", requirements: createAnswerMap(REQUIREMENTS), quality: createAnswerMap(QUALITY_ITEMS), observations: "" };
}
function createExpandedSections(expanded = true) {
  return { rendimiento: expanded, requerimientos: expanded, calidad: expanded };
}

function readLocalRecords() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try { const parsed = JSON.parse(stored); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function writeLocalRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 100)));
}
function sanitizeMonitoredBedsInput(value) {
  const sanitizedValue = sanitizeDecimalInput(value);
  if (!sanitizedValue) return "";
  const numericValue = Number(sanitizedValue);
  return Number.isFinite(numericValue) && numericValue > ASSIGNED_BEDS ? String(ASSIGNED_BEDS) : sanitizedValue;
}
function calculateRendimientoScore(monitoredBeds) {
  const beds = Math.max(0, Math.min(ASSIGNED_BEDS, Number(monitoredBeds) || 0));
  return Math.round((beds / ASSIGNED_BEDS) * RENDIMIENTO_SCORE);
}
function calculateItemsScore(items, answers) {
  return items.reduce((score, item) => score + (answers[item.id] === "yes" ? item.weight : 0), 0);
}
function areItemsComplete(items, answers) {
  return items.every((item) => Boolean(answers[item.id]));
}
function isRendimientoComplete(form) {
  return Boolean(form.aspiratorName.trim() && form.assurerName.trim() && String(form.monitoredBeds).trim());
}

function calculateAspiradoScore(form) {
  const rendimientoScore = calculateRendimientoScore(form.monitoredBeds);
  const requirementsScore = calculateItemsScore(REQUIREMENTS, form.requirements);
  const qualityScore = calculateItemsScore(QUALITY_ITEMS, form.quality);
  const totalScore = rendimientoScore + requirementsScore + qualityScore;
  const percent = TOTAL_SCORE ? (totalScore / TOTAL_SCORE) * 100 : 0;
  const compliant = [];
  const nonCompliant = [];
  if (String(form.monitoredBeds).trim()) {
    const row = { sectionTitle: "Rendimiento", itemLabel: "Número de camas aspiradas en el día", criterion: `${formatNumber(Number(form.monitoredBeds) || 0)} de ${ASSIGNED_BEDS} camas asignadas en una hora.`, weight: RENDIMIENTO_SCORE };
    (rendimientoScore >= RENDIMIENTO_SCORE ? compliant : nonCompliant).push(row);
  }
  for (const item of REQUIREMENTS) {
    if (!form.requirements[item.id]) continue;
    const row = { sectionTitle: "Requerimientos", itemLabel: item.label, criterion: item.criterion, weight: item.weight };
    (form.requirements[item.id] === "yes" ? compliant : nonCompliant).push(row);
  }
  for (const item of QUALITY_ITEMS) {
    if (!form.quality[item.id]) continue;
    const row = { sectionTitle: "Calidad", itemLabel: item.label, criterion: item.criterion, weight: item.weight };
    (form.quality[item.id] === "yes" ? compliant : nonCompliant).push(row);
  }
  return { rendimientoScore, requirementsScore, qualityScore, totalScore, percent, compliant, nonCompliant };
}
function StatusToggle({ value, onChange, disabled = false }) {
  return <div className="status-toggle" role="group" aria-label="Cumplimiento"><button type="button" className={value === "yes" ? "selected yes" : ""} disabled={disabled} onClick={() => onChange("yes")}>Sí</button><button type="button" className={value === "no" ? "selected no" : ""} disabled={disabled} onClick={() => onChange("no")}>No</button></div>;
}

function SectionHeader({ number, title, expanded, onToggle, rightSlot }) {
  return <div className="section-heading"><div><span className="section-index">{number}</span><h2>{title}</h2></div><div className="section-heading-actions">{rightSlot}<button type="button" className={expanded ? "collapse-button expanded" : "collapse-button collapsed"} aria-expanded={expanded} aria-label={expanded ? "Plegar apartado" : "Desplegar apartado"} title={expanded ? "Plegar apartado" : "Desplegar apartado"} onClick={onToggle}><span className="collapse-icon" aria-hidden="true" /></button></div></div>;
}
function SummaryList({ title, items, emptyText, className, detail = "criterion" }) {
  return <div className={className}><h3>{title}</h3>{items.length ? items.map((item, index) => <p key={item.sectionTitle + item.itemLabel + index}><strong>{item.itemLabel}</strong><span>{detail === "section" ? item.sectionTitle : item.criterion}</span></p>) : <p className="empty-state">{emptyText}</p>}</div>;
}
function SummaryTable({ result, observations, onSave, canSave = false, compact = false }) {
  return <section className={compact ? "record-summary" : "summary-panel"}><div className={compact ? "record-summary-title" : "summary-top"}>{compact ? <><strong>Resumen del registro</strong><span>{formatNumber(result.totalScore)} / {formatNumber(TOTAL_SCORE)} - {formatNumber(result.percent)}%</span></> : <><div><span className="section-index">Resumen</span><h2>Resultado del chequeo</h2></div><div className="score-card"><span>Calificación</span><strong>{formatNumber(result.totalScore)} / {formatNumber(TOTAL_SCORE)}</strong><small>{formatNumber(result.percent)}% cumplimiento</small></div></>}</div><div className="summary-grid"><SummaryList className="summary-column good" title="Cumple" items={result.compliant} emptyText="Sin ítems cumplidos." detail="section" /><SummaryList className="summary-column bad" title="No cumple" items={result.nonCompliant} emptyText="Sin situaciones por mejorar." /><div className="summary-column notes"><h3>Observaciones</h3>{observations?.trim() ? <p>{observations}</p> : <p className="empty-state">Sin observaciones.</p>}</div></div>{canSave ? <div className="summary-actions"><button type="button" className="primary-action" onClick={onSave}>Guardar registro</button></div> : null}</section>;
}
function RendimientoSection({ form, expanded, onToggle, onChange, readOnly }) {
  const complete = isRendimientoComplete(form);
  const score = calculateRendimientoScore(form.monitoredBeds);
  return <section className={complete ? "section-band completed-section" : "section-band"}><SectionHeader number="1" title="Rendimiento" expanded={expanded} onToggle={onToggle} rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(RENDIMIENTO_SCORE)}</div>} />{expanded ? <div className="collapsible-content"><div className="field-grid rb-monitoring-fields"><label className="form-field"><span>Aspirador</span><input value={form.aspiratorName} readOnly={readOnly} onChange={(event) => onChange({ aspiratorName: event.target.value })} /></label><label className="form-field"><span>Asegurador</span><input value={form.assurerName} readOnly={readOnly} onChange={(event) => onChange({ assurerName: event.target.value })} /></label><label className="form-field"><span>Número de camas asignadas en una hora</span><input type="text" value={ASSIGNED_BEDS} disabled readOnly /></label><label className="form-field"><span>Número de camas aspiradas en el día</span><input inputMode="decimal" value={form.monitoredBeds} readOnly={readOnly} onChange={(event) => onChange({ monitoredBeds: sanitizeMonitoredBedsInput(event.target.value) })} /></label></div></div> : null}</section>;
}

function ItemsSection({ number, title, items, answers, score, total, expanded, onToggle, onAnswerChange, readOnly }) {
  const complete = areItemsComplete(items, answers);
  return <section className={complete ? "section-band completed-section" : "section-band"}><SectionHeader number={number} title={title} expanded={expanded} onToggle={onToggle} rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(total)}</div>} />{expanded ? <div className="collapsible-content"><div className="item-table without-value monitoring-control-table"><div className="item-table-head"><span>Item</span><span>Criterio</span><span>Peso</span><span>Cumple</span></div>{items.map((item) => <div className="item-row" key={item.id}><div className="item-title">{item.label}</div><div>{item.criterion}</div><div>{item.weight}</div><div><StatusToggle value={answers[item.id]} disabled={readOnly} onChange={(value) => onAnswerChange(item.id, value)} /></div></div>)}</div></div> : null}</section>;
}
function RecordsLoadingState() {
  return <div className="records-loading" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" /><span>Cargando registros...</span></div>;
}
function AspiradoStartScreen({ saveState, permissions, onCreate }) {
  return <section className="checklist-start"><div><p className="eyebrow">Chequeo</p><h2>Aseguramiento de Aspirado</h2><p>Inicia un nuevo registro para desplegar las secciones del chequeo.</p></div>{permissions.canCreateChecklists ? <button type="button" className="primary-action create-checklist-button" onClick={onCreate}>Crear Chequeo</button> : <p className="permission-note">Tu usuario puede ver registros, pero no crear chequeos.</p>}{saveState ? <span className={saveState.type}>{saveState.message}</span> : null}</section>;
}
function AspiradoRecords({ records, recordsSource, isLoading, permissions, onEditRecord }) {
  const [expandedRecordId, setExpandedRecordId] = useState(null);
  const [draftFilters, setDraftFilters] = useState(createEmptyRecordFilters);
  const [appliedFilters, setAppliedFilters] = useState(createEmptyRecordFilters);
  function getFilterValues(record) { return { week: record.weekCode, date: record.savedDate, collaborator: record.form?.aspiratorName, assurer: record.form?.assurerName }; }
  const filterOptions = useMemo(() => getRecordFilterOptions(records, getFilterValues), [records]);
  const filteredRecords = useMemo(() => records.filter((record) => matchesRecordFilters(getFilterValues(record), appliedFilters)), [records, appliedFilters]);
  function toggleFilter(field, value) { setDraftFilters((current) => toggleRecordFilterValue(current, field, value)); }
  function applyFilters() { setAppliedFilters(draftFilters); }
  function clearFilters() { const emptyFilters = createEmptyRecordFilters(); setDraftFilters(emptyFilters); setAppliedFilters(emptyFilters); }
  function handleDownloadExcel() { if (!filteredRecords.length) { window.alert("No hay registros para descargar con los filtros actuales."); return; } downloadAspiradoRecordsExcel(filteredRecords); }
  return <section className="records-section"><div className="records-heading"><div><span className="section-index">Registros</span><h2>Chequeos guardados</h2></div><div className="records-actions"><RecordFilters options={filterOptions} draftFilters={draftFilters} appliedFilters={appliedFilters} onToggle={toggleFilter} onApply={applyFilters} onClear={clearFilters} collaboratorLabel="Aspirador" />{permissions.canDownloadExcel ? <button type="button" className="secondary-action" onClick={handleDownloadExcel}>Descargar Excel</button> : null}<span className="source-pill">{recordsSource}</span></div></div><div className="rb-records-table"><div className="rb-records-head"><span>Aspirador</span><span>Asegurador</span><span>Fecha</span><span>Semana</span><span>Calificación</span><span>%</span><span>Acción</span></div>{isLoading ? <RecordsLoadingState /> : filteredRecords.length ? filteredRecords.map((record) => <div className="rb-record-wrapper" key={record.id}><div role="button" tabIndex={0} className={expandedRecordId === record.id ? "rb-records-row expanded" : "rb-records-row"} onClick={() => setExpandedRecordId(expandedRecordId === record.id ? null : record.id)}><span>{record.form?.aspiratorName || "Sin aspirador"}</span><span>{record.form?.assurerName || "Sin asegurador"}</span><span>{record.savedDate || "-"}</span><span>{record.weekCode || "-"}</span><span>{formatNumber(record.score)} / {TOTAL_SCORE}</span><span>{formatNumber(record.percent)}%</span><span>{record.syncStatus === "pending" ? <em className="sync-status-pill">Pendiente</em> : null}<button type="button" className="edit-record-button" onClick={(event) => { event.stopPropagation(); onEditRecord(record); }}>{permissions.canEditRecords ? "Editar" : "Ver"}</button></span></div>{expandedRecordId === record.id ? <SummaryTable result={{ ...record.summary, totalScore: record.score, percent: record.percent }} observations={record.form?.observations} compact /> : null}</div>) : <p className="records-empty">No hay registros con los filtros actuales.</p>}</div></section>;
}

export default function AspiradoChecklistApp({ currentUser, permissions, onHome, onLogout }) { 
  const [view, setView] = useState(permissions.canCreateChecklists ? CHECKLIST_VIEW : RECORDS_VIEW); 
  const [isChecklistActive, setIsChecklistActive] = useState(false); 
  const [form, setForm] = useState(createInitialForm); 
  const [records, setRecords] = useState([]);
  const [recordsSource, setRecordsSource] = useState("Local");
  const [isRecordsLoading, setIsRecordsLoading] = useState(true); 
  const [saveState, setSaveState] = useState(null); 
  const [expandedSections, setExpandedSections] = useState(() => createExpandedSections(true)); 
  const [editingRecord, setEditingRecord] = useState(null); 
  const result = useMemo(() => calculateAspiradoScore(form), [form]); 
  const answeredCount = (String(form.monitoredBeds).trim() ? 1 : 0) + (areItemsComplete(REQUIREMENTS, form.requirements) ? 1 : 0) + (areItemsComplete(QUALITY_ITEMS, form.quality) ? 1 : 0); 
  async function refreshRecords() { setIsRecordsLoading(true); try { const loaded = await loadAspiradoRecords(); setRecords(loaded.records); setRecordsSource(loaded.sourceLabel); } finally { setIsRecordsLoading(false); } }
  useEffect(() => { refreshRecords(); function handleConnectivityChange() { refreshRecords(); } window.addEventListener("online", handleConnectivityChange); return () => window.removeEventListener("online", handleConnectivityChange); }, []);
  useEffect(() => { if (view === RECORDS_VIEW) { refreshRecords(); const intervalId = window.setInterval(refreshRecords, 15000); return () => window.clearInterval(intervalId); } return undefined; }, [view]);
  function updateForm(patch) { setForm((current) => ({ ...current, ...patch })); }
  function updateRequirement(id, value) { setForm((current) => ({ ...current, requirements: { ...current.requirements, [id]: value } })); }
  function updateQuality(id, value) { setForm((current) => ({ ...current, quality: { ...current.quality, [id]: value } })); }
  function toggleSection(id) { setExpandedSections((current) => ({ ...current, [id]: !current[id] })); }
  function clearChecklistData(clearSaveState = true) { setForm(createInitialForm()); setExpandedSections(createExpandedSections(true)); setEditingRecord(null); if (clearSaveState) setSaveState(null); }
  function startChecklist() { clearChecklistData(); setIsChecklistActive(true); setView(CHECKLIST_VIEW); }
  function editRecord(record) { setForm({ ...createInitialForm(), ...(record.form ?? {}) }); setEditingRecord(record); setSaveState(null); setExpandedSections(createExpandedSections(true)); setIsChecklistActive(true); setView(CHECKLIST_VIEW); }
  function cancelEditRecord() { if (!permissions.canEditRecords) { clearChecklistData(); setIsChecklistActive(false); setView(RECORDS_VIEW); return; } const shouldLeave = window.confirm("¿Seguro que quieres dejar de editar este chequeo? No se guardará ningún cambio que hayas hecho."); if (!shouldLeave) return; clearChecklistData(); setIsChecklistActive(false); setView(CHECKLIST_VIEW); }
  function returnHome() { if (isChecklistActive && editingRecord && permissions.canEditRecords) { const shouldLeave = window.confirm("¿Seguro que quieres dejar de editar este chequeo? No se guardará ningún cambio que hayas hecho."); if (!shouldLeave) return; } else if (isChecklistActive) { const shouldLeave = window.confirm("¿Seguro que quieres salir sin terminar el chequeo?"); if (!shouldLeave) return; } clearChecklistData(); setIsChecklistActive(false); setView(CHECKLIST_VIEW); onHome(); }
  function getLocalSourceLabel(nextRecords) { const pendingCount = nextRecords.filter((record) => record.syncStatus === "pending").length; if (!pendingCount) return hasSupabaseConfig ? "Supabase" : "Local"; return "Supabase (" + pendingCount + " pendiente" + (pendingCount === 1 ? "" : "s") + ")"; }
  async function handleSaveRecord() { if (!permissions.canEditRecords) return; const savedAt = new Date(); const record = { id: editingRecord?.id ?? crypto.randomUUID(), createdAt: editingRecord?.createdAt ?? savedAt.toISOString(), finishedAt: savedAt.toISOString(), savedDate: formatSavedDate(savedAt), savedTime: formatSavedTime(savedAt), weekCode: getCurrentWeekCode(), form, score: result.totalScore, percent: result.percent, summary: { compliant: result.compliant, nonCompliant: result.nonCompliant } }; const nextRecords = editingRecord ? await updateAspiradoRecord(record) : await saveAspiradoRecord(record); const isPending = nextRecords.some((item) => item.id === record.id && item.syncStatus === "pending"); setRecords(nextRecords); setRecordsSource(getLocalSourceLabel(nextRecords)); setSaveState({ type: "success-message", message: isPending ? (editingRecord ? "Registro actualizado localmente. Se sincronizará con Supabase cuando haya conexión." : "Registro guardado localmente. Se sincronizará con Supabase cuando haya conexión.") : (editingRecord ? "Registro actualizado." : "Registro guardado.") }); clearChecklistData(false); setIsChecklistActive(false); setView(CHECKLIST_VIEW); }
  return <main className="app-shell"><header className="app-header"><div><p className="eyebrow">Flores El Trigal</p><h1>Aseguramiento de Aspirado</h1></div><div className="header-actions"><span className="source-pill">{recordsSource}</span><span className="source-pill">{currentUser.label}</span><button type="button" className="ghost-action" onClick={onLogout}>Cerrar sesión</button><button type="button" className="ghost-action" onClick={returnHome}>Inicio</button><button type="button" className={view === CHECKLIST_VIEW ? "tab-button active" : "tab-button"} onClick={() => setView(CHECKLIST_VIEW)}>Chequeo</button><button type="button" className={view === RECORDS_VIEW ? "tab-button active" : "tab-button"} onClick={() => setView(RECORDS_VIEW)}>Registros</button></div></header>{view === CHECKLIST_VIEW ? (isChecklistActive ? <><section className="progress-strip"><div><span>Secciones completas</span><strong>{answeredCount} / 3</strong></div><div><span>Calificación</span><strong>{formatNumber(result.totalScore)} / {TOTAL_SCORE}</strong></div><div><span>% Cumplimiento</span><strong>{formatNumber(result.percent)}%</strong></div>{editingRecord ? <div className="edit-mode-panel"><div><span>Modo</span><strong>{permissions.canEditRecords ? "Edición" : "Visualización"}</strong></div><button type="button" className="danger-action" onClick={cancelEditRecord}>Salir</button></div> : null}</section><RendimientoSection form={form} expanded={expandedSections.rendimiento} onToggle={() => toggleSection("rendimiento")} onChange={updateForm} readOnly={!permissions.canEditRecords} /><ItemsSection number="2" title="Requerimientos" items={REQUIREMENTS} answers={form.requirements} score={result.requirementsScore} total={REQUIREMENTS_TOTAL} expanded={expandedSections.requerimientos} onToggle={() => toggleSection("requerimientos")} onAnswerChange={updateRequirement} readOnly={!permissions.canEditRecords} /><ItemsSection number="3" title="Calidad" items={QUALITY_ITEMS} answers={form.quality} score={result.qualityScore} total={QUALITY_TOTAL} expanded={expandedSections.calidad} onToggle={() => toggleSection("calidad")} onAnswerChange={updateQuality} readOnly={!permissions.canEditRecords} /><section className="section-band"><div className="section-heading"><div><span className="section-index">Observaciones</span><h2>Observaciones</h2></div></div><textarea className="observations-box" value={form.observations} readOnly={!permissions.canEditRecords} onChange={(event) => updateForm({ observations: event.target.value })} /></section><SummaryTable result={result} observations={form.observations} onSave={handleSaveRecord} canSave={permissions.canEditRecords} /></> : <AspiradoStartScreen saveState={saveState} permissions={permissions} onCreate={startChecklist} />) : <AspiradoRecords records={records} recordsSource={recordsSource} isLoading={isRecordsLoading} permissions={permissions} onEditRecord={editRecord} />}</main>;
}

