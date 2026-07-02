import { Fragment, useEffect, useMemo, useState } from "react";
import DirectMonitoringApp from "./DirectMonitoringApp";
import TswvChecklistApp from "./TswvChecklistApp";
import AspiradoChecklistApp from "./AspiradoChecklistApp";
import RbMonitoringApp from "./RbMonitoringApp";
import {
  RecordFilters,
  createEmptyRecordFilters,
  getRecordFilterOptions,
  matchesRecordFilters,
  toggleRecordFilterValue
} from "./RecordFilters";
import { CHECKLIST_SECTIONS } from "./data/checklistConfig";
import {
  buildInitialAnswers,
  calculateMatrixSection,
  calculateScore,
  formatNumber,
  getMatrixAnswerId
} from "./lib/checklistMath";
import { loadRecords, saveRecord, updateRecord } from "./lib/records";
import { hasSupabaseConfig } from "./lib/supabase";
import { sanitizeDecimalInput } from "./lib/inputFormat";
import {
  authenticateUser,
  clearSessionUser,
  getPermissions,
  loadSessionUser
} from "./lib/auth";
import {
  downloadSprayRecordsExcel,
  getCurrentWeekCode,
  getSprayRecordWeekCode
} from "./lib/excelExport";

const CHECKLIST_VIEW = "checklist";
const RECORDS_VIEW = "records";
const SPRAY_CHECKLIST_MODULE = "spray-checklist";
const RB_MONITORING_MODULE = "rb-monitoring";
const DIRECT_MONITORING_MODULE = "direct-monitoring";
const TSWV_CHECKLIST_MODULE = "tswv-checklist";
const ASPIRADO_CHECKLIST_MODULE = "aspirado-checklist";
const metadataSection = CHECKLIST_SECTIONS.find((section) => section.kind === "metadata");
const observationSection = CHECKLIST_SECTIONS.find((section) => section.kind === "observations");
const scoredSections = CHECKLIST_SECTIONS.filter((section) => Array.isArray(section.items));
const collapsibleSectionIds = CHECKLIST_SECTIONS.map((section) => section.id);
const sectionsWithValueColumn = new Set(["mezcla_clima"]);
const highlightedMetadataFields = new Set([
  "assurerName",
  "assurerRole",
  "block",
  "sprayerGroup",
  "stepsPerBed",
  "volumePerBed",
  "theoreticalFlow",
  "theoreticalTravelTime"
]);

function createInitialMetadata() {
  return metadataSection.fields.reduce((metadata, field) => {
    metadata[field.id] = metadata[field.id] ?? field.defaultValue ?? "";
    return metadata;
  }, {});
}

function createInitialProducts() {
  return Array.from({ length: metadataSection.productCount }, () => "");
}

function createExpandedSections(expanded = true) {
  return collapsibleSectionIds.reduce((sections, sectionId) => {
    sections[sectionId] = expanded;
    return sections;
  }, {});
}

function createInitialSprayerCounts() {
  return scoredSections.reduce((counts, section) => {
    if (section.matrix) {
      counts[section.id] = section.matrix.defaultSprayerCount;
    }

    return counts;
  }, {});
}

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

function getRecordDate(record) {
  if (record.metadata?.savedDate) {
    return record.metadata.savedDate;
  }

  if (record.metadata?.applicationDate) {
    return record.metadata.applicationDate;
  }

  return record.finishedAt ? formatSavedDate(new Date(record.finishedAt)) : "-";
}

function getRecordTime(record) {
  if (record.metadata?.savedTime) {
    return record.metadata.savedTime;
  }

  if (record.metadata?.finishedTime) {
    return record.metadata.finishedTime;
  }

  return record.finishedAt ? formatSavedTime(new Date(record.finishedAt)) : "-";
}

function getRecordCalification(record) {
  const compliantScore = Number.isFinite(record.score) ? record.score : 0;
  const baseScore = Number.isFinite(record.calificationBaseScore)
    ? record.calificationBaseScore
    : 212;
  const percent = Number.isFinite(record.calificationPercent)
    ? record.calificationPercent
    : (compliantScore / baseScore) * 100;

  return {
    compliantScore,
    baseScore,
    percent
  };
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

function MetadataSection({
  metadata,
  products,
  expanded,
  onToggle,
  onMetadataChange,
  onProductChange,
  readOnly = false
}) {
  const isSectionComplete = [...highlightedMetadataFields].every((fieldId) =>
    String(metadata[fieldId] ?? "").trim()
  );

  return (
    <section className={isSectionComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="01"
        title={metadataSection.title}
        expanded={expanded}
        onToggle={onToggle}
      />

      {expanded ? (
        <div className="collapsible-content">
          <div className="field-grid">
            {metadataSection.fields.map((field) => (
              <label key={field.id} className="form-field">
                <span>
                  {field.label}
                  {field.required ? <b>*</b> : null}
                </span>
                <input
                  type="text"
                  inputMode={field.type === "decimal" ? "decimal" : undefined}
                  value={metadata[field.id] ?? ""}
                  disabled={readOnly}
                  onChange={(event) =>
                    onMetadataChange(
                      field.id,
                      field.type === "decimal"
                        ? sanitizeDecimalInput(event.target.value)
                        : event.target.value
                    )
                  }
                  required={field.required}
                />
              </label>
            ))}
          </div>

          <div className="products-block">
            <h3>Productos químicos</h3>
            <div className="products-grid">
              {products.map((product, index) => (
                <label key={index} className="form-field compact">
                  <span>Producto {index + 1}</span>
                  <input
                    type="text"
                    value={product}
                    disabled={readOnly}
                    onChange={(event) => onProductChange(index, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ChecklistSection({
  section,
  index,
  expanded,
  answers,
  sprayerCount,
  onSprayerCountChange,
  onToggle,
  onAnswerChange,
  readOnly = false
}) {
  const showValueColumn = sectionsWithValueColumn.has(section.id);
  const matrixResult = section.matrix
    ? calculateMatrixSection(section, answers, sprayerCount)
    : null;
  const isSectionComplete = section.matrix
    ? section.items.every((item) =>
        Array.from({ length: sprayerCount }, (_, itemIndex) => {
          const answerId = getMatrixAnswerId(item.id, itemIndex + 1);
          return Boolean(answers[answerId]?.status);
        }).every(Boolean)
      )
    : section.items.every((item) => Boolean(answers[item.id]?.status));
  const sectionMax = section.matrix
    ? section.matrix.totalWeight
    : section.items.reduce((total, item) => total + item.weight, 0);
  const sectionScore = section.matrix
    ? matrixResult.convertedScore
    : section.items.reduce((total, item) => {
        return total + (answers[item.id]?.status === "yes" ? item.weight : 0);
      }, 0);

  return (
    <section className={isSectionComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number={String(index).padStart(2, "0")}
        title={section.title}
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={(
          <div className="section-score">
            {formatNumber(sectionScore)} / {formatNumber(sectionMax)}
          </div>
        )}
      />

      {expanded ? (
        <div className="collapsible-content">
          {section.note ? <p className="section-note">{section.note}</p> : null}

          {section.matrix ? (
            <>
              <label className="sprayer-count-control">
                <span>Número de asperjadores</span>
                <select
                  value={sprayerCount}
                  disabled={readOnly}
                  onChange={(event) => onSprayerCountChange(Number(event.target.value))}
                >
                  {Array.from({ length: section.matrix.maxSprayerCount }, (_, itemIndex) => itemIndex + 1).map(
                    (count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    )
                  )}
                </select>
              </label>

              <div className="matrix-score-note">
                <span>
                  Peso real cumplido: {formatNumber(matrixResult.rawEarnedScore)} /{" "}
                  {formatNumber(matrixResult.rawMaxScore)}
                </span>
                <span>{formatNumber(matrixResult.rawPercent)}%</span>
                <strong>
                  Puntaje aplicado: {formatNumber(matrixResult.convertedScore)} /{" "}
                  {formatNumber(matrixResult.convertedMaxScore)}
                </strong>
              </div>

              <div
                className="sprayer-matrix"
                style={{ "--sprayer-count": sprayerCount }}
              >
                <div className="sprayer-matrix-head">
                  <span>Ítem</span>
                  <span>Criterio</span>
                  <span>Peso/asp.</span>
                  {Array.from({ length: sprayerCount }, (_, itemIndex) => (
                    <span key={itemIndex}>Asperjador {itemIndex + 1}</span>
                  ))}
                </div>

                {section.items.map((item) => (
                  <div className="sprayer-matrix-row" key={item.id}>
                    <div className="item-title">{item.label}</div>
                    <div className="item-criterion">{item.criterion}</div>
                    <div className="item-weight">{formatNumber(item.weight / sprayerCount)}</div>
                    {Array.from({ length: sprayerCount }, (_, itemIndex) => {
                      const sprayerNumber = itemIndex + 1;
                      const answerId = getMatrixAnswerId(item.id, sprayerNumber);
                      const answer = answers[answerId] ?? {};

                      return (
                        <div className="sprayer-cell" key={answerId}>
                          <input
                            className="value-input"
                            type="text"
                            inputMode="decimal"
                            value={answer.value ?? ""}
                            placeholder="Valor medido"
                            disabled={readOnly}
                            onChange={(event) =>
                              onAnswerChange(answerId, {
                                value: sanitizeDecimalInput(event.target.value)
                              })
                            }
                          />
                          <StatusToggle
                            value={answer.status}
                            disabled={readOnly}
                            onChange={(status) => onAnswerChange(answerId, { status })}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={showValueColumn ? "item-table with-value" : "item-table without-value"}>
              <div className="item-table-head">
                <span>Ítem</span>
                <span>Criterio</span>
                <span>Peso</span>
                {showValueColumn ? <span>Valor</span> : null}
                <span>Cumple</span>
              </div>

              {section.items.map((item) => {
                const answer = answers[item.id] ?? {};

                return (
                  <div key={item.id} className="item-row">
                    <div className="item-title">{item.label}</div>
                    <div className="item-criterion">{item.criterion}</div>
                    <div className="item-weight">{formatNumber(item.weight)}</div>
                    {showValueColumn ? (
                      <div>
                        <input
                          className="value-input"
                          type="text"
                          inputMode="decimal"
                          value={answer.value ?? ""}
                          placeholder={item.valueLabel ?? "-"}
                          disabled={readOnly}
                          onChange={(event) =>
                            onAnswerChange(item.id, {
                              value: sanitizeDecimalInput(event.target.value)
                            })
                          }
                        />
                      </div>
                    ) : null}
                    <StatusToggle
                      value={answer.status}
                      disabled={readOnly}
                      onChange={(status) => onAnswerChange(item.id, { status })}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ObservationsSection({ value, expanded, onToggle, onChange, readOnly = false }) {
  return (
    <section className="section-band">
      <SectionHeader
        number="07"
        title={observationSection.title}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded ? (
        <div className="collapsible-content">
          <label className="form-field">
            <span>Situación a mejorar</span>
            <textarea
              value={value}
              readOnly={readOnly}
              onChange={(event) => onChange(event.target.value)}
              rows="5"
            />
          </label>
        </div>
      ) : null}
    </section>
  );
}

function SummaryPanel({ result, observations, onSave, saveState, canSave = true }) {
  const observedRows = [...result.compliant, ...result.nonCompliant].filter((row) =>
    row.observation.trim()
  );

  return (
    <section className="summary-panel">
      <div className="summary-top">
        <div>
          <span className="section-index">Resumen</span>
          <h2>Resultado del chequeo</h2>
        </div>
        <div className="score-card">
          <span>Calificación</span>
          <strong>
            {formatNumber(result.earnedScore)} / {formatNumber(result.calificationBaseScore)}
          </strong>
          <em>{formatNumber(result.calificationPercent)}%</em>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-column good">
          <h3>Cumple</h3>
          {result.compliant.length ? (
            result.compliant.map((row) => (
              <p key={row.itemId}>
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
              <p key={row.itemId}>
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
          {observations.trim() ? <p>{observations}</p> : null}
          {observedRows.map((row) => (
            <p key={row.itemId}>
              <strong>{row.itemLabel}</strong>
              <span>{row.observation}</span>
            </p>
          ))}
          {!observations.trim() && !observedRows.length ? (
            <p className="empty-state">Sin observaciones.</p>
          ) : null}
        </div>
      </div>

      <div className="summary-actions">
        {canSave ? (
          <button type="button" className="primary-action" onClick={onSave}>
            Guardar registro
          </button>
        ) : null}
        {saveState ? <span className={saveState.type}>{saveState.message}</span> : null}
      </div>
    </section>
  );
}

function RecordSummary({ record }) {
  const calification = getRecordCalification(record);
  const compliant = record.summary?.compliant ?? [];
  const nonCompliant = record.summary?.nonCompliant ?? [];
  const observedRows = [...compliant, ...nonCompliant].filter((row) =>
    row.observation?.trim()
  );

  return (
    <div className="record-summary">
      <div className="record-summary-title">
        <strong>Resumen del registro</strong>
        <span>
          {formatNumber(calification.compliantScore)} / {formatNumber(calification.baseScore)} -{" "}
          {formatNumber(calification.percent)}%
        </span>
      </div>

      <div className="summary-grid">
        <div className="summary-column good">
          <h3>Cumple</h3>
          {compliant.length ? (
            compliant.map((row) => (
              <p key={row.itemId}>
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
          {nonCompliant.length ? (
            nonCompliant.map((row) => (
              <p key={row.itemId}>
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
          {record.observations?.trim() ? <p>{record.observations}</p> : null}
          {observedRows.map((row) => (
            <p key={row.itemId}>
              <strong>{row.itemLabel}</strong>
              <span>{row.observation}</span>
            </p>
          ))}
          {!record.observations?.trim() && !observedRows.length ? (
            <p className="empty-state">Sin observaciones.</p>
          ) : null}
        </div>
      </div>
    </div>
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

function RecordsView({ records, recordsSource, isLoading, permissions, onEditRecord }) {
  const [expandedRecordId, setExpandedRecordId] = useState(null);
  const [draftFilters, setDraftFilters] = useState(createEmptyRecordFilters);
  const [appliedFilters, setAppliedFilters] = useState(createEmptyRecordFilters);

  function getFilterValues(record) {
    return {
      week: getSprayRecordWeekCode(record),
      date: getRecordDate(record),
      collaborator: record.metadata?.sprayerGroup,
      assurer: record.metadata?.assurerName
    };
  }

  const filterOptions = useMemo(() =>
    getRecordFilterOptions(records, getFilterValues),
  [records]);
  const filteredRecords = useMemo(() => records.filter((record) =>
    matchesRecordFilters(getFilterValues(record), appliedFilters)
  ), [records, appliedFilters]);

  function toggleRecord(recordId) {
    setExpandedRecordId((current) => (current === recordId ? null : recordId));
  }

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

    downloadSprayRecordsExcel(filteredRecords);
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

      <div className="records-table">
        <div className="records-head">
          <span>Grupo</span>
          <span>Bloque</span>
          <span>Fecha</span>
          <span>Semana</span>
          <span>Hora</span>
          <span>Asegurador</span>
          <span>Cargo</span>
          <span>Calificación</span>
          <span>% Calif.</span>
          <span>Acción</span>
        </div>

        {isLoading ? (
          <RecordsLoadingState />
        ) : filteredRecords.length ? (
          filteredRecords.map((record) => {
            const calification = getRecordCalification(record);

            return (
              <Fragment key={record.id}>
                <div
                  role="button"
                  tabIndex={0}
                  className={expandedRecordId === record.id ? "records-row expanded" : "records-row"}
                  onClick={() => toggleRecord(record.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleRecord(record.id);
                    }
                  }}
                >
                  <span>{record.metadata?.sprayerGroup || "-"}</span>
                  <span>{record.metadata?.block || "-"}</span>
                  <span>{getRecordDate(record)}</span>
                  <span>{getSprayRecordWeekCode(record)}</span>
                  <span>{getRecordTime(record)}</span>
                  <span>{record.metadata?.assurerName || "-"}</span>
                  <span>{record.metadata?.assurerRole || "-"}</span>
                  <span>
                    {formatNumber(calification.compliantScore)} / {formatNumber(calification.baseScore)}
                  </span>
                  <span>{formatNumber(calification.percent)}%</span>
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
                {expandedRecordId === record.id ? <RecordSummary record={record} /> : null}
              </Fragment>
            );
          })
        ) : (
          <div className="records-empty">No hay registros guardados.</div>
        )}
      </div>
    </section>
  );
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const user = await authenticateUser(username, password);
      onLogin(user);
    } catch (authError) {
      setError(authError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="home-shell">
      <section className="login-panel">
        <div>
          <p className="eyebrow">Flores El Trigal</p>
          <h1>Listas de chequeo</h1>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Usuario</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" className="primary-action" disabled={isSubmitting}>
            {isSubmitting ? "Ingresando..." : "Iniciar sesión"}
          </button>
          {error ? <span className="error-message">{error}</span> : null}
        </form>
      </section>
    </main>
  );
}

function HomeScreen({
  currentUser,
  onLogout,
  onOpenSprayChecklist,
  onOpenRbMonitoring,
  onOpenDirectMonitoring,
  onOpenTswvChecklist,
  onOpenAspiradoChecklist
}) {
  return (
    <main className="home-shell">
      <section className="home-panel">
        <div>
          <p className="eyebrow">Flores El Trigal</p>
          <h1>Listas de chequeo</h1>
          <p className="session-text">Sesión: {currentUser.label}</p>
        </div>
        <button type="button" className="ghost-action logout-action" onClick={onLogout}>
          Cerrar sesión
        </button>

        <div className="checklist-options">
          <button type="button" className="checklist-option" onClick={onOpenSprayChecklist}>
            <span>Listado chequeo ejecución aplicación de plaguicidas</span>
            <strong>Ingresar</strong>
          </button>
          <button type="button" className="checklist-option" onClick={onOpenRbMonitoring}>
            <span>Aseguramiento de monitoreo roya blanca</span>
            <strong>Ingresar</strong>
          </button>
          <button type="button" className="checklist-option" onClick={onOpenDirectMonitoring}>
            <span>Aseguramiento de monitoreo directo</span>
            <strong>Ingresar</strong>
          </button>
          <button type="button" className="checklist-option" onClick={onOpenTswvChecklist}>
            <span>Aseguramiento TSWV</span>
            <strong>Ingresar</strong>
          </button>
          <button type="button" className="checklist-option" onClick={onOpenAspiradoChecklist}>
            <span>Aseguramiento de Aspirado</span>
            <strong>Ingresar</strong>
          </button>
        </div>
      </section>
    </main>
  );
}

function AuthLoadingScreen() {
  return (
    <main className="home-shell">
      <section className="login-panel">
        <div>
          <p className="eyebrow">Flores El Trigal</p>
          <h1>Listas de chequeo</h1>
        </div>
        <div className="records-loading auth-loading">
          <span className="loading-spinner" aria-hidden="true" />
          <span>Validando sesión...</span>
        </div>
      </section>
    </main>
  );
}

function ChecklistStartScreen({ saveState, permissions, onCreate }) {
  return (
    <section className="checklist-start">
      <div>
        <p className="eyebrow">Chequeo</p>
        <h2>Listado chequeo ejecución aplicación de plaguicidas</h2>
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

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const permissions = getPermissions(currentUser);
  const [activeModule, setActiveModule] = useState(null);
  const [view, setView] = useState(CHECKLIST_VIEW);
  const [isChecklistActive, setIsChecklistActive] = useState(false);
  const [metadata, setMetadata] = useState(createInitialMetadata);
  const [products, setProducts] = useState(createInitialProducts);
  const [answers, setAnswers] = useState(buildInitialAnswers);
  const [observations, setObservations] = useState("");
  const [records, setRecords] = useState([]);
  const [recordsSource, setRecordsSource] = useState("Local");
  const [isRecordsLoading, setIsRecordsLoading] = useState(true);
  const [saveState, setSaveState] = useState(null);
  const [expandedSections, setExpandedSections] = useState(() => createExpandedSections(true));
  const [sprayerCounts, setSprayerCounts] = useState(createInitialSprayerCounts);
  const [editingRecord, setEditingRecord] = useState(null);

  const result = useMemo(
    () => calculateScore(answers, { sprayerCounts }),
    [answers, sprayerCounts]
  );
  const answeredCount = result.answeredCount;
  const totalItems = result.answerableCount;

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      const sessionUser = await loadSessionUser();

      if (isMounted) {
        setCurrentUser(sessionUser);
        setIsAuthLoading(false);
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  async function refreshRecords() {
    setIsRecordsLoading(true);

    try {
      const loaded = await loadRecords();
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

  function handleMetadataChange(fieldId, value) {
    setMetadata((current) => ({
      ...current,
      [fieldId]: value
    }));
  }

  function handleProductChange(index, value) {
    setProducts((current) => current.map((product, itemIndex) => (
      itemIndex === index ? value : product
    )));
  }

  function handleAnswerChange(itemId, patch) {
    setAnswers((current) => ({
      ...current,
      [itemId]: {
        ...current[itemId],
        ...patch
      }
    }));
  }

  function toggleSection(sectionId) {
    setExpandedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId]
    }));
  }

  function setAllSectionsExpanded(expanded) {
    setExpandedSections(createExpandedSections(expanded));
  }

  function handleSprayerCountChange(sectionId, count) {
    setSprayerCounts((current) => ({
      ...current,
      [sectionId]: count
    }));
  }

  function clearChecklistData(clearSaveState = true) {
    setMetadata(createInitialMetadata());
    setProducts(createInitialProducts());
    setAnswers(buildInitialAnswers());
    setObservations("");
    if (clearSaveState) {
      setSaveState(null);
    }
    setSprayerCounts(createInitialSprayerCounts());
    setEditingRecord(null);
  }

  function resetForm() {
    clearChecklistData();
  }

  function startChecklist() {
    clearChecklistData();
    setIsChecklistActive(true);
    setView(CHECKLIST_VIEW);
  }

  function editRecord(record) {
    const nextProducts = createInitialProducts();

    (record.products ?? []).slice(0, nextProducts.length).forEach((product, index) => {
      nextProducts[index] = product;
    });

    setMetadata({
      ...createInitialMetadata(),
      ...(record.metadata ?? {})
    });
    setProducts(nextProducts);
    setAnswers({
      ...buildInitialAnswers(),
      ...(record.answers ?? {})
    });
    setObservations(record.observations ?? "");
    setSprayerCounts({
      ...createInitialSprayerCounts(),
      ...(record.metadata?.sprayerCounts ?? {})
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

    setActiveModule(null);
    setView(CHECKLIST_VIEW);
    setIsChecklistActive(false);
    clearChecklistData();
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
    const savedAtIso = savedAt.toISOString();
    const weekCode = getCurrentWeekCode();
    const record = {
      id: editingRecord?.id ?? crypto.randomUUID(),
      createdAt: editingRecord?.createdAt ?? savedAtIso,
      finishedAt: savedAtIso,
      metadata: {
        ...metadata,
        savedDate: formatSavedDate(savedAt),
        savedTime: formatSavedTime(savedAt),
        weekCode,
        sprayerCounts
      },
      products: products.filter((product) => product.trim()),
      answers,
      observations,
      score: result.earnedScore,
      maxScore: result.maxScore,
      nonCompliantScore: result.nonCompliantScore,
      calificationBaseScore: result.calificationBaseScore,
      calificationPercent: result.calificationPercent,
      compliancePercent: result.compliancePercent,
      summary: {
        compliant: result.compliant,
        nonCompliant: result.nonCompliant
      }
    };

    const nextRecords = editingRecord
      ? await updateRecord(record)
      : await saveRecord(record);
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

  async function handleLogout() {
    await clearSessionUser();
    setCurrentUser(null);
    setActiveModule(null);
    setIsChecklistActive(false);
    clearChecklistData();
  }

  if (isAuthLoading) {
    return <AuthLoadingScreen />;
  }

  if (!currentUser) {
    return <LoginScreen onLogin={setCurrentUser} />;
  }

  if (activeModule !== SPRAY_CHECKLIST_MODULE) {
    if (activeModule === RB_MONITORING_MODULE) {
      return (
        <RbMonitoringApp
          currentUser={currentUser}
          permissions={permissions}
          onHome={() => setActiveModule(null)}
          onLogout={handleLogout}
        />
      );
    }

    if (activeModule === DIRECT_MONITORING_MODULE) {
      return (
        <DirectMonitoringApp
          currentUser={currentUser}
          permissions={permissions}
          onHome={() => setActiveModule(null)}
          onLogout={handleLogout}
        />
      );
    }

    if (activeModule === TSWV_CHECKLIST_MODULE) {
      return (
        <TswvChecklistApp
          currentUser={currentUser}
          permissions={permissions}
          onHome={() => setActiveModule(null)}
          onLogout={handleLogout}
        />
      );
    }

    if (activeModule === ASPIRADO_CHECKLIST_MODULE) {
      return (
        <AspiradoChecklistApp
          currentUser={currentUser}
          permissions={permissions}
          onHome={() => setActiveModule(null)}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <HomeScreen
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenSprayChecklist={() => {
          setActiveModule(SPRAY_CHECKLIST_MODULE);
          setView(permissions.canCreateChecklists ? CHECKLIST_VIEW : RECORDS_VIEW);
          setIsChecklistActive(false);
        }}
        onOpenRbMonitoring={() => {
          setActiveModule(RB_MONITORING_MODULE);
        }}
        onOpenDirectMonitoring={() => {
          setActiveModule(DIRECT_MONITORING_MODULE);
        }}
        onOpenTswvChecklist={() => {
          setActiveModule(TSWV_CHECKLIST_MODULE);
        }}
        onOpenAspiradoChecklist={() => {
          setActiveModule(ASPIRADO_CHECKLIST_MODULE);
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Flores El Trigal</p>
          <h1>Listado chequeo ejecución aplicación de plaguicidas</h1>
        </div>
        <div className="header-actions">
          <span className="source-pill">{hasSupabaseConfig ? "Supabase activo" : "MVP local"}</span>
          <span className="source-pill">{currentUser.label}</span>
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
                {answeredCount} / {totalItems}
              </strong>
            </div>
            <div>
              <span>Calificación</span>
              <strong>
                {formatNumber(result.earnedScore)} / {formatNumber(result.calificationBaseScore)}
              </strong>
            </div>
            <div>
              <span>% Calificación</span>
              <strong>{formatNumber(result.calificationPercent)}%</strong>
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

          <MetadataSection
            metadata={metadata}
            products={products}
            expanded={expandedSections[metadataSection.id]}
            onToggle={() => toggleSection(metadataSection.id)}
            onMetadataChange={handleMetadataChange}
            onProductChange={handleProductChange}
            readOnly={!permissions.canEditRecords}
          />

          {scoredSections.map((section, index) => (
            <ChecklistSection
              key={section.id}
              section={section}
              index={index + 2}
              expanded={expandedSections[section.id]}
              answers={answers}
              sprayerCount={sprayerCounts[section.id] ?? section.matrix?.defaultSprayerCount ?? 1}
              onSprayerCountChange={(count) => handleSprayerCountChange(section.id, count)}
              onToggle={() => toggleSection(section.id)}
              onAnswerChange={handleAnswerChange}
              readOnly={!permissions.canEditRecords}
            />
          ))}

          <ObservationsSection
            value={observations}
            expanded={expandedSections[observationSection.id]}
            onToggle={() => toggleSection(observationSection.id)}
            onChange={setObservations}
            readOnly={!permissions.canEditRecords}
          />

          <SummaryPanel
            result={result}
            observations={observations}
            onSave={handleSaveRecord}
            saveState={saveState}
            canSave={permissions.canEditRecords}
          />
          </>
        ) : (
          <ChecklistStartScreen saveState={saveState} permissions={permissions} onCreate={startChecklist} />
        )
      ) : (
        <RecordsView
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

export default App;
