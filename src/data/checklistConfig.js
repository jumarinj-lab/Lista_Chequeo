export const CHECKLIST_SECTIONS = [
  {
    id: "datos",
    title: "Datos de asegurador, información general y aplicación",
    kind: "metadata",
    fields: [
      { id: "assurerName", label: "Nombre del asegurador", type: "text", required: true },
      { id: "assurerRole", label: "Cargo del asegurador", type: "text", required: true },
      { id: "block", label: "Bloque", type: "text", required: true },
      { id: "sprayerGroup", label: "Grupo aspersión", type: "text", required: true },
      { id: "stepsPerBed", label: "Número pases/cama", type: "decimal" },
      { id: "volumePerBed", label: "Volumen/cama", type: "decimal" },
      { id: "theoreticalFlow", label: "Caudal teórico", type: "decimal" },
      { id: "theoreticalTravelTime", label: "Tiempo recorrido teórico", type: "decimal" }
    ],
    productCount: 7
  },
  {
    id: "mezcla_clima",
    title: "Preparación de mezcla, temperatura y humedad",
    items: [
      {
        id: "ph",
        label: "pH",
        criterion: "Agua + adyuvante: 6.0 +/- 0.5. Agua + adyuvante + PPCs: 5.5 a 6.8",
        weight: 5 / 3,
        valueLabel: "Valor medido"
      },
      {
        id: "ce",
        label: "CE (mS/cm)",
        criterion: "Agua + adyuvante + PPCs: <= 1.5",
        weight: 5 / 3,
        valueLabel: "Valor medido"
      },
      {
        id: "dureza",
        label: "Dureza (ppm)",
        criterion: "Agua + adyuvante + PPCs: <= 60",
        weight: 5 / 3,
        valueLabel: "Valor medido"
      },
      {
        id: "temperatura",
        label: "Temperatura",
        criterion: "Menor a 28 C",
        weight: 1,
        valueLabel: "Valor"
      },
      {
        id: "humedad_relativa",
        label: "Humedad relativa",
        criterion: "Mayor a 40%",
        weight: 1,
        valueLabel: "Valor"
      }
    ]
  },
  {
    id: "elementos",
    title: "Elementos",
    items: [
      {
        id: "agitador",
        label: "Agitador",
        criterion: "En funcionamiento",
        weight: 8
      },
      {
        id: "premezcla",
        label: "Premezcla",
        criterion: "Plaguicidas por separado en balde plástico con agua acidulada y adyuvante",
        weight: 10
      },
      {
        id: "mezcla",
        label: "Mezcla",
        criterion: "Orden de mezcla, adición de plaguicidas programados",
        weight: 8
      },
      {
        id: "envases_limpios",
        label: "Envases limpios",
        criterion: "Triple enjuague de todos los envases",
        weight: 8
      }
    ]
  },
  {
    id: "requerimientos_aspersion",
    title: "Requerimientos de aspersión",
    items: [
      {
        id: "lanza",
        label: "Lanza",
        criterion: "Definida en programa",
        weight: 5
      },
      {
        id: "alineacion",
        label: "Alineación en la aplicación",
        criterion: "Los colaboradores conservan la línea",
        weight: 25
      },
      {
        id: "lavado_filtros",
        label: "Lavado de filtros y boquillas",
        criterion: "Se realiza lavado de boquillas y filtros por bloque",
        weight: 10
      },
      {
        id: "avisos_informativos",
        label: "Avisos informativos",
        criterion: "En entradas al bloque",
        weight: 8
      },
      {
        id: "operarios",
        label: "Operarios",
        criterion: "Vistiendo todos EPP",
        weight: 3
      },
      {
        id: "manejo_cortinas",
        label: "Manejo de cortinas",
        criterion: "Se suben y bajan las cortinas oportunamente",
        weight: 10
      },
      {
        id: "drenaje_manguera",
        label: "Drenaje de manguera",
        criterion: "Dentro del bloque en camino central, sin generar charcos",
        weight: 10
      }
    ]
  },
  {
    id: "revision_aspersores",
    title: "Revisión de asperjadores",
    matrix: {
      defaultSprayerCount: 1,
      maxSprayerCount: 6,
      rawTotalWeight: 294,
      totalWeight: 90
    },
    items: [
      {
        id: "presion_rev_1",
        label: "Presión - revisión 1",
        criterion: "Presión entre lanzas no diferente a +/- 10 psi",
        weight: 12
      },
      {
        id: "presion_rev_2",
        label: "Presión - revisión 2",
        criterion: "Presión entre lanzas no diferente a +/- 10 psi",
        weight: 12
      },
      {
        id: "presion_rev_3",
        label: "Presión - revisión 3",
        criterion: "Presión entre lanzas no diferente a +/- 10 psi",
        weight: 12
      },
      {
        id: "direccion_rev_1",
        label: "Dirección - revisión 1",
        criterion: "Dirección de aplicación igual a la del programa",
        weight: 36
      },
      {
        id: "direccion_rev_2",
        label: "Dirección - revisión 2",
        criterion: "Dirección de aplicación igual a la del programa",
        weight: 36
      },
      {
        id: "direccion_rev_3",
        label: "Dirección - revisión 3",
        criterion: "Dirección de aplicación igual a la del programa",
        weight: 36
      },
      {
        id: "tiempo_rev_1",
        label: "Tiempo - revisión 1",
        criterion: "Tiempo recorrido no diferente a +/- 10% del tiempo teórico",
        weight: 50
      },
      {
        id: "tiempo_rev_2",
        label: "Tiempo - revisión 2",
        criterion: "Tiempo recorrido no diferente a +/- 10% del tiempo teórico",
        weight: 50
      },
      {
        id: "tiempo_rev_3",
        label: "Tiempo - revisión 3",
        criterion: "Tiempo recorrido no diferente a +/- 10% del tiempo teórico",
        weight: 50
      }
    ],
    note: "La sección suma el peso real cumplido sobre 294. Si alcanza 90% o más aplica 90 puntos; entre 80% y 89% aplica 60 puntos; menor a 79% aplica 30 puntos."
  },
  {
    id: "mangueras",
    title: "Mangueras",
    items: [
      {
        id: "mangueras_transporte",
        label: "Mangueras",
        criterion: "Ubicadas en carro de transporte para traslado",
        weight: 10
      }
    ]
  },
  {
    id: "observaciones",
    title: "Observaciones",
    kind: "observations"
  }
];

export function getScoredSections() {
  return CHECKLIST_SECTIONS.filter((section) => Array.isArray(section.items));
}

export function getMaxScore() {
  return getScoredSections().reduce(
    (total, section) => total + section.items.reduce((sum, item) => sum + item.weight, 0),
    0
  );
}
