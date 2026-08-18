import { db } from '../db';
import { drive } from '../clients/drive';
import { audit } from '../services/audit';

// ─────────────────────────────────────────────────────────────────────────
// Indexador del Cerebro — DISENO_FASE1.md §9. Listado recursivo de Drive,
// upsert en CerebroDoc por fileId SOLO si modifiedTime cambió (evita
// re-exportar/re-descargar todo en cada corrida), y borra las filas de
// archivos que ya no están en Drive. PDFs quedan fuera de esta v1 (el
// Cerebro hoy son Google Docs) — se loguean como omitidos, no como error.
//
// Arranca al boot de forma ASÍNCRONA (nunca bloquea ni tumba el arranque del
// server) + se repite cada 6h. Si Drive no está configurado, no hace nada
// (mismo criterio "opcional hasta que haga falta" que el resto de Fase 1).
// ─────────────────────────────────────────────────────────────────────────

const INDEX_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

export type CerebroIndexResult =
  | {
      ok: true;
      updated: number;
      unchanged: number;
      omitted: number;
      deleted: number;
      /** Listados por Drive pero imposibles de descargar — quedan FUERA del índice. */
      failed: string[];
      durationMs: number;
    }
  | { ok: false; error: string };

// El indexado tarda (lista Drive entero y re-descarga lo que cambió), así que
// dos corridas superpuestas —el intervalo de 6h justo cuando alguien pulsa
// "Reindexar"— se pisarían escribiendo las mismas filas. Un booleano alcanza:
// un solo proceso, igual que en el resumen semanal.
let isRunning = false;

export async function runCerebroIndex(): Promise<CerebroIndexResult> {
  if (!drive.isConfigured()) {
    console.warn('[cerebro-index] Drive no configurado — se omite el indexado.');
    return { ok: false, error: 'Drive no está configurado en este ambiente — no hay nada que indexar.' };
  }
  if (isRunning) {
    return { ok: false, error: 'Ya hay un indexado en curso — esperá a que termine.' };
  }
  isRunning = true;

  const startedAt = Date.now();
  try {
    const entries = await drive.listCerebroFilesRecursive();
    const seenIds = new Set<string>();
    let updated = 0;
    let unchanged = 0;
    let omitted = 0;
    // Archivos que Drive listó pero no se pudieron descargar. Antes esto era un
    // `continue` sin contador: el archivo desaparecía de los cuatro números y la
    // corrida se veía perfecta mientras un documento quedaba fuera del índice en
    // silencio (bug real, 2026-08-12 — una nota recién creada no aparecía en las
    // búsquedas y nada en el resultado lo delataba). Se guardan los nombres para
    // poder decir CUÁL falló sin tener que ir a los logs del server.
    const fallidos: string[] = [];

    for (const entry of entries) {
      seenIds.add(entry.id);

      const existing = await db.cerebroDoc.findUnique({ where: { id: entry.id }, select: { modifiedTime: true } });
      if (existing && existing.modifiedTime === entry.modifiedTime) {
        unchanged++;
        continue;
      }

      let text: string | null;
      try {
        text = await drive.fetchCerebroFileText(entry);
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        console.warn(`[cerebro-index] No se pudo leer "${entry.path}/${entry.name}":`, motivo);
        fallidos.push(`${entry.name} (${motivo.slice(0, 120)})`);
        continue;
      }
      if (text === null) {
        omitted++;
        console.warn(`[cerebro-index] "${entry.name}" (${entry.mimeType}) fuera de v1 (ej. PDF) — omitido.`);
        continue;
      }

      const data = { name: entry.name, path: entry.path, mimeType: entry.mimeType, text, modifiedTime: entry.modifiedTime, indexedAt: new Date() };
      await db.cerebroDoc.upsert({ where: { id: entry.id }, create: { id: entry.id, ...data }, update: data });
      updated++;
    }

    // Filas de docs que ya no están en Drive (borrados o movidos fuera del árbol).
    const allIds = await db.cerebroDoc.findMany({ select: { id: true } });
    const staleIds = allIds.map((d) => d.id).filter((id) => !seenIds.has(id));
    if (staleIds.length > 0) {
      await db.cerebroDoc.deleteMany({ where: { id: { in: staleIds } } });
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      `[cerebro-index] listo en ${durationMs}ms — ${updated} actualizados, ${unchanged} sin cambios, ` +
        `${omitted} omitidos (tipo no soportado), ${staleIds.length} borrados, ${fallidos.length} fallidos.`,
    );
    // Chequeo de cuadre: si los contadores no suman lo que Drive listó, hay un
    // camino que no está contando y volveríamos a tener archivos invisibles.
    const contados = updated + unchanged + omitted + fallidos.length;
    if (contados !== entries.length) {
      console.warn(`[cerebro-index] Descuadre: Drive listó ${entries.length} archivos y se contaron ${contados}.`);
    }

    // El job dejaba rastro SOLO en consola: la única fila de auditoría la
    // escribía el botón manual, así que la pantalla de Auditoría mostraba la
    // última vez que alguien pulsó "Reindexar" y nunca las corridas de cada 6h
    // (bug real, 2026-08-17: parecía que el indexado automático no corría).
    await audit.log({
      actor: 'cron',
      action: 'cerebro-index:done',
      resultSummary: `${updated} actualizados, ${unchanged} sin cambios, ${omitted} omitidos, ${staleIds.length} borrados, ${fallidos.length} fallidos`,
      isError: fallidos.length > 0,
      durationMs,
    });

    return { ok: true, updated, unchanged, omitted, deleted: staleIds.length, failed: fallidos, durationMs };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[cerebro-index] Falló la corrida:', error);
    await audit
      .log({ actor: 'cron', action: 'cerebro-index:error', resultSummary: error.slice(0, 2000), isError: true })
      .catch(() => undefined);
    return { ok: false, error };
  } finally {
    isRunning = false;
  }
}

let interval: ReturnType<typeof setInterval> | null = null;

/** Corrida inmediata (sin esperarla — no bloquea el boot) + cada 6h. */
export function startCerebroIndexJob(): void {
  if (!drive.isConfigured()) return;
  void runCerebroIndex();
  if (interval) clearInterval(interval);
  interval = setInterval(() => void runCerebroIndex(), INDEX_INTERVAL_MS);
}
