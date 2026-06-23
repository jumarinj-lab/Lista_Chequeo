# MVP Listas de Chequeo

Aplicación React + Vite para digitalizar listas de chequeo de aspersión de plaguicidas y aseguramiento de monitoreo de roya blanca.

## Stack

- React 18
- Vite
- `localStorage` como respaldo local
- Supabase JS para guardar registros remotos
- GitHub Pages para publicación estática

## Ejecutar en local

```powershell
npm.cmd install
npm.cmd run dev
```

## Supabase

El MVP funciona sin Supabase, pero si existen variables de entorno guarda y carga registros desde Supabase. Para local, crea `.env.local` basado en `.env.example`:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

También acepta nombres compatibles con Next:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Ejecuta el SQL de [supabase/schema.sql](supabase/schema.sql) en el SQL Editor de Supabase. Crea estas tablas:

- `spray_checklist_records`
- `rb_monitoring_records`

### Usuarios

La app usa Supabase Auth. Crea estos usuarios en `Authentication > Users`:

- `jefemipe@trigal.com`: rol visual `jefe`
- `operariomipe@trigal.com`: rol visual `operario`
- `auxiliarpro@trigal.com`: rol visual `auxiliar`

Las contraseñas no se guardan en el repositorio; deben configurarse en Supabase.

## GitHub Pages

El workflow está en `.github/workflows/deploy-pages.yml`. En el repositorio de GitHub configura estos secretos en `Settings > Secrets and variables > Actions`:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

También puedes usar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

Después de hacer push a `main`, GitHub Actions construye la app y la publica en GitHub Pages.

La calificación de aspersión se calcula como:

```text
(total de pesos cumplidos / 212) x 100
```

## Pesos por confirmar

Los pesos estan centralizados en `src/data/checklistConfig.js`.

La seccion de revision de aspersores usa un calculo especial:

- Presion: 12 puntos por repeticion.
- Direccion: 36 puntos por repeticion.
- Tiempo: 50 puntos por repeticion.
- Total real evaluado: 294 puntos.
- Si hay varios aspersores, cada peso por repeticion se divide entre el numero de aspersores.
- Si el cumplimiento real es >= 90%, la seccion aporta 90 puntos a la calificacion.
- Si esta entre 80% y 89%, aporta 60 puntos.
- Si es menor a 79%, aporta 30 puntos.
