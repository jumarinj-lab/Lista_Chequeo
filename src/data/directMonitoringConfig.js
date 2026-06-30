export const DIRECT_MONITORING_ITEMS = [
  {
    id: "rendimiento",
    sectionTitle: "Rendimiento",
    label: "Rendimiento",
    criterion: "Cumple con el rendimiento definido para el monitoreo directo.",
    weight: 20
  },
  {
    id: "registro_marcacion",
    sectionTitle: "Monitoreo directo: registro de información y marcación de cama monitoreadas",
    label: "Registro de información y marcación de cama monitoreadas",
    criterion:
      "Registra la información y realiza la marcación de las camas monitoreadas según lo establecido.",
    weight: 75
  },
  {
    id: "informe_planos",
    sectionTitle: "Monitoreo directo: informe y entrega planos monitoreo",
    label: "Informe y entrega planos monitoreo",
    criterion: "Entrega el informe y los planos de monitoreo según lo establecido.",
    weight: 50,
    controls: [
      {
        id: "informe_implementos",
        label: "Implementos del monitor",
        criterion:
          "El monitor lleva: tablet, planillero, lápices y/o esferos, cinta, lupa, guantes y/o punzón.",
        weight: 5
      },
      {
        id: "informe_registro_trips",
        label: "Registro de individuos por sitio",
        criterion:
          "Verificar que se lleve el registro de individuos por sitio de trips ninfa y trips adulto.",
        weight: 5
      },
      {
        id: "informe_trampas_ica",
        label: "Monitoreo de trampas ICA",
        criterion: "Registra oportunamente el monitoreo de las trampas ICA.",
        weight: 5
      },
      {
        id: "informe_desglose_labor",
        label: "Desglose de la labor",
        criterion: "El monitor cumple con el desglose de la labor.",
        weight: 5
      },
      {
        id: "informe_trampas_internas",
        label: "Monitoreo de trampas internas",
        criterion: "Registra oportunamente el monitoreo de las trampas internas.",
        weight: 5
      },
      {
        id: "informe_cuadros_semana",
        label: "Cuadros a monitorear",
        criterion: "El monitor tiene presente los cuadros a monitorear según la semana.",
        weight: 5
      },
      {
        id: "informe_dispositivos",
        label: "Uso de dispositivos electrónicos",
        criterion: "El monitor usa adecuadamente los dispositivos electrónicos.",
        weight: 20
      }
    ]
  }
];

export const DIRECT_MONITORING_TOTAL_SCORE = DIRECT_MONITORING_ITEMS.reduce(
  (total, item) => total + item.weight,
  0
);
