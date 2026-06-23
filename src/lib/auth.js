import { hasSupabaseConfig, supabase } from "./supabase";

const USER_PROFILES = [
  {
    username: "jefe",
    email: "jefemipe@trigal.com",
    role: "jefe",
    label: "jefe"
  },
  {
    username: "operario",
    email: "operariomipe@trigal.com",
    role: "operario",
    label: "operario"
  },
  {
    username: "auxiliar",
    email: "auxiliarpro@trigal.com",
    role: "auxiliar",
    label: "auxiliar"
  }
];

export const ROLE_PERMISSIONS = {
  jefe: {
    canCreateChecklists: true,
    canEditRecords: true,
    canDownloadExcel: true
  },
  operario: {
    canCreateChecklists: true,
    canEditRecords: true,
    canDownloadExcel: false
  },
  auxiliar: {
    canCreateChecklists: false,
    canEditRecords: false,
    canDownloadExcel: true
  }
};

function normalizeLogin(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getProfileByLogin(login) {
  const normalizedLogin = normalizeLogin(login);

  return USER_PROFILES.find((profile) =>
    profile.username === normalizedLogin || profile.email === normalizedLogin
  );
}

function getProfileByEmail(email) {
  const normalizedEmail = normalizeLogin(email);
  return USER_PROFILES.find((profile) => profile.email === normalizedEmail) ?? null;
}

function toSessionUser(profile, sessionUser) {
  return {
    id: sessionUser?.id ?? null,
    email: profile.email,
    username: profile.username,
    role: profile.role,
    label: profile.label
  };
}

export function getPermissions(user) {
  return ROLE_PERMISSIONS[user?.role] ?? ROLE_PERMISSIONS.auxiliar;
}

export async function authenticateUser(login, password) {
  if (!hasSupabaseConfig || !supabase) {
    throw new Error("Supabase no está configurado.");
  }

  const profile = getProfileByLogin(login);

  if (!profile) {
    throw new Error("Usuario no autorizado.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: String(password ?? "")
  });

  if (error) {
    throw new Error("Usuario o contraseña incorrectos.");
  }

  return toSessionUser(profile, data.user);
}

export async function loadSessionUser() {
  if (!hasSupabaseConfig || !supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.user?.email) {
    return null;
  }

  const profile = getProfileByEmail(data.session.user.email);

  if (!profile) {
    await supabase.auth.signOut();
    return null;
  }

  return toSessionUser(profile, data.session.user);
}

export async function clearSessionUser() {
  if (hasSupabaseConfig && supabase) {
    await supabase.auth.signOut();
  }
}
