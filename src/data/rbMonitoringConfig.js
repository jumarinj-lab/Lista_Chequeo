export const RB_MONITORING_ITEMS = [
  {
    id: "kit_monitoreo",
    label: "El monitor cumple con el kit de monitoreo",
    criterion:
      "Varas de aluminio, carné con la sintomatología, bolsas, lapicero, libreta, lupa 30x, alcohol, gotero con aceite, cintas, pijama, chaleco.",
    weight: 15
  },
  {
    id: "unidad_monitorear",
    label: "El monitor cuenta con la unidad a monitorear",
    criterion: "El monitor se ubica en la cama asignada a monitorear.",
    weight: 5
  },
  {
    id: "desglose_labor",
    label: "El monitor cumple con el desglose de la labor",
    criterion: "Si no cumple, describir el paso o punto clave a mejorar.",
    weight: 20
  },
  {
    id: "devuelve_aviso",
    label: "Disposición de las varas",
    criterion:
      "Cuando el monitor detiene el monitoreo deja las varas en la línea y al retomar vuelve a revisar.",
    weight: 5
  },
  {
    id: "desinfeccion_varas",
    label: "Desinfecta varas y se asperja con alcohol",
    criterion:
      "Al finalizar el monitoreo de un lado y de la cama completa se detiene, desinfecta las varas y se asperja con alcohol en todo su cuerpo.",
    weight: 5
  },
  {
    id: "reporte_oportuno",
    label: "Recolección del hallazgo",
    criterion: "El monitor recolecta de manera adecuada el hallazgo en forma de guante.",
    weight: 10
  },
  {
    id: "reporte_sospecha",
    label: "Reporta sintomatología sospechosa",
    criterion:
      "Cuando encuentra sintomatología sospechosa y tiene dudas, reporta a su jefe.",
    weight: 5
  },
  {
    id: "registro_hallazgo",
    label: "Genera el reporte de un hallazgo según lo establecido",
    criterion:
      "Bloque, cama, lado, cuadro, edad de la planta, tercio en el que encuentra y variedad.",
    weight: 10
  },
  {
    id: "descansos_definidos",
    label: "Cumple con los tiempos establecidos para los descansos",
    criterion:
      "Realiza los descansos únicamente en los tiempos autorizados, evitando permanecer al final de la cama o sostener conversaciones excesivas con sus compañeros.",
    weight: 10
  },
  {
    id: "dispositivos_electronicos",
    label: "Usa adecuadamente los dispositivos electrónicos",
    criterion: "Uso adecuado de dispositivos electrónicos.",
    weight: 15
  }
];

export const RB_MONITORING_TOTAL_SCORE = 130;
export const RB_MONITORING_RENDIMIENTO_SCORE = 10;
export const RB_MONITORING_SIMULACROS_SCORE = 20;
export const RB_MONITORING_CONTROL_SCORE = 100;

export const RB_MONITORING_AGE_TIMES = [
  { id: "edad_1_4", label: "Edad 1-4", minutes: "12 min" },
  { id: "edad_5_7", label: "Edad 5-7", minutes: "20 min" },
  { id: "edad_8_12", label: "Edad 8-12", minutes: "30 min" }
];
