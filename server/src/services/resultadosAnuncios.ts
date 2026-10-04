import type { AdProposal } from '@prisma/client';
import { db } from '../db';
import { getDiasCampana, getEstadoCampana, type DiaCampana } from '../clients/metaApi';
import { getAcquisitionWindow, type AcquisitionWindowRow } from '../clients/finzenApi';
import { todayInRD } from '../util/fecha';

// ─────────────────────────────────────────────────────────────────────────
// El seguimiento de los anuncios de Kaizen (2026-10-05).
//
// Kaizen propone un anuncio, se crea en pausa, alguien lo activa… y hasta acá
// Kaizen nunca se enteraba de si funcionó. Esto cierra el ciclo:
//
//   Meta (por día)      gasto, impresiones, alcance, clics al enlace
//   FinZen (ventana)    visitantes y clics únicos a descargar con
//                       utm_campaign = nombre de la campaña
//
// La unión es exacta porque el nombre de la campaña de Kaizen ES su
// utm_campaign (services/publicidad.ts). No hace falta adivinar como con las
// campañas que cargan personas a mano.
//
// TODO se calcula acá y no lo calcula el modelo: un costo por clic que nadie
// puede reproducir es el error silencioso que la regla 1 quiere evitar.
//
// Lo que NO se afirma: registros ni suscripciones. Lo que FinZen llama
// "Registros" por campaña son clics únicos a "Descargar" (una aproximación de
// atribución, skill lectura-adquisicion-finzen §1), y la atribución puede
// perderse en el salto a la tienda (§2). Por eso los campos se llaman como lo
// que son.
// ─────────────────────────────────────────────────────────────────────────

/** Días con gasto antes de evaluar: el aprendizaje de Meta (skill adquisicion-pagada §4). */
export const DIAS_MINIMOS_EVALUACION = 7;
/** Hasta cuándo se sigue leyendo una campaña después de su fecha de fin. */
const DIAS_DE_GRACIA = 3;

export interface ResultadoAnuncio {
  /** effective_status en Meta al momento de leer. */
  estadoMeta: string;
  /** Ventana leída (días inclusivos). */
  desde: string;
  hasta: string;
  /** Primer día con gasto (≈ cuándo la activaron). Null si nunca gastó. */
  primerDiaConGasto: string | null;
  diasConGasto: number;
  gasto: number;
  impresiones: number;
  alcance: number;
  clicsEnlace: number;
  /** clicsEnlace / impresiones × 100, 2 decimales. Null sin impresiones. */
  ctrPct: number | null;
  /** gasto / clicsEnlace. Null sin clics. */
  costoPorClic: number | null;
  /** gasto / impresiones × 1000. */
  cpm: number | null;
  /** De FinZen, filtrado por utm_campaign = nombre. Null si FinZen no respondió. */
  finzen: { visitantes: number; clicsDescarga: number } | null;
  costoPorVisitante: number | null;
  costoPorClicDescarga: number | null;
  /** Por qué falta algo, en una línea (p. ej. FinZen caído). */
  avisos: string[];
  /** ¿Ya se puede evaluar? (≥ DIAS_MINIMOS_EVALUACION días con gasto). */
  evaluable: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const div = (a: number, b: number) => (b > 0 ? r2(a / b) : null);

/**
 * El cálculo, puro: días de Meta + filas de FinZen → resultado. Exportado para
 * probarlo sin red. Las filas de FinZen se filtran por campaign === nombre
 * (pueden venir varias si cambió el medium o el source).
 */
export function calcularResultado(
  nombre: string,
  estadoMeta: string,
  desde: string,
  hasta: string,
  dias: DiaCampana[],
  filasFinzen: AcquisitionWindowRow[] | null,
  avisos: string[] = [],
): ResultadoAnuncio {
  const conGasto = dias.filter((d) => d.gasto > 0);
  const suma = (k: keyof Omit<DiaCampana, 'fecha'>) => dias.reduce((acc, d) => acc + d[k], 0);
  const gasto = r2(suma('gasto'));
  const impresiones = suma('impresiones');
  const clicsEnlace = suma('clicsEnlace');

  let finzen: ResultadoAnuncio['finzen'] = null;
  if (filasFinzen) {
    const propias = filasFinzen.filter((f) => f.campaign === nombre);
    finzen = {
      visitantes: propias.reduce((a, f) => a + f.visitors, 0),
      clicsDescarga: propias.reduce((a, f) => a + f.leads_unicos, 0),
    };
  }

  return {
    estadoMeta,
    desde,
    hasta,
    primerDiaConGasto: conGasto[0]?.fecha ?? null,
    diasConGasto: conGasto.length,
    gasto,
    impresiones,
    // El alcance diario NO se suma bien (la misma persona cuenta cada día);
    // el máximo diario es un piso honesto, y se dice así en la nota.
    alcance: dias.reduce((m, d) => Math.max(m, d.alcance), 0),
    clicsEnlace,
    ctrPct: impresiones > 0 ? r2((clicsEnlace / impresiones) * 100) : null,
    costoPorClic: div(gasto, clicsEnlace),
    cpm: impresiones > 0 ? r2((gasto / impresiones) * 1000) : null,
    finzen,
    costoPorVisitante: finzen ? div(gasto, finzen.visitantes) : null,
    costoPorClicDescarga: finzen ? div(gasto, finzen.clicsDescarga) : null,
    avisos,
    evaluable: conGasto.length >= DIAS_MINIMOS_EVALUACION,
  };
}

/** YYYY-MM-DD de una fecha en hora RD. */
function diaRD(d: Date): string {
  return todayInRD(d);
}

/**
 * Lee Meta y FinZen para un anuncio creado y guarda el resultado. Meta es
 * obligatorio (sin eso no hay nada que guardar); FinZen es best-effort: si
 * falla, el resultado se guarda igual con un aviso.
 */
export async function actualizarResultado(ad: AdProposal): Promise<ResultadoAnuncio> {
  if (!ad.metaCampaignId || !ad.inicio) throw new Error(`El anuncio ${ad.id} no tiene campaña creada en Meta.`);
  const desde = diaRD(ad.inicio);
  const finLectura = ad.fin ? new Date(Math.min(Date.now(), ad.fin.getTime() + DIAS_DE_GRACIA * 86_400_000)) : new Date();
  const hasta = diaRD(finLectura);

  const [dias, estado] = await Promise.all([getDiasCampana(ad.metaCampaignId, desde, hasta), getEstadoCampana(ad.metaCampaignId)]);

  const avisos: string[] = [];
  let filas: AcquisitionWindowRow[] | null = null;
  try {
    filas = (await getAcquisitionWindow({ from: desde, to: hasta })).rows;
  } catch (e) {
    avisos.push(`No se pudo leer la adquisición de FinZen: ${e instanceof Error ? e.message : e}`);
  }

  const resultado = calcularResultado(ad.nombre, estado, desde, hasta, dias, filas, avisos);
  await db.adProposal.update({
    where: { id: ad.id },
    data: {
      resultado: resultado as object,
      resultadoEn: new Date(),
      ...(resultado.primerDiaConGasto && !ad.activadaEn ? { activadaEn: new Date(`${resultado.primerDiaConGasto}T12:00:00Z`) } : {}),
    },
  });
  return resultado;
}

/** Los anuncios que todavía vale la pena leer: creados y dentro de su ventana (+ gracia). */
export async function anunciosEnSeguimiento(): Promise<AdProposal[]> {
  const limite = new Date(Date.now() - DIAS_DE_GRACIA * 86_400_000);
  return db.adProposal.findMany({
    where: { status: 'CREATED_PAUSED', metaCampaignId: { not: null }, OR: [{ fin: null }, { fin: { gte: limite } }, { resultadoEn: null }] },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * El historial que la próxima propuesta tiene que tener a la vista: qué se
 * promocionó, cómo rindió y qué recomendó Kaizen. Texto corto, calculado acá.
 */
export async function historialParaAprender(limite = 8): Promise<string> {
  const ads = await db.adProposal.findMany({
    where: { status: 'CREATED_PAUSED', resultadoEn: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: limite,
  });
  const lineas = ads
    .filter((a) => a.resultado)
    .map((a) => {
      const r = a.resultado as unknown as ResultadoAnuncio;
      const partes = [
        `${a.nombre} (${a.mediaTipo ?? 'post'}, ${a.objetivo})`,
        r.diasConGasto ? `${r.diasConGasto} días con gasto, ${r.gasto} ${a.moneda}` : 'nunca se activó',
        r.ctrPct != null ? `CTR ${r.ctrPct}%` : null,
        r.costoPorClic != null ? `costo/clic ${r.costoPorClic}` : null,
        r.costoPorClicDescarga != null ? `costo/clic a descargar ${r.costoPorClicDescarga}` : null,
        a.recomendacion ? `Kaizen recomendó: ${a.recomendacion}` : null,
      ].filter(Boolean);
      return `- ${partes.join(' · ')}`;
    });
  return lineas.join('\n');
}
