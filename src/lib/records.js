import { hasSupabaseConfig, supabase } from "./supabase";

const LOCAL_STORAGE_KEY = "spray-checklist-records";
const TABLE_NAME = "spray_checklist_records";
const SYNC_PENDING = "pending";
const SYNC_SYNCED = "synced";
const RECORDS_RESET_AT = Date.parse("2026-06-23T15:33:29.521Z");

function isAfterReset(record) {
  const timestamp = new Date(record.finishedAt ?? record.createdAt ?? 0).getTime();
  return !Number.isFinite(RECORDS_RESET_AT)
    || !Number.isFinite(timestamp)
    || timestamp >= RECORDS_RESET_AT;
}

function readLocalRecords() {
  const stored = localStorage.getItem(LOCAL_STORAGE_KEY);

  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter(isAfterReset).map((record) => ({
        ...record,
        syncStatus: record.syncStatus ?? SYNC_PENDING
      }))
      : [];
  } catch {
    return [];
  }
}

function writeLocalRecords(records) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
}

function getRecordTimestamp(record) {
  const timestamp = new Date(record.finishedAt ?? record.createdAt ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function markRecordSynced(record) {
  return {
    ...record,
    syncStatus: SYNC_SYNCED,
    syncedAt: new Date().toISOString()
  };
}

function markRecordPending(record) {
  return {
    ...record,
    syncStatus: SYNC_PENDING
  };
}

function mapSupabaseRecord(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    metadata: row.metadata ?? {},
    products: row.products ?? [],
    answers: row.answers ?? {},
    observations: row.observations ?? "",
    score: Number(row.score ?? 0),
    maxScore: Number(row.max_score ?? 0),
    nonCompliantScore: row.non_compliant_score == null ? null : Number(row.non_compliant_score),
    calificationBaseScore: row.calification_base_score == null ? 212 : Number(row.calification_base_score),
    calificationPercent: row.calification_percent == null ? null : Number(row.calification_percent),
    compliancePercent: Number(row.compliance_percent ?? 0),
    summary: row.summary ?? { compliant: [], nonCompliant: [] },
    syncStatus: SYNC_SYNCED,
    syncedAt: row.finished_at ?? row.created_at
  };
}

function toSupabaseRow(record) {
  return {
    id: record.id,
    created_at: record.createdAt,
    finished_at: record.finishedAt,
    metadata: record.metadata,
    products: record.products,
    answers: record.answers,
    observations: record.observations,
    score: record.score,
    max_score: record.maxScore,
    non_compliant_score: record.nonCompliantScore,
    calification_base_score: record.calificationBaseScore,
    calification_percent: record.calificationPercent,
    compliance_percent: record.compliancePercent,
    summary: record.summary
  };
}

function mergeRecords(localRecords, remoteRecords) {
  const mergedById = new Map(remoteRecords.map((record) => [record.id, record]));

  for (const localRecord of localRecords) {
    const remoteRecord = mergedById.get(localRecord.id);

    if (
      localRecord.syncStatus === SYNC_PENDING ||
      (remoteRecord && getRecordTimestamp(localRecord) > getRecordTimestamp(remoteRecord))
    ) {
      mergedById.set(localRecord.id, localRecord);
    }
  }

  return [...mergedById.values()]
    .sort((left, right) => getRecordTimestamp(right) - getRecordTimestamp(left))
    .slice(0, 100);
}

function getSourceLabel(source, records) {
  const pendingCount = records.filter((record) => record.syncStatus === SYNC_PENDING).length;

  if (!pendingCount) {
    return source;
  }

  return `${source} (${pendingCount} pendiente${pendingCount === 1 ? "" : "s"})`;
}

async function pushRecordToSupabase(record) {
  if (!hasSupabaseConfig || !supabase) {
    return false;
  }

  const { error } = await supabase.from(TABLE_NAME).upsert(toSupabaseRow(record));

  if (error) {
    throw error;
  }

  return true;
}

export async function syncLocalRecords() {
  const localRecords = readLocalRecords();

  if (!hasSupabaseConfig || !supabase) {
    return localRecords;
  }

  let changed = false;
  const syncedRecords = [];

  for (const record of localRecords) {
    if (record.syncStatus !== SYNC_PENDING) {
      syncedRecords.push(record);
      continue;
    }

    try {
      await pushRecordToSupabase(record);
      syncedRecords.push(markRecordSynced(record));
      changed = true;
    } catch {
      syncedRecords.push(record);
    }
  }

  if (changed) {
    writeLocalRecords(syncedRecords);
  }

  return syncedRecords;
}

export async function loadRecords() {
  const localRecords = await syncLocalRecords();

  if (hasSupabaseConfig && supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (!error && data) {
        const remoteRecords = data.map(mapSupabaseRecord).filter(isAfterReset);
        const mergedRecords = mergeRecords(localRecords, remoteRecords);
        writeLocalRecords(mergedRecords);

        return {
          records: mergedRecords,
          sourceLabel: getSourceLabel("Supabase", mergedRecords)
        };
      }
    } catch {
      // Offline or network failures fall back to local records.
    }
  }

  return {
    records: localRecords,
    sourceLabel: getSourceLabel(hasSupabaseConfig ? "Local/Supabase pendiente" : "Local", localRecords)
  };
}

export async function saveRecord(record) {
  let localRecords = [markRecordPending(record), ...readLocalRecords()].slice(0, 100);
  writeLocalRecords(localRecords);

  try {
    await pushRecordToSupabase(record);
    localRecords = localRecords.map((item) =>
      item.id === record.id ? markRecordSynced(item) : item
    );
    writeLocalRecords(localRecords);
  } catch {
    // Local save is the source of durability; pending records sync on the next online refresh.
  }

  return localRecords;
}

export async function updateRecord(record) {
  const existingRecords = readLocalRecords();
  const nextRecords = existingRecords.some((item) => item.id === record.id)
    ? existingRecords.map((item) => (item.id === record.id ? markRecordPending(record) : item))
    : [markRecordPending(record), ...existingRecords];

  let localRecords = nextRecords.slice(0, 100);
  writeLocalRecords(localRecords);

  try {
    await pushRecordToSupabase(record);
    localRecords = localRecords.map((item) =>
      item.id === record.id ? markRecordSynced(item) : item
    );
    writeLocalRecords(localRecords);
  } catch {
    // Local edits remain pending until Supabase is reachable.
  }

  return localRecords;
}

export function clearLocalRecords() {
  writeLocalRecords([]);
}
