import { expect, test } from "@playwright/test";
import {
  MAX_MULTI_DAY,
  MAX_SERIES_SESSIONS,
  buildSessions,
  daysBetween,
  defaultRule,
  describeRule,
  expandRule,
  formatDayShort,
  isDate,
  validateRule,
  weekdayOf,
  type RecurrenceRule,
} from "../../src/lib/recurrence";

/**
 * Motor de fechas de las series (eventos de varios días y recurrentes):
 * lógica pura, sin navegador ni servidor. Cada sesión es un evento de verdad;
 * aquí se comprueba qué fechas salen, con el cambio de hora resuelto, sin
 * duplicados y dentro de los topes.
 *
 *   npm run test:e2e:partner
 */

const regla = (cambios: Partial<RecurrenceRule>): RecurrenceRule => ({ ...defaultRule("recurring"), ...cambios });

test.describe("fechas de calendario", () => {
  test("isDate y weekdayOf", () => {
    expect(isDate("2026-10-16")).toBe(true);
    expect(isDate("2028-02-29")).toBe(true);
    for (const mala of ["2026-02-30", "2026-13-01", "26-01-01", "2026-1-1", "", null, undefined, 20261016]) {
      expect(isDate(mala as unknown), String(mala)).toBe(false);
    }
    expect(weekdayOf("2026-10-12")).toBe(1); // lunes
    expect(weekdayOf("2026-10-16")).toBe(5); // viernes
    expect(weekdayOf("2026-10-18")).toBe(7); // domingo
    expect(daysBetween("2026-10-16", "2026-10-18")).toBe(2);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(formatDayShort("2026-10-16")).toBe("vie 16 oct");
  });
});

test.describe("expandRule", () => {
  test("varios días seguidos (diaria hasta una fecha): ambos extremos incluidos", () => {
    const r = regla({ kind: "multi_day", frequency: "daily", endMode: "until", endsOn: "2026-10-18" });
    expect(expandRule("2026-10-16", r).dates).toEqual(["2026-10-16", "2026-10-17", "2026-10-18"]);
    // Cruza fin de mes y de año.
    const año = regla({ kind: "multi_day", frequency: "daily", endMode: "until", endsOn: "2027-01-02" });
    expect(expandRule("2026-12-30", año).dates).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  test("diaria: cada N días, por número de sesiones", () => {
    expect(expandRule("2026-10-16", regla({ frequency: "daily", endMode: "count", count: 3 })).dates).toEqual([
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
    expect(expandRule("2026-10-16", regla({ frequency: "daily", interval: 2, endMode: "count", count: 4 })).dates).toEqual([
      "2026-10-16",
      "2026-10-18",
      "2026-10-20",
      "2026-10-22",
    ]);
  });

  test("semanal: sin días elegidos, el de la primera fecha; con interval y hasta una fecha", () => {
    const base = regla({ frequency: "weekly", endMode: "count", count: 4 });
    expect(expandRule("2026-10-16", base).dates).toEqual(["2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06"]);
    expect(expandRule("2026-10-16", { ...base, interval: 2, count: 3 }).dates).toEqual(["2026-10-16", "2026-10-30", "2026-11-13"]);
    expect(expandRule("2026-10-16", { ...base, endMode: "until", endsOn: "2026-11-13" }).dates).toEqual([
      "2026-10-16",
      "2026-10-23",
      "2026-10-30",
      "2026-11-06",
      "2026-11-13",
    ]);
    // La fecha final se incluye y la anterior a la primera no cuenta.
    expect(expandRule("2026-10-16", { ...base, endMode: "until", endsOn: "2026-10-16" }).dates).toEqual(["2026-10-16"]);
    expect(expandRule("2026-10-16", { ...base, endMode: "until", endsOn: "2026-10-15" }).dates).toEqual([]);
  });

  test("semanal con días concretos: viernes y sábados; lunes y miércoles empezando un viernes", () => {
    const base = regla({ frequency: "weekly", endMode: "count" });
    expect(expandRule("2026-10-16", { ...base, weekdays: [5, 6], count: 5 }).dates).toEqual([
      "2026-10-16",
      "2026-10-17",
      "2026-10-23",
      "2026-10-24",
      "2026-10-30",
    ]);
    // Empieza un viernes pero solo se eligen lunes y miércoles: nada de ese viernes ni de los días anteriores de su semana.
    expect(expandRule("2026-10-16", { ...base, weekdays: [3, 1], count: 4 }).dates).toEqual([
      "2026-10-19",
      "2026-10-21",
      "2026-10-26",
      "2026-10-28",
    ]);
    // Días repetidos o inválidos se ignoran; vacío vale el de la primera fecha.
    expect(expandRule("2026-10-16", { ...base, weekdays: [5, 5, 9, 0], count: 2 }).dates).toEqual(["2026-10-16", "2026-10-23"]);
  });

  test("mensual: el mismo día del mes (el 31 cae el último día) y cada 2 meses, cruzando año", () => {
    const base = regla({ frequency: "monthly", monthlyMode: "day_of_month", endMode: "count" });
    expect(expandRule("2026-01-31", { ...base, count: 4 }).dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(expandRule("2028-01-31", { ...base, count: 2 }).dates).toEqual(["2028-01-31", "2028-02-29"]); // bisiesto
    expect(expandRule("2026-10-15", { ...base, interval: 2, count: 3 }).dates).toEqual(["2026-10-15", "2026-12-15", "2027-02-15"]);
    expect(expandRule("2026-11-15", { ...base, count: 3 }).dates).toEqual(["2026-11-15", "2026-12-15", "2027-01-15"]);
  });

  test("mensual: el mismo día de la semana (tercer viernes; el último cuando es el quinto)", () => {
    const base = regla({ frequency: "monthly", monthlyMode: "nth_weekday", endMode: "count", count: 3 });
    // 16 oct 2026 es el tercer viernes.
    expect(expandRule("2026-10-16", base).dates).toEqual(["2026-10-16", "2026-11-20", "2026-12-18"]);
    // 30 oct 2026 es el quinto viernes: se toma el último de cada mes.
    expect(expandRule("2026-10-30", base).dates).toEqual(["2026-10-30", "2026-11-27", "2026-12-25"]);
  });

  test("fechas elegidas a mano: ordenadas, sin duplicados ni inválidas", () => {
    const r = regla({ frequency: "custom", customDates: ["2026-11-02", "2026-10-16", "2026-10-16", "2026-02-30", "2026-12-24"] });
    expect(expandRule("", r).dates).toEqual(["2026-10-16", "2026-11-02", "2026-12-24"]);
  });

  test("las fechas quitadas no salen pero se pueden volver a poner", () => {
    const r = regla({ frequency: "weekly", endMode: "count", count: 4, excluded: ["2026-10-23"] });
    const e = expandRule("2026-10-16", r);
    expect(e.dates).toEqual(["2026-10-16", "2026-10-30", "2026-11-06"]);
    expect(e.all).toEqual(["2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06"]);
  });

  test("topes: máximo de sesiones, también cuando la regla da más; pedir exactamente el máximo no es pasarse", () => {
    const pasada = expandRule("2026-10-12", regla({ frequency: "weekly", endMode: "count", count: 500 }));
    expect(pasada.dates).toHaveLength(MAX_SERIES_SESSIONS);
    expect(pasada.truncated).toBe(true);

    const exacta = expandRule("2026-10-12", regla({ frequency: "weekly", endMode: "count", count: MAX_SERIES_SESSIONS }));
    expect(exacta.dates).toHaveLength(MAX_SERIES_SESSIONS);
    expect(exacta.truncated).toBe(false);

    const hastaLejos = expandRule("2026-10-12", regla({ frequency: "daily", endMode: "until", endsOn: "2031-01-01" }));
    expect(hastaLejos.dates).toHaveLength(MAX_SERIES_SESSIONS);
    expect(hastaLejos.truncated).toBe(true);

    // Dentro del tope: no se corta.
    const corta = expandRule("2026-10-12", regla({ frequency: "daily", endMode: "until", endsOn: "2026-10-20" }));
    expect(corta.dates).toHaveLength(9);
    expect(corta.truncated).toBe(false);

    // Una regla sin primera fecha válida no inventa nada.
    expect(expandRule("", regla({ frequency: "daily" })).dates).toEqual([]);
    expect(expandRule("2026-13-40", regla({ frequency: "daily" })).dates).toEqual([]);
  });

  test("ninguna regla se queda en un bucle: interval enorme o negativo", () => {
    expect(expandRule("2026-10-16", regla({ frequency: "daily", interval: 100000, endMode: "count", count: 5 })).dates).toEqual(["2026-10-16"]);
    expect(expandRule("2026-10-16", regla({ frequency: "weekly", interval: -3, endMode: "count", count: 2 })).dates).toHaveLength(2);
    expect(expandRule("2026-10-16", regla({ frequency: "monthly", interval: 0, endMode: "count", count: 2 })).dates).toHaveLength(2);
  });
});

test.describe("buildSessions: el cambio de hora no desplaza las sesiones", () => {
  test("otoño en Madrid (25 oct 2026): 23:30 sigue siendo 23:30 antes y después", () => {
    const s = buildSessions(["2026-10-24", "2026-10-25", "2026-10-26"], { startTime: "23:30", endTime: "06:00" }, "Europe/Madrid");
    expect(s.map((x) => x.startIso)).toEqual(["2026-10-24T21:30:00.000Z", "2026-10-25T22:30:00.000Z", "2026-10-26T22:30:00.000Z"]);
    expect(s.map((x) => x.crossesMidnight)).toEqual([true, true, true]);
    // El fin de la primera es el 25 a las 06:00 ya con la hora de invierno.
    expect(s[0].endIso).toBe("2026-10-25T05:00:00.000Z");
    expect(s[1].endIso).toBe("2026-10-26T05:00:00.000Z");
    expect(s.map((x) => x.date)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });

  test("primavera en Madrid (28 mar 2027) y sin hora de fin", () => {
    const s = buildSessions(["2027-03-27", "2027-03-28", "2027-03-29"], { startTime: "23:30", endTime: "" }, "Europe/Madrid");
    expect(s.map((x) => x.startIso)).toEqual(["2027-03-27T22:30:00.000Z", "2027-03-28T21:30:00.000Z", "2027-03-29T21:30:00.000Z"]);
    expect(s.every((x) => x.endIso === null && !x.crossesMidnight)).toBe(true);
  });

  test("otra zona: Canarias va una hora por detrás de la Península", () => {
    const s = buildSessions(["2026-10-16"], { startTime: "23:30", endTime: "04:00" }, "Atlantic/Canary");
    expect(s[0].startIso).toBe("2026-10-16T22:30:00.000Z"); // WEST, UTC+1
    expect(s[0].endIso).toBe("2026-10-17T03:00:00.000Z");
  });

  test("una hora de inicio no válida no genera sesiones", () => {
    expect(buildSessions(["2026-10-16"], { startTime: "", endTime: "06:00" }, "Europe/Madrid")).toEqual([]);
  });
});

test.describe("validateRule", () => {
  test("lo que no se puede crear", () => {
    expect(validateRule("", regla({ frequency: "weekly" }))).toBe("Elige la primera fecha.");
    expect(validateRule("2026-10-16", regla({ frequency: "weekly", interval: 0 }))).toMatch(/entero entre 1 y 52/);
    expect(validateRule("2026-10-16", regla({ frequency: "weekly", interval: 1.5 }))).toMatch(/entero entre 1 y 52/);
    expect(validateRule("2026-10-16", regla({ frequency: "weekly", endMode: "count", count: 0 }))).toMatch(/entre 1 y 100/);
    expect(validateRule("2026-10-16", regla({ frequency: "weekly", endMode: "count", count: 101 }))).toMatch(/entre 1 y 100/);
    expect(validateRule("2026-10-16", regla({ frequency: "weekly", endMode: "until", endsOn: "" }))).toBe("Elige hasta qué fecha se repite.");
    expect(validateRule("2026-10-16", regla({ frequency: "weekly", endMode: "until", endsOn: "2026-10-01" }))).toMatch(/anterior a la primera/);
    expect(validateRule("2026-10-16", regla({ frequency: "weekly", endMode: "until", endsOn: "2029-01-01" }))).toMatch(/2 años/);
    expect(validateRule("2026-10-16", regla({ frequency: "weekly", weekdays: [8], endMode: "count", count: 3 }))).toMatch(/días de la semana/);
    expect(validateRule("", regla({ frequency: "custom", customDates: [] }))).toMatch(/al menos una fecha/);
    // Más de 100 sesiones: se pide acortar en vez de cortar por detrás.
    expect(validateRule("2026-10-12", regla({ frequency: "daily", endMode: "until", endsOn: "2027-06-01" }))).toMatch(/hasta 100 sesiones/);
  });

  test("varios días: al menos 2 y como mucho 30", () => {
    const multi = (fin: string) => regla({ kind: "multi_day", frequency: "daily", endMode: "until", endsOn: fin });
    expect(validateRule("2026-10-16", multi(""))).toBe("Elige el último día.");
    expect(validateRule("2026-10-16", multi("2026-10-16"))).toMatch(/al menos 2 días/);
    expect(validateRule("2026-10-16", multi("2026-10-15"))).toMatch(/al menos 2 días/);
    expect(validateRule("2026-10-16", multi("2026-10-17"))).toBeNull();
    expect(validateRule("2026-10-16", multi("2026-11-14"))).toBeNull(); // 30 días
    expect(validateRule("2026-10-16", multi("2026-11-15"))).toMatch(new RegExp(`hasta ${MAX_MULTI_DAY} días`));
  });

  test("lo que sí se puede crear", () => {
    expect(validateRule("2026-10-16", regla({ frequency: "weekly", weekdays: [5, 6], endMode: "count", count: 8 }))).toBeNull();
    expect(validateRule("2026-10-16", regla({ frequency: "monthly", endMode: "until", endsOn: "2027-06-16" }))).toBeNull();
    expect(validateRule("", regla({ frequency: "custom", customDates: ["2026-10-16", "2026-11-20"] }))).toBeNull();
    // Todo excluido: no queda nada que crear.
    expect(
      validateRule(
        "2026-10-16",
        regla({ frequency: "daily", endMode: "count", count: 2, excluded: ["2026-10-16", "2026-10-17"] }),
      ),
    ).toBe("Con esas opciones no sale ninguna fecha.");
  });
});

test.describe("describeRule", () => {
  test("en español, con lo que de verdad se va a crear", () => {
    expect(describeRule("2026-10-16", regla({ kind: "multi_day", frequency: "daily", endMode: "until", endsOn: "2026-10-18" }))).toBe(
      "3 días seguidos · del 16 oct 2026 al 18 oct 2026",
    );
    expect(describeRule("2026-10-16", regla({ frequency: "weekly", weekdays: [5, 6], endMode: "count", count: 4 }))).toBe(
      "Todos los viernes y sábados · 4 sesiones hasta el 24 oct 2026",
    );
    expect(describeRule("2026-10-16", regla({ frequency: "weekly", interval: 2, endMode: "count", count: 3 }))).toBe(
      "Cada 2 semanas, los viernes · 3 sesiones hasta el 13 nov 2026",
    );
    expect(describeRule("2026-10-16", regla({ frequency: "daily", endMode: "count", count: 1 }))).toBe("Todos los días · 1 sesión hasta el 16 oct 2026");
    expect(describeRule("2026-10-16", regla({ frequency: "monthly", monthlyMode: "nth_weekday", endMode: "count", count: 3 }))).toBe(
      "El tercer viernes de cada mes · 3 sesiones hasta el 18 dic 2026",
    );
    expect(describeRule("2026-10-30", regla({ frequency: "monthly", monthlyMode: "nth_weekday", endMode: "count", count: 2 }))).toBe(
      "El último viernes de cada mes · 2 sesiones hasta el 27 nov 2026",
    );
    expect(describeRule("2026-10-15", regla({ frequency: "monthly", interval: 2, endMode: "count", count: 3 }))).toBe(
      "El día 15 de cada 2 meses · 3 sesiones hasta el 15 feb 2027",
    );
    expect(describeRule("", regla({ frequency: "custom", customDates: ["2026-10-16", "2026-11-20"] }))).toBe("Fechas elegidas · 2 sesiones");
  });
});
