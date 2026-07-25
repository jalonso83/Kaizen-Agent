import { db } from '../db';
import { drive } from '../clients/drive';

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

export async function runCerebroIndex(): Promise<void> {
  if (!drive.isConfigured()) {
    console.warn('[cerebro-index] Drive no configurado — se omite el indexado.');
    return;
  }

  const startedAt = Date.now();
  try {
    const entries = await drive.listCerebroFilesRecursive();
    const seenIds = new Set<string>();
    let updated = 0;
    let unchanged = 0;
    let omitted = 0;

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
        console.warn(`[cerebro-index] No se pudo leer "${entry.path}/${entry.name}":`, err instanceof Error ? err.message : err);
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

    console.log(
      `[cerebro-index] listo en ${Date.now() - startedAt}ms — ${updated} actualizados, ${unchanged} sin cambios, ` +
        `${omitted} omitidos (tipo no soportado), ${staleIds.length} borrados.`,
    );
  } catch (err) {
    console.error('[cerebro-index] Falló la corrida:', err instanceof Error ? err.message : err);
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
